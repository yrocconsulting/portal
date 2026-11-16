import Link from "next/link";
import type { Metadata } from "next";
import { TicketTable } from "@/components/ticket-table";
import { requireStaff, staffName } from "@/lib/auth";
import { TICKET_ROW } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, type TicketRow } from "@/lib/types";

export const metadata: Metadata = { title: "Tickets" };

const PAGE = 50;

export default async function TicketsPage({ searchParams }: PageProps<"/tickets">) {
  await requireStaff();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const q = get("q");
  const status = get("status") || "open";
  const assignee = get("assignee");
  const client = get("client");
  const priority = get("priority");
  const page = Math.max(1, Number(get("page")) || 1);

  const supabase = await createClient();
  let query = supabase.from("tickets").select(TICKET_ROW, { count: "exact" });
  if (status === "open") query = query.in("status", OPEN_STATUSES);
  else if (status !== "all") query = query.eq("status", status);
  if (assignee === "none") query = query.is("assignee_id", null);
  else if (assignee) query = query.eq("assignee_id", assignee);
  if (client) query = query.eq("client_id", client);
  if (priority) query = query.eq("priority", priority);
  if (q) {
    const n = Number(q.replace(/^#/, ""));
    const safe = q.replace(/[%,()]/g, " ");
    query = Number.isInteger(n) && n > 0 ? query.eq("number", n) : query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  query = query.order("updated_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);

  const [{ data: tickets, count, error }, { data: staff }, { data: clients }] = await Promise.all([
    query,
    supabase.from("staff").select("id, full_name, email").eq("active", true).order("full_name"),
    supabase.from("clients").select("id, name").order("name"),
  ]);

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => {
    const u = new URLSearchParams(Object.entries({ q, status, assignee, client, priority }).filter(([, v]) => v) as [string, string][]);
    if (p > 1) u.set("page", String(p));
    return `/tickets?${u}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Tickets</h1>
        <Link href="/tickets/new" className="btn-green">
          + New ticket
        </Link>
      </div>

      <form className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
        <input name="q" defaultValue={q} placeholder="Search title, description or #number" className="field" />
        <select name="status" defaultValue={status} className="field">
          <option value="open">All open</option>
          <option value="all">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="assignee" defaultValue={assignee} className="field">
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {(staff ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {staffName(s)}
            </option>
          ))}
        </select>
        <select name="client" defaultValue={client} className="field">
          <option value="">All clients</option>
          {(clients ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={priority} className="field">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary">Filter</button>
          <Link href="/tickets" className="btn-ghost">
            Reset
          </Link>
        </div>
      </form>

      <section className="card">
        {error ? (
          <p className="p-4 text-sm text-red-700">{error.message}</p>
        ) : (
          <TicketTable tickets={(tickets ?? []) as TicketRow[]} empty="No tickets match these filters." />
        )}
        <footer className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
          <span>
            {total} ticket{total === 1 ? "" : "s"}
          </span>
          {pages > 1 && (
            <span className="flex items-center gap-3">
              {page > 1 && <Link href={link(page - 1)} className="hover:text-ink">Previous</Link>}
              Page {page} of {pages}
              {page < pages && <Link href={link(page + 1)} className="hover:text-ink">Next</Link>}
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}
