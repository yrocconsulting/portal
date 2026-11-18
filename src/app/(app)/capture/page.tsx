import { headers } from "next/headers";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { bookmarklet } from "@/lib/capture";
import { Capture } from "./capture";

export const metadata: Metadata = { title: "ProRankTracker button" };

export default async function CapturePage() {
  await requireStaff();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return <Capture code={bookmarklet(origin)} />;
}
