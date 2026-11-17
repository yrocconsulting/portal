import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Signed (1 hour) links for staff photos in the private avatars bucket, keyed by path. */
export async function avatarUrls(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = Array.from(new Set(paths.filter((p): p is string => !!p)));
  if (!list.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from("avatars").createSignedUrls(list, 3600);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}
