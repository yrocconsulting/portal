import Link from "next/link";
import { daysAgoISO, fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/** Google Business Profile for one client: last 28 days vs the 28 before, rating, reviews waiting for a reply, search terms. */

type Sum = { views: number; calls: number; web: number; dir: number };
const add = (a: Sum, d: { views_search: number; views_maps: number; calls: number; website_clicks: number; directions: number }) => ({
  views: a.views + d.views_search + d.views_maps,
  calls: a.calls + d.calls,
  web: a.web + d.website_clicks,
  dir: a.dir + d.directions,
});
const zero: Sum = { views: 0, calls: 0, web: 0, dir: 0 };

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return <span className="text-xs text-muted">steady</span>;
  return <span className={`text-xs font-semibold ${pct > 0 ? "text-green-d" : "text-red-700"}`}>{pct > 0 ? `▲ ${pct}%` : `▼ ${-pct}%`}</span>;
}

const starRow = (n: number | null) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "");

export async function BusinessProfile({ clientId }: { clientId: string }) {
  const db = await createClient();
  const { data: locs } = await db.from("gbp_locations").select("name, title, address, maps_uri, average_rating, review_count, last_synced_at").eq("client_id", clientId).order("title");
  if (!locs?.length) {
    return (
      <section className="card p-4" id="business-profile">
        <h2 className="font-semibold">Google Business Profile</h2>
        <p className="mt-1 text-sm text-muted">
          No Business Profile is matched to this client yet. <Link href="/business-profiles" className="text-green-d hover:underline">See Business Profiles</Link>.
        </p>
      </section>
    );
  }
  const names = locs.map((l) => l.name);
  const [{ data: days }, { data: waiting }, { data: kw }] = await Promise.all([
    db.from("gbp_daily").select("date, views_search, views_maps, calls, website_clicks, directions").in("location", names).gte("date", daysAgoISO(57)),
    db.from("gbp_reviews").select("name, location, reviewer, rating, comment, created_at").in("location", names).is("reply", null).order("created_at", { ascending: false }).limit(5),
    db.from("gbp_keywords").select("month, keyword, impressions, below").in("location", names).order("month", { ascending: false }).order("impressions", { ascending: false }).limit(200),
  ]);
  const cut = daysAgoISO(29);
  let cur = zero;
  let prev = zero;
  for (const d of days ?? []) {
    if (d.date >= cut) cur = add(cur, d);
    else prev = add(prev, d);
  }
  const latestMonth = kw?.[0]?.month;
  const terms = new Map<string, { n: number; below: boolean }>();
  for (const k of kw ?? []) {
    if (k.month !== latestMonth) continue;
    const t = terms.get(k.keyword) ?? { n: 0, below: false };
    terms.set(k.keyword, { n: t.n + k.impressions, below: t.below || k.below });
  }
  const top = [...terms.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const reviewsTotal = locs.reduce((s, l) => s + (l.review_count ?? 0), 0);
  const rated = locs.filter((l) => l.average_rating !== null);
  const avg = rated.length ? rated.reduce((s, l) => s + Number(l.average_rating) * (l.review_count ?? 1), 0) / rated.reduce((s, l) => s + (l.review_count ?? 1), 0) : null;
  const locTitle = (n: string) => locs.find((l) => l.name === n)?.title;

  const stats: [string, number, number][] = [
    ["Profile views", cur.views, prev.views],
    ["Calls", cur.calls, prev.calls],
    ["Website clicks", cur.web, prev.web],
    ["Direction requests", cur.dir, prev.dir],
  ];
  return (
    <section className="card" id="business-profile">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-semibold">Google Business Profile</h2>
        <span className="text-xs text-muted">
          Last 28 days vs the 28 before · {locs.length === 1 ? locs[0].title : `${locs.length} locations`}
        </span>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map(([label, n, before]) => (
          <div key={label} className="rounded-lg bg-bg p-3">
            <p className="text-xs text-muted">{label}</p>
            <p className="font-display text-2xl font-bold">{n.toLocaleString("en-US")}</p>
            <Delta now={n} before={before} />
          </div>
        ))}
        <div className="rounded-lg bg-bg p-3">
          <p className="text-xs text-muted">Google rating</p>
          <p className="font-display text-2xl font-bold">{avg ? avg.toFixed(1) : "none"}</p>
          <p className="text-xs text-muted">{reviewsTotal.toLocaleString("en-US")} reviews</p>
        </div>
      </div>
      <div className="grid gap-4 border-t border-line p-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Reviews waiting for a reply {waiting?.length ? `(${waiting.length}${waiting.length === 5 ? "+" : ""})` : ""}</h3>
          {waiting?.length ? (
            <ul className="space-y-2">
              {waiting.map((r) => (
                <li key={r.name} className="rounded-lg border border-line p-3 text-sm">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className={r.rating && r.rating <= 3 ? "text-red-700" : "text-amber-500"}>{starRow(r.rating)}</span> <b>{r.reviewer ?? "Someone"}</b>
                    </span>
                    <span className="text-xs text-muted">
                      {fmtDate(r.created_at)}
                      {locs.length > 1 ? ` · ${locTitle(r.location)}` : ""}
                    </span>
                  </p>
                  {r.comment && <p className="mt-1 line-clamp-3 text-muted">{r.comment}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Every review has a reply.</p>
          )}
          {locs.some((l) => l.maps_uri) && (
            <p className="mt-2 text-xs">
              {locs
                .filter((l) => l.maps_uri)
                .map((l) => (
                  <a key={l.name} href={l.maps_uri!} target="_blank" rel="noreferrer" className="mr-3 text-green-d hover:underline">
                    Open {locs.length > 1 ? l.title : "the profile"} on Google Maps
                  </a>
                ))}
            </p>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">What people searched to find them{latestMonth ? ` (${new Date(`${latestMonth}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })})` : ""}</h3>
          {top.length ? (
            <ul className="divide-y divide-line text-sm">
              {top.map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate">{k}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">{v.below ? `under ${v.n}` : v.n.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No search terms yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
