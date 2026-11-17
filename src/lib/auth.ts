import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Staff } from "@/lib/types";

/** The signed-in staff member, or a redirect to /login (signed out) or /no-access (not invited). */
export const requireStaff = cache(async (): Promise<Staff> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  let { data: me } = await supabase.from("staff").select("id, email, full_name, role, active, job_title, phone, avatar_path").eq("id", auth.user.id).maybeSingle();
  if (!me) {
    // Invited after their first sign in: claim the invite now.
    const { data: claimed } = await supabase.rpc("claim_invite");
    if (claimed) {
      ({ data: me } = await supabase.from("staff").select("id, email, full_name, role, active, job_title, phone, avatar_path").eq("id", auth.user.id).maybeSingle());
    }
  }
  if (!me || !me.active) redirect("/no-access");
  return me as Staff;
});

export async function requireAdmin(): Promise<Staff> {
  const me = await requireStaff();
  if (me.role !== "admin") redirect("/");
  return me;
}

export function staffName(s: { full_name: string | null; email: string } | null | undefined): string {
  if (!s) return "Unassigned";
  return s.full_name?.trim() || s.email.split("@")[0];
}
