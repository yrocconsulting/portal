import { NextResponse, type NextRequest } from "next/server";
import { ensureSubscription, processHelpdesk } from "@/lib/email/process";

export const maxDuration = 60;

/**
 * Daily (vercel.json): renews the Microsoft new-mail subscription and catches up on any mail the
 * notifications missed. Vercel sends "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let subscription: string;
  try {
    subscription = await ensureSubscription();
  } catch (e) {
    subscription = `error: ${(e as Error).message}`;
  }
  const run = await processHelpdesk().catch((e) => ({ errors: [(e as Error).message] }));
  return NextResponse.json({ subscription, run });
}
