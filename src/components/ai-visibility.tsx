import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PLATFORMS, type PromptResult, type SiteResult } from "@/lib/visibility";

function Delta({ now, before, suffix = "" }: { now: number; before: number | undefined; suffix?: string }) {
  if (before === undefined) return null;
  const d = now - before;
  if (d === 0) return <span className="text-xs text-muted">no change</span>;
  return (
    <span className={`text-xs font-semibold ${d > 0 ? "text-green-d" : "text-red-700"}`} title="Change since last week">
      {d > 0 ? "▲" : "▼"} {Math.abs(d)}
      {suffix}
    </span>
  );
}

function Trend({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) return null;
  const w = 280;
  const h = 56;
  const max = Math.max(...points.map((p) => p.value), 1);
  const step = w / (points.length - 1);
  const xy = points.map((p, i) => [i * step, h - 4 - (p.value / max) * (h - 12)] as const);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" role="img" aria-label="Weekly appearances trend">
        <path d={`${d} L${w},${h} L0,${h} Z`} fill="currentColor" className="text-green/15" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-green-d" />
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.5" className="fill-green-d">
            <title>{`${fmtDate(points[i].date)}: ${points[i].value} appearances`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex justify-between text-[11px] text-muted">
        <span>{fmtDate(points[0].date)}</span>
        <span>Appearances by week</span>
        <span>{fmtDate(points[points.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}

/** Weekly AI visibility for one tracked domain (latest week, platform split, trend and every prompt). */
export async function AiVisibility({ domain, clientId }: { domain: string | null; clientId: string }) {
  if (!domain) {
    return (
      <section className="card p-4">
        <h2 className="font-semibold">AI visibility</h2>
        <p className="mt-1 text-sm text-muted">Add the client&apos;s website domain (or the tracked domain) in Client details to show their weekly ProRankTracker results.</p>
      </section>
    );
  }
  const supabase = await createClient();
  const { data: weeks } = await supabase.from("prt_site_results").select("*").eq("domain", domain).order("report_date", { ascending: false }).limit(26);
  const history = (weeks ?? []) as SiteResult[];
  if (!history.length) {
    return (
      <section className="card p-4">
        <h2 className="font-semibold">AI visibility</h2>
        <p className="mt-1 text-sm text-muted">
          No ProRankTracker results for <span className="font-mono">{domain}</span> yet. If this client is tracked under another domain, set it as the tracked
          domain in Client details. <Link href="/visibility" className="text-green-d hover:underline">See all tracked domains</Link>.
        </p>
      </section>
    );
  }
  const [cur, prev] = history;
  const { data: promptRows } = await supabase
    .from("prt_prompt_results")
    .select("*")
    .eq("domain", domain)
    .in("report_date", prev ? [cur.report_date, prev.report_date] : [cur.report_date])
    .order("visibility", { ascending: false });
  const prompts = ((promptRows ?? []) as PromptResult[]).filter((p) => p.report_date === cur.report_date);
  const before = new Map(((promptRows ?? []) as PromptResult[]).filter((p) => p.report_date !== cur.report_date).map((p) => [p.prompt, p.visibility]));
  const maxPlat = Math.max(...PLATFORMS.map(([k]) => cur.platforms?.[k] ?? 0), 1);

  const kpis: [string, number, number | undefined, string][] = [
    ["Visibility", cur.visibility, prev?.visibility, "%"],
    ["Appearances", cur.appearances, prev?.appearances, ""],
    ["Mentions", cur.mentions, prev?.mentions, ""],
    ["Citations", cur.links, prev?.links, ""],
  ];

  return (
    <section className="card" id="ai-visibility">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-semibold">AI visibility</h2>
        <span className="text-xs text-muted">
          ProRankTracker, week of {fmtDate(cur.report_date)} · {cur.prompts} prompts · <span className="font-mono">{domain}</span>
        </span>
      </header>
      <div className="grid gap-4 p-4 2xl:grid-cols-[1fr_300px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpis.map(([label, now, was, suffix]) => (
            <div key={label} className="rounded-lg bg-bg p-3">
              <p className="truncate text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
              <p className="font-display text-2xl font-bold">
                {now}
                {suffix}
              </p>
              <Delta now={now} before={was} suffix={suffix === "%" ? " pts" : ""} />
            </div>
          ))}
        </div>
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 2xl:grid-cols-1">
          {PLATFORMS.map(([k, label]) => {
            const n = cur.platforms?.[k] ?? 0;
            return (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-muted">{label}</span>
                <span className="h-2 flex-1 rounded-full bg-bg">
                  <span className="block h-2 rounded-full bg-green-d" style={{ width: `${(n / maxPlat) * 100}%` }} />
                </span>
                <span className="w-6 text-right font-semibold">{n}</span>
              </div>
            );
          })}
        </div>
      </div>
      {history.length > 1 && (
        <div className="border-t border-line px-4 py-3">
          <Trend points={[...history].reverse().map((w) => ({ date: w.report_date, value: w.appearances }))} />
        </div>
      )}
      {prompts.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <th className="px-4 py-2.5">Prompt</th>
                <th className="px-4 py-2.5">Named by</th>
                <th className="px-4 py-2.5 text-right">Visibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {prompts.map((p) => {
                const was = before.get(p.prompt);
                return (
                  <tr key={p.prompt}>
                    <td className="px-4 py-2.5">{p.prompt}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {PLATFORMS.map(([k, label]) => (
                          <span
                            key={k}
                            title={label}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${p.platforms.includes(k) ? "bg-green/20 text-green-d" : "bg-bg text-muted/60 line-through"}`}
                          >
                            {label}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <span className="font-semibold">{p.visibility}%</span>
                      {was !== undefined && was !== p.visibility && (
                        <span className={`ml-1 text-xs ${p.visibility > was ? "text-green-d" : "text-red-700"}`}>
                          {p.visibility > was ? "▲" : "▼"}
                          {Math.abs(p.visibility - was)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <footer className="flex justify-between border-t border-line px-4 py-2 text-xs text-muted">
        <span>▲▼ change since last week. Visibility: share of AI platforms that named the client for that prompt.</span>
        <Link href={`/tickets/new?client=${clientId}`} className="text-green-d hover:underline">
          Make a ticket from this
        </Link>
      </footer>
    </section>
  );
}
