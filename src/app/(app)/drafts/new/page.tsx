import Link from "next/link";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { KINDS } from "@/lib/drafts/context";
import { createClient } from "@/lib/supabase/server";
import { NewDraftForm } from "../parts";

export const metadata: Metadata = { title: "New draft" };
// Claude's work runs after the response (see drafts/actions.ts); give it room.
export const maxDuration = 300;

export default async function NewDraftPage({ searchParams }: PageProps<"/drafts/new">) {
  await requireStaff();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const db = await createClient();
  const { data: clients } = await db.from("clients").select("id, name").neq("status", "former").order("name");
  const ticket = one("ticket");
  const kind = one("kind");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-muted">
        <Link href="/drafts" className="hover:text-ink">
          Content drafts
        </Link>{" "}
        / New
      </p>
      <h1 className="text-2xl font-bold">New draft with Claude</h1>
      <NewDraftForm
        clients={clients ?? []}
        defaultClient={one("client")}
        defaultKind={kind in KINDS ? kind : "press_release"}
        ticketId={ticket || null}
        kinds={Object.entries(KINDS)}
      />
    </div>
  );
}
