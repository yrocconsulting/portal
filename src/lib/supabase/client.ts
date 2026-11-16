"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "./env";

/** Browser client, used for direct file uploads to Storage. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseKey());
}
