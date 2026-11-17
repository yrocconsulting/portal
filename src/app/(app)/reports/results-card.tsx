import { fmtDate } from "@/lib/format";
import type { Results } from "@/lib/reports";

const n = (v: number) => v.toLocaleString("en-US");

function Delta({ now, before, lowerIsBetter = false, fmt = n }: { now: number; before?: number; lowerIsBetter?: boolean; fmt?: (v: number) => string }) {
  if (before === undefined || before === null) return null;
  const d = now - before;
  if (Math.abs(d) < 1e-9) return <span className="text-xs text-muted">same as last month</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={`text-xs font-semibold ${good ? "text-green-d" : "text-red-700"}`}>
      {d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}
    </span>
  );
}

/** The month's saved results: Google Search totals and the AI visibility report. */
export function ResultsCard({ results, at }: { results: Results; at: string | null }) {
  const g = results.gsc;
  const a = results.ai;
  if (!g && !a) {
    return (
      <p className="text-sm text-muted">
        No Google Search or AI visibility data for this client and month. Connect their Search Console property or tracked domain, then refresh.
      </p>
    );
  }
  const tiles: { label: string; value: string; sub?: React.ReactNode }[] = [];
  if (g) {
    tiles.push({ label: "Google clicks", value: n(g.month.clicks), sub: <Delta now={g.month.clicks} before={g.previous?.clicks} /> });
    tiles.push({ label: "Impressions", value: n(g.month.impressions), sub: <Delta now={g.month.impressions} before={g.previous?.impressions} /> });
    tiles.push({
      label: "Avg. position",
      value: g.month.position ? g.month.position.toFixed(1) : "none",
      sub: <Delta now={g.month.position} before={g.previous?.position} lowerIsBetter fmt={(v) => v.toFixed(1)} />,
    });
  }
  if (a) {
    tiles.push({ label: "AI visibility", value: `${a.visibility}%`, sub: <span className="text-xs text-muted">week of {fmtDate(a.report_date)}</span> });
    tiles.push({ label: "AI appearances", value: n(a.appearances), sub: <span className="text-xs text-muted">{a.mentions} mentions, {a.links} citations</span> });
    tiles.push({ label: "Prompts won", value: `${a.strong_prompts} of ${a.prompts}`, sub: <span className="text-xs text-muted">75%+ of AI platforms</span> });
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg bg-bg p-3">
            <p className="truncate text-xs font-semibold tracking-wide text-muted uppercase">{t.label}</p>
            <p className="font-display text-xl font-bold">{t.value}</p>
            {t.sub}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted">
        {g && (
          <>
            Google Search: {g.site}, data through {fmtDate(g.through ?? "")}.{" "}
            {g.partial_days ? `Month in progress: ▲▼ compare days 1 to ${g.partial_days} of each month. ` : "▲▼ compare with the previous month. "}
          </>
        )}
        {a && <>AI visibility: {a.domain}. </>}
        {at && <>Saved {fmtDate(at)}.</>}
      </p>
    </div>
  );
}
