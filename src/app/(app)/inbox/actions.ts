"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { ensureSubscription, processHelpdesk } from "@/lib/email/process";
import { cleanSubject, clip } from "@/lib/email/parse";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type State = { message?: string; error?: string };

/** Reads the tasks mailbox now (any staff member). */
export async function checkNow(): Promise<State> {
  await requireStaff();
  try {
    const r = await processHelpdesk();
    revalidatePath("/", "layout");
    if (!r.configured) return { error: "The tasks mailbox is not connected yet." };
    const parts = [`Checked ${r.checked} new email${r.checked === 1 ? "" : "s"}`];
    if (r.tickets) parts.push(`${r.tickets} ticket${r.tickets === 1 ? "" : "s"} created`);
    if (r.comments) parts.push(`${r.comments} added to tickets`);
    if (r.unmatched) parts.push(`${r.unmatched} need review`);
    return r.errors.length ? { error: `${parts.join(", ")}. Problems: ${r.errors.join("; ")}` } : { message: parts.join(", ") + "." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Creates or renews the Microsoft new-mail subscription (admins). */
export async function connectMailbox(): Promise<State> {
  await requireAdmin();
  try {
    return { message: `Connected: ${await ensureSubscription()}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Turns an unmatched email into a ticket by hand. */
export async function ticketFromEmail(fd: FormData) {
  const me = await requireStaff();
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  const { data: m } = await supabase.from("email_messages").select("*").eq("id", id).single();
  if (!m || m.ticket_id) return;
  const who = m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email;
  const { data: t, error } = await supabase
    .from("tickets")
    .insert({
      title: cleanSubject(m.subject).slice(0, 200),
      description: clip([who && `From: ${who}`, m.body].filter(Boolean).join("\n\n")),
      client_id: str(fd, "client_id"),
      type: "request",
      source: "email",
      created_by: me.id,
    })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  await supabase.from("email_messages").update({ status: "ticket", ticket_id: t.id, staff_id: me.id }).eq("id", id);
  revalidatePath("/", "layout");
  redirect(`/tickets/${t.number}`);
}

export async function dismissEmail(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("email_messages").update({ status: "dismissed" }).eq("id", id).eq("status", "unmatched");
  revalidatePath("/inbox");
}
