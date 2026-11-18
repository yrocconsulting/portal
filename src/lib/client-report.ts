import "server-only";
import { randomBytes } from "node:crypto";
import { PR_ITEM_PATTERN } from "@/lib/press-release";
import { itemDone } from "@/lib/report-progress";
import { type Results } from "@/lib/reports";
import { supabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * What a client sees. Built from a monthly record when the team publishes; contains nothing internal:
 * no item notes, no "not done" items, no staff names, no prices, no package name, no domains we track.
 */
export type ClientSnapshot = {
  v: 1 | 2;
  brand: "yroc" | "none";
  client: string;
  month: string; // YYYY-MM
  headline: string | null; // wins
  note: string | null;
  next: string | null;
  leads: number | null;
  gsc: {
    month: { clicks: number; impressions: number; ctr: number; position: number };
    previous: { clicks: number; impressions: number; ctr: number; position: number } | null;
    partial_days: number | null;
    daily: { date: string; clicks: number; impressions: number }[]; // this month and last
  } | null;
  ai: {
    visibility: number;
    appearances: number;
    mentions: number;
    citations: number;
    prompts: number;
    won: { prompt: string; platforms: string[] }[];
    // v2
    platforms?: Record<string, number>;
    top?: { prompt: string; visibility: number; appearances: number; counts: Record<string, number> }[];
  } | null;
  actions: { type: string | null; title: string; url: string | null; date: string | null }[];
  delivered: { section: string; items: { name: string; count: number | null }[] }[];
  published_at: string;
  // v2: the new design
  logo?: string | null; // public image URL
  color?: string | null; // #rrggbb
  city?: string | null;
  site?: string | null; // the client's own website, for the footer
  title?: string | null; // headline; *asterisks* mark the highlighted words
  quotes?: { platform: string; prompt: string | null; quote: string; note: string | null }[];
  cited?: { url: string; platforms: string[]; built: boolean }[];
  media?: { kind: "ai" | "gsc" | "pr" | "other"; url: string; caption: string | null }[];
  pr?: { title: string; url: string | null }[];
};

export const newShareToken = () => randomBytes(24).toString("base64url");

const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

/** Public URL of an image in the report-media bucket. */
export function mediaUrl(path: string): string {
  return `${supabaseUrl()}/storage/v1/object/public/report-media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Search Console shows when the team says so, or (auto) when clicks or impressions went up. */
export function gscPositive(results: Results): boolean {
  const g = results.gsc;
  if (!g?.previous) return false;
  return g.month.clicks > g.previous.clicks || g.month.impressions > g.previous.impressions;
}

const sameUrl = (a: string, b: string) => a.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").toLowerCase() === b.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").toLowerCase();

export async function buildSnapshot(reportId: string): Promise<ClientSnapshot> {
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("monthly_reports")
    .select("*, client:clients(name, white_label, domain, tracking_domain, website, city, logo_path, brand_color)")
    .eq("id", reportId)
    .single();
  if (!r) throw new Error("Report not found.");
  const client = r.client as unknown as {
    name: string;
    white_label: boolean;
    domain: string | null;
    tracking_domain: string | null;
    website: string | null;
    city: string | null;
    logo_path: string | null;
    brand_color: string | null;
  };
  const results = (r.results ?? {}) as Results;
  const month = (r.month as string).slice(0, 7);

  const [{ data: items }, { data: actions }, { data: quotes }, { data: media }] = await Promise.all([
    supabase.from("report_items").select("section, name, kind, status, count, target, position, client_facing, links, notes").eq("report_id", reportId).order("position"),
    supabase.from("report_actions").select("action_type, title, url, done_on").eq("report_id", reportId).order("done_on", { nullsFirst: false }),
    supabase.from("report_quotes").select("platform, prompt, quote, note, cited_urls").eq("report_id", reportId).order("position"),
    supabase.from("report_media").select("kind, path, caption").eq("report_id", reportId).order("position"),
  ]);

  // Only finished, client-facing work (the green rows in the SOP), grouped by section.
  const delivered = new Map<string, { name: string; count: number | null }[]>();
  for (const it of items ?? []) {
    if (it.kind === "actions" || !it.client_facing) continue;
    const done = itemDone(it) || (it.kind === "count" && (it.count ?? 0) > 0);
    if (!done) continue;
    const key = it.section ?? "Other";
    delivered.set(key, [...(delivered.get(key) ?? []), { name: it.name, count: it.kind === "count" ? it.count ?? null : null }]);
  }

  // Press release: the PR task's links (and its note as the title) once it's done.
  const prItem = (items ?? []).find((i) => new RegExp(PR_ITEM_PATTERN.replace(/%/g, ".*"), "i").test(i.name));
  const pr: NonNullable<ClientSnapshot["pr"]> = [];
  if (prItem && prItem.status === "done") {
    const links = ((prItem.links as string[] | null) ?? []).map((l) => safeUrl(l.trim())).filter((l): l is string => !!l);
    const title = (prItem.notes as string | null)?.split("\n")[0]?.trim() || null;
    if (links.length) links.forEach((url, i) => pr.push({ title: i === 0 && title ? title : "Read the published release", url }));
    else if (title) pr.push({ title, url: null });
  }

  // Google Search: the month and the one before, day by day, for the chart. Hidden unless positive (or forced).
  const showGsc = r.gsc_display === "show" || (r.gsc_display !== "hide" && gscPositive(results));
  let gsc: ClientSnapshot["gsc"] = null;
  if (results.gsc && showGsc) {
    const [y, m] = month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const { data: days } = await supabase.from("gsc_daily").select("date, clicks, impressions").eq("site_url", results.gsc.site).gte("date", from).lte("date", to).order("date");
    const pick = (x: { clicks: number; impressions: number; ctr: number; position: number }) => ({ clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position });
    gsc = {
      month: pick(results.gsc.month),
      previous: results.gsc.previous ? pick(results.gsc.previous) : null,
      partial_days: results.gsc.partial_days ?? null,
      daily: (days ?? []).map((d) => ({ date: d.date, clicks: d.clicks, impressions: d.impressions })),
    };
  }

  // AI: prompts where most AI platforms recommend the client, with counts per platform.
  let ai: ClientSnapshot["ai"] = null;
  if (results.ai) {
    const [{ data: won }, { data: site }] = await Promise.all([
      supabase
        .from("prt_prompt_results")
        .select("prompt, platforms, visibility, appearances, platform_counts")
        .eq("domain", results.ai.domain)
        .eq("report_date", results.ai.report_date)
        .gte("visibility", 75)
        .order("visibility", { ascending: false })
        .order("appearances", { ascending: false })
        .limit(12),
      supabase.from("prt_site_results").select("platforms").eq("domain", results.ai.domain).eq("report_date", results.ai.report_date).maybeSingle(),
    ]);
    ai = {
      visibility: results.ai.visibility,
      appearances: results.ai.appearances,
      mentions: results.ai.mentions,
      citations: results.ai.links,
      prompts: results.ai.prompts,
      won: (won ?? []).map((w) => ({ prompt: w.prompt, platforms: w.platforms })),
      platforms: (site?.platforms as Record<string, number> | null) ?? {},
      top: (won ?? []).slice(0, 4).map((w) => ({
        prompt: w.prompt,
        visibility: w.visibility,
        appearances: w.appearances,
        counts: (w.platform_counts as Record<string, number> | null) ?? Object.fromEntries((w.platforms as string[]).map((p) => [p, 0])),
      })),
    };
  }

  // Pages AI cited: the client's own URLs from the quotes. "Built" when we delivered that page this month.
  const actionUrls = (actions ?? []).map((a) => safeUrl(a.url)).filter((u): u is string => !!u);
  const cited = new Map<string, { url: string; platforms: string[]; built: boolean }>();
  for (const q of quotes ?? []) {
    for (const raw of (q.cited_urls as string[]) ?? []) {
      const url = safeUrl(raw);
      if (!url) continue;
      const key = url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").toLowerCase();
      const entry = cited.get(key) ?? { url, platforms: [], built: actionUrls.some((a) => sameUrl(a, url)) };
      if (!entry.platforms.includes(q.platform)) entry.platforms.push(q.platform);
      cited.set(key, entry);
    }
  }

  const color = client.brand_color && /^#[0-9a-f]{6}$/i.test(client.brand_color) ? client.brand_color : null;
  return {
    v: 2,
    brand: client.white_label ? "none" : "yroc",
    client: client.name,
    month,
    headline: r.wins?.trim() || null,
    note: r.client_note?.trim() || null,
    next: r.next_priorities?.trim() || null,
    leads: r.organic_leads ?? null,
    gsc,
    ai,
    actions: (actions ?? []).map((a) => ({ type: a.action_type, title: a.title, url: safeUrl(a.url), date: a.done_on })),
    delivered: [...delivered.entries()].map(([section, list]) => ({ section, items: list })),
    published_at: new Date().toISOString(),
    logo: client.logo_path ? mediaUrl(client.logo_path) : null,
    color,
    city: client.city,
    site: safeUrl(client.website) ?? (client.domain ? `https://${client.domain}` : null),
    title: (r.hero_title as string | null)?.trim() || null,
    quotes: (quotes ?? []).map((q) => ({ platform: q.platform, prompt: q.prompt, quote: q.quote, note: q.note })),
    cited: [...cited.values()],
    media: (media ?? []).filter((m) => m.kind !== "gsc" || !!gsc).map((m) => ({ kind: m.kind as "ai" | "gsc" | "pr" | "other", url: mediaUrl(m.path), caption: m.caption })),
    pr,
  };
}
