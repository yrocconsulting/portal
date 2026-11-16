/** Public Supabase settings. Both are safe to expose to the browser; access is enforced by row level security. */
export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }
  if (u.hostname === "supabase.com" || u.hostname.endsWith(".supabase.com")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is the dashboard address. Use the Project URL (https://<project-id>.supabase.co).");
  }
  // Only the origin is valid: a pasted "/rest/v1/" or trailing slash breaks every auth request.
  return u.origin;
}

export function supabaseKey(): string {
  const v = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  return v;
}
