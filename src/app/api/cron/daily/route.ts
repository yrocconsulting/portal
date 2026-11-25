import { NextResponse, type NextRequest } from "next/server";
import { ensureSubscription, processHelpdesk } from "@/lib/email/process";
import { syncSearchConsole } from "@/lib/gsc/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPendingNotifications } from "@/lib/notify";
import { syncGbp } from "@/lib/gbp/sync";

export const maxDuration = 300;

/**
 * Daily (vercel.json): renews the Microsoft new-mail subscription, catches up on helpdesk mail and
 * syncs Google Search Console. Vercel sends "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result: Record<string, unknown> = {};
  try {
    result.subscription = await ensureSubscription();
  } catch (e) {
    result.subscription = `error: ${(e as Error).message}`;
  }
  result.email = await processHelpdesk().catch((e) => ({ errors: [(e as Error).message] }));
  result.searchConsole = await syncSearchConsole().catch((e) => ({ errors: [(e as Error).message] }));
  result.businessProfiles = await syncGbp().catch((e) => ({ errors: [(e as Error).message] }));
  // Ticket and new-review emails (and any that didn't go out right away).
  result.notifications = await sendPendingNotifications(createAdminClient()).catch((e) => ({ errors: [(e as Error).message] }));
  try {
    const { error } = await createAdminClient().rpc("snapshot_revenue");
    result.revenue = error ? `error: ${error.message}` : "saved";
  } catch (e) {
    result.revenue = `error: ${(e as Error).message}`;
  }
  return NextResponse.json(result);
}
