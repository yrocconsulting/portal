import Link from "next/link";
import type { Metadata } from "next";
import { requireStaff, staffName } from "@/lib/auth";
import { mailConfig } from "@/lib/email/graph";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { dismissEmail, ticketFromEmail } from "./actions";
import { RunButton } from "./parts";

export const metadata: Metadata = { title: "Inbox" };

type Row = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  body: string | null;
  received_at: string | null;
  created_at: string;
  status: string;
  error: string | null;
  original_from_email: string | null;
  attachment_count: number;
  ticket: { number: number; title: string } | null;
  staff: { full_name: string | null; email: string } | null;
};

const STATUS: Record<string, string> = {
  ticket: "New ticket",
  comment: "Added to ticket",
  unmatched: "Needs review",
  dismissed: "Dismissed",
  error: "Error",
  processing: "Processing",
};

export default async function InboxPage() {
  const me = await requireStaff();
  const cfg = mailConfig();
  const supabase = await createClient();
  const select = "*, ticket:tickets(number, title), staff:staff(full_name, email)";
  const [{ data: unmatched }, { data: recent }, { data: clients }] = await Promise.all([
    supabase.from("email_messages").select(select).eq("status", "unmatched").order("received_at", { ascending: false }).limit(50),
    supabase.from("email_messages").select(select).neq("status", "unmatched").order("created_at", { ascending: false }).limit(30),
    supabase.from("clients").select("id, name").neq("status", "former").order("name"),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Forward a client email to <b className="text-ink">{cfg?.helpdesk ?? "the helpdesk address"}</b> and it becomes a ticket, linked to the client by the
          sender. To add to an existing ticket, keep its number (like <span className="font-mono">#1042</span>) in the subject. Only team members can create
          tickets this way; anything else waits here for review.
        </p>
      </div>

      <section className="card flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="text-sm">
          {cfg ? (
            <>
              <p className="font-semibold">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-d align-middle" />
                Connected to {cfg.helpdesk}
              </p>
              <p className="text-muted">New mail is picked up within a minute or two, with a daily catch-up.</p>
            </>
          ) : (
            <>
              <p className="font-semibold">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
                Mailbox not connected yet
              </p>
              <p className="text-muted">Microsoft 365 settings still need to be added in Vercel.</p>
            </>
          )}
        </div>
        {cfg && (
          <div className="flex flex-wrap items-start gap-3">
            <RunButton kind="check" />
            {me.role === "admin" && <RunButton kind="connect" />}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="border-b border-line px-4 py-3 font-semibold">Needs review ({(unmatched ?? []).length})</h2>
        {(unmatched ?? []).length ? (
          <ul className="divide-y divide-line">
            {((unmatched ?? []) as Row[]).map((m) => (
              <li key={m.id} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{m.subject || "(no subject)"}</p>
                  <span className="text-xs text-muted" title={m.received_at ? fmtDateTime(m.received_at) : ""}>
                    {m.received_at ? timeAgo(m.received_at) : ""}
                  </span>
                </div>
                <p className="text-sm text-muted">From {m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}</p>
                {m.body && <p className="line-clamp-3 whitespace-pre-wrap text-sm">{m.body}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <form action={ticketFromEmail} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={m.id} />
                    <select name="client_id" className="field w-auto py-1.5" defaultValue="">
                      <option value="">No client</option>
                      {(clients ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn-green py-1.5">Create ticket</button>
                  </form>
                  <form action={dismissEmail}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn-ghost py-1.5">Dismiss</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted">Nothing waiting.</p>
        )}
      </section>

      <section className="card">
        <h2 className="border-b border-line px-4 py-3 font-semibold">Recent</h2>
        {(recent ?? []).length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Forwarded by</th>
                  <th className="px-4 py-2.5">Result</th>
                  <th className="px-4 py-2.5 text-right">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {((recent ?? []) as Row[]).map((m) => (
                  <tr key={m.id}>
                    <td className="max-w-sm px-4 py-3">
                      <p className="truncate font-medium">{m.subject || "(no subject)"}</p>
                      {m.original_from_email && <p className="truncate text-xs text-muted">Originally from {m.original_from_email}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{m.staff ? staffName(m.staff) : m.from_email}</td>
                    <td className="px-4 py-3">
                      {m.ticket ? (
                        <Link href={`/tickets/${m.ticket.number}`} className="hover:text-green-d">
                          {STATUS[m.status] ?? m.status} <span className="font-mono">#{m.ticket.number}</span>
                          {m.attachment_count > 0 && <span className="text-muted"> · {m.attachment_count} file{m.attachment_count === 1 ? "" : "s"}</span>}
                        </Link>
                      ) : (
                        <span className={m.status === "error" ? "text-red-700" : "text-muted"} title={m.error ?? ""}>
                          {STATUS[m.status] ?? m.status}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">{timeAgo(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted">No emails yet.</p>
        )}
      </section>
    </div>
  );
}
