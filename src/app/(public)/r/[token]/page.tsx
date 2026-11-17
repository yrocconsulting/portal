import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { ClientReport } from "@/components/client-report";
import type { ClientSnapshot } from "@/lib/client-report";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Published client report at a secret link. No sign in: the anonymous key can only call
 * get_shared_report(token), which returns that report's published snapshot and nothing else.
 */
const load = cache(async (token: string): Promise<ClientSnapshot | null> => {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const db = createClient(supabaseUrl(), supabaseKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await db.rpc("get_shared_report", { p_token: token });
  return (data as ClientSnapshot | null) ?? null;
});

const monthName = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

export async function generateMetadata({ params }: PageProps<"/r/[token]">): Promise<Metadata> {
  const { token } = await params;
  const snap = await load(token);
  // Neutral wording on purpose: white-label reports must not mention Yroc anywhere, including the tab title.
  return {
    title: { absolute: snap ? `${snap.client}: ${monthName(snap.month)} report` : "Report" },
    description: snap ? `Search and AI visibility report for ${snap.client}` : undefined,
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

export default async function SharedReport({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const snap = await load(token);
  if (!snap) notFound();
  return <ClientReport snap={snap} />;
}
