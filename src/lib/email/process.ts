import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAttachments, listUnread, mailConfig, markRead, sendMail, upsertSubscription, type GraphMessage, type MailConfig } from "./graph";
import { clip, parseForward, ticketNumberFromSubject } from "./parse";

type Admin = ReturnType<typeof createAdminClient>;
type Staff = { id: string; email: string; full_name: string | null };

export type RunSummary = { checked: number; tickets: number; comments: number; unmatched: number; errors: string[]; configured: boolean };

export function siteUrl(): string {
  const v = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://127.0.0.1:3000");
  return v.replace(/\/$/, "");
}

/** Secret Microsoft echoes back on every notification, derived from CRON_SECRET so there is one less setting. */
export function webhookClientState(): string {
  return createHash("sha256").update(`graph-webhook:${process.env.CRON_SECRET ?? ""}`).digest("hex").slice(0, 40);
}

const ownDomains = (cfg: MailConfig, staff: Staff[]) =>
  Array.from(new Set([cfg.helpdesk, cfg.noreply, ...staff.map((s) => s.email)].map((e) => e.split("@")[1]).filter(Boolean)));

/** Reads unread helpdesk mail and files it. Safe to run concurrently: each message is claimed once. */
export async function processHelpdesk(): Promise<RunSummary> {
  const summary: RunSummary = { checked: 0, tickets: 0, comments: 0, unmatched: 0, errors: [], configured: false };
  const cfg = mailConfig();
  if (!cfg) return summary;
  summary.configured = true;

  const db = createAdminClient();
  const { data: staffRows } = await db.from("staff").select("id, email, full_name").eq("active", true);
  const staff = (staffRows ?? []) as Staff[];

  const messages = await listUnread(cfg);
  for (const msg of messages) {
    summary.checked++;
    try {
      const outcome = await handleMessage(db, cfg, staff, msg);
      if (outcome === "ticket") summary.tickets++;
      else if (outcome === "comment") summary.comments++;
      else if (outcome === "unmatched") summary.unmatched++;
    } catch (e) {
      summary.errors.push((e as Error).message);
      await db.from("email_messages").update({ status: "error", error: (e as Error).message.slice(0, 500) }).eq("graph_id", msg.id);
    }
    // Mark read even after an error so one bad message can't block the queue; the error is kept in the log.
    await markRead(cfg, msg.id).catch((e) => summary.errors.push(`mark read: ${(e as Error).message}`));
  }
  return summary;
}

async function handleMessage(db: Admin, cfg: MailConfig, staff: Staff[], msg: GraphMessage): Promise<string | null> {
  const fromEmail = msg.from?.emailAddress?.address?.toLowerCase() ?? null;
  const fromName = msg.from?.emailAddress?.name ?? null;
  const subject = msg.subject ?? "";
  const body = msg.body?.content ?? "";

  // Claim the message (unique graph_id): a second concurrent run skips it.
  const { data: claimed, error: claimErr } = await db
    .from("email_messages")
    .insert({
      graph_id: msg.id,
      internet_message_id: msg.internetMessageId ?? null,
      mailbox: cfg.helpdesk,
      from_email: fromEmail,
      from_name: fromName,
      subject,
      body: clip(body),
      received_at: msg.receivedDateTime ?? null,
    })
    .select("id")
    .maybeSingle();
  if (claimErr) {
    if (claimErr.code === "23505") return null; // already handled
    throw new Error(claimErr.message);
  }
  const emailId = claimed!.id as string;

  // Exchange stamps mail sent from inside our Microsoft 365 account as "Internal". A staff address on
  // mail that arrived from outside is spoofed, so it gets no special treatment.
  const authAs = msg.internetMessageHeaders?.find((h) => h.name.toLowerCase() === "x-ms-exchange-organization-authas")?.value;
  const internal = authAs === undefined || authAs.toLowerCase() === "internal";
  const forwarder = internal ? staff.find((s) => s.email.toLowerCase() === fromEmail) : undefined;
  if (!forwarder) {
    // Only the team can create tickets by email. Anything else waits for a person in the Inbox.
    await db.from("email_messages").update({ status: "unmatched" }).eq("id", emailId);
    return "unmatched";
  }

  const parsed = parseForward(subject, body, ownDomains(cfg, staff));
  const original = parsed.original;
  const who = original ? (original.name ? `${original.name} <${original.email}>` : original.email) : null;

  // Follow-up on an existing ticket: "#1042" in the subject.
  const number = ticketNumberFromSubject(subject);
  if (number) {
    const { data: t } = await db.from("tickets").select("id, number, title").eq("number", number).maybeSingle();
    if (t) {
      const text = [parsed.note && `Note from ${forwarder.full_name ?? forwarder.email}:\n${parsed.note}`, parsed.body].filter(Boolean).join("\n\n---\n\n");
      await db.from("ticket_comments").insert({
        ticket_id: t.id,
        author_id: forwarder.id,
        author_kind: original ? "email" : "staff",
        author_name: original ? original.name ?? original.email : null,
        body: clip(text || "(empty message)"),
        internal: true,
        email_message_id: emailId,
      });
      await db.from("tickets").update({ updated_at: new Date().toISOString() }).eq("id", t.id);
      const files = msg.hasAttachments ? await saveAttachments(db, cfg, msg.id, t.id, forwarder.id) : 0;
      await db
        .from("email_messages")
        .update({ status: "comment", ticket_id: t.id, staff_id: forwarder.id, original_from_email: original?.email ?? null, original_from_name: original?.name ?? null, attachment_count: files })
        .eq("id", emailId);
      await confirm(cfg, forwarder.email, `Added to ticket #${t.number}: ${t.title}`, [
        `Your forwarded email was added to ticket #${t.number}${files ? ` with ${files} file${files === 1 ? "" : "s"}` : ""}.`,
        `${siteUrl()}/tickets/${t.number}`,
      ]);
      return "comment";
    }
  }

  // New ticket. Match the client by contact email, then by domain.
  let clientId: string | null = null;
  let contactId: string | null = null;
  let clientName: string | null = null;
  if (original) {
    const { data: contact } = await db.from("contacts").select("id, client_id, clients(name)").eq("email", original.email).limit(1).maybeSingle();
    if (contact) {
      clientId = contact.client_id;
      contactId = contact.id;
      clientName = (contact.clients as unknown as { name: string } | null)?.name ?? null;
    } else {
      const domain = original.email.split("@")[1];
      const { data: client } = await db.from("clients").select("id, name").eq("domain", domain).maybeSingle();
      if (client) {
        clientId = client.id;
        clientName = client.name;
        // Remember this person as a contact for next time.
        const { data: c } = await db
          .from("contacts")
          .insert({ client_id: client.id, name: original.name ?? original.email, email: original.email })
          .select("id")
          .single();
        contactId = c?.id ?? null;
      }
    }
  }

  const description = [
    parsed.note && `Note from ${forwarder.full_name ?? forwarder.email}:\n${parsed.note}`,
    who && `From: ${who}`,
    parsed.body,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data: ticket, error } = await db
    .from("tickets")
    .insert({
      title: parsed.subject.slice(0, 200),
      description: clip(description),
      client_id: clientId,
      contact_id: contactId,
      type: "request",
      source: "email",
      created_by: forwarder.id,
    })
    .select("id, number, title")
    .single();
  if (error) throw new Error(error.message);

  const files = msg.hasAttachments ? await saveAttachments(db, cfg, msg.id, ticket.id, forwarder.id) : 0;
  await db
    .from("email_messages")
    .update({ status: "ticket", ticket_id: ticket.id, staff_id: forwarder.id, original_from_email: original?.email ?? null, original_from_name: original?.name ?? null, attachment_count: files })
    .eq("id", emailId);

  await confirm(cfg, forwarder.email, `Ticket #${ticket.number} created: ${ticket.title}`, [
    `Ticket #${ticket.number} was created${clientName ? ` for ${clientName}` : ""}${files ? ` with ${files} file${files === 1 ? "" : "s"}` : ""}.`,
    clientName ? "" : original ? `No client matched ${original.email}. Set the client on the ticket.` : "The original sender wasn't found in the email. Set the client on the ticket.",
    `${siteUrl()}/tickets/${ticket.number}`,
    "",
    `To add a later email to this ticket, forward it with #${ticket.number} in the subject.`,
  ]);
  return "ticket";
}

async function saveAttachments(db: Admin, cfg: MailConfig, messageId: string, ticketId: string, staffId: string): Promise<number> {
  let n = 0;
  for (const a of await listAttachments(cfg, messageId)) {
    if (a["@odata.type"] && a["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    if (a.isInline || !a.contentBytes) continue; // signature logos and embedded images
    const bytes = Buffer.from(a.contentBytes, "base64");
    if (bytes.length > 25 * 1024 * 1024) continue;
    const safe = a.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${ticketId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await db.storage.from("attachments").upload(path, bytes, { contentType: a.contentType || "application/octet-stream" });
    if (error) throw new Error(`attachment ${a.name}: ${error.message}`);
    await db.from("attachments").insert({ ticket_id: ticketId, path, name: a.name, size: bytes.length, content_type: a.contentType ?? null, uploaded_by: staffId });
    n++;
  }
  return n;
}

async function confirm(cfg: MailConfig, to: string, subject: string, lines: string[]) {
  // A failed confirmation should not undo the ticket.
  await sendMail(cfg, to, subject, lines.filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n")).catch(() => {});
}

/** Creates or renews the new-mail subscription so Microsoft calls us as mail arrives. */
export async function ensureSubscription(): Promise<string> {
  const cfg = mailConfig();
  if (!cfg) return "not configured";
  const db = createAdminClient();
  const { data } = await db.from("app_settings").select("value").eq("key", "graph_subscription").maybeSingle();
  const existing = (data?.value as { id?: string } | null)?.id ?? null;
  const sub = await upsertSubscription(cfg, `${siteUrl()}/api/email/webhook`, webhookClientState(), existing);
  await db.from("app_settings").upsert({ key: "graph_subscription", value: sub, updated_at: new Date().toISOString() });
  return `subscription ${existing && existing === sub.id ? "renewed" : "created"} until ${sub.expirationDateTime}`;
}
