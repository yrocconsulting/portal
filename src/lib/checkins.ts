import "server-only";
import { todayCentral } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type CheckinState = { lastContact: string | null; daysSince: number | null; snoozedUntil: string | null };

const centralDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
/** Whole calendar days (Central time) from a timestamp to a YYYY-MM-DD date. */
const dayDiff = (fromIso: string, toYmd: string) =>
  Math.max(0, Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${centralDay.format(new Date(fromIso))}T00:00:00Z`)) / 86400000));

/** Last contact and snooze state for the given clients. */
export async function checkinStates(clientIds: string[]): Promise<Map<string, CheckinState>> {
  const out = new Map<string, CheckinState>();
  if (!clientIds.length) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_touchpoints")
    .select("client_id, kind, until, created_at")
    .in("client_id", clientIds)
    .order("created_at", { ascending: false })
    .limit(2000);
  const today = todayCentral();
  for (const id of clientIds) {
    const rows = (data ?? []).filter((r) => r.client_id === id);
    const contact = rows.find((r) => r.kind !== "snooze");
    const snooze = rows.find((r) => r.kind === "snooze" && r.until && r.until > today && (!contact || r.created_at > contact.created_at));
    out.set(id, {
      lastContact: contact?.created_at ?? null,
      daysSince: contact ? dayDiff(contact.created_at, today) : null,
      snoozedUntil: snooze?.until ?? null,
    });
  }
  return out;
}

type ClientForNudge = { id: string; name: string; status: string; account_manager_id: string | null; checkin_days: number | null; created_at: string };

/**
 * The one client (if any) to gently remind this person about today: their most overdue client as
 * account manager, not snoozed, and only if they haven't already answered a reminder today.
 */
export async function pickNudge(staffId: string, clients: ClientForNudge[]): Promise<{ client: ClientForNudge; daysSince: number | null } | null> {
  const mine = clients.filter((c) => c.account_manager_id === staffId && c.checkin_days && (c.status === "active" || c.status === "onboarding"));
  if (!mine.length) return null;
  const supabase = await createClient();
  const today = todayCentral();
  // At most one reminder answered per day.
  const { data: answered } = await supabase
    .from("client_touchpoints")
    .select("created_at")
    .eq("staff_id", staffId)
    .eq("via_nudge", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (answered?.[0] && new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(answered[0].created_at)) === today) return null;

  const states = await checkinStates(mine.map((c) => c.id));
  const due = mine
    .map((c) => {
      const s = states.get(c.id)!;
      // Never contacted: count from when the client was added, so new clients aren't flagged on day one.
      const since = s.daysSince ?? dayDiff(c.created_at, today);
      return { client: c, daysSince: s.daysSince, overdue: since - (c.checkin_days ?? 30), snoozed: !!s.snoozedUntil };
    })
    .filter((x) => x.overdue >= 0 && !x.snoozed)
    .sort((a, b) => b.overdue - a.overdue);
  return due[0] ? { client: due[0].client, daysSince: due[0].daysSince } : null;
}
