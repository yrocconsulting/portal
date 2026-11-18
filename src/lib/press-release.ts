import "server-only";
import { createClient } from "@/lib/supabase/server";

/** The monthly report item that records the client's press release. */
export const PR_ITEM_PATTERN = "%digital pr%";
export const PR_REMIND_FROM_DAY = 16;
export const PR_SNOOZE_DAYS = 2;

type PrItem = { status: string; links: string[] | null; notes: string | null };

/** Has info on it: ticked, marked N/A, or has a link or note. */
export function prRecorded(it: PrItem): boolean {
  return it.status !== "todo" || (it.links ?? []).length > 0 || !!it.notes?.trim();
}

type ClientForPr = { id: string; name: string; status: string; lead_id: string | null; package_id: string | null };

/**
 * The one client (if any) whose press release this lead should be reminded about today: after the 15th,
 * the client's report this month has a Digital PR item with nothing on it (or the report isn't started
 * and their package includes it), and they haven't said "not yet" in the last couple of days.
 */
export async function pickPressReleaseNudge(staffId: string, clients: ClientForPr[], today: string): Promise<ClientForPr | null> {
  if (Number(today.slice(8, 10)) < PR_REMIND_FROM_DAY) return null;
  const mine = clients.filter((c) => c.lead_id === staffId && (c.status === "active" || c.status === "onboarding"));
  if (!mine.length) return null;
  const month = `${today.slice(0, 7)}-01`;
  const supabase = await createClient();
  const ids = mine.map((c) => c.id);
  const [{ data: reports }, { data: snoozes }] = await Promise.all([
    supabase.from("monthly_reports").select("id, client_id, status").eq("month", month).in("client_id", ids),
    supabase.from("nudge_answers").select("client_id, until").eq("staff_id", staffId).eq("kind", "press_release").eq("answer", "no").gt("until", today),
  ]);
  const reportIds = (reports ?? []).map((r) => r.id);
  const pkgIds = [...new Set(mine.map((c) => c.package_id).filter((p): p is string => !!p))];
  const [{ data: items }, { data: pkgItems }] = await Promise.all([
    reportIds.length
      ? supabase.from("report_items").select("report_id, status, links, notes").in("report_id", reportIds).ilike("name", PR_ITEM_PATTERN)
      : Promise.resolve({ data: [] as { report_id: string; status: string; links: string[] | null; notes: string | null }[] }),
    pkgIds.length
      ? supabase.from("package_items").select("package_id").in("package_id", pkgIds).ilike("name", PR_ITEM_PATTERN)
      : Promise.resolve({ data: [] as { package_id: string }[] }),
  ]);
  const snoozed = new Set((snoozes ?? []).map((s) => s.client_id));
  const pkgHasPr = new Set((pkgItems ?? []).map((p) => p.package_id));
  for (const c of mine) {
    if (snoozed.has(c.id)) continue;
    const r = (reports ?? []).find((x) => x.client_id === c.id);
    if (r) {
      if (r.status === "complete") continue;
      const pr = (items ?? []).filter((i) => i.report_id === r.id);
      if (pr.length && !pr.some(prRecorded)) return c;
    } else if (c.package_id && pkgHasPr.has(c.package_id)) {
      return c;
    }
  }
  return null;
}
