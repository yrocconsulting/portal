import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { requireStaff } from "@/lib/auth";
import { todayCentral } from "@/lib/format";
import { progress } from "@/lib/report-progress";
import { monthLabel, nextMonth, prevMonth } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { startAll, startReport } from "./actions";

export const metadata: Metadata = { title: "Monthly reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const me = await requireStaff();
  const sp = await searchParams;
  const current = todayCentral().slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : current;
  const supabase = await createClient();

  const [{ data: clients }, { data: reports }] = await Promise.all([
    supabase.from("clients").select("id, name, status, white_label, package:packages(id, name)").neq("status", "former").order("name"),
    supabase.from("monthly_reports").select("id, client_id, status, package_name, client:clients(id, name, white_label)").eq("month", `${month}-01`),
  ]);
  const ids = (reports ?? []).map((r) => r.id);
  const [{ data: items }, { data: actions }] = ids.length
    ? await Promise.all([
        supabase.from("report_items").select("report_id, kind, status, count, target").in("report_id", ids),
        supabase.from("report_actions").select("report_id").in("report_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const byReport = new Map((reports ?? []).map((r) => [r.client_id, r]));
  const actionCount = (id: string) => (actions ?? []).filter((a) => a.report_id === id).length;

  // Clients with a record this month first (including archived ones), then active clients without one.
  type Row = { clientId: string; name: string; whiteLabel: boolean; packageName: string | null; report: NonNullable<typeof reports>[number] | null };
  const rows: Row[] = [];
  for (const r of reports ?? []) {
    const c = r.client as unknown as { id: string; name: string; white_label: boolean };
    rows.push({ clientId: c.id, name: c.name, whiteLabel: c.white_label, packageName: r.package_name, report: r });
  }
  for (const c of clients ?? []) {
    if (byReport.has(c.id)) continue;
    rows.push({ clientId: c.id, name: c.name, whiteLabel: c.white_label, packageName: (c.package as unknown as { name: string } | null)?.name ?? null, report: null });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const missing = rows.filter((r) => !r.report && r.packageName).length;
  const isPast = month < current;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Monthly reports</h1>
          <p className="mt-1 text-sm text-muted">The work delivered for each client every month, from their package&apos;s deliverables. Completed months are archived read-only.</p>
        </div>
        <div className="flex items-center gap-2">
          {me.role === "admin" && (
            <Link href="/packages" className="btn-ghost">
              Packages
            </Link>
          )}
          <Link href={`/reports?month=${prevMonth(month)}`} className="btn-ghost px-3" aria-label="Previous month">
            ←
          </Link>
          <form className="flex items-center gap-2">
            <input type="month" name="month" defaultValue={month} className="field w-auto" />
            <button className="btn-ghost">Go</button>
          </form>
          <Link href={`/reports?month=${nextMonth(month)}`} className="btn-ghost px-3" aria-label="Next month">
            →
          </Link>
        </div>
      </div>

      <section className="card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">
            {monthLabel(month)}
            {isPast && <span className="ml-2 text-xs font-normal text-muted">(past month)</span>}
          </h2>
          {missing > 0 && (
            <form action={startAll}>
              <input type="hidden" name="month" value={month} />
              <button className="btn-primary py-1.5 text-sm">Start all {missing} for {monthLabel(month).split(" ")[0]}</button>
            </form>
          )}
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <th className="px-4 py-2.5">Client</th>
                <th className="px-4 py-2.5">Package</th>
                <th className="px-4 py-2.5">Progress</th>
                <th className="px-4 py-2.5">Search Growth Actions</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const r = row.report;
                const its = r ? (items ?? []).filter((i) => i.report_id === r.id) : [];
                const acts = r ? actionCount(r.id) : 0;
                const p = progress(its, acts);
                const actionItem = its.find((i) => i.kind === "actions");
                const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                return (
                  <tr key={row.clientId}>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 font-medium">
                        {row.name}
                        {row.whiteLabel && <WhiteLabelBadge />}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{row.packageName ?? <span className="text-amber-700">No package set</span>}</td>
                    <td className="px-4 py-3">
                      {r ? (
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-28 rounded-full bg-bg">
                            <span className="block h-2 rounded-full bg-green-d" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="text-xs text-muted">
                            {p.done} of {p.total}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Not started</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{actionItem ? `${acts} of ${actionItem.target}` : ""}</td>
                    <td className="px-4 py-3">
                      {r?.status === "complete" ? (
                        <span className="rounded-full bg-green/15 px-2 py-0.5 text-xs font-medium text-green-d">Complete, archived</span>
                      ) : r ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">In progress</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r ? (
                        <Link href={`/reports/${r.id}`} className="btn-ghost py-1 text-xs">
                          Open
                        </Link>
                      ) : row.packageName ? (
                        <form action={startReport}>
                          <input type="hidden" name="client_id" value={row.clientId} />
                          <input type="hidden" name="month" value={month} />
                          <button className="btn-green py-1 text-xs">Start</button>
                        </form>
                      ) : (
                        <Link href={`/clients/${row.clientId}`} className="text-xs text-green-d hover:underline">
                          Set package
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
