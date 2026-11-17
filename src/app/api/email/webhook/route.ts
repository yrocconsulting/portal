import { after, NextResponse, type NextRequest } from "next/server";
import { processHelpdesk, webhookClientState } from "@/lib/email/process";

export const maxDuration = 60;

/**
 * Microsoft Graph calls this when new mail reaches the helpdesk mailbox.
 * 1. On subscription setup it sends ?validationToken=..., which must be echoed back as plain text.
 * 2. Afterwards it posts notifications carrying our clientState secret. We answer at once and read the
 *    mailbox after the response (Graph expects a reply within a few seconds).
 */
export async function POST(request: NextRequest) {
  const validation = request.nextUrl.searchParams.get("validationToken");
  if (validation) {
    return new NextResponse(validation, { status: 200, headers: { "content-type": "text/plain" } });
  }

  const payload = (await request.json().catch(() => null)) as { value?: { clientState?: string }[] } | null;
  const expected = webhookClientState();
  const valid = !!process.env.CRON_SECRET && (payload?.value ?? []).some((n) => n.clientState === expected);
  if (!valid) return new NextResponse(null, { status: 202 }); // ignore quietly; don't reveal anything

  after(async () => {
    const r = await processHelpdesk().catch((e) => ({ errors: [(e as Error).message] }));
    if (r.errors.length) console.error("helpdesk intake errors", r.errors);
  });
  return new NextResponse(null, { status: 202 });
}
