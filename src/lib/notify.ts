import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { mailConfig, sendMail } from "@/lib/email/graph";
import { siteUrl } from "@/lib/email/process";
import { createClient } from "@/lib/supabase/server";

/**
 * Emails the team about tickets: assigned to you, and client replies on your tickets. Staff only, never
 * clients, sent from the no-reply mailbox. The queue (public.notifications) is filled by database
 * triggers; this sends it. Each person chooses which kinds they get (staff.notify_*).
 */

export const NOTIFICATION_KINDS = [
  ["assigned", "A ticket is assigned to me", "notify_assigned"],
  ["client_reply", "A client replies on a ticket assigned to me", "notify_client_reply"],
] as const;

type Row = { id: number; staff_id: string; ticket_id: string; kind: "assigned" | "client_reply"; actor_id: string | null; comment_id: string | null; created_at: string };
type Person = { id: string; email: string; full_name: string | null; active: boolean; notify_assigned: boolean; notify_client_reply: boolean };
type Ticket = { id: string; number: number; title: string; priority: string; due_date: string | null; description: string | null; client: { name: string } | null };

const name = (p: { full_name: string | null; email: string } | undefined) => p?.full_name?.trim() || p?.email || "Someone";
const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}...` : t;
};
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null);

export async function sendPendingNotifications(db: SupabaseClient): Promise<{ sent: number; configured: boolean; errors: string[] }> {
  const cfg = mailConfig();
  if (!cfg) return { sent: 0, configured: false, errors: [] };
  const errors: string[] = [];

  // Old items (mail was off, or a send failed long ago) are dropped rather than sent late.
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await db.from("notifications").update({ sent_at: new Date().toISOString(), error: "expired" }).is("sent_at", null).lt("created_at", cutoff);

  const { data: pending } = await db.from("notifications").select("id").is("sent_at", null).order("created_at").limit(200);
  if (!pending?.length) return { sent: 0, configured: true, errors };
  // Claim them first so two runs at once never send the same email twice.
  const { data: claimed } = await db
    .from("notifications")
    .update({ sent_at: new Date().toISOString() })
    .in("id", pending.map((p) => p.id))
    .is("sent_at", null)
    .select("id, staff_id, ticket_id, kind, actor_id, comment_id, created_at");
  const rows = (claimed ?? []) as Row[];
  if (!rows.length) return { sent: 0, configured: true, errors };

  const ids = <T,>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => !!x))];
  const [{ data: staff }, { data: tickets }, { data: comments }] = await Promise.all([
    db.from("staff").select("id, email, full_name, active, notify_assigned, notify_client_reply"),
    db.from("tickets").select("id, number, title, priority, due_date, description, client:clients(name)").in("id", ids(rows.map((r) => r.ticket_id))),
    ids(rows.map((r) => r.comment_id)).length
      ? db.from("ticket_comments").select("id, body, author_name").in("id", ids(rows.map((r) => r.comment_id)))
      : Promise.resolve({ data: [] as { id: string; body: string; author_name: string | null }[] }),
  ]);
  const people = new Map(((staff ?? []) as Person[]).map((p) => [p.id, p]));
  const tix = new Map(((tickets ?? []) as unknown as Ticket[]).map((t) => [t.id, t]));
  const notes = new Map((comments ?? []).map((c) => [c.id, c]));
  const base = siteUrl();

  const byPerson = new Map<string, Row[]>();
  for (const r of rows) byPerson.set(r.staff_id, [...(byPerson.get(r.staff_id) ?? []), r]);

  let sent = 0;
  for (const [staffId, list] of byPerson) {
    const p = people.get(staffId);
    // Only active staff, and only the kinds they want.
    const wanted = list.filter((r) => p?.active && p.email && (r.kind === "assigned" ? p.notify_assigned : p.notify_client_reply) && tix.has(r.ticket_id));
    if (!p || !wanted.length) continue;

    const line = (r: Row) => {
      const t = tix.get(r.ticket_id)!;
      return `#${t.number} ${t.title}${t.client ? ` (${t.client.name})` : ""}`;
    };
    let subject: string;
    let body: string;
    if (wanted.length === 1) {
      const r = wanted[0];
      const t = tix.get(r.ticket_id)!;
      const url = `${base}/tickets/${t.number}`;
      if (r.kind === "assigned") {
        const meta = [`Priority: ${t.priority[0].toUpperCase()}${t.priority.slice(1)}`, t.due_date ? `Due: ${day(t.due_date)}` : null].filter(Boolean).join(" · ");
        subject = `New ticket for you: #${t.number} ${t.title}`;
        body = [
          `${r.actor_id ? name(people.get(r.actor_id)) : "The portal"} assigned you a ticket${t.client ? ` for ${t.client.name}` : ""}.`,
          "",
          `#${t.number} ${t.title}`,
          meta,
          t.description ? `\n${clip(t.description, 400)}` : "",
          "",
          `Open the ticket: ${url}`,
        ].join("\n");
      } else {
        const c = r.comment_id ? notes.get(r.comment_id) : null;
        subject = `Client reply on #${t.number}: ${t.title}`;
        body = [
          `${c?.author_name?.trim() || "The client"} replied on a ticket assigned to you${t.client ? ` for ${t.client.name}` : ""}.`,
          "",
          c ? `"${clip(c.body, 600)}"` : "",
          "",
          `Open the ticket: ${url}`,
        ].join("\n");
      }
    } else {
      const fresh = wanted.filter((r) => r.kind === "assigned");
      const replies = wanted.filter((r) => r.kind === "client_reply");
      subject = [fresh.length ? `${fresh.length} new ticket${fresh.length === 1 ? "" : "s"}` : "", replies.length ? `${replies.length} client repl${replies.length === 1 ? "y" : "ies"}` : ""]
        .filter(Boolean)
        .join(" and ");
      subject = `${subject[0].toUpperCase()}${subject.slice(1)} for you`;
      body = [
        fresh.length ? `New tickets assigned to you:\n${fresh.map((r) => `- ${line(r)}: ${base}/tickets/${tix.get(r.ticket_id)!.number}`).join("\n")}` : "",
        replies.length ? `Client replies on your tickets:\n${replies.map((r) => `- ${line(r)}: ${base}/tickets/${tix.get(r.ticket_id)!.number}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    body += `\n\nChoose which emails you get: ${base}/profile`;

    try {
      await sendMail(cfg, p.email, subject, body.replace(/\n{3,}/g, "\n\n"));
      sent++;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      errors.push(msg);
      await db.from("notifications").update({ error: msg }).in("id", wanted.map((r) => r.id));
    }
  }
  return { sent, configured: true, errors };
}

/** Sends the queue right after the response, as the signed-in person. */
export function notifySoon() {
  after(async () => {
    try {
      await sendPendingNotifications(await createClient());
    } catch (e) {
      console.error("notifications", (e as Error).message);
    }
  });
}
