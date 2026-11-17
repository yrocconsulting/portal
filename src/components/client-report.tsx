import type { ClientSnapshot } from "@/lib/client-report";
import { PLATFORMS } from "@/lib/visibility";

/**
 * The client-facing monthly report. Pure presentation of a published snapshot.
 * brand "yroc": Yroc colors and logo. brand "none" (white-label clients): neutral, no Yroc name or logo.
 */

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const monthName = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};
const shortMonth = (ym: string, offset = 0) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
};
const platformLabel = (k: string) => PLATFORMS.find(([key]) => key === k)?.[1] ?? k;

type Theme = { hero: string; accent: string; accentText: string; accentSoft: string; stroke: string; stroke2: string; chip: string };
const THEMES: Record<ClientSnapshot["brand"], Theme> = {
  yroc: {
    hero: "bg-[#0B1220]",
    accent: "bg-[#7ED957]",
    accentText: "text-[#3F8F1C]",
    accentSoft: "bg-[#7ED957]/15",
    stroke: "#3F8F1C",
    stroke2: "#547590",
    chip: "bg-[#7ED957]/20 text-[#2f6e14]",
  },
  none: {
    hero: "bg-slate-900",
    accent: "bg-sky-400",
    accentText: "text-sky-700",
    accentSoft: "bg-sky-50",
    stroke: "#0369a1",
    stroke2: "#94a3b8",
    chip: "bg-sky-100 text-sky-800",
  },
};

function Change({ now, before, lowerIsBetter = false, suffix = "" }: { now: number; before: number | null | undefined; lowerIsBetter?: boolean; suffix?: string }) {
  if (before === null || before === undefined || before === 0) return null;
  const d = now - before;
  if (Math.abs(d) < 0.05) return <span className="text-xs text-slate-500">steady</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  const pct = !lowerIsBetter && before ? Math.round((d / before) * 100) : null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
      {d > 0 ? "▲" : "▼"}
      {pct !== null ? ` ${Math.abs(pct)}%` : ` ${Math.abs(d).toFixed(1)}${suffix}`}
    </span>
  );
}

function ClicksChart({ snap, theme }: { snap: ClientSnapshot; theme: Theme }) {
  const g = snap.gsc!;
  const cur = g.daily.filter((d) => d.date.startsWith(snap.month));
  const prev = g.daily.filter((d) => !d.date.startsWith(snap.month));
  if (cur.length < 2) return null;
  const w = 640;
  const h = 180;
  const days = 31;
  const max = Math.max(...g.daily.map((d) => d.clicks), 1);
  const path = (list: { date: string; clicks: number }[]) =>
    list
      .map((d, i) => {
        const x = ((Number(d.date.slice(8, 10)) - 1) / (days - 1)) * w;
        const y = h - 8 - (d.clicks / max) * (h - 24);
        return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const curPath = path(cur);
  const lastX = ((Number(cur[cur.length - 1].date.slice(8, 10)) - 1) / (days - 1)) * w;
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full" role="img" aria-label="Daily Google clicks, this month compared with last month">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={h - 8 - f * (h - 24)} y2={h - 8 - f * (h - 24)} stroke="#e2e8f0" strokeDasharray="3 4" />
        ))}
        {prev.length > 1 && <path d={path(prev)} fill="none" stroke={theme.stroke2} strokeWidth="2" strokeDasharray="5 5" opacity="0.7" />}
        <path d={`${curPath} L${lastX.toFixed(1)},${h} L0,${h} Z`} fill={theme.stroke} opacity="0.12" />
        <path d={curPath} fill="none" stroke={theme.stroke} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1 w-5 rounded" style={{ background: theme.stroke }} /> {shortMonth(snap.month)}
        </span>
        {prev.length > 1 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 border-t-2 border-dashed" style={{ borderColor: theme.stroke2 }} /> {shortMonth(snap.month, -1)}
          </span>
        )}
        <span>Daily clicks from Google Search</span>
      </figcaption>
    </figure>
  );
}

function Ring({ value, theme }: { value: number; theme: Theme }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 130 130" className="h-32 w-32 shrink-0" role="img" aria-label={`AI visibility ${value}%`}>
      <circle cx="65" cy="65" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
      <circle cx="65" cy="65" r={r} fill="none" stroke={theme.stroke} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 65 65)" />
      <text x="65" y="62" textAnchor="middle" className="fill-slate-900" style={{ font: "700 26px var(--font-inter-tight), sans-serif" }}>
        {value}%
      </text>
      <text x="65" y="82" textAnchor="middle" className="fill-slate-500" style={{ font: "500 10px var(--font-inter), sans-serif" }}>
        AI visibility
      </text>
    </svg>
  );
}

export function ClientReport({ snap, preview = false }: { snap: ClientSnapshot; preview?: boolean }) {
  const theme = THEMES[snap.brand];
  const g = snap.gsc;
  const wins = (snap.headline ?? "")
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
  const kpis: { label: string; value: string; change?: React.ReactNode; hint?: string }[] = [];
  if (g) {
    kpis.push({ label: "Clicks from Google", value: n(g.month.clicks), change: <Change now={g.month.clicks} before={g.previous?.clicks} /> });
    kpis.push({ label: "Times seen in Google", value: n(g.month.impressions), change: <Change now={g.month.impressions} before={g.previous?.impressions} /> });
    if (g.month.position) kpis.push({ label: "Average Google position", value: g.month.position.toFixed(1), change: <Change now={g.month.position} before={g.previous?.position} lowerIsBetter />, hint: "Lower is better" });
  }
  if (snap.ai) {
    kpis.push({ label: "AI answers naming you", value: n(snap.ai.appearances), hint: "ChatGPT, Gemini, Google AI and more" });
  }
  if (snap.leads !== null && snap.leads !== undefined) kpis.push({ label: "Leads from search", value: n(snap.leads) });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {preview && (
        <div className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950 print:hidden">Preview: this is what the client will see once you publish.</div>
      )}

      <header className={`${theme.hero} relative overflow-hidden px-5 pt-10 pb-24 text-white sm:px-8`}>
        <div className={`absolute -top-24 -right-24 h-72 w-72 rounded-full ${theme.accent} opacity-20 blur-3xl`} />
        <div className="relative mx-auto max-w-4xl">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold tracking-[0.25em] text-white/60 uppercase">{monthName(snap.month)} report</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {snap.brand === "yroc" && <img src="/logo-white.png" alt="Yroc Consulting" className="h-8 w-auto" />}
          </div>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">{snap.client}</h1>
          <p className="mt-2 text-lg text-white/70">Your search and AI visibility this month</p>
          {snap.note && <p className="mt-6 max-w-2xl text-base leading-relaxed whitespace-pre-wrap text-white/85">{snap.note}</p>}
        </div>
      </header>

      <main className="mx-auto -mt-16 max-w-4xl space-y-6 px-4 pb-16 sm:px-6">
        {wins.length > 0 && (
          <section className="relative rounded-2xl bg-white p-6 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200 sm:p-8">
            <p className={`text-xs font-bold tracking-[0.2em] uppercase ${theme.accentText}`}>This month&apos;s wins</p>
            <ul className="mt-4 space-y-3">
              {wins.map((w, i) => (
                <li key={i} className="flex gap-3 text-lg leading-snug font-medium">
                  <span className={`mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${theme.accent} text-sm font-bold text-slate-900`}>✓</span>
                  {w}
                </li>
              ))}
            </ul>
          </section>
        )}

        {kpis.length > 0 && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <p className="text-xs font-semibold text-slate-500">{k.label}</p>
                <p className="mt-1 font-display text-3xl font-bold tracking-tight">{k.value}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {k.change}
                  {k.hint && <span className="text-[11px] text-slate-400">{k.hint}</span>}
                </div>
              </div>
            ))}
          </section>
        )}

        {g && g.daily.length > 1 && (
          <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <h2 className="font-display text-xl font-bold">Google Search, day by day</h2>
            <p className="mt-1 text-sm text-slate-500">
              {g.previous ? (
                <>
                  {n(g.month.clicks)} clicks in {shortMonth(snap.month)}
                  {g.partial_days ? ` so far (days 1 to ${g.partial_days})` : ""}, compared with {n(g.previous.clicks)} in {shortMonth(snap.month, -1)}
                  {g.partial_days ? " over the same days" : ""}.
                </>
              ) : (
                <>{n(g.month.clicks)} clicks this month.</>
              )}
            </p>
            <div className="mt-4">
              <ClicksChart snap={snap} theme={theme} />
            </div>
          </section>
        )}

        {snap.ai && (
          <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <h2 className="font-display text-xl font-bold">How AI assistants talk about you</h2>
            <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-center">
              <Ring value={snap.ai.visibility} theme={theme} />
              <p className="text-base leading-relaxed text-slate-600">
                When people asked AI assistants the questions your customers ask, you were named <b className="text-slate-900">{n(snap.ai.appearances)} times</b>
                {snap.ai.citations > 0 && (
                  <>
                    , with your website cited as a source <b className="text-slate-900">{n(snap.ai.citations)} times</b>
                  </>
                )}
                . You show up in {snap.ai.visibility}% of the answers we track.
              </p>
            </div>
            {snap.ai.won.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-slate-500">Questions where AI recommends you</h3>
                <ul className="mt-3 space-y-2">
                  {snap.ai.won.map((p) => (
                    <li key={p.prompt} className={`rounded-xl ${theme.accentSoft} p-3`}>
                      <p className="font-medium">&ldquo;{p.prompt}&rdquo;</p>
                      <p className="mt-1.5 flex flex-wrap gap-1.5">
                        {p.platforms.map((k) => (
                          <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${theme.chip}`}>
                            {platformLabel(k)}
                          </span>
                        ))}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {(snap.actions.length > 0 || snap.delivered.length > 0) && (
          <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <h2 className="font-display text-xl font-bold">Work completed</h2>
            {snap.actions.length > 0 && (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {snap.actions.map((a, i) => (
                  <li key={i} className="rounded-xl border border-slate-200 p-4">
                    {a.type && <p className={`text-[11px] font-bold tracking-wide uppercase ${theme.accentText}`}>{a.type}</p>}
                    <p className="mt-1 font-semibold">{a.title}</p>
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-sm text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-900">
                        View it live
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {snap.delivered.length > 0 && (
              <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {snap.delivered.map((s) => (
                  <div key={s.section}>
                    <h3 className="text-sm font-semibold text-slate-500">{s.section}</h3>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {s.items.map((it) => (
                        <li key={it.name} className="flex gap-2">
                          <span className={theme.accentText}>✓</span>
                          <span>
                            {it.name}
                            {it.count ? <b className="ml-1">({it.count})</b> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {snap.next && (
          <section className={`rounded-2xl ${theme.hero} p-6 text-white sm:p-8`}>
            <h2 className="font-display text-xl font-bold">Coming up next month</h2>
            <p className="mt-3 leading-relaxed whitespace-pre-wrap text-white/85">{snap.next}</p>
          </section>
        )}

        <footer className="pt-4 text-center text-xs text-slate-400">
          {snap.brand === "yroc" ? "Prepared for you by Yroc Consulting" : "Monthly search performance report"} ·{" "}
          {new Date(snap.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </footer>
      </main>
    </div>
  );
}
