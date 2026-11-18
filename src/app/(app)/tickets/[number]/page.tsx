import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { Avatar } from "@/components/avatar";
import { requireStaff, staffName } from "@/lib/auth";
import { avatarUrls } from "@/lib/avatars";
import { fmtDate, fmtDateTime, isOverdue, timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  TYPES,
  TYPE_LABEL,
  type Attachment,
  type Comment,
  type Ticket,
  type TicketEvent,
} from "@/lib/types";
import { deleteTicket } from "../actions";
import { Attachments, CommentBox, DeleteCommentButton, DueDate, FieldSelect, TicketText } from "./parts";

export async function generateMetadata({ params }: PageProps<"/tickets/[number]">): Promise<Metadata> {
  const { number } = await params;
  return { title: `#${number}` };
}

const SOURCE_LABEL: Record<Ticket["source"], string> = {
  manual: "Created in portal",
  email: "From email",
  onboarding: "Onboarding checklist",
  claude: "Created by Claude",
  report: "From weekly report",
};

export default async function TicketPage({ params }: PageProps<"/tickets/[number]">) {
  const me = await requireStaff();
  const { number } = await params;
  const n = Number(number);
  if (!Number.isInteger(n)) notFound();

  const supabase = await createClient();
  const { data: t } = await supabase.from("tickets").select("*").eq("number", n).maybeSingle<Ticket>();
  if (!t) notFound();

  const [{ data: comments }, { data: events }, { data: files }, { data: staff }, { data: clients }, client, contact] = await Promise.all([
    supabase.from("ticket_comments").select("*").eq("ticket_id", t.id).order("created_at"),
    supabase.from("ticket_events").select("*").eq("ticket_id", t.id).order("created_at"),
    supabase.from("attachments").select("*").eq("ticket_id", t.id).order("created_at"),
    supabase.from("staff").select("id, full_name, email, active, avatar_path, job_title").order("full_name"),
    supabase.from("clients").select("id, name").order("name"),
    t.client_id ? supabase.from("clients").select("id, name, white_label, partner, domain").eq("id", t.client_id).single() : Promise.resolve({ data: null }),
    t.contact_id ? supabase.from("contacts").select("name, email, phone").eq("id", t.contact_id).single() : Promise.resolve({ data: null }),
  ]);

  const fileRows = (files ?? []) as Attachment[];
  const signed = fileRows.length
    ? (await supabase.storage.from("attachments").createSignedUrls(fileRows.map((f) => f.path), 3600)).data ?? []
    : [];
  const urlFor = (p: string) => signed.find((s) => s.path === p)?.signedUrl ?? null;

  const people = new Map((staff ?? []).map((s) => [s.id, staffName(s)]));
  const photos = await avatarUrls((staff ?? []).map((s) => s.avatar_path));
  const photoOf = (id: string | null) => {
    const p = (staff ?? []).find((s) => s.id === id)?.avatar_path;
    return p ? photos[p] ?? null : null;
  };
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const who = (id: string | null) => (id ? people.get(id) ?? "Someone" : "System");

  type Item = { at: string; kind: "comment"; c: Comment } | { at: string; kind: "event"; e: TicketEvent };
  const feed: Item[] = [
    ...((comments ?? []) as Comment[]).map((c) => ({ at: c.created_at, kind: "comment" as const, c })),
    ...((events ?? []) as TicketEvent[]).map((e) => ({ at: e.created_at, kind: "event" as const, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  function describe(e: TicketEvent): string {
    const d = e.data;
    switch (e.kind) {
      case "created":
        return "created this ticket";
      case "status":
        return `changed status to ${STATUS_LABEL[d.to as keyof typeof STATUS_LABEL] ?? d.to}`;
      case "priority":
        return `set priority to ${PRIORITY_LABEL[d.to as keyof typeof PRIORITY_LABEL] ?? d.to}`;
      case "assignee":
        return d.to ? `assigned it to ${who(d.to)}` : "unassigned it";
      case "due_date":
        return d.to ? `set the due date to ${fmtDate(d.to)}` : "removed the due date";
      case "client":
        return d.to ? `linked it to ${clientName.get(d.to) ?? "a client"}` : "removed the client";
      default:
        return e.kind;
    }
  }

  const overdue = isOverdue(t.due_date, t.status);
  const activeStaff = (staff ?? []).filter((s) => s.active || s.id === t.assignee_id);

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href="/tickets" className="hover:text-ink">
          Tickets
        </Link>
        <span>/</span>
        <span className="font-mono">#{t.number}</span>
        {overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Overdue</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          <section className="card p-6">
            <TicketText id={t.id} title={t.title} description={t.description ?? ""} />
            <div className="mt-6 border-t border-line pt-5">
              <Attachments ticketId={t.id} files={fileRows.map((f) => ({ id: f.id, name: f.name, size: f.size, url: urlFor(f.path) }))} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">Activity</h2>
            <ol className="space-y-3">
              {feed.map((it) =>
                it.kind === "event" ? (
                  <li key={`e${it.e.id}`} className="flex items-center gap-2 pl-3 text-xs text-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-steel/50" />
                    <span>
                      <b className="font-medium text-ink/80">{who(it.e.actor_id)}</b> {describe(it.e)}
                    </span>
                    <span title={fmtDateTime(it.at)}>{timeAgo(it.at)}</span>
                  </li>
                ) : (
                  <li key={it.c.id} className={`card p-4 ${it.c.author_kind === "claude" ? "border-green/50" : it.c.author_kind === "email" ? "border-l-4 border-l-steel" : ""}`}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-2 font-semibold">
                        {it.c.author_kind === "staff" && <Avatar name={who(it.c.author_id)} url={photoOf(it.c.author_id)} size={24} />}
                        {it.c.author_kind === "staff" ? who(it.c.author_id) : it.c.author_kind === "claude" ? "Claude" : it.c.author_name ?? "Client"}
                        {it.c.author_kind === "email" && (
                          <span className="ml-2 font-normal text-muted">
                            {it.c.email_message_id ? "via email" : "client message"}
                            {it.c.author_id && `, ${it.c.email_message_id ? "forwarded" : "logged"} by ${who(it.c.author_id)}`}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-muted">
                        <span title={fmtDateTime(it.at)}>{timeAgo(it.at)}</span>
                        {(it.c.author_id === me.id || me.role === "admin") && <DeleteCommentButton id={it.c.id} />}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{it.c.body}</div>
                  </li>
                ),
              )}
            </ol>
            <div className="mt-4">
              <CommentBox ticketId={t.id} status={t.status} contactName={contact.data?.name ?? ""} />
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="card space-y-4 p-4">
            <FieldSelect ticketId={t.id} field="status" label="Status" value={t.status} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            <FieldSelect
              ticketId={t.id}
              field="assignee_id"
              label="Assignee"
              value={t.assignee_id ?? ""}
              options={[{ value: "", label: "Unassigned" }, ...activeStaff.map((s) => ({ value: s.id, label: staffName(s) }))]}
            />
            <FieldSelect ticketId={t.id} field="priority" label="Priority" value={t.priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
            <DueDate ticketId={t.id} value={t.due_date ?? ""} />
            <FieldSelect
              ticketId={t.id}
              field="client_id"
              label="Client"
              value={t.client_id ?? ""}
              options={[{ value: "", label: "No client" }, ...(clients ?? []).map((c) => ({ value: c.id, label: c.name }))]}
            />
            <FieldSelect ticketId={t.id} field="type" label="Type" value={t.type} options={TYPES.map((x) => ({ value: x, label: TYPE_LABEL[x] }))} />
          </div>

          {client.data && (
            <div className="card p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/clients/${client.data.id}`} className="font-semibold hover:text-green-d">
                  {client.data.name}
                </Link>
                {client.data.white_label && <WhiteLabelBadge />}
              </div>
              {client.data.white_label && client.data.partner && <p className="mt-1 text-xs text-muted">Through {client.data.partner}</p>}
              {contact.data && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="font-medium">{contact.data.name}</p>
                  {contact.data.email && (
                    <a href={`mailto:${contact.data.email}`} className="block text-muted hover:text-ink">
                      {contact.data.email}
                    </a>
                  )}
                  {contact.data.phone && <p className="text-muted">{contact.data.phone}</p>}
                </div>
              )}
            </div>
          )}

          <dl className="card space-y-2 p-4 text-xs text-muted">
            <div className="flex justify-between gap-3">
              <dt>Source</dt>
              <dd className="text-ink">{SOURCE_LABEL[t.source]}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Created</dt>
              <dd className="text-ink">{fmtDateTime(t.created_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Created by</dt>
              <dd className="text-ink">{t.created_by ? who(t.created_by) : "System"}</dd>
            </div>
            {t.resolved_at && (
              <div className="flex justify-between gap-3">
                <dt>Resolved</dt>
                <dd className="text-ink">{fmtDateTime(t.resolved_at)}</dd>
              </div>
            )}
          </dl>

          {t.client_id && (
            <Link href={`/drafts/new?client=${t.client_id}&ticket=${t.id}`} className="btn-ghost w-full text-xs">
              Draft content with Claude
            </Link>
          )}

          {me.role === "admin" && (
            <form action={deleteTicket}>
              <input type="hidden" name="id" value={t.id} />
              <ConfirmButton message="Delete this ticket and its files? This cannot be undone." className="btn-danger w-full text-xs">Delete ticket</ConfirmButton>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
