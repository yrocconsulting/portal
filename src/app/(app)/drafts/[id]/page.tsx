import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { requireStaff } from "@/lib/auth";
import type { Angle } from "@/lib/drafts/claude";
import { KINDS, STATUS_LABEL, type DraftKind } from "@/lib/drafts/context";
import { createClient } from "@/lib/supabase/server";
import { AnglePicker, DraftEditor, Poller } from "../parts";
import { RetryButton } from "./retry";

export const metadata: Metadata = { title: "Draft" };
// Claude's work runs after the response (see drafts/actions.ts); give it room.
export const maxDuration = 300;

export default async function DraftPage({ params }: PageProps<"/drafts/[id]">) {
  await requireStaff();
  const { id } = await params;
  const db = await createClient();
  const { data: d } = await db.from("ai_drafts").select("*, client:clients(id, name, white_label), ticket:tickets(number, title)").eq("id", id).maybeSingle();
  if (!d) notFound();
  const client = d.client as { id: string; name: string; white_label: boolean };
  const ticket = d.ticket as { number: number; title: string } | null;
  const steps = ((d.usage as { steps?: { step: string; cost_usd: number }[] })?.steps ?? []) as { step: string; cost_usd: number }[];
  const cost = steps.reduce((s, x) => s + (x.cost_usd ?? 0), 0);
  const angle = d.angle as Angle | null;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <p className="text-sm text-muted">
        <Link href="/drafts" className="hover:text-ink">
          Content drafts
        </Link>{" "}
        / {client.name}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            {d.title ?? angle?.title ?? `${KINDS[d.kind as DraftKind]} for ${client.name}`}
            {client.white_label && <WhiteLabelBadge />}
          </h1>
          <p className="text-sm text-muted">
            {KINDS[d.kind as DraftKind]} for{" "}
            <Link href={`/clients/${client.id}`} className="hover:text-green-d">
              {client.name}
            </Link>{" "}
            · {STATUS_LABEL[d.status] ?? d.status}
            {ticket && (
              <>
                {" "}
                · ticket{" "}
                <Link href={`/tickets/${ticket.number}`} className="text-green-d hover:underline">
                  #{ticket.number}
                </Link>
              </>
            )}
            {cost > 0 && ` · about $${cost.toFixed(2)} of Claude usage`}
          </p>
        </div>
      </div>

      {d.status === "angles_pending" && <Poller label="Claude is reading the client's prompts and data and choosing angles..." />}
      {d.status === "draft_pending" && <Poller label="Writing the draft and reading the client's website..." />}
      {d.status === "failed" && (
        <div className="card space-y-3 border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>That didn&apos;t work: {d.error}</p>
          <RetryButton id={d.id} />
        </div>
      )}
      {d.status === "angles_ready" && Array.isArray(d.angles) && <AnglePicker id={d.id} angles={d.angles as Angle[]} brief={d.brief} error={d.error} />}

      {(d.status === "draft_ready" || d.status === "posted") && (
        <>
          {angle && (
            <section className="card p-4 text-sm">
              <p className="font-semibold">Angle: {angle.title}</p>
              <p className="text-muted">{angle.why}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {angle.target_prompts.map((p) => (
                  <li key={p} className="rounded bg-bg px-2 py-1 font-mono text-[11px]">
                    {p}
                  </li>
                ))}
              </ul>
              {d.sources.length > 0 && (
                <p className="mt-2 text-xs text-muted">
                  Read on the website:{" "}
                  {d.sources.map((u: string, i: number) => (
                    <span key={u}>
                      {i > 0 && ", "}
                      <a href={u} target="_blank" rel="noreferrer" className="text-steel hover:underline">
                        {u.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </section>
          )}
          {d.status === "posted" && ticket && (
            <p className="card border-green/40 bg-green/10 p-4 text-sm">
              Posted to ticket{" "}
              <Link href={`/tickets/${ticket.number}`} className="font-semibold text-green-d hover:underline">
                #{ticket.number} {ticket.title}
              </Link>{" "}
              for review. Edits here won&apos;t change what was posted.
            </p>
          )}
          <DraftEditor id={d.id} body={d.body ?? ""} notes={d.notes ?? ""} posted={d.status === "posted"} />
        </>
      )}
    </div>
  );
}
