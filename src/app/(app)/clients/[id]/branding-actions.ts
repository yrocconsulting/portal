"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveBranding(clientId: string, patch: { logo_path?: string | null; brand_color?: string | null }): Promise<{ error?: string }> {
  await requireStaff();
  const db = await createClient();
  const row: { logo_path?: string | null; brand_color?: string | null } = {};
  if ("brand_color" in patch) {
    if (patch.brand_color && !/^#[0-9a-f]{6}$/i.test(patch.brand_color)) return { error: "Use a color like #c91f26." };
    row.brand_color = patch.brand_color?.toLowerCase() ?? null;
  }
  if ("logo_path" in patch) {
    if (patch.logo_path && !patch.logo_path.startsWith(`logos/${clientId}/`)) return { error: "Bad upload path." };
    row.logo_path = patch.logo_path ?? null;
    // Old logos stay in storage: a published report may still show them.
  }
  const { error } = await db.from("clients").update(row).eq("id", clientId);
  if (error) return { error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return {};
}
