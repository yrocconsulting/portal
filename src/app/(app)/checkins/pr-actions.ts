"use server";

import { requireStaff } from "@/lib/auth";
import { todayCentral } from "@/lib/format";
import { PR_ITEM_PATTERN, PR_SNOOZE_DAYS } from "@/lib/press-release";
import { createClient } from "@/lib/supabase/server";

/**
 * Thumbs up: the press release is in, so tick the PR task on this month's report (starting the
 * report if needed). Thumbs down: ask again in a couple of days.
 */
export async function answerPressRelease(clientId: string, answer: "yes" | "no"): Promise<{ reportId?: string }> {
  const me = await requireStaff();
  const supabase = await createClient();
  const today = todayCentral();
  const month = `${today.slice(0, 7)}-01`;
  let reportId: string | undefined;
  if (answer === "yes") {
    const { data: rid } = await supabase.rpc("start_monthly_report", { p_client: clientId, p_month: month });
    if (rid) {
      reportId = String(rid);
      const { data: r } = await supabase.from("monthly_reports").select("status").eq("id", reportId).single();
      if (r?.status !== "complete") {
        await supabase.from("report_items").update({ status: "done" }).eq("report_id", reportId).eq("status", "todo").ilike("name", PR_ITEM_PATTERN);
      }
    }
  }
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + PR_SNOOZE_DAYS * 86400000).toISOString().slice(0, 10);
  await supabase.from("nudge_answers").insert({
    staff_id: me.id,
    client_id: clientId,
    kind: "press_release",
    answer,
    month,
    until: answer === "no" ? until : null,
  });
  return { reportId };
}
