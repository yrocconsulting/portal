"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { syncGbp } from "@/lib/gbp/sync";
import { notifySoon } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";

/** Admins: run the Business Profile sync now (normally daily). */
export async function syncGbpNow(): Promise<{ message?: string; error?: string }> {
  await requireAdmin();
  try {
    const r = await syncGbp();
    if (r.newReviews) notifySoon();
    revalidatePath("/", "layout");
    if (!r.configured) return { error: "Google sign-in isn't set up yet (GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET)." };
    if (!r.connected) return { error: "No Google account is connected yet. Click Connect." };
    const msg = `Synced ${r.locations} profile${r.locations === 1 ? "" : "s"}: ${r.days} days of numbers, ${r.reviews} reviews${r.newReviews ? `, ${r.newReviews} new` : ""}.`;
    return r.errors.length ? { error: `${msg} Problems: ${r.errors.slice(0, 3).join("; ")}` } : { message: msg };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Admins: forget the Google connection (the data already synced stays). */
export async function disconnectGbp() {
  await requireAdmin();
  const db = await createClient();
  await db.from("app_settings").delete().eq("key", "gbp_oauth");
  revalidatePath("/business-profiles");
}

/** Admins: choose which client a profile belongs to (overrides matching by website). */
export async function setProfileClient(name: string, clientId: string | null) {
  await requireAdmin();
  const db = await createClient();
  await db.from("gbp_locations").update({ client_id: clientId, matched_by: clientId ? "admin" : null }).eq("name", name);
  revalidatePath("/", "layout");
}
