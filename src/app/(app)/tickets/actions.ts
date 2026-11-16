"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PRIORITIES, STATUSES, TYPES } from "@/lib/types";

function pick<T extends readonly string[]>(list: T, v: string | null, fallback: T[number]): T[number] {
  return v && (list as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

export async function createTicket(_prev: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const me = await requireStaff();
  const supabase = await createClient();
  const title = str(fd, "title");
  if (!title) return { error: "Give the ticket a title." };

  const { data, error } = await supabase
    .from("tickets")
    .insert({
      title,
      description: str(fd, "description"),
      client_id: str(fd, "client_id"),
      contact_id: str(fd, "contact_id"),
      status: pick(STATUSES, str(fd, "status"), "new"),
      priority: pick(PRIORITIES, str(fd, "priority"), "normal"),
      type: pick(TYPES, str(fd, "type"), "task"),
      assignee_id: str(fd, "assignee_id"),
      due_date: str(fd, "due_date"),
      created_by: me.id,
    })
    .select("number")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect(`/tickets/${data.number}`);
}

/** Inline field updates from the ticket sidebar (status, priority, assignee, due date, client, type). */
export async function updateTicketField(ticketId: string, field: string, value: string | null) {
  await requireStaff();
  const allowed: Record<string, (v: string | null) => string | null> = {
    status: (v) => pick(STATUSES, v, "new"),
    priority: (v) => pick(PRIORITIES, v, "normal"),
    type: (v) => pick(TYPES, v, "task"),
    assignee_id: (v) => v || null,
    client_id: (v) => v || null,
    due_date: (v) => v || null,
  };
  if (!allowed[field]) throw new Error("Field not editable");
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").update({ [field]: allowed[field](value) }).eq("id", ticketId);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

export async function updateTicketText(_prev: { error?: string; ok?: boolean }, fd: FormData): Promise<{ error?: string; ok?: boolean }> {
  await requireStaff();
  const id = str(fd, "id");
  const title = str(fd, "title");
  if (!id || !title) return { error: "Title is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").update({ title, description: str(fd, "description") }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addComment(_prev: { error?: string; n?: number }, fd: FormData): Promise<{ error?: string; n?: number }> {
  const me = await requireStaff();
  const ticketId = str(fd, "ticket_id");
  const body = str(fd, "body");
  if (!ticketId || !body) return { error: "Write something first." };
  const supabase = await createClient();
  const { error } = await supabase.from("ticket_comments").insert({ ticket_id: ticketId, body, author_id: me.id, author_kind: "staff", internal: true });
  if (error) return { error: error.message };

  // Optional status change in the same step ("Comment and mark done").
  const nextStatus = str(fd, "then_status");
  if (nextStatus && (STATUSES as readonly string[]).includes(nextStatus)) {
    await supabase.from("tickets").update({ status: nextStatus }).eq("id", ticketId);
  } else {
    // Touch updated_at so the ticket rises in "recently updated".
    await supabase.from("tickets").update({ updated_at: new Date().toISOString() }).eq("id", ticketId);
  }
  revalidatePath("/", "layout");
  return { n: Date.now() };
}

export async function deleteComment(commentId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("ticket_comments").delete().eq("id", commentId);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

export async function recordAttachment(ticketId: string, file: { path: string; name: string; size: number; type: string }) {
  const me = await requireStaff();
  if (!file.path.startsWith(`${ticketId}/`)) throw new Error("Bad path");
  const supabase = await createClient();
  const { error } = await supabase
    .from("attachments")
    .insert({ ticket_id: ticketId, path: file.path, name: file.name, size: file.size, content_type: file.type || null, uploaded_by: me.id });
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

export async function deleteAttachment(id: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("attachments").select("path").eq("id", id).single();
  if (data) await supabase.storage.from("attachments").remove([data.path]);
  await supabase.from("attachments").delete().eq("id", id);
  revalidatePath("/", "layout");
}

export async function deleteTicket(fd: FormData) {
  const me = await requireStaff();
  if (me.role !== "admin") throw new Error("Only admins can delete tickets");
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  const { data: files } = await supabase.from("attachments").select("path").eq("ticket_id", id);
  if (files?.length) await supabase.storage.from("attachments").remove(files.map((f) => f.path));
  await supabase.from("tickets").delete().eq("id", id);
  revalidatePath("/", "layout");
  redirect("/tickets");
}
