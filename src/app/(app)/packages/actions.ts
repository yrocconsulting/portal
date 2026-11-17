"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type State = { error?: string; ok?: number };

function itemFields(fd: FormData) {
  const kind = str(fd, "kind");
  const target = str(fd, "target");
  return {
    section: str(fd, "section"),
    name: str(fd, "name") ?? "",
    frequency: str(fd, "frequency"),
    kind: kind === "count" || kind === "actions" ? kind : "check",
    target: target && /^\d+$/.test(target) ? Number(target) : null,
    target_label: str(fd, "target_label"),
    level: str(fd, "level"),
    optional: fd.get("optional") === "on",
    notes: str(fd, "notes"),
  };
}

export async function saveItem(_prev: State, fd: FormData): Promise<State> {
  await requireAdmin();
  const id = str(fd, "id");
  const f = itemFields(fd);
  if (!f.name) return { error: "Name is required." };
  if (f.kind !== "check" && f.target === null) return { error: "Counted items need a monthly target." };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("package_items").update(f).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const pkg = str(fd, "package_id");
    if (!pkg) return { error: "Missing package." };
    const { data: last } = await supabase.from("package_items").select("position").eq("package_id", pkg).order("position", { ascending: false }).limit(1);
    const { error } = await supabase.from("package_items").insert({ ...f, package_id: pkg, position: (last?.[0]?.position ?? 0) + 1 });
    if (error) return { error: error.message };
  }
  revalidatePath("/packages");
  return { ok: Date.now() };
}

export async function deleteItem(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("package_items").delete().eq("id", id);
  revalidatePath("/packages");
}

export async function savePackage(_prev: State, fd: FormData): Promise<State> {
  await requireAdmin();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!name) return { error: "Name is required." };
  const price = str(fd, "price_monthly");
  const row = { name, description: str(fd, "description"), price_monthly: price ? Number(price.replace(/[$,]/g, "")) || null : null };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("packages").update(row).eq("id", id) : await supabase.from("packages").insert(row);
  if (error) return { error: error.message.includes("packages_name_key") ? "Another package has that name." : error.message };
  revalidatePath("/", "layout");
  return { ok: Date.now() };
}

/** Copies a package (all its items) under a new name, as a starting point for a custom package. */
export async function duplicatePackage(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { data: p } = await supabase.from("packages").select("*").eq("id", id).single();
  if (!p) return;
  let name = `${p.name} (copy)`;
  for (let i = 2; (await supabase.from("packages").select("id").eq("name", name).maybeSingle()).data; i++) name = `${p.name} (copy ${i})`;
  const { data: np } = await supabase.from("packages").insert({ name, description: p.description, price_monthly: p.price_monthly, position: p.position + 1 }).select("id").single();
  const { data: items } = await supabase.from("package_items").select("*").eq("package_id", id);
  if (np && items?.length) {
    const copies = items.map((it) => {
      const row: Record<string, unknown> = { ...it, package_id: np.id };
      delete row.id;
      return row;
    });
    await supabase.from("package_items").insert(copies);
  }
  revalidatePath("/packages");
}
