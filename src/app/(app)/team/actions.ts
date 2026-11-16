"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type State = { error?: string; ok?: number };

export async function inviteStaff(_prev: State, fd: FormData): Promise<State> {
  const me = await requireAdmin();
  const email = str(fd, "email")?.toLowerCase();
  const role = str(fd, "role") === "admin" ? "admin" : "member";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("staff").select("id").eq("email", email).maybeSingle();
  if (existing) return { error: "That person is already on the team." };
  const { error } = await supabase.from("staff_invites").upsert({ email, role, invited_by: me.id });
  if (error) return { error: error.message };
  revalidatePath("/team");
  return { ok: Date.now() };
}

export async function revokeInvite(email: string) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("staff_invites").delete().eq("email", email);
  revalidatePath("/team");
}

export async function updateStaff(id: string, patch: { role?: "admin" | "member"; active?: boolean }) {
  const me = await requireAdmin();
  if (id === me.id) throw new Error("You cannot change your own role or access.");
  const supabase = await createClient();
  const { error } = await supabase.from("staff").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/team");
}
