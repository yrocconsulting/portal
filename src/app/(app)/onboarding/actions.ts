"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PRIORITIES } from "@/lib/types";

type State = { error?: string; ok?: number };

export async function createTemplate(_prev: State, fd: FormData): Promise<State> {
  await requireStaff();
  const name = str(fd, "name");
  if (!name) return { error: "Name the checklist." };
  const supabase = await createClient();
  const { error } = await supabase.from("onboarding_templates").insert({ name, description: str(fd, "description") });
  if (error) return { error: error.message };
  revalidatePath("/onboarding");
  return { ok: Date.now() };
}

export async function addStep(_prev: State, fd: FormData): Promise<State> {
  await requireStaff();
  const templateId = str(fd, "template_id");
  const title = str(fd, "title");
  if (!templateId || !title) return { error: "Step title is required." };
  const days = Math.max(0, Math.min(365, Number(str(fd, "due_offset_days")) || 0));
  const p = str(fd, "priority");
  const supabase = await createClient();
  const { data: last } = await supabase.from("onboarding_steps").select("position").eq("template_id", templateId).order("position", { ascending: false }).limit(1);
  const { error } = await supabase.from("onboarding_steps").insert({
    template_id: templateId,
    title,
    description: str(fd, "description"),
    due_offset_days: days,
    priority: p && (PRIORITIES as readonly string[]).includes(p) ? p : "normal",
    position: (last?.[0]?.position ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidatePath("/onboarding");
  return { ok: Date.now() };
}

export async function deleteStep(id: string) {
  await requireStaff();
  const supabase = await createClient();
  await supabase.from("onboarding_steps").delete().eq("id", id);
  revalidatePath("/onboarding");
}

export async function moveStep(id: string, dir: -1 | 1) {
  await requireStaff();
  const supabase = await createClient();
  const { data: step } = await supabase.from("onboarding_steps").select("id, template_id, position").eq("id", id).single();
  if (!step) return;
  const { data: steps } = await supabase.from("onboarding_steps").select("id, position").eq("template_id", step.template_id).order("position");
  const list = steps ?? [];
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await Promise.all(list.map((s, k) => supabase.from("onboarding_steps").update({ position: k + 1 }).eq("id", s.id)));
  revalidatePath("/onboarding");
}

export async function deleteTemplate(id: string) {
  await requireStaff();
  const supabase = await createClient();
  await supabase.from("onboarding_templates").delete().eq("id", id);
  revalidatePath("/onboarding");
}
