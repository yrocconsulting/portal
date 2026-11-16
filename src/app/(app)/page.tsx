import Link from "next/link";
import type { Metadata } from "next";
import { TicketTable } from "@/components/ticket-table";
import { requireStaff, staffName } from "@/lib/auth";
import { todayCentral } from "@/lib/format";
import { TICKET_ROW } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, STATUS_LABEL, type TicketRow } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const me = await requireStaff();
  const supabase = await createClient();
  const today = todayCentral();

  const [mine, unassigned, overdue, open, clients] = await Promise.all([
    supabase.from("tickets").select(TICKET_ROW).eq("assignee_id", me.id).in("status", OPEN_STATUSES).order("due_date", { ascending: true, nullsFirst: false }).limit(25),
    supabase.from("tickets").select(TICKET_ROW).is("assignee_id", null).in("status", OPEN_STATUSES).order("created_at", { ascending: false }).limit(10),
    supabase.from("tickets").select(TICKET_ROW).lt("due_date", today).in("status", OPEN_STATUSES).order("due_date").limit(10),
    supabase.from("tickets").select("status").in("status", OPEN_STATUSES),
    supabase.from("clients").select("id", { count: "exact", head: true }).in("status", ["onboarding", "active"]),
  ]);

  const counts = OPEN_STATUSES.map((s) => ({ s, n: (open.data ?? []).filter((t) => t.status === s).length }));
  const first = staffName(me).split(" ")[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Hi {first}</h1>
          <p className="text-sm text-muted">
            {(mine.data ?? []).length} open tickets assigned to you, {clients.count ?? 0} active clients.
          </p>
        </div>
        <Link href="/tickets/new" className="btn-green">
          + New ticket
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map(({ s, n }) => (
          <Link key={s} href={`/tickets?status=${s}`} className="card p-4 transition hover:border-steel/40">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">{STATUS_LABEL[s]}</p>
            <p className="mt-1 font-display text-3xl font-bold">{n}</p>
          </Link>
        ))}
      </div>

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
