"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { cleanDomain, str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_STATUSES, LINK_FIELDS } from "@/lib/types";

type State = { error?: string; ok?: number };

function feeField(fd: FormData): { monthly_fee?: number | null } {
  if (!fd.has("monthly_fee")) return {};
  const v = str(fd, "monthly_fee");
  const n = v === null ? null : Number(v.replace(/[$,\s]/g, ""));
  return { monthly_fee: n === null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100 };
}

function clientFields(fd: FormData) {
  const status = str(fd, "status");
  const whiteLabel = fd.get("white_label") === "on";
  return {
    name: str(fd, "name") ?? "",
    domain: cleanDomain(str(fd, "domain")),
    status: status && (CLIENT_STATUSES as readonly string[]).includes(status) ? status : "active",
    white_label: whiteLabel,
    partner: whiteLabel ? str(fd, "partner") : null,
    services: fd.getAll("services").filter((v): v is string => typeof v === "string" && v !== ""),
    city: str(fd, "city"),
    phone: str(fd, "phone"),
    website: str(fd, "website"),
    notes: str(fd, "notes"),
    address: str(fd, "address"),
    industry: str(fd, "industry"),
    payment_method: str(fd, "payment_method"),
    drive_url: str(fd, "drive_url"),
    locations: str(fd, "locations"),
    start_date: str(fd, "start_date"),
    tracking_domain: cleanDomain(str(fd, "tracking_domain")),
    package_id: str(fd, "package_id"),
    lead_id: str(fd, "lead_id"),
    account_manager_id: str(fd, "account_manager_id"),
    links: Object.fromEntries(
      LINK_FIELDS.map(([k]) => [k, str(fd, `link_${k}`)]).filter((e): e is [string, string] => !!e[1] && /^https?:\/\//i.test(e[1])),
    ),
  };
}

function friendly(msg: string): string {
  return msg.includes("clients_domain_key") ? "Another client already uses that domain." : msg;
}

export async function createClientRecord(_prev: State, fd: FormData): Promise<State> {
  const me = await requireStaff();
  const fields = { ...clientFields(fd), ...(me.role === "admin" ? feeField(fd) : {}) };
  if (!fields.name) return { error: "Client name is required." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").insert(fields).select("id").single();
  if (error) return { error: friendly(error.message) };

  const contactName = str(fd, "contact_name");
  if (contactName) {
    await supabase.from("contacts").insert({
      client_id: data.id,
      name: contactName,
      email: str(fd, "contact_email")?.toLowerCase() ?? null,
      phone: str(fd, "contact_phone"),
      title: str(fd, "contact_title"),
      is_primary: true,
    });
  }
  revalidatePath("/clients");
  redirect(`/clients/${data.id}`);
}

export async function updateClientRecord(_prev: State, fd: FormData): Promise<State> {
  const me = await requireStaff();
  const id = str(fd, "id");
  const fields = { ...clientFields(fd), ...(me.role === "admin" ? feeField(fd) : {}) };
  if (!id || !fields.name) return { error: "Client name is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update(fields).eq("id", id);
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: Date.now() };
}

export async function addContact(_prev: State, fd: FormData): Promise<State> {
  await requireStaff();
  const clientId = str(fd, "client_id");
  const name = str(fd, "name");
  if (!clientId || !name) return { error: "Contact name is required." };
  const supabase = await createClient();
  const isPrimary = fd.get("is_primary") === "on";
  if (isPrimary) await supabase.from("contacts").update({ is_primary: false }).eq("client_id", clientId);
  const { error } = await supabase.from("contacts").insert({
    client_id: clientId,
    name,
    email: str(fd, "email")?.toLowerCase() ?? null,
    phone: str(fd, "phone"),
    title: str(fd, "title"),
    is_primary: isPrimary,
  });
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return { ok: Date.now() };
}

export async function deleteContact(id: string, clientId: string) {
  await requireStaff();
  const supabase = await createClient();
  await supabase.from("contacts").delete().eq("id", id);
  revalidatePath(`/clients/${clientId}`);
}

export async function startOnboarding(_prev: State, fd: FormData): Promise<State> {
  await requireStaff();
  const clientId = str(fd, "client_id");
  const templateId = str(fd, "template_id");
  if (!clientId || !templateId) return { error: "Choose a checklist." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_onboarding", { p_client: clientId, p_template: templateId, p_assignee: str(fd, "assignee_id") });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: Number(data) || 0 };
}

export async function deleteClientRecord(fd: FormData) {
  const me = await requireStaff();
  if (me.role !== "admin") throw new Error("Only admins can delete clients");
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("clients").delete().eq("id", id);
  revalidatePath("/", "layout");
  redirect("/clients");
}

/** Archive hides a client from the active lists and pickers; everything is kept. Restore brings it back. */
export async function setArchived(fd: FormData) {
  await requireStaff();
  const id = str(fd, "id");
  if (!id) return;
  const archive = fd.get("archive") === "1";
  const supabase = await createClient();
  await supabase.from("clients").update({ status: archive ? "former" : "active" }).eq("id", id);
  revalidatePath("/", "layout");
}
