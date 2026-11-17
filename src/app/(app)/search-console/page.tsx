import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { requireStaff } from "@/lib/auth";
import { daysAgoISO, timeAgo } from "@/lib/format";
import { gscConfig, gscConfigProblem } from "@/lib/gsc/google";
import { siteForClient } from "@/lib/gsc/match";
import { createClient } from "@/lib/supabase/server";
import { linkProperty } from "./actions";
import { SyncButton } from "./parts";

export const metadata: Metadata = { title: "Search Console" };

const n = (v: number) => v.toLocaleString("en-US");

export default async function SearchConsolePage() {
  const me = await requireStaff();
  const cfg = gscConfig();
  const supabase = await createClient();
  const since = daysAgoISO(31);
  const [{ data: sites }, { data: clients }, { data: days }] = await Promise.all([
    supabase.from("gsc_sites").select("*").order("domain"),
    supabase.from("clients").select("id, name, domain, gsc_site_url, white_label, status").order("name"),
    supabase.from("gsc_daily").select("site_url, date, clicks, impressions").gte("date", since),
  ]);

  // Latest 28 days per property.
  const totals = new Map<string, { clicks: number; impressions: number }>();
  const latestBySite = new Map<string, string>();
  for (const d of days ?? []) if ((latestBySite.get(d.site_url) ?? "") < d.date) latestBySite.set(d.site_url, d.date);
  for (const d of days ?? []) {
    const end = latestBySite.get(d.site_url)!;
    if ((new Date(end).getTime() - new Date(d.date).getTime()) / 86400000 > 27) continue;
    const t = totals.get(d.site_url) ?? { clicks: 0, impressions: 0 };
    t.clicks += d.clicks;
    t.impressions += d.impressions;
    totals.set(d.site_url, t);
  }
  const owner = new Map<string, NonNullable<typeof clients>[number]>();
  for (const c of clients ?? []) {
    const s = siteForClient(c, sites ?? []);
    if (s) owner.set(s, c);
  }
  const unlinked = (sites ?? []).filter((s) => !owner.has(s.site_url)).length;
  const pickable = (clients ?? []).filter((c) => c.status !== "former");

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Search Console</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Google Search Console properties the portal can read, synced daily.
            {cfg ? (
              <>
                {" "}
                To add a client, give <span className="font-mono text-ink">{cfg.sa.client_email}</span> access to their property in Search Console (Settings, Users and
                permissions, Add user, Restricted), then sync.
              </>
            ) : (
              <span className="mt-2 block rounded-lg bg-amber-50 px-3 py-2 text-amber-800">Not connected yet: {gscConfigProblem()}</span>
            )}
          </p>
        </div>
        {cfg && me.role === "admin" && <SyncButton />}
      </div>

      {unlinked > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {unlinked} propert{unlinked === 1 ? "y isn't" : "ies aren't"} linked to a client. Pick the client below.
        </p>
      )}

      <section className="card overflow-x-auto">
        {(sites ?? []).length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <th className="px-4 py-2.5">Client</th>
                <th className="px-4 py-2.5">Property</th>
                <th className="px-4 py-2.5 text-right">Clicks (28 days)</th>
                <th className="px-4 py-2.5 text-right">Impressions (28 days)</th>
                <th className="px-4 py-2.5 text-right">Last sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(sites ?? []).map((s) => {
                const c = owner.get(s.site_url);
                const t = totals.get(s.site_url);
                return (
                  <tr key={s.site_url}>
                    <td className="px-4 py-3">
                      {c ? (
                        <Link href={`/clients/${c.id}#google-search`} className="flex items-center gap-2 font-medium hover:text-green-d">
                          {c.name}
                          {c.white_label && <WhiteLabelBadge />}
                        </Link>
                      ) : (
                        <form action={linkProperty} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="site_url" value={s.site_url} />
                          <select name="client_id" className="field w-auto py-1 text-xs" defaultValue="" required>
                            <option value="" disabled>
                              Link to client...
                            </option>
                            {pickable.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn-ghost py-1 text-xs">Link</button>
                        </form>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{s.site_url}</td>
                    <td className="px-4 py-3 text-right font-semibold">{t ? n(t.clicks) : ""}</td>
                    <td className="px-4 py-3 text-right">{t ? n(t.impressions) : ""}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-xs">
                      {s.last_error ? (
                        <span className="text-red-700" title={s.last_error}>
                          Error
                        </span>
                      ) : s.last_synced_at ? (
                        <span className="text-muted">{timeAgo(s.last_synced_at)}</span>
                      ) : (
                        <span className="text-muted">Not yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted">{cfg ? "No properties yet. Add the service account to a property, then sync." : "Not connected yet."}</p>
        )}
      </section>
    </div>
  );
}
