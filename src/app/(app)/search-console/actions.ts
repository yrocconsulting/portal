"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { siteDomain } from "@/lib/gsc/google";
import { syncSearchConsole } from "@/lib/gsc/sync";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/** Admins: run the Search Console sync now (normally daily). */
export async function syncNow(): Promise<{ message?: string; error?: string }> {
  await requireAdmin();
  try {
    const r = await syncSearchConsole();
    revalidatePath("/", "layout");
    if (!r.configured) return { error: "Search Console isn't connected yet (GSC_SERVICE_ACCOUNT)." };
    const msg = `Synced ${r.sites} propert${r.sites === 1 ? "y" : "ies"}, ${r.days} days of data.`;
    return r.errors.length ? { error: `${msg} Problems: ${r.errors.join("; ")}` } : { message: msg };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Links a Search Console property to a client that doesn't match it by domain. */
export async function linkProperty(fd: FormData) {
  await requireStaff();
  const site = str(fd, "site_url");
  const clientId = str(fd, "client_id");
  if (!site || !clientId) return;
  const supabase = await createClient();
  const { data: c } = await supabase.from("clients").select("domain").eq("id", clientId).single();
  await supabase
    .from("clients")
    .update({ gsc_site_url: c?.domain === siteDomain(site) ? null : site })
    .eq("id", clientId);
  revalidatePath("/", "layout");
}
