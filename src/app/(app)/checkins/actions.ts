"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SNOOZE_DAYS = 3;

/** Thumbs up: I've been in touch. Thumbs down: remind me again in a few days. */
export async function answerCheckin(clientId: string, answer: "yes" | "no", viaNudge = true) {
  const me = await requireStaff();
  const supabase = await createClient();
  const until = new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString().slice(0, 10);
  await supabase.from("client_touchpoints").insert({
    client_id: clientId,
    staff_id: me.id,
    kind: answer === "yes" ? "checkin" : "snooze",
    via_nudge: viaNudge,
    until: answer === "no" ? until : null,
  });
  // From the dashboard bubble, keep the bubble's "thanks" visible; the next page load is already right.
  if (!viaNudge) revalidatePath("/", "layout");
}
