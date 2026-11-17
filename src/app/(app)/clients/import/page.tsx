import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { ImportFlow } from "./parts";

export const metadata: Metadata = { title: "Import clients" };

export default async function ImportClientsPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="text-sm text-muted">
        <Link href="/clients" className="hover:text-ink">
          Clients
        </Link>{" "}
        / Import
      </div>
      <div>
        <h1 className="text-2xl font-bold">Import clients from the client sheet</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          In Google Sheets choose <b className="text-ink">File, Download, Microsoft Excel (.xlsx)</b> and upload it here. Each client tab is read by its labels
          (Business Name, Primary Contact Name, Phone, Email, Address, Website URL, and so on). Tabs after &quot;Past Clients&quot; come in as former clients, and
          &quot;White Label&quot; in a tab, name or the summary marks white-label clients. Usernames and passwords are never imported. You can run this again at any
          time: existing clients are matched by website or name and filled in, not duplicated.
        </p>
      </div>
      <ImportFlow />
    </div>
  );
}
