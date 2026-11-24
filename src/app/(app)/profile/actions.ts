"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type ProfileState = { error?: string; ok?: number };

/** avatar_path field: missing = keep, "" = remove, "<staff id>/<file>" = new photo. */
function avatarField(fd: FormData, staffId: string): string | null | undefined {
  const v = fd.get("avatar_path");
  if (v === null) return undefined;
  if (v === "") return null;
  return typeof v === "string" && v.startsWith(`${staffId}/`) ? v : undefined;
}

async function removeOldPhoto(oldPath: string | null, newPath: string | null | undefined) {
  if (!oldPath || newPath === undefined || newPath === oldPath) return;
  const supabase = await createClient();
  await supabase.storage.from("avatars").remove([oldPath]);
}

/** Anyone: update their own name, title, phone and photo (never role or access). */
export async function saveMyProfile(_prev: ProfileState, fd: FormData): Promise<ProfileState> {
  const me = await requireStaff();
  const avatar = avatarField(fd, me.id);
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p_name: str(fd, "full_name") ?? "",
    p_title: str(fd, "job_title") ?? "",
    p_phone: str(fd, "phone") ?? "",
    p_avatar: avatar === undefined ? null : avatar ?? "",
  });
  if (error) return { error: error.message };
  await removeOldPhoto(me.avatar_path, avatar);
  revalidatePath("/", "layout");
  return { ok: Date.now() };
}

/** Admins: update anyone's profile details. */
export async function saveStaffProfile(_prev: ProfileState, fd: FormData): Promise<ProfileState> {
  await requireAdmin();
  const id = str(fd, "id");
  if (!id) return { error: "Missing person." };
  const supabase = await createClient();
  const { data: current } = await supabase.from("staff").select("avatar_path").eq("id", id).single();
  const avatar = avatarField(fd, id);
  const patch: Record<string, unknown> = {
    full_name: str(fd, "full_name"),
    job_title: str(fd, "job_title"),
    phone: str(fd, "phone"),
  };
  if (avatar !== undefined) patch.avatar_path = avatar;
  const { error } = await supabase.from("staff").update(patch).eq("id", id);
  if (error) return { error: error.message };
  await removeOldPhoto(current?.avatar_path ?? null, avatar);
  revalidatePath("/", "layout");
  return { ok: Date.now() };
}

/** Turns one kind of ticket email on or off for the signed-in person. */
export async function setMyNotification(kind: string, on: boolean): Promise<{ error?: string }> {
  await requireStaff();
  if (kind !== "assigned" && kind !== "client_reply") return { error: "Unknown email type." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_notification", { p_kind: kind, p_on: on });
  return error ? { error: error.message } : {};
}
