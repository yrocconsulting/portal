"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { extractQuote, readScreenshot } from "@/lib/quotes";
import { createClient } from "@/lib/supabase/server";
import { PLATFORMS } from "@/lib/visibility";

type Res = { error?: string; ok?: number };
const KINDS = ["ai", "gsc", "pr", "other"] as const;
const PLATFORM_KEYS = [...PLATFORMS.map(([k]) => k), "unknown"] as string[];

async function editable(reportId: string) {
  const db = await createClient();
  const { data: r } = await db.from("monthly_reports").select("status, client:clients(name, domain, website)").eq("id", reportId).single();
  if (!r) return { db, error: "Record not found." };
  if (r.status === "complete") return { db, error: "This month is archived. An admin can reopen it to make changes." };
  return { db, client: r.client as unknown as { name: string; domain: string | null; website: string | null } };
}
const done = (reportId: string): Res => {
  revalidatePath(`/reports/${reportId}`);
  return { ok: Date.now() };
};

export async function saveDesign(reportId: string, input: { hero_title: string; gsc_display: string; gbp_display?: string }): Promise<Res> {
  await requireStaff();
  const { db, error } = await editable(reportId);
  if (error) return { error };
  const gsc_display = ["auto", "show", "hide"].includes(input.gsc_display) ? input.gsc_display : "auto";
  const gbp_display = ["auto", "show", "hide"].includes(input.gbp_display ?? "") ? input.gbp_display : "auto";
  const { error: e } = await db
    .from("monthly_reports")
    .update({ hero_title: input.hero_title.trim().replace(/\s*\u2014\s*/g, ", ").slice(0, 200) || null, gsc_display, gbp_display, content_changed_at: new Date().toISOString() })
    .eq("id", reportId);
  return e ? { error: e.message } : done(reportId);
}

/** The browser uploads the image to report-media, then records it here. */
export async function addMedia(reportId: string, path: string, kind: string, caption: string): Promise<Res & { id?: string }> {
  await requireStaff();
  const { db, error } = await editable(reportId);
  if (error) return { error };
  if (!path.startsWith(`reports/${reportId}/`)) return { error: "Bad upload path." };
  const k = (KINDS as readonly string[]).includes(kind) ? kind : "other";
  const { data: last } = await db.from("report_media").select("position").eq("report_id", reportId).order("position", { ascending: false }).limit(1);
  const { data: row, error: e } = await db
    .from("report_media")
    .insert({ report_id: reportId, path, kind: k, caption: caption.trim().slice(0, 300) || null, position: (last?.[0]?.position ?? 0) + 1 })
    .select("id")
    .single();
  return e ? { error: e.message } : { ...done(reportId), id: row.id };
}

export async function updateMedia(reportId: string, id: string, kind: string, caption: string): Promise<Res> {
  await requireStaff();
  const { db, error } = await editable(reportId);
  if (error) return { error };
  const k = (KINDS as readonly string[]).includes(kind) ? kind : "other";
  const { error: e } = await db.from("report_media").update({ kind: k, caption: caption.trim().slice(0, 300) || null }).eq("id", id).eq("report_id", reportId);
  return e ? { error: e.message } : done(reportId);
}

export async function removeMedia(reportId: string, id: string): Promise<Res> {
  await requireStaff();
  const { db, error } = await editable(reportId);
  if (error) return { error };
  const { data: m } = await db.from("report_media").select("path").eq("id", id).eq("report_id", reportId).single();
  if (!m) return { error: "Not found." };
  await db.from("report_media").delete().eq("id", id);
  // Keep the file if a published snapshot may still show it; remove it only when nothing is published.
  const { data: r } = await db.from("monthly_reports").select("published_at").eq("id", reportId).single();
  if (!r?.published_at) await db.storage.from("report-media").remove([m.path]);
  return done(reportId);
}

/** Paste an AI answer from ProRankTracker: Claude picks the quote (verbatim) and the client's cited pages. */
export async function quoteFromAnswer(reportId: string, platform: string, prompt: string, answer: string): Promise<Res & { by?: string }> {
  await requireStaff();
  const { db, error, client } = await editable(reportId);
  if (error || !client) return { error };
  if (!PLATFORM_KEYS.includes(platform)) return { error: "Choose the AI platform." };
  if (answer.trim().length < 20) return { error: "Paste the AI's answer first." };
  try {
    const q = await extractQuote(answer, client.name, client.domain);
    const { data: last } = await db.from("report_quotes").select("position").eq("report_id", reportId).order("position", { ascending: false }).limit(1);
    const { error: e } = await db.from("report_quotes").insert({
      report_id: reportId,
      platform,
      prompt: prompt.trim().slice(0, 300) || null,
      quote: q.quote,
      note: q.note,
      cited_urls: q.cited_urls,
      position: (last?.[0]?.position ?? 0) + 1,
    });
    if (e) return { error: e.message };
    return { ...done(reportId), by: q.by };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveQuote(reportId: string, id: string | null, q: { platform: string; prompt: string; quote: string; note: string; cited_urls: string }): Promise<Res> {
  await requireStaff();
  const { db, error } = await editable(reportId);
  if (error) return { error };
  if (!PLATFORM_KEYS.includes(q.platform)) return { error: "Choose the AI platform." };
  if (!q.quote.trim()) return { error: "The quote is empty." };
  const row = {
    platform: q.platform,
    prompt: q.prompt.trim().slice(0, 300) || null,
    quote: q.quote.trim().slice(0, 1200),
    note: q.note.trim().replace(/\s*\u2014\s*/g, ", ").slice(0, 300) || null,
    cited_urls: q.cited_urls
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 10),
  };
  const { error: e } = id ? await db.from("report_quotes").update(row).eq("id", id).eq("report_id", reportId) : await db.from("report_quotes").insert({ ...row, report_id: reportId });
  return e ? { error: e.message } : done(reportId);
}

export async function removeQuote(reportId: string, id: string): Promise<Res> {
  await requireStaff();
  const { db, error } = await editable(reportId);
  if (error) return { error };
  await db.from("report_quotes").delete().eq("id", id).eq("report_id", reportId);
  return done(reportId);
}

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" } as const;

/** Claude reads an AI-results screenshot and adds the quotes it finds (once per screenshot). */
export async function readShot(reportId: string, mediaId: string, again = false): Promise<Res & { added?: number; note?: string }> {
  await requireStaff();
  const { db, error, client } = await editable(reportId);
  if (error || !client) return { error };
  const { data: m } = await db.from("report_media").select("id, path, kind, read_at").eq("id", mediaId).eq("report_id", reportId).single();
  if (!m) return { error: "Screenshot not found." };
  if (m.read_at && !again) return { note: "Already read." };
  const ext = (m.path.split(".").pop() ?? "").toLowerCase() as keyof typeof IMAGE_TYPES;
  const media_type = IMAGE_TYPES[ext];
  if (!media_type) return { error: "Claude can read PNG, JPG, WebP or GIF screenshots." };
  const { data: file, error: dl } = await db.storage.from("report-media").download(m.path);
  if (dl || !file) return { error: dl?.message ?? "Couldn't open the screenshot." };
  if (file.size > 5 * 1024 * 1024) return { error: "That screenshot is over 5 MB. Crop it to the pop-up and try again." };
  try {
    const read = await readScreenshot({ data: Buffer.from(await file.arrayBuffer()).toString("base64"), media_type }, client.name, client.domain);
    const { data: existing } = await db.from("report_quotes").select("quote, position").eq("report_id", reportId);
    const have = new Set((existing ?? []).map((q) => q.quote.trim().toLowerCase()));
    let pos = Math.max(0, ...(existing ?? []).map((q) => q.position));
    const rows = read.quotes
      .filter((q) => !have.has(q.toLowerCase()))
      .map((quote, i) => ({
        report_id: reportId,
        media_id: m.id,
        platform: read.platform ?? "unknown",
        prompt: read.prompt?.slice(0, 300) ?? null,
        quote: quote.slice(0, 1200),
        cited_urls: i === 0 ? read.cited_urls : [],
        position: ++pos,
      }));
    if (rows.length) {
      const { error: e } = await db.from("report_quotes").insert(rows);
      if (e) return { error: e.message };
    }
    const note = rows.length || !read.quotes.length ? read.note : "Quotes were already on the report.";
    await db.from("report_media").update({ read_at: new Date().toISOString(), read_note: note }).eq("id", m.id);
    revalidatePath(`/reports/${reportId}`);
    return { ok: Date.now(), added: rows.length, note };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
