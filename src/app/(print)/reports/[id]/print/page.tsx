import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ResultsCard } from "@/app/(app)/reports/results-card";
import { requireStaff, staffName } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { itemDone, progress } from "@/lib/report-progress";
import { monthLabel, type Results } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Monthly report (print)" };

type Item = { id: string; section: string | null; name: string; kind: string; status: string; count: number | null; target: number | null; level: string | null; links: string[]; notes: string | null };

/** Internal print view of a month's record (not client-facing). */
export default async function PrintReport({ params }: PageProps<"/reports/[id]/print">) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from("monthly_reports").select("*, client:clients(name)").eq("id", id).maybeSingle();
  if (!r) notFound();
  const [{ data: items }, { data: actions }, { data: staff }] = await Promise.all([
    supabase.from("report_items").select("*").eq("report_id", id).order("position"),
    supabase.from("report_actions").select("*").eq("report_id", id).order("done_on", { nullsFirst: false }),
    supabase.from("staff").select("id, full_name, email"),
  ]);
  const all = (items ?? []) as Item[];
  const acts = actions ?? [];
  const p = progress(all, acts.length);
  const month = (r.month as string).slice(0, 7);
  const sections = new Map<string, Item[]>();
  for (const it of all.filter((i) => i.kind !== "actions")) sections.set(it.section ?? "Other", [...(sections.get(it.section ?? "Other") ?? []), it]);
  const actionsItem = all.find((i) => i.kind === "actions");
  const completer = (staff ?? []).find((s) => s.id === r.completed_by);

  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-8 text-ink print:max-w-none print:px-0 print:py-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/reports/${id}`} className="text-sm text-muted hover:text-ink">
          Back to the record
        </Link>
        <PrintButton />
      </div>

      <header className="flex items-end justify-between gap-6 border-b-4 border-ink pb-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-steel uppercase">Monthly work record</p>
          <h1 className="mt-1 text-3xl font-bold">{(r.client as unknown as { name: string }).name}</h1>
          <p className="text-lg text-muted">
            {monthLabel(month)} · {r.package_name ?? "No package"}
          </p>
        </div>
        <Image src="/logo.png" alt="Yroc Consulting" width={150} height={45} />
      </header>

      <section className="mt-6 grid grid-cols-3 gap-4 text-center">
        <div className="rounded-lg bg-bg p-3">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Deliverables done</p>
          <p className="text-2xl font-bold">
            {p.done} of {p.total}
          </p>
        </div>
        <div className="rounded-lg bg-bg p-3">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Search Growth Actions</p>
          <p className="text-2xl font-bold">
            {acts.length}
            {actionsItem?.target ? ` of ${actionsItem.target}` : ""}
          </p>
        </div>
        <div className="rounded-lg bg-bg p-3">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Organic leads</p>
          <p className="text-2xl font-bold">{r.organic_leads ?? "Not recorded"}</p>
        </div>
      </section>

      <section className="mt-6 break-inside-avoid">
        <h2 className="mb-2 text-lg font-bold">Results</h2>
        <ResultsCard results={(r.results ?? {}) as Results} at={r.results_at} />
      </section>

      {r.wins && (
        <section className="mt-6 break-inside-avoid rounded-lg border-l-4 border-green-d bg-green/10 p-4">
          <h2 className="mb-1 text-lg font-bold">Wins</h2>
          <p className="whitespace-pre-wrap text-sm">{r.wins}</p>
        </section>
      )}

      {acts.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-bold">Search Growth Actions delivered</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {acts.map((a) => (
                <tr key={a.id} className="break-inside-avoid">
                  <td className="py-1.5 pr-3 align-top text-muted whitespace-nowrap">{a.done_on ? fmtDate(a.done_on) : ""}</td>
                  <td className="py-1.5 pr-3 align-top text-muted">{a.action_type}</td>
                  <td className="py-1.5 align-top">
                    <span className="font-medium">{a.title}</span>
                    {a.url && <span className="block break-all text-xs text-steel">{a.url}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {[...sections.entries()].map(([section, its]) => (
        <section key={section} className="mt-6 break-inside-avoid">
          <h2 className="mb-2 text-lg font-bold">{section}</h2>
          <ul className="divide-y divide-line text-sm">
            {its.map((it) => {
              const ok = itemDone(it);
              return (
                <li key={it.id} className="flex gap-3 py-1.5">
                  <span className={`w-16 shrink-0 text-xs font-semibold ${it.status === "na" ? "text-muted" : ok ? "text-green-d" : "text-amber-700"}`}>
                    {it.status === "na" ? "N/A" : ok ? "Done" : "Not done"}
                  </span>
                  <span className="min-w-0">
                    {it.name}
                    {it.kind === "count" && (
                      <span className="text-muted">
                        {" "}
                        ({it.count ?? 0} of {it.target})
                      </span>
                    )}
                    {it.links.length > 0 && <span className="block break-all text-xs text-steel">{it.links.join(", ")}</span>}
                    {it.notes && <span className="block text-xs text-muted">{it.notes}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {(r.summary || r.next_priorities) && (
        <section className="mt-6 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          {r.summary && (
            <div className="break-inside-avoid">
              <h2 className="mb-1 text-lg font-bold">What shipped, changed or was learned</h2>
              <p className="whitespace-pre-wrap text-sm">{r.summary}</p>
            </div>
          )}
          {r.next_priorities && (
            <div className="break-inside-avoid">
              <h2 className="mb-1 text-lg font-bold">Next month&apos;s priorities</h2>
              <p className="whitespace-pre-wrap text-sm">{r.next_priorities}</p>
            </div>
          )}
        </section>
      )}

      <footer className="mt-8 border-t border-line pt-3 text-xs text-muted">
        Yroc Consulting · internal record ·{" "}
        {r.status === "complete" && r.completed_at ? `completed ${fmtDate(r.completed_at)}${completer ? ` by ${staffName(completer)}` : ""}` : "in progress"}
      </footer>
    </main>
  );
}
