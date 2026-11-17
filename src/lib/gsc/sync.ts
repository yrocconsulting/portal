import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { gscConfig, listSites, query, siteDomain } from "./google";

export type GscSyncResult = { configured: boolean; sites: number; days: number; errors: string[] };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return ymd(d);
};

/**
 * Pulls daily totals (16 months on the first run, then the last 10 days) plus the top queries and pages
 * for the latest 28 days, for every property the service account can read.
 */
export async function syncSearchConsole(): Promise<GscSyncResult> {
  const out: GscSyncResult = { configured: false, sites: 0, days: 0, errors: [] };
  const cfg = gscConfig();
  if (!cfg) return out;
  out.configured = true;
  const db = createAdminClient();

  const sites = await listSites(cfg);
  for (const s of sites) {
    const site = s.siteUrl;
    try {
      await db.from("gsc_sites").upsert({ site_url: site, domain: siteDomain(site), permission: s.permissionLevel });

      const { data: last } = await db.from("gsc_daily").select("date").eq("site_url", site).order("date", { ascending: false }).limit(1).maybeSingle();
      const start = last?.date ? ymd(new Date(new Date(last.date as string).getTime() - 10 * 86400000)) : daysAgo(486);
      const end = daysAgo(1);
      const daily = await query(cfg, site, { startDate: start, endDate: end, dimensions: ["date"], rowLimit: 25000 });
      if (daily.length) {
        const rows = daily.map((r) => ({ site_url: site, date: r.keys![0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position }));
        for (let i = 0; i < rows.length; i += 1000) {
          const { error } = await db.from("gsc_daily").upsert(rows.slice(i, i + 1000));
          if (error) throw new Error(error.message);
        }
        out.days += rows.length;
      }

      // Top lists for the latest complete 28 days (Search Console data lags 2 to 3 days).
      const latest = daily.length ? daily.map((r) => r.keys![0]).sort().at(-1)! : daysAgo(3);
      const periodEnd = latest;
      const periodStart = ymd(new Date(new Date(latest).getTime() - 27 * 86400000));
      const [queries, pages] = await Promise.all([
        query(cfg, site, { startDate: periodStart, endDate: periodEnd, dimensions: ["query"], rowLimit: 25 }),
        query(cfg, site, { startDate: periodStart, endDate: periodEnd, dimensions: ["page"], rowLimit: 25 }),
      ]);
      await db.from("gsc_top").delete().eq("site_url", site);
      const top = [
        ...queries.map((r) => ({ kind: "query", r })),
        ...pages.map((r) => ({ kind: "page", r })),
      ].map(({ kind, r }) => ({
        site_url: site,
        kind,
        period_start: periodStart,
        period_end: periodEnd,
        key: (r.keys?.[0] ?? "").slice(0, 1000),
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        ctr: r.ctr,
        position: r.position,
      }));
      if (top.length) {
        const { error } = await db.from("gsc_top").insert(top);
        if (error) throw new Error(error.message);
      }
      await db.from("gsc_sites").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("site_url", site);
      out.sites++;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      out.errors.push(`${site}: ${msg}`);
      await db.from("gsc_sites").update({ last_error: msg }).eq("site_url", site);
    }
  }
  return out;
}
