import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { siteForClient } from "@/lib/gsc/match";
import { createClient } from "@/lib/supabase/server";

type Day = { date: string; clicks: number; impressions: number; ctr: number; position: number };
type Top = { kind: "query" | "page"; key: string; clicks: number; impressions: number; ctr: number; position: number; period_start: string; period_end: string };

function sum(days: Day[]) {
  const clicks = days.reduce((a, d) => a + d.clicks, 0);
  const impressions = days.reduce((a, d) => a + d.impressions, 0);
  // Average position weighted by impressions, like Search Console.
  const position = impressions ? days.reduce((a, d) => a + d.position * d.impressions, 0) / impressions : 0;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

const n = (v: number) => v.toLocaleString("en-US");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Change({ now, before, lowerIsBetter = false, fmt }: { now: number; before: number; lowerIsBetter?: boolean; fmt: (v: number) => string }) {
  if (!before && !now) return null;
  if (!before) return <span className="text-xs text-muted">new</span>;
  const d = now - before;
  if (Math.abs(d) < 1e-9) return <span className="text-xs text-muted">no change</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`text-xs font-semibold ${good ? "text-green-d" : "text-red-700"}`} title="Compared with the 28 days before">
      {d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}
    </span>
  );
}

function Chart({ days }: { days: Day[] }) {
  if (days.length < 2) return null;
  const w = 600;
  const h = 120;
  const maxC = Math.max(...days.map((d) => d.clicks), 1);
  const maxI = Math.max(...days.map((d) => d.impressions), 1);
  const step = w / (days.length - 1);
  const line = (vals: number[], max: number) => vals.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - 6 - (v / max) * (h - 16)).toFixed(1)}`).join(" ");
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label="Daily clicks and impressions, last 90 days">
        <path d={line(days.map((d) => d.impressions), maxI)} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-steel/60" vectorEffect="non-scaling-stroke" />
        <path d={line(days.map((d) => d.clicks), maxC)} fill="none" stroke="currentColor" strokeWidth="2" className="text-green-d" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex flex-wrap justify-between gap-2 text-[11px] text-muted">
        <span>{fmtDate(days[0].date)}</span>
        <span className="flex gap-3">
          <span>
            <span className="mr-1 inline-block h-0.5 w-3 bg-green-d align-middle" />
            Clicks (max {n(maxC)}/day)
          </span>
          <span>
            <span className="mr-1 inline-block h-0.5 w-3 bg-steel/60 align-middle" />
            Impressions (max {n(maxI)}/day)
          </span>
        </span>
        <span>{fmtDate(days[days.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}

function TopTable({ title, rows, page }: { title: string; rows: Top[]; page?: boolean }) {
  if (!rows.length) return null;
  return (
    <div className="min-w-0">
      <h3 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="px-4 py-1 font-medium" />
            <th className="w-16 px-2 py-1 text-right font-medium">Clicks</th>
            <th className="w-20 px-2 py-1 text-right font-medium">Impr.</th>
            <th className="w-16 px-4 py-1 text-right font-medium">Pos.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, 10).map((r) => (
            <tr key={r.key}>
              <td className="truncate px-4 py-1.5" title={r.key}>
                {page ? (
                  <a href={r.key} target="_blank" rel="noreferrer" className="hover:text-green-d">
                    {r.key.replace(/^https?:\/\/[^/]+/, "") || "/"}
                  </a>
                ) : (
                  r.key
                )}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold">{n(r.clicks)}</td>
              <td className="px-2 py-1.5 text-right text-muted">{n(r.impressions)}</td>
              <td className="px-4 py-1.5 text-right text-muted">{r.position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Google Search Console for one client: last 28 days vs the 28 before, a 90 day chart and top queries/pages. */
export async function SearchConsole({ client }: { client: { gsc_site_url: string | null; domain: string | null } }) {
  const supabase = await createClient();
  const { data: sites } = await supabase.from("gsc_sites").select("site_url, domain, last_synced_at");
  const site = siteForClient(client, sites ?? []);
  if (!site) {
    return (
      <section className="card p-4">
        <h2 className="font-semibold">Google Search</h2>
        <p className="mt-1 text-sm text-muted">
          No Search Console property is connected for this client yet. <Link href="/search-console" className="text-green-d hover:underline">See connected properties</Link>.
        </p>
      </section>
    );
  }
  const [{ data: dayRows }, { data: topRows }] = await Promise.all([
    supabase.from("gsc_daily").select("date, clicks, impressions, ctr, position").eq("site_url", site).order("date", { ascending: false }).limit(90),
    supabase.from("gsc_top").select("*").eq("site_url", site).order("clicks", { ascending: false }),
  ]);
  const days = ((dayRows ?? []) as Day[]).reverse();
  if (!days.length) {
    return (
      <section className="card p-4">
        <h2 className="font-semibold">Google Search</h2>
        <p className="mt-1 text-sm text-muted">Connected to {site}, waiting for the first sync.</p>
      </section>
    );
  }
  const last28 = sum(days.slice(-28));
  const prev28 = sum(days.slice(-56, -28));
  const top = (topRows ?? []) as Top[];
  const period = top[0] ? `${fmtDate(top[0].period_start)} to ${fmtDate(top[0].period_end)}` : `last 28 days to ${fmtDate(days[days.length - 1].date)}`;
  const kpis = [
    { label: "Clicks", v: n(last28.clicks), c: <Change now={last28.clicks} before={prev28.clicks} fmt={n} /> },
    { label: "Impressions", v: n(last28.impressions), c: <Change now={last28.impressions} before={prev28.impressions} fmt={n} /> },
    { label: "CTR", v: pct(last28.ctr), c: <Change now={last28.ctr} before={prev28.ctr} fmt={(x) => `${(x * 100).toFixed(1)} pts`} /> },
    { label: "Avg. position", v: last28.position ? last28.position.toFixed(1) : "none", c: <Change now={last28.position} before={prev28.position} lowerIsBetter fmt={(x) => x.toFixed(1)} /> },
  ];

  return (
    <section className="card" id="google-search">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-semibold">Google Search</h2>
        <span className="text-xs text-muted">
          Search Console, {period} · <span className="font-mono">{site}</span>
        </span>
      </header>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg bg-bg p-3">
            <p className="truncate text-xs font-semibold tracking-wide text-muted uppercase">{k.label}</p>
            <p className="font-display text-2xl font-bold">{k.v}</p>
            {k.c}
          </div>
        ))}
      </div>
      <div className="border-t border-line px-4 py-3">
        <Chart days={days} />
      </div>
      {top.length > 0 && (
        <div className="grid border-t border-line pb-2 xl:grid-cols-2">
          <TopTable title="Top queries" rows={top.filter((t) => t.kind === "query")} />
          <TopTable title="Top pages" rows={top.filter((t) => t.kind === "page")} page />
        </div>
      )}
      <footer className="border-t border-line px-4 py-2 text-xs text-muted">▲▼ compared with the 28 days before. Position: lower is better.</footer>
    </section>
  );
}
