import type { NextRequest } from "next/server";

/** The origin the browser actually used (behind Vercel or a local -H flag, nextUrl can report a different host). */
export function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}
