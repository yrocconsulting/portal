import "server-only";
import { randomBytes } from "node:crypto";
import { itemDone } from "@/lib/report-progress";
import { type Results } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

/**
 * What a client sees. Built from a monthly record when the team publishes; contains nothing internal:
 * no item notes, no "not done" items, no staff names, no prices, no package name, no domains we track.
 */
export type ClientSnapshot = {
  v: 1;
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
  } | null;
  actions: { type: string | null; title: string; url: string | null; date: string | null }[];
  delivered: { section: string; items: { name: string; count: number | null }[] }[];
  published_at: string;
};

export const newShareToken = () => randomBytes(24).toString("base64url");

const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

export async function buildSnapshot(reportId: string): Promise<ClientSnapshot> {
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("monthly_reports")
    .select("*, client:clients(name, white_label, domain, tracking_domain)")
    .eq("id", reportId)
    .single();
  if (!r) throw new Error("Report not found.");
  const client = r.client as unknown as { name: string; white_label: boolean; domain: string | null; tracking_domain: string | null };
  const results = (r.results ?? {}) as Results;
  const month = (r.month as string).slice(0, 7);

  const [{ data: items }, { data: actions }] = await Promise.all([
    supabase.from("report_items").select("section, name, kind, status, count, target, position").eq("report_id", reportId).order("position"),
    supabase.from("report_actions").select("action_type, title, url, done_on").eq("report_id", reportId).order("done_on", { nullsFirst: false }),
  ]);

  // Only finished work, grouped by section.
  const delivered = new Map<string, { name: string; count: number | null }[]>();
  for (const it of items ?? []) {
    if (it.kind === "actions") continue;
    const done = itemDone(it) || (it.kind === "count" && (it.count ?? 0) > 0);
    if (!done) continue;
    const key = it.section ?? "Other";
    delivered.set(key, [...(delivered.get(key) ?? []), { name: it.name, count: it.kind === "count" ? it.count ?? null : null }]);
  }

  // Google Search: the month and the one before, day by day, for the chart.
  let gsc: ClientSnapshot["gsc"] = null;
  if (results.gsc) {
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

  // AI: prompts where most AI platforms recommend the client.
  let ai: ClientSnapshot["ai"] = null;
  if (results.ai) {
    const { data: won } = await supabase
      .from("prt_prompt_results")
      .select("prompt, platforms, visibility")
      .eq("domain", results.ai.domain)
      .eq("report_date", results.ai.report_date)
      .gte("visibility", 75)
      .order("visibility", { ascending: false })
      .limit(12);
    ai = {
      visibility: results.ai.visibility,
      appearances: results.ai.appearances,
      mentions: results.ai.mentions,
      citations: results.ai.links,
      prompts: results.ai.prompts,
      won: (won ?? []).map((w) => ({ prompt: w.prompt, platforms: w.platforms })),
    };
  }

  return {
    v: 1,
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
  };
}
