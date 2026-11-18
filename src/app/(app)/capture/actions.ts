"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { todayCentral } from "@/lib/format";
import { clientUrls } from "@/lib/quotes";
import { createClient } from "@/lib/supabase/server";
import { PLATFORMS, trackedDomain } from "@/lib/visibility";

const normPrompt = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which client a ProRankTracker prompt belongs to, from the latest weekly results. */
export async function captureTargets(prompt: string) {
  await requireStaff();
  const db = await createClient();
  const [{ data: clients }, { data: latest }] = await Promise.all([
    db.from("clients").select("id, name, white_label, domain, tracking_domain").neq("status", "former").order("name"),
    db.from("prt_reports").select("report_date").order("report_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  let suggested: string | null = null;
  if (latest) {
    const { data: rows } = await db.from("prt_prompt_results").select("domain, prompt").eq("report_date", latest.report_date);
    const hits = [...new Set((rows ?? []).filter((r) => normPrompt(r.prompt) === normPrompt(prompt)).map((r) => r.domain))];
    if (hits.length === 1) suggested = (clients ?? []).find((c) => trackedDomain(c) === hits[0])?.id ?? null;
  }
  return { suggested, clients: (clients ?? []).map((c) => ({ id: c.id, name: c.name, white_label: c.white_label })), month: todayCentral().slice(0, 7) };
}

export async function saveCapture(input: { clientId: string; month: string; platform: string; prompt: string; quotes: string[]; links: string[] }): Promise<{ error?: string; reportId?: string; added?: number }> {
  await requireStaff();
  if (!PLATFORMS.some(([k]) => k === input.platform)) return { error: "Choose the AI platform." };
  if (!/^\d{4}-\d{2}$/.test(input.month)) return { error: "Choose the month." };
  const quotes = input.quotes.map((q) => q.trim()).filter(Boolean).slice(0, 20);
  if (!quotes.length) return { error: "Pick at least one mention." };
  const db = await createClient();
  const { data: client } = await db.from("clients").select("id, domain, website").eq("id", input.clientId).single();
  if (!client) return { error: "Client not found." };
  const { data: rid, error } = await db.rpc("start_monthly_report", { p_client: client.id, p_month: `${input.month}-01` });
  if (error || !rid) return { error: error?.message ?? "Couldn't open that month." };
  const reportId = String(rid);
  const { data: r } = await db.from("monthly_reports").select("status").eq("id", reportId).single();
  if (r?.status === "complete") return { error: "That month is archived. An admin can reopen it first." };

  const { data: existing } = await db.from("report_quotes").select("quote, position").eq("report_id", reportId);
  const have = new Set((existing ?? []).map((q) => q.quote.trim().toLowerCase()));
  let pos = Math.max(0, ...(existing ?? []).map((q) => q.position));
  const cited = clientUrls(input.links.join(" "), client.domain);
  const rows = quotes
    .filter((q) => !have.has(q.toLowerCase()))
    .map((quote, i) => ({
      report_id: reportId,
      platform: input.platform,
      prompt: input.prompt.slice(0, 300),
      quote: quote.slice(0, 1200),
      cited_urls: i === 0 ? cited : [],
      position: ++pos,
    }));
  if (rows.length) {
    const { error: e } = await db.from("report_quotes").insert(rows);
    if (e) return { error: e.message };
  }
  revalidatePath(`/reports/${reportId}`);
  return { reportId, added: rows.length };
}
