import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/** Finishes Microsoft sign in and email links: trades the one-time code for a session cookie. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = requestOrigin(request);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const providerError = url.searchParams.get("error_description");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, origin));
  }
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(providerError ?? "Sign in failed. Try again.")}`, origin));
}
