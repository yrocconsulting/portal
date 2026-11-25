import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { requireStaff, staffName } from "@/lib/auth";
import { daysAgoISO, timeAgo } from "@/lib/format";
import { gbpOAuthConfig } from "@/lib/gbp/google";
import { createClient } from "@/lib/supabase/server";
import { ClientPicker, DisconnectButton, SyncButton } from "./parts";

export const metadata: Metadata = { title: "Business Profiles" };
export const maxDuration = 300;

type Conn = { email: string | null; connected_at: string; connected_by: string | null; last_sync?: string; last_error?: string | null };

export default async function BusinessProfilesPage({ searchParams }: PageProps<"/business-profiles">) {
  const me = await requireStaff();
  const isAdmin = me.role === "admin";
  const sp = await searchParams;
  const db = await createClient();
  const [{ data: setting }, { data: locs }, { data: clients }, { data: staff }, { data: days }] = await Promise.all([
    isAdmin ? db.from("app_settings").select("value").eq("key", "gbp_oauth").maybeSingle() : Promise.resolve({ data: null }),
    db.from("gbp_locations").select("name, title, address, website, client_id, matched_by, average_rating, review_count, last_synced_at, last_error, client:clients(id, name, white_label)").order("title"),
    db.from("clients").select("id, name").neq("status", "former").order("name"),
    db.from("staff").select("id, full_name, email"),
    db.from("gbp_daily").select("location, calls, website_clicks, directions").gte("date", daysAgoISO(28)),
  ]);
  const conn = (setting?.value as Conn | undefined) ?? null;
  const configured = !!gbpOAuthConfig();
  const totals = new Map<string, { calls: number; web: number; dir: number }>();
  for (const d of days ?? []) {
    const t = totals.get(d.location) ?? { calls: 0, web: 0, dir: 0 };
    t.calls += d.calls;
    t.web += d.website_clicks;
    t.dir += d.directions;
    totals.set(d.location, t);
  }
  const who = (id: string | null) => staffName((staff ?? []).find((s) => s.id === id));
  const unmatched = (locs ?? []).filter((l) => !l.client_id).length;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Google Business Profiles</h1>
        <p className="max-w-3xl text-sm text-muted">
          Views, calls, website clicks, direction requests, search terms and reviews for every client profile our Google account manages. Synced daily.
        </p>
      </div>

      {typeof sp.error === "string" && <p className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{sp.error}</p>}
      {sp.connected && <p className="card border-green/40 bg-green/10 p-4 text-sm">Connected. The first sync runs now and can take a few minutes; refresh to see profiles appear.</p>}

      {isAdmin && (
        <section className="card flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="text-sm">
            {!configured ? (
              <>
                <p className="font-semibold">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
                  Google sign-in isn&apos;t set up yet
                </p>
                <p className="text-muted">Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel (after Google approves Business Profile API access), then redeploy.</p>
              </>
            ) : conn ? (
              <>
                <p className="font-semibold">
                  <span className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${conn.last_error ? "bg-amber-500" : "bg-green-d"}`} />
                  Connected{conn.email ? ` as ${conn.email}` : ""}
                </p>
                <p className="text-muted">
                  Connected {timeAgo(conn.connected_at)}
                  {conn.connected_by ? ` by ${who(conn.connected_by)}` : ""}
                  {conn.last_sync ? ` · last synced ${timeAgo(conn.last_sync)}` : ""}
                </p>
                {conn.last_error && <p className="mt-1 text-red-700">{conn.last_error}</p>}
              </>
            ) : (
              <>
                <p className="font-semibold">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
                  Not connected
                </p>
                <p className="text-muted">Sign in with the Google account that clients added as a manager on their profiles.</p>
              </>
            )}
          </div>
          {configured && (
            <div className="flex flex-wrap items-start gap-3">
              {conn && <DisconnectButton />}
              <a href="/api/gbp/connect" className={conn ? "btn-ghost" : "btn-green"}>
                {conn ? "Reconnect" : "Connect Google account"}
              </a>
              {conn && <SyncButton />}
            </div>
          )}
        </section>
      )}

      <section className="card overflow-x-auto">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">Profiles ({(locs ?? []).length})</h2>
          {unmatched > 0 && <span className="text-xs text-amber-700">{unmatched} not matched to a client</span>}
        </header>
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Profile</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 text-right font-medium">Rating</th>
              <th className="px-4 py-2 text-right font-medium" title="Last 28 days">Calls</th>
              <th className="px-4 py-2 text-right font-medium" title="Last 28 days">Website clicks</th>
              <th className="px-4 py-2 text-right font-medium" title="Last 28 days">Directions</th>
              <th className="px-4 py-2 font-medium">Synced</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(locs ?? []).map((l) => {
              const c = l.client as unknown as { id: string; name: string; white_label: boolean } | null;
              const t = totals.get(l.name);
              return (
                <tr key={l.name}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{l.title}</p>
                    <p className="text-xs text-muted">{l.address ?? l.website ?? "Service-area business"}</p>
                  </td>
                  <td className="px-4 py-2">
                    {isAdmin ? (
                      <ClientPicker name={l.name} clientId={l.client_id} clients={clients ?? []} />
                    ) : c ? (
                      <Link href={`/clients/${c.id}`} className="hover:text-green-d">
                        {c.name}
                      </Link>
                    ) : (
                      <span className="text-muted/60">Not a client</span>
                    )}
                    {c?.white_label && <span className="ml-2 align-middle"><WhiteLabelBadge /></span>}
                    {l.client_id && <p className="mt-0.5 text-[11px] text-muted">{l.matched_by === "admin" ? "Chosen by an admin" : "Matched by website"}</p>}
                  </td>
                  <td className="px-4 py-2 text-right">{l.average_rating ? `${l.average_rating} ★ (${l.review_count ?? 0})` : <span className="text-muted/60">none</span>}</td>
                  <td className="px-4 py-2 text-right">{t?.calls ?? 0}</td>
                  <td className="px-4 py-2 text-right">{t?.web ?? 0}</td>
                  <td className="px-4 py-2 text-right">{t?.dir ?? 0}</td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {l.last_synced_at ? timeAgo(l.last_synced_at) : "not yet"}
                    {l.last_error && <span className="block text-red-700">{l.last_error}</span>}
                  </td>
                </tr>
              );
            })}
            {!locs?.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No profiles yet. {isAdmin ? "Connect the Google account above." : "An admin needs to connect the Google account."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
