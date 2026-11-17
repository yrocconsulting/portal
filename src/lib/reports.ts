import "server-only";
import { siteForClient } from "@/lib/gsc/match";
import { createClient } from "@/lib/supabase/server";
import { trackedDomain } from "@/lib/visibility";

export type GscMonth = { clicks: number; impressions: number; ctr: number; position: number; days: number };
export type Results = {
  // partial_days: when the month isn't over yet, the comparison uses the same days of the previous month.
  gsc?: { site: string; month: GscMonth; previous: GscMonth | null; through?: string; partial_days?: number };
  ai?: { domain: string; report_date: string; visibility: number; appearances: number; mentions: number; links: number; prompts: number; strong_prompts: number };
};

export const monthStart = (ym: string) => `${ym.slice(0, 7)}-01`;
export const monthEnd = (ym: string) => {
  const [y, m] = ym.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const prevMonth = (ym: string) => {
  const [y, m] = ym.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
export const nextMonth = (ym: string) => {
  const [y, m] = ym.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
export function monthLabel(ym: string): string {
  const [y, m] = ym.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function sumDays(days: { clicks: number; impressions: number; position: number }[]): GscMonth {
  const clicks = days.reduce((a, d) => a + d.clicks, 0);
  const impressions = days.reduce((a, d) => a + d.impressions, 0);
  const position = impressions ? days.reduce((a, d) => a + d.position * d.impressions, 0) / impressions : 0;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: Math.round(position * 10) / 10, days: days.length };
}

/** That month's Google Search totals (vs the month before) and the latest AI visibility report in the month. */
export async function computeResults(
  client: { domain: string | null; tracking_domain: string | null; gsc_site_url: string | null },
  month: string,
): Promise<Results> {
  const supabase = await createClient();
  const out: Results = {};
  const start = monthStart(month);
  const end = monthEnd(month);

  const { data: sites } = await supabase.from("gsc_sites").select("site_url, domain");
  const site = siteForClient(client, sites ?? []);
  if (site) {
    const pStart = monthStart(prevMonth(month));
    const { data: days } = await supabase.from("gsc_daily").select("date, clicks, impressions, position").eq("site_url", site).gte("date", pStart).lte("date", end);
    const cur = (days ?? []).filter((d) => d.date >= start);
    if (cur.length) {
      const through = cur.map((d) => d.date).sort().at(-1)!;
      const lastDay = Number(through.slice(8, 10));
      const partial = through < end ? lastDay : undefined;
      // Compare like with like: a month in progress against the same days of the previous month.
      const prev = (days ?? []).filter((d) => d.date < start && (partial === undefined || Number(d.date.slice(8, 10)) <= partial));
      out.gsc = { site, month: sumDays(cur), previous: prev.length ? sumDays(prev) : null, through, partial_days: partial };
    }
  }

  const domain = trackedDomain(client);
  if (domain) {
    const { data: ai } = await supabase
      .from("prt_site_results")
      .select("*")
      .eq("domain", domain)
      .lte("report_date", end)
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ai && ai.report_date >= monthStart(prevMonth(month))) {
      const { count } = await supabase
        .from("prt_prompt_results")
        .select("id", { count: "exact", head: true })
        .eq("domain", domain)
        .eq("report_date", ai.report_date)
        .gte("visibility", 75);
      out.ai = {
        domain,
        report_date: ai.report_date,
        visibility: ai.visibility,
        appearances: ai.appearances,
        mentions: ai.mentions,
        links: ai.links,
        prompts: ai.prompts,
        strong_prompts: count ?? 0,
      };
    }
  }
  return out;
}
