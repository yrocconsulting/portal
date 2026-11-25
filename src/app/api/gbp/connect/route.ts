import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { credentialsReady } from "@/lib/crypto";
import { gbpOAuthConfig, signInUrl } from "@/lib/gbp/google";
import { requestOrigin } from "@/lib/origin";

/** Admin starts the Google sign-in for the manager account that can see clients' Business Profiles. */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const origin = requestOrigin(request);
  if (!gbpOAuthConfig()) return NextResponse.redirect(`${origin}/business-profiles?error=${encodeURIComponent("Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel first.")}`);
  if (!credentialsReady()) return NextResponse.redirect(`${origin}/business-profiles?error=${encodeURIComponent("CREDENTIALS_KEY isn't set, so the connection can't be stored safely.")}`);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(signInUrl(`${origin}/api/gbp/callback`, state));
  res.cookies.set("gbp_oauth_state", state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/gbp", maxAge: 600 });
  return res;
}
