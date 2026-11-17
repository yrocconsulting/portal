import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { TicketTable } from "@/components/ticket-table";
import { requireStaff, staffName } from "@/lib/auth";
import { todayCentral } from "@/lib/format";
import { TICKET_ROW } from "@/lib/queries";
import { progress } from "@/lib/report-progress";
import { monthLabel } from "@/lib/reports";
import { randomVerse } from "@/lib/scripture";
import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, STATUS_LABEL, type TicketRow } from "@/lib/types";
import { trackedDomain } from "@/lib/visibility";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(hourCentral: number) {
  if (hourCentral < 12) return "Good morning";
  if (hourCentral < 17) return "Good afternoon";
  return "Good evening";
}

export default async function Dashboard() {
  const me = await requireStaff();
  const supabase = await createClient();
  const today = todayCentral();
  const month = today.slice(0, 7);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  const verse = randomVerse();

  const [mine, unassigned, overdue, open, myClientsRes, latestPrt] = await Promise.all([
    supabase.from("tickets").select(TICKET_ROW).eq("assignee_id", me.id).in("status", OPEN_STATUSES).order("due_date", { ascending: true, nullsFirst: false }).limit(25),
    supabase.from("tickets").select(TICKET_ROW).is("assignee_id", null).in("status", OPEN_STATUSES).order("created_at", { ascending: false }).limit(10),
    supabase.from("tickets").select(TICKET_ROW).lt("due_date", today).in("status", OPEN_STATUSES).order("due_date").limit(10),
    supabase.from("tickets").select("status, client_id, due_date").in("status", OPEN_STATUSES),
    supabase
      .from("clients")
      .select("id, name, status, white_label, lead_id, account_manager_id, domain, tracking_domain")
      .or(`lead_id.eq.${me.id},account_manager_id.eq.${me.id}`)
      .neq("status", "former")
      .order("name"),
    supabase.from("prt_reports").select("report_date").order("report_date", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const myClients = myClientsRes.data ?? [];
  const ids = myClients.map((c) => c.id);
  const domains = myClients.map((c) => trackedDomain(c)).filter((d): d is string => !!d);
  const [{ data: reports }, { data: vis }] = await Promise.all([
    ids.length ? supabase.from("monthly_reports").select("id, client_id, status").eq("month", `${month}-01`).in("client_id", ids) : Promise.resolve({ data: [] }),
    latestPrt.data && domains.length
      ? supabase.from("prt_site_results").select("domain, visibility").eq("report_date", latestPrt.data.report_date).in("domain", domains)
      : Promise.resolve({ data: [] }),
  ]);
  const reportIds = (reports ?? []).map((r) => r.id);
  const [{ data: items }, { data: actions }] = reportIds.length
    ? await Promise.all([
        supabase.from("report_items").select("report_id, kind, status, count, target").in("report_id", reportIds),
        supabase.from("report_actions").select("report_id").in("report_id", reportIds),
      ])
    : [{ data: [] }, { data: [] }];

  const openTickets = open.data ?? [];
  const counts = OPEN_STATUSES.map((s) => ({ s, n: openTickets.filter((t) => t.status === s).length }));
  const first = staffName(me).split(" ")[0];
  const visBy = new Map((vis ?? []).map((v) => [v.domain, v.visibility]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {greeting(hour)}, {first}
          </h1>
          <p className="text-sm text-muted">
            {(mine.data ?? []).length} open ticket{(mine.data ?? []).length === 1 ? "" : "s"} assigned to you
            {myClients.length > 0 && `, ${myClients.length} client${myClients.length === 1 ? "" : "s"} in your care`}.
          </p>
        </div>
        <Link href="/tickets/new" className="btn-green">
          + New ticket
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          {counts.map(({ s, n }) => (
            <Link key={s} href={`/tickets?status=${s}`} className="card p-4 transition hover:border-steel/40">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">{STATUS_LABEL[s]}</p>
              <p className="mt-1 font-display text-3xl font-bold">{n}</p>
            </Link>
          ))}
        </div>
        <figure className="relative overflow-hidden rounded-xl bg-ink p-6 text-white">
          <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-green opacity-15 blur-3xl" />
          <p className="relative text-[11px] font-bold tracking-[0.2em] text-green uppercase">A word of encouragement</p>
          <blockquote className="relative mt-3 font-display text-lg leading-snug">&ldquo;{verse.text}&rdquo;</blockquote>
          <figcaption className="relative mt-3 text-sm text-white/60">
            {verse.ref} <span className="text-white/35">(BSB)</span>
          </figcaption>
        </figure>
      </div>

      <section className="card">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">My clients</h2>
          <Link href="/clients?lead=me" className="text-sm text-green-d hover:underline">
            View list
          </Link>
        </header>
        {myClients.length ? (
          <ul className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {myClients.map((c) => {
              const tickets = openTickets.filter((t) => t.client_id === c.id);
              const late = tickets.filter((t) => t.due_date && t.due_date < today).length;
              const r = (reports ?? []).find((x) => x.client_id === c.id);
              const p = r
                ? progress(
                    (items ?? []).filter((i) => i.report_id === r.id),
                    (actions ?? []).filter((a) => a.report_id === r.id).length,
                  )
                : null;
              const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
              const v = visBy.get(trackedDomain(c) ?? "");
              const role = c.lead_id === me.id && c.account_manager_id === me.id ? "Lead and account manager" : c.lead_id === me.id ? "Lead" : "Account manager";
              return (
                <li key={c.id} className="rounded-lg border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/clients/${c.id}`} className="min-w-0 font-semibold hover:text-green-d">
                      <span className="block truncate">{c.name}</span>
                    </Link>
                    {c.white_label && <WhiteLabelBadge />}
                  </div>
                  <p className="text-xs text-muted">
                    {role}
                    {c.status === "onboarding" && " · Onboarding"}
                    {c.status === "paused" && " · Paused"}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <Link href={`/tickets?client=${c.id}`} className="rounded-lg bg-bg px-2 py-1.5 hover:bg-line/60">
                      <span className="block font-display text-lg font-bold">{tickets.length}</span>
                      <span className="text-[11px] text-muted">open</span>
                    </Link>
                    <span className={`rounded-lg px-2 py-1.5 ${late ? "bg-red-50 text-red-700" : "bg-bg"}`}>
                      <span className="block font-display text-lg font-bold">{late}</span>
                      <span className="text-[11px] opacity-80">overdue</span>
                    </span>
                    <Link href={`/clients/${c.id}#ai-visibility`} className="rounded-lg bg-bg px-2 py-1.5 hover:bg-line/60">
                      <span className="block font-display text-lg font-bold">{v === undefined ? "none" : `${v}%`}</span>
                      <span className="text-[11px] text-muted">AI visibility</span>
                    </Link>
                  </div>
                  <div className="mt-3">
                    {r ? (
                      <Link href={`/reports/${r.id}`} className="group block">
                        <span className="flex items-center justify-between text-xs text-muted">
                          <span className="group-hover:text-ink">{monthLabel(month).split(" ")[0]} report</span>
                          <span>{r.status === "complete" ? "Complete" : `${p?.done ?? 0} of ${p?.total ?? 0}`}</span>
                        </span>
                        <span className="mt-1 block h-1.5 rounded-full bg-bg">
                          <span className="block h-1.5 rounded-full bg-green-d" style={{ width: `${r.status === "complete" ? 100 : pct}%` }} />
                        </span>
                      </Link>
                    ) : (
                      <Link href={`/reports?month=${month}`} className="text-xs text-muted hover:text-green-d">
                        {monthLabel(month).split(" ")[0]} report not started
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted">
            No clients assigned to you yet. Set yourself as lead or account manager under a client&apos;s details.
          </p>
        )}
      </section>

      <section className="card">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">My open tickets</h2>
          <Link href={`/tickets?assignee=${me.id}`} className="text-sm text-green-d hover:underline">
            View all
          </Link>
        </header>
        <TicketTable tickets={(mine.data ?? []) as TicketRow[]} empty="Nothing assigned to you. Nice." />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">Overdue</h2>
          </header>
          <TicketTable compact tickets={(overdue.data ?? []) as TicketRow[]} empty="Nothing overdue." />
        </section>
        <section className="card">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">Unassigned</h2>
            <Link href="/tickets?assignee=none" className="text-sm text-green-d hover:underline">
              View all
            </Link>
          </header>
          <TicketTable compact tickets={(unassigned.data ?? []) as TicketRow[]} empty="Every open ticket has an owner." />
        </section>
      </div>
    </div>
  );
}
