import { NextResponse, after, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCode } from "@/lib/gbp/google";
import { syncGbp } from "@/lib/gbp/sync";
import { requestOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

/** Google sends the admin back here: store the connection (encrypted), then run the first sync. */
export async function GET(request: NextRequest) {
  const me = await requireAdmin();
  const origin = requestOrigin(request);
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/business-profiles?${q}`);
    res.cookies.delete({ name: "gbp_oauth_state", path: "/api/gbp" });
    return res;
  };
  const p = request.nextUrl.searchParams;
  if (p.get("error")) return back(`error=${encodeURIComponent(p.get("error") === "access_denied" ? "Google sign-in was cancelled." : `Google said: ${p.get("error")}`)}`);
  const state = request.cookies.get("gbp_oauth_state")?.value;
  if (!state || state !== p.get("state") || !p.get("code")) return back(`error=${encodeURIComponent("The sign-in link expired. Try Connect again.")}`);
  try {
    const { refreshToken, email } = await exchangeCode(p.get("code")!, `${origin}/api/gbp/callback`);
    const db = await createClient();
    const { error } = await db.from("app_settings").upsert({
      key: "gbp_oauth",
      value: { refresh_enc: encryptSecret(refreshToken), email, connected_at: new Date().toISOString(), connected_by: me.id, last_error: null },
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    after(() => syncGbp().catch(() => undefined));
    return back("connected=1");
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`);
  }
}
