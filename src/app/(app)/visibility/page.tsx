import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PLATFORMS, trackedDomain, type SiteResult } from "@/lib/visibility";
import { linkDomain } from "./actions";

export const metadata: Metadata = { title: "AI visibility" };

export default async function VisibilityPage() {
  await requireStaff();
  const supabase = await createClient();
  const { data: reports } = await supabase.from("prt_reports").select("report_date").order("report_date", { ascending: false }).limit(2);
  const [latest, previous] = (reports ?? []).map((r) => r.report_date as string);

  if (!latest) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-bold">AI visibility</h1>
        <p className="card p-6 text-sm text-muted">
          No ProRankTracker report has arrived yet. Results come in every Monday afternoon from the weekly report in Google Drive.
        </p>
      </div>
    );
  }

  const [{ data: rows }, { data: prevRows }, { data: clients }] = await Promise.all([
    supabase.from("prt_site_results").select("*").eq("report_date", latest).order("visibility", { ascending: false }),
    previous ? supabase.from("prt_site_results").select("domain, visibility, appearances").eq("report_date", previous) : Promise.resolve({ data: [] }),
    supabase.from("clients").select("id, name, domain, tracking_domain, white_label, status").order("name"),
  ]);
  const byDomain = new Map((clients ?? []).map((c) => [trackedDomain(c), c]));
  const prev = new Map((prevRows ?? []).map((r) => [r.domain, r]));
  const sites = (rows ?? []) as SiteResult[];
  const totals = sites.reduce((a, s) => ({ appearances: a.appearances + s.appearances, prompts: a.prompts + s.prompts }), { appearances: 0, prompts: 0 });
  const unlinked = sites.filter((s) => !byDomain.has(s.domain)).length;
  const pickable = (clients ?? []).filter((c) => c.status !== "former");

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">AI visibility</h1>
          <p className="text-sm text-muted">
            ProRankTracker, week of {fmtDate(latest)}: {sites.length} tracked sites, {totals.prompts} prompts, {totals.appearances} appearances.
            {previous && ` Compared with ${fmtDate(previous)}.`}
          </p>
        </div>
      </div>
      {unlinked > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {unlinked} tracked {unlinked === 1 ? "site isn't" : "sites aren't"} linked to a client yet. Pick the client below so their results show on the client page.
        </p>
      )}
      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Client</th>
              <th className="px-4 py-2.5 text-right">Visibility</th>
              <th className="px-4 py-2.5 text-right">Appearances</th>
              <th className="px-4 py-2.5 text-right">Prompts</th>
              {PLATFORMS.map(([k, l]) => (
                <th key={k} className="whitespace-nowrap px-3 py-2.5 text-right">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sites.map((s) => {
              const c = byDomain.get(s.domain);
              const p = prev.get(s.domain);
              const dv = p ? s.visibility - p.visibility : null;
              return (
                <tr key={s.domain}>
                  <td className="px-4 py-3">
                    {c ? (
                      <Link href={`/clients/${c.id}#ai-visibility`} className="flex items-center gap-2 font-medium hover:text-green-d">
                        {c.name}
                        {c.white_label && <WhiteLabelBadge />}
                      </Link>
                    ) : (
                      <form action={linkDomain} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="domain" value={s.domain} />
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
                    <span className="font-mono text-xs text-muted">{s.domain}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className="font-semibold">{s.visibility}%</span>
                    {dv !== null && dv !== 0 && <span className={`ml-1 text-xs ${dv > 0 ? "text-green-d" : "text-red-700"}`}>{dv > 0 ? `▲${dv}` : `▼${-dv}`}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">{s.appearances}</td>
                  <td className="px-4 py-3 text-right text-muted">{s.prompts}</td>
                  {PLATFORMS.map(([k]) => (
                    <td key={k} className={`px-3 py-3 text-right ${s.platforms?.[k] ? "" : "text-muted/50"}`}>
                      {s.platforms?.[k] ?? 0}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
