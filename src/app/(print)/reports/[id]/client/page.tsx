import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ClientReport } from "@/components/client-report";
import { requireStaff } from "@/lib/auth";
import { buildSnapshot } from "@/lib/client-report";

export const metadata: Metadata = { title: "Client report preview" };

/** Staff preview: the client report built from the record as it is right now (not yet published). */
export default async function ClientReportPreview({ params }: PageProps<"/reports/[id]/client">) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const snap = await buildSnapshot(id).catch(() => null);
  if (!snap) notFound();
  return <ClientReport snap={snap} preview />;
}
