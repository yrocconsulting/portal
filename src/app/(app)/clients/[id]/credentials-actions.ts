"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { credentialsReady, decryptSecret, encryptSecret } from "@/lib/crypto";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CREDENTIAL_KINDS } from "@/lib/types";

type State = { error?: string; ok?: number };

const KINDS = CREDENTIAL_KINDS.map(([k]) => k as string);

export async function saveCredential(_prev: State, fd: FormData): Promise<State> {
  const me = await requireStaff();
  const id = str(fd, "id");
  const clientId = str(fd, "client_id");
  if (!clientId) return { error: "Missing client." };
  const kind = str(fd, "kind") ?? "other";
  const password = fd.get("password");
  const hasNewPassword = typeof password === "string" && password !== "";
  if (hasNewPassword && !credentialsReady()) return { error: "Password storage isn't switched on yet (CREDENTIALS_KEY)." };

  const row: Record<string, unknown> = {
    client_id: clientId,
    kind: KINDS.includes(kind) ? kind : "other",
    label: str(fd, "label"),
    url: str(fd, "url"),
    username: str(fd, "username"),
    notes: str(fd, "notes"),
    updated_by: me.id,
  };
  if (hasNewPassword) row.password_enc = encryptSecret(password);
  if (fd.get("clear_password") === "on") row.password_enc = null;
  if (!row.label && !row.url && !row.username && !hasNewPassword) return { error: "Add at least a name, link or username." };

  const supabase = await createClient();
  const q = id ? supabase.from("client_credentials").update(row).eq("id", id).select("id").single() : supabase.from("client_credentials").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { error: error.message };
  await supabase.from("credential_views").insert({ credential_id: data.id, client_id: clientId, staff_id: me.id, action: id ? "update" : "create" });
  revalidatePath(`/clients/${clientId}`);
  return { ok: Date.now() };
}

/** Returns the password and records who looked. */
export async function revealPassword(id: string): Promise<{ password?: string; error?: string }> {
  const me = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("client_credentials").select("id, client_id, password_enc").eq("id", id).single();
  if (!data?.password_enc) return { error: "No password saved." };
  try {
    const password = decryptSecret(data.password_enc);
    await supabase.from("credential_views").insert({ credential_id: id, client_id: data.client_id, staff_id: me.id, action: "reveal" });
    return { password };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteCredential(id: string, clientId: string) {
  const me = await requireStaff();
  const supabase = await createClient();
  await supabase.from("credential_views").insert({ credential_id: id, client_id: clientId, staff_id: me.id, action: "delete" });
  await supabase.from("client_credentials").delete().eq("id", id);
  revalidatePath(`/clients/${clientId}`);
}
