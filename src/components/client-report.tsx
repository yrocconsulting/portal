import type { ClientSnapshot } from "@/lib/client-report";
import { PLATFORMS } from "@/lib/visibility";
import { reportBody, reportDisplay } from "./report-fonts";

/**
 * The client-facing monthly report. Pure presentation of a published snapshot.
 * Colors come from the client's brand color and logo. brand "none" (white-label clients): no Yroc
 * name or logo anywhere. brand "yroc": a small "Prepared by Yroc Consulting" in the footer.
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
const platformLabel = (k: string) => PLATFORMS.find(([key]) => key === k)?.[1] ?? (k === "unknown" ? "AI answer" : k);
const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
const path = (u: string) => {
  try {
    const p = new URL(u).pathname;
    return p === "/" ? host(u) : p;
  } catch {
    return u;
  }
};
const lines = (t: string | null | undefined) =>
  (t ?? "")
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);

// ---- color: everything derives from the client's brand color ----
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (c: string, with_: string, t: number) => {
  const a = hex(c);
  const b = hex(with_);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
};
const lum = (c: string) => {
  const [r, g, b] = hex(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function palette(snap: ClientSnapshot) {
  const base = snap.color ?? (snap.brand === "yroc" ? "#3F8F1C" : "#3B6EA5");
  // On the dark hero the accent must be light enough to read; on white it must be dark enough.
  let onDark = base;
  while (lum(onDark) < 0.18) onDark = mix(onDark, "#ffffff", 0.15);
  let ink = base;
  while (lum(ink) > 0.12) ink = mix(ink, "#000000", 0.15);
  return { accent: base, onDark, ink, soft: mix(base, "#ffffff", 0.88), wash: mix(base, "#ffffff", 0.94) };
}

function Highlight({ text, mark }: { text: string; mark: string }) {
  // *words* become the accent color.
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") ? (
          <span key={i} className={mark}>
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** The client's name (and the name without LLC/Inc.) highlighted inside an AI quote. */
function QuoteText({ quote, client }: { quote: string; client: string }) {
  const short = client.replace(/[\s,]+(llc|inc\.?|co\.?|corp\.?|ltd\.?|pllc)$/i, "").trim();
  const names = [...new Set([client, short].filter((x) => x.length > 2))].sort((a, b) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${names.map(esc).join("|")})`, "gi");
  return (
    <>
      {quote.split(re).map((p, i) =>
        names.some((nm) => nm.toLowerCase() === p.toLowerCase()) ? (
          <span key={i} className="cr-mk">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Change({ now, before, lowerIsBetter = false }: { now: number; before: number | null | undefined; lowerIsBetter?: boolean }) {
  if (before === null || before === undefined || before === 0) return null;
  const d = now - before;
  if (Math.abs(d) < 0.05) return <span className="cr-chg">steady</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  const pct = !lowerIsBetter ? Math.round((d / before) * 100) : null;
  return (
    <span className={`cr-chg ${good ? "up" : "down"}`}>
      {d > 0 ? "▲" : "▼"}
      {pct !== null ? ` ${Math.abs(pct)}%` : ` ${Math.abs(d).toFixed(1)}`} vs last month
    </span>
  );
}

function ClicksChart({ snap, color }: { snap: ClientSnapshot; color: string }) {
  const g = snap.gsc!;
  const cur = g.daily.filter((d) => d.date.startsWith(snap.month));
  const prev = g.daily.filter((d) => !d.date.startsWith(snap.month));
  if (cur.length < 2) return null;
  const w = 640;
  const h = 180;
  const days = 31;
  const max = Math.max(...g.daily.map((d) => d.clicks), 1);
  const d = (list: { date: string; clicks: number }[]) =>
    list
      .map((x, i) => {
        const px = ((Number(x.date.slice(8, 10)) - 1) / (days - 1)) * w;
        const py = h - 8 - (x.clicks / max) * (h - 24);
        return `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ");
  const curPath = d(cur);
  const lastX = ((Number(cur[cur.length - 1].date.slice(8, 10)) - 1) / (days - 1)) * w;
  return (
    <figure className="cr-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Daily Google clicks, this month compared with last month">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={h - 8 - f * (h - 24)} y2={h - 8 - f * (h - 24)} stroke="#e3e0da" strokeDasharray="3 4" />
        ))}
        {prev.length > 1 && <path d={d(prev)} fill="none" stroke="#9a968f" strokeWidth="2" strokeDasharray="5 5" />}
        <path d={`${curPath} L${lastX.toFixed(1)},${h} L0,${h} Z`} fill={color} opacity="0.12" />
        <path d={curPath} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption>
        <span>
          <i style={{ background: color }} /> {shortMonth(snap.month)}
        </span>
        {prev.length > 1 && (
          <span>
            <i className="dash" /> {shortMonth(snap.month, -1)}
          </span>
        )}
        <span>Daily clicks from Google Search</span>
      </figcaption>
    </figure>
  );
}

function Shots({ items }: { items: NonNullable<ClientSnapshot["media"]> }) {
  if (!items.length) return null;
  return (
    <div className={`cr-shots ${items.length === 1 ? "one" : ""}`}>
      {items.map((m) => (
        <figure key={m.url}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.url} alt={m.caption ?? "Screenshot"} loading="lazy" />
          {m.caption && <figcaption>{m.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

const CSS = `
.cr{--bg:#f6f5f3;--surface:#fff;--surface-2:#efedea;--fg:#1a1a1a;--muted:#6c6a66;--line:#e3e0da;--good:#1f9d55;--hero-bg:#161514;--hero-fg:#f5f3f0;--hero-muted:#b9b4ad;--hero-line:#332f2b;
  --disp:var(--font-report-display),"Arial Narrow",sans-serif;--body:var(--font-report-body),system-ui,sans-serif;
  background:var(--bg);color:var(--fg);font-family:var(--body);line-height:1.55;-webkit-font-smoothing:antialiased;min-height:100vh;font-size:15px}
.cr *{box-sizing:border-box}
.cr .wrap{max-width:960px;margin:0 auto;padding-left:18px;padding-right:18px}
.cr h1,.cr h2,.cr h3{font-family:var(--disp);text-wrap:balance;margin:0;line-height:1.02;letter-spacing:.01em;text-transform:uppercase}
.cr p{margin:0}
.cr .eyebrow{font-family:var(--disp);text-transform:uppercase;letter-spacing:.16em;font-weight:600;font-size:.8rem}
.cr .tnum{font-variant-numeric:tabular-nums}
.cr .hero{background:var(--hero-bg);color:var(--hero-fg)}
.cr .hero .wrap{padding-top:46px;padding-bottom:52px}
.cr .hero .eyebrow{color:var(--on-dark);margin-bottom:22px}
.cr .brandrow{display:flex;align-items:center;gap:13px;margin-bottom:30px}
.cr .logo{height:56px;width:auto;max-width:180px;object-fit:contain;display:block;background:#fff;border-radius:10px;padding:6px}
.cr .brandname{font-family:var(--disp);font-weight:700;font-size:1.15rem;letter-spacing:.04em;text-transform:uppercase}
.cr .hero h1{font-size:clamp(2.5rem,7.2vw,4.6rem);font-weight:700}
.cr .hl{color:var(--on-dark)}
.cr .lede{color:var(--hero-muted);font-size:clamp(1.05rem,2.4vw,1.3rem);max-width:46ch;margin-top:20px;line-height:1.5;white-space:pre-wrap}
.cr .meta{display:flex;flex-wrap:wrap;gap:10px 26px;margin-top:30px;color:var(--hero-muted);font-size:.9rem}
.cr .meta b{color:var(--hero-fg);font-weight:600}
.cr .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:38px}
.cr .kpis.c3{grid-template-columns:repeat(3,1fr)}.cr .kpis.c2{grid-template-columns:repeat(2,1fr)}.cr .kpis.c1{grid-template-columns:1fr}
.cr .kpi{background:rgba(255,255,255,.04);border:1px solid var(--hero-line);border-radius:12px;padding:18px 16px;transition:transform .25s,border-color .25s}
.cr .kpi:hover{transform:translateY(-3px);border-color:var(--on-dark)}
.cr .kpi .n{font-family:var(--disp);font-weight:700;font-size:clamp(2.1rem,5vw,2.9rem);line-height:1;color:var(--on-dark)}
.cr .kpi .l{color:var(--hero-muted);font-size:.84rem;margin-top:8px;line-height:1.35}
@media(max-width:620px){.cr .kpis,.cr .kpis.c3{grid-template-columns:repeat(2,1fr)}}
.cr section.band{padding-top:48px;padding-bottom:48px}
.cr section.alt{background:var(--surface-2)}
.cr .sec-head{margin-bottom:8px}.cr .sec-head .eyebrow{color:var(--ink)}
.cr h2.big{font-size:clamp(1.9rem,4.6vw,2.9rem);font-weight:700}
.cr .sec-sub{color:var(--muted);max-width:62ch;margin-top:12px;font-size:1.02rem}
.cr .sec-sub b{color:var(--fg)}
.cr .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px;transition:transform .25s,box-shadow .25s,border-color .25s}
.cr .card:hover{transform:translateY(-4px);box-shadow:0 16px 36px rgba(0,0,0,.1);border-color:var(--accent)}
.cr .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:28px}
.cr .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:28px}
@media(max-width:860px){.cr .grid3{grid-template-columns:1fr 1fr}}
@media(max-width:720px){.cr .grid2{grid-template-columns:1fr}}
@media(max-width:560px){.cr .grid3{grid-template-columns:1fr}}
.cr .rcard{display:flex;flex-direction:column;gap:16px}
.cr .q{font-weight:600;font-size:1.12rem;line-height:1.3}
.cr .vis{display:flex;align-items:center;gap:10px}
.cr .vis .pct{font-family:var(--disp);font-weight:700;font-size:2.3rem;color:var(--good);line-height:1}
.cr .vis .vl{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:600;line-height:1.2}
.cr .pf{display:flex;flex-direction:column;gap:9px}
.cr .pf .row{display:grid;grid-template-columns:140px 1fr 28px;align-items:center;gap:10px}
.cr .pf .pn{font-size:.88rem;font-weight:500}
.cr .pf .track{height:9px;background:var(--surface-2);border-radius:99px;overflow:hidden}
.cr .pf .fill{display:block;height:100%;background:var(--accent);border-radius:99px}
.cr .pf .pc{font-family:var(--disp);font-weight:700;font-size:1.05rem;text-align:right}
.cr .appd{border-top:1px solid var(--line);padding-top:13px;display:flex;justify-content:space-between;align-items:baseline}
.cr .appd b{font-family:var(--disp);font-size:1.5rem;font-weight:700;color:var(--ink)}
.cr .appd span{color:var(--muted);font-size:.84rem}
.cr .platline{color:var(--muted);font-size:.94rem;margin-top:22px}.cr .platline b{color:var(--fg);font-weight:600}
.cr .quote{display:flex;flex-direction:column;gap:13px}
.cr .ptag{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;font-family:var(--disp);text-transform:uppercase;letter-spacing:.06em;font-weight:600;font-size:.84rem;padding:5px 13px;border-radius:99px;background:var(--surface-2)}
.cr .ptag i{width:9px;height:9px;border-radius:99px;background:var(--accent)}
.cr blockquote{margin:0;font-size:1.06rem;line-height:1.5}
.cr .cr-mk{background:var(--soft);color:var(--ink);font-weight:600;padding:0 4px;border-radius:4px}
.cr .by{color:var(--muted);font-size:.88rem}
.cr .cite{background:var(--hero-bg);color:var(--hero-fg);border-radius:16px;padding:clamp(24px,4vw,38px);margin-top:32px}
.cr .cite .eyebrow{color:var(--on-dark)}
.cr .cite h3{font-size:clamp(1.6rem,4vw,2.3rem);font-weight:700;text-transform:none;letter-spacing:0;margin-top:14px}
.cr .cite .cp{color:var(--hero-muted);max-width:64ch;margin-top:12px}
.cr .urls{display:flex;flex-direction:column;gap:10px;margin-top:24px}
.cr .u{display:flex;align-items:center;gap:13px;flex-wrap:wrap;background:rgba(255,255,255,.05);border:1px solid var(--hero-line);border-radius:10px;padding:13px 16px;transition:transform .25s,border-color .25s;color:inherit;text-decoration:none}
.cr .u:hover{transform:translateX(5px);border-color:var(--on-dark)}
.cr .u .ck{color:var(--good);font-weight:700}
.cr .u .url{font-family:var(--disp);letter-spacing:.02em;font-weight:600;font-size:1.04rem;word-break:break-word}
.cr .u .tag{margin-left:auto;font-size:.78rem;color:var(--hero-muted);background:rgba(255,255,255,.07);padding:4px 10px;border-radius:99px}
.cr .u .tag.built{color:var(--on-dark)}
.cr .pill{border-top:3px solid var(--accent)}
.cr .pill .pt{display:flex;align-items:center;gap:11px;margin-bottom:12px}
.cr .pill .num{font-family:var(--disp);font-weight:700;font-size:1.1rem;color:#fff;background:var(--accent);width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.cr .pill h3,.cr .dcard h3{font-size:1.28rem;font-weight:700;text-transform:none;letter-spacing:0}
.cr ul.diam,.cr ul.chk,.cr ul.arr{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}
.cr ul.diam li,.cr ul.chk li,.cr ul.arr li{position:relative;padding-left:22px;font-size:.97rem}
.cr ul.diam li::before{content:"";position:absolute;left:3px;top:.55em;width:7px;height:7px;border-radius:2px;background:var(--accent);transform:rotate(45deg)}
.cr ul.chk li::before{content:"\\2713";position:absolute;left:0;color:var(--good);font-weight:700}
.cr ul.arr li::before{content:"\\2192";position:absolute;left:0;color:var(--ink);font-weight:700}
.cr .dcard{border-top:3px solid var(--accent)}.cr .dcard h3{font-size:1.08rem;margin-bottom:12px}
.cr .dcard .lk{display:block;font-family:var(--disp);font-weight:600;letter-spacing:.02em;color:var(--ink);word-break:break-word;text-decoration:none}
.cr .dcard .lk:hover{text-decoration:underline}
.cr .wins{display:flex;flex-direction:column;gap:12px;margin-top:24px}
.cr .win{display:flex;gap:14px;align-items:flex-start;font-size:1.12rem;font-weight:500;line-height:1.4}
.cr .win i{flex:0 0 auto;width:28px;height:28px;border-radius:8px;background:var(--soft);color:var(--ink);display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:700}
.cr .gstats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px}
@media(max-width:620px){.cr .gstats{grid-template-columns:1fr}}
.cr .gstat .n{font-family:var(--disp);font-weight:700;font-size:2.4rem;line-height:1}
.cr .gstat .l{color:var(--muted);font-size:.86rem;margin-top:6px}
.cr .cr-chg{display:inline-block;margin-top:8px;font-size:.78rem;font-weight:600;border-radius:99px;padding:2px 9px;background:var(--surface-2);color:var(--muted)}
.cr .cr-chg.up{background:#e3f5ea;color:#17804a}.cr .cr-chg.down{background:#fbe9e9;color:#a1262b}
.cr .cr-chart{margin:22px 0 0}.cr .cr-chart svg{width:100%;height:190px;display:block}
.cr .cr-chart figcaption{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px;color:var(--muted);font-size:.8rem}
.cr .cr-chart figcaption span{display:flex;align-items:center;gap:6px}
.cr .cr-chart figcaption i{display:inline-block;width:20px;height:4px;border-radius:2px}
.cr .cr-chart figcaption i.dash{height:0;border-top:2px dashed #9a968f}
.cr .cr-shots{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:26px}
.cr .cr-shots.one{grid-template-columns:1fr;max-width:840px;margin-left:auto;margin-right:auto}
@media(max-width:720px){.cr .cr-shots{grid-template-columns:1fr}}
.cr .cr-shots figure{margin:0;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px}
.cr .cr-shots img{display:block;width:100%;height:auto;border-radius:6px}
.cr .cr-shots figcaption{text-align:center;color:var(--muted);font-size:.84rem;margin-top:8px}
.cr .prcard{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:22px;margin-top:22px;display:flex;flex-direction:column;gap:13px}
.cr .prtitle{font-size:1.15rem;font-weight:600;line-height:1.35}
.cr .prlink{align-self:flex-start;font-family:var(--disp);text-transform:uppercase;letter-spacing:.05em;font-weight:600;font-size:.9rem;color:#fff;background:var(--accent);padding:10px 18px;border-radius:8px;text-decoration:none}
.cr .opp{background:var(--surface-2);border:1px solid var(--line);border-radius:16px;padding:clamp(22px,4vw,34px)}
.cr .opp .flag{display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:99px;padding:6px 14px;font-size:.8rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink)}
.cr .opp h3{font-size:clamp(1.5rem,3.6vw,2.1rem);font-weight:700;margin-top:16px;text-transform:none;letter-spacing:0}
.cr .opp .box{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;margin-top:20px}
.cr footer{border-top:1px solid var(--line)}
.cr footer .wrap{padding-top:30px;padding-bottom:40px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px;color:var(--muted);font-size:.88rem}
.cr footer b{color:var(--fg);font-weight:600}
.cr .preview{background:#fbbf24;color:#451a03;text-align:center;font-weight:600;font-size:.9rem;padding:8px 16px}
@media(prefers-reduced-motion:reduce){.cr .card,.cr .kpi,.cr .u{transition:none}}
@media print{.cr .card:hover,.cr .kpi:hover{transform:none;box-shadow:none}.cr .preview{display:none}}
`;

export function ClientReport({ snap, preview = false }: { snap: ClientSnapshot; preview?: boolean }) {
  const c = palette(snap);
  const ai = snap.ai;
  const g = snap.gsc;
  const media = snap.media ?? [];
  const wins = lines(snap.headline);
  const next = lines(snap.next);
  const quotes = snap.quotes ?? [];
  const cited = snap.cited ?? [];
  const top = (ai?.top ?? []).filter((t) => t.visibility > 0);
  const platformTotals = ai?.platforms ?? {};
  const engines = PLATFORMS.filter(([k]) => (platformTotals[k] ?? 0) > 0).map(([k]) => k);
  const notYet = PLATFORMS.filter(([k]) => !engines.includes(k)).map(([k]) => k);
  const title = snap.title ?? (ai && ai.visibility >= 50 ? `When AI gets asked, *it names ${snap.client}.*` : `${snap.client}: *${shortMonth(snap.month)} results.*`);

  const kpis: { n: string; l: string }[] = [];
  if (ai) {
    kpis.push({ n: `${ai.visibility}%`, l: "AI visibility across the searches we track" });
    kpis.push({ n: n(ai.appearances), l: `Times ${snap.client} appeared in live AI answers` });
    if (engines.length) kpis.push({ n: String(engines.length), l: `AI engines featuring ${snap.client}` });
  }
  if (g && kpis.length < 4) kpis.push({ n: n(g.month.clicks), l: "Clicks from Google Search" });
  if (snap.actions.length && kpis.length < 4) kpis.push({ n: String(snap.actions.length), l: "Search growth actions delivered" });
  if (snap.leads !== null && snap.leads !== undefined && kpis.length < 4) kpis.push({ n: n(snap.leads), l: "Leads from search" });

  // Deliverables grouped by type, with links.
  const byType = new Map<string, ClientSnapshot["actions"]>();
  for (const a of snap.actions) byType.set(a.type ?? "Delivered", [...(byType.get(a.type ?? "Delivered") ?? []), a]);

  const style = { "--accent": c.accent, "--on-dark": c.onDark, "--ink": c.ink, "--soft": c.soft } as React.CSSProperties;
  return (
    <div className={`cr ${reportBody.variable} ${reportDisplay.variable}`} style={style}>
      <style>{CSS}</style>
      {preview && <div className="preview">Preview: this is what the client will see once you publish.</div>}

      <header className="hero">
        <div className="wrap">
          <div className="brandrow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {snap.logo && <img className="logo" src={snap.logo} alt={`${snap.client} logo`} />}
            <span className="brandname">{snap.client}</span>
          </div>
          <p className="eyebrow">AI Search Optimization · {monthName(snap.month)}</p>
          <h1>
            <Highlight text={title} mark="hl" />
          </h1>
          {snap.note && <p className="lede">{snap.note}</p>}
          <div className="meta">
            <span>
              Report period: <b>{monthName(snap.month)}</b>
            </span>
            {snap.city && (
              <span>
                Market: <b>{snap.city}</b>
              </span>
            )}
          </div>
          {kpis.length > 0 && (
            <div className={`kpis c${Math.min(kpis.length, 4)}`}>
              {kpis.slice(0, 4).map((k) => (
                <div key={k.l} className="kpi">
                  <div className="n tnum">{k.n}</div>
                  <div className="l">{k.l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {wins.length > 0 && (
        <section className="band">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">This Month&apos;s Wins</span>
            </div>
            <h2 className="big">What changed for {snap.client}.</h2>
            <div className="wins">
              {wins.map((w, i) => (
                <div key={i} className="win">
                  <i>✓</i>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {ai && (top.length > 0 || quotes.length > 0 || media.some((m) => m.kind === "ai")) && (
        <section className={`band ${wins.length ? "alt" : ""}`}>
          <div className="wrap">
            {top.length > 0 && (
              <>
                <div className="sec-head">
                  <span className="eyebrow">The Headline Win</span>
                </div>
                <h2 className="big">AI is recommending {snap.client}.</h2>
                <p className="sec-sub">
                  For {top.length === 1 ? "this search" : `these ${top.length} searches`}, {snap.client} shows up in <b>{top[top.length - 1].visibility}% or more</b> of the AI
                  results we track. These are the questions customers ask when they&apos;re ready to hire.
                </p>
                <div className="grid2">
                  {top.map((t) => {
                    const rows = Object.entries(t.counts)
                      .filter(([, v]) => v > 0)
                      .sort((a, b) => b[1] - a[1]);
                    const max = Math.max(1, ...rows.map(([, v]) => v));
                    return (
                      <div key={t.prompt} className="card rcard">
                        <div className="q">&ldquo;{t.prompt}&rdquo;</div>
                        <div className="vis">
                          <span className="pct tnum">{t.visibility}%</span>
                          <span className="vl">
                            AI
                            <br />
                            Visibility
                          </span>
                        </div>
                        {rows.length > 0 && (
                          <div className="pf">
                            {rows.map(([k, v]) => (
                              <div key={k} className="row">
                                <span className="pn">{platformLabel(k)}</span>
                                <span className="track">
                                  <span className="fill" style={{ width: `${(v / max) * 100}%` }} />
                                </span>
                                <span className="pc tnum">{v}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="appd">
                          <b className="tnum">{t.appearances}</b>
                          <span>total appearances in AI answers</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {engines.length > 0 && (
                  <p className="platline">
                    Appearing on{" "}
                    {engines.map((k, i) => (
                      <span key={k}>
                        {i > 0 && (i === engines.length - 1 ? (engines.length > 2 ? ", and " : " and ") : ", ")}
                        <b>{platformLabel(k)}</b>
                      </span>
                    ))}
                    .{notYet.length > 0 && ` Next we'll grow into ${notYet.map(platformLabel).join(", ").replace(/, ([^,]*)$/, " and $1")}.`}
                  </p>
                )}
              </>
            )}

            {quotes.length > 0 && (
              <div style={{ marginTop: top.length ? 56 : 0 }}>
                <div className="sec-head">
                  <span className="eyebrow">Straight From The Source</span>
                </div>
                <h2 className="big">Here&apos;s what AI is telling your customers.</h2>
                <p className="sec-sub">Real answers the AI engines gave when asked about your services.</p>
                <div className="grid2">
                  {quotes.map((q, i) => (
                    <div key={i} className="card quote">
                      <span className="ptag">
                        <i />
                        {platformLabel(q.platform)}
                      </span>
                      <blockquote>
                        &ldquo;
                        <QuoteText quote={q.quote} client={snap.client} />
                        &rdquo;
                      </blockquote>
                      {(q.note || q.prompt) && <span className="by">{q.note ?? `Asked: "${q.prompt}"`}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cited.length > 0 && (
              <div className="cite">
                <p className="eyebrow">The Proof It&apos;s Working</p>
                <h3>AI is citing {snap.client}&apos;s pages by name.</h3>
                <p className="cp">When AI recommends a business, it links to the sources it trusts. These are pages on your site that AI pointed customers to.</p>
                <div className="urls">
                  {cited.map((u) => (
                    <a key={u.url} className="u" href={u.url} target="_blank" rel="noreferrer">
                      <span className="ck">✓</span>
                      <span className="url">{path(u.url)}</span>
                      <span className={`tag ${u.built ? "built" : ""}`}>
                        {u.built ? "Built this month · " : ""}cited by {u.platforms.map(platformLabel).join(", ")}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <Shots items={media.filter((m) => m.kind === "ai")} />
          </div>
        </section>
      )}

      {g && (
        <section className="band">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Google Search</span>
            </div>
            <h2 className="big">{g.previous && (g.month.clicks > g.previous.clicks || g.month.impressions > g.previous.impressions) ? "More people are finding you on Google." : "How people found you on Google."}</h2>
            {g.partial_days && <p className="sec-sub">Month in progress: compared with the same {g.partial_days} days of last month.</p>}
            <div className="gstats">
              <div className="card gstat">
                <div className="n tnum">{n(g.month.clicks)}</div>
                <div className="l">Clicks from Google</div>
                <Change now={g.month.clicks} before={g.previous?.clicks} />
              </div>
              <div className="card gstat">
                <div className="n tnum">{n(g.month.impressions)}</div>
                <div className="l">Times seen in Google</div>
                <Change now={g.month.impressions} before={g.previous?.impressions} />
              </div>
              {g.month.position > 0 && (
                <div className="card gstat">
                  <div className="n tnum">{g.month.position.toFixed(1)}</div>
                  <div className="l">Average position (lower is better)</div>
                  <Change now={g.month.position} before={g.previous?.position} lowerIsBetter />
                </div>
              )}
            </div>
            <ClicksChart snap={snap} color={c.accent} />
            <Shots items={media.filter((m) => m.kind === "gsc")} />
          </div>
        </section>
      )}

      {snap.delivered.length > 0 && (
        <section className="band alt">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">What We Built</span>
            </div>
            <h2 className="big">The work behind the results.</h2>
            <p className="sec-sub">AI engines recommend businesses they can clearly identify, verify and trust. This month&apos;s work, by area:</p>
            <div className="grid2">
              {snap.delivered.map((d, i) => (
                <div key={d.section} className="card pill">
                  <div className="pt">
                    <span className="num">{i + 1}</span>
                    <h3>{d.section}</h3>
                  </div>
                  <ul className="diam">
                    {d.items.map((it) => (
                      <li key={it.name}>
                        {it.name}
                        {it.count ? ` (${it.count})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {snap.actions.length > 0 && (
        <section className="band">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Everything We Shipped</span>
            </div>
            <h2 className="big">The complete deliverables.</h2>
            <div className="grid3">
              {[...byType.entries()].map(([type, list]) => (
                <div key={type} className="card dcard">
                  <h3>{type}</h3>
                  <ul className="chk">
                    {list.map((a, i) => (
                      <li key={i}>
                        {a.title}
                        {a.url && (
                          <a className="lk" href={a.url} target="_blank" rel="noreferrer">
                            {path(a.url)}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {((snap.pr ?? []).length > 0 || media.some((m) => m.kind === "pr")) && (
        <section className="band alt">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Off-Site Authority</span>
            </div>
            <h2 className="big">Published and syndicated.</h2>
            <p className="sec-sub">More trusted places that mention {snap.client} means more sources for AI and search to pull from.</p>
            {(snap.pr ?? []).map((p, i) => (
              <div key={i} className="prcard">
                <div className="prtitle">{p.title}</div>
                {p.url && (
                  <a className="prlink" href={p.url} target="_blank" rel="noreferrer">
                    Read the published release →
                  </a>
                )}
              </div>
            ))}
            <Shots items={media.filter((m) => m.kind === "pr")} />
          </div>
        </section>
      )}

      {media.some((m) => m.kind === "other") && (
        <section className="band">
          <div className="wrap">
            <Shots items={media.filter((m) => m.kind === "other")} />
          </div>
        </section>
      )}

      {next.length > 0 && (
        <section className="band">
          <div className="wrap">
            <div className="opp">
              <span className="flag">● &nbsp;Next Month</span>
              <h3>Where we&apos;re going next.</h3>
              <div className="box">
                <ul className="arr">
                  {next.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      <footer>
        <div className="wrap">
          <div>
            <b>{snap.client}</b> · AI Search Optimization · {monthName(snap.month)}
            {snap.brand === "yroc" && <div>Prepared by Yroc Consulting</div>}
          </div>
          {snap.site && <div>{host(snap.site)}</div>}
        </div>
      </footer>
    </div>
  );
}
