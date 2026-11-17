"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { cleanDomain, str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/** Links a tracked domain to a client (sets the client's tracked domain). */
export async function linkDomain(fd: FormData) {
  await requireStaff();
  const domain = cleanDomain(str(fd, "domain"));
  const clientId = str(fd, "client_id");
  if (!domain || !clientId) return;
  const supabase = await createClient();
  const { data: c } = await supabase.from("clients").select("domain").eq("id", clientId).single();
  // If it's already their website domain there's nothing to store; otherwise remember it as the tracked domain.
  await supabase
    .from("clients")
    .update(c?.domain === domain ? { tracking_domain: null } : { tracking_domain: domain })
    .eq("id", clientId);
  revalidatePath("/", "layout");
}
