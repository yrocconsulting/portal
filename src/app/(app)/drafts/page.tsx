import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { requireStaff, staffName } from "@/lib/auth";
import { claudeConfigured } from "@/lib/drafts/claude";
import { KINDS, STATUS_LABEL, type DraftKind } from "@/lib/drafts/context";
import { fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { HouseStyleForm } from "./parts";

export const metadata: Metadata = { title: "Content drafts" };


export default async function DraftsPage({ searchParams }: PageProps<"/drafts">) {
  const me = await requireStaff();
  const sp = await searchParams;
  const clientFilter = typeof sp.client === "string" ? sp.client : null;
  const db = await createClient();
  let q = db
    .from("ai_drafts")
    .select("id, kind, status, title, angle, created_at, created_by, client:clients(id, name, white_label)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (clientFilter) q = q.eq("client_id", clientFilter);
  const [{ data: drafts }, { data: staff }, { data: style }] = await Promise.all([
    q,
    db.from("staff").select("id, full_name, email"),
    db.from("app_settings").select("value").eq("key", "draft_style").maybeSingle(),
  ]);
  const who = (id: string | null) => staffName((staff ?? []).find((s) => s.id === id));

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Content drafts</h1>
          <p className="max-w-2xl text-sm text-muted">
            Press releases, articles, service pages and FAQs written with Claude from each client&apos;s tracked AI prompts, Search Console data and website. Every
            draft goes to a ticket for review. Nothing is published or sent automatically.
          </p>
        </div>
        <Link href={`/drafts/new${clientFilter ? `?client=${clientFilter}` : ""}`} className="btn-green">
          + New draft
        </Link>
      </div>

      {!claudeConfigured() && (
        <p className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Claude isn&apos;t connected yet. Add <span className="font-mono">ANTHROPIC_API_KEY</span> in Vercel (Production) and redeploy.
        </p>
      )}

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Draft</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(drafts ?? []).map((d) => {
              const c = d.client as unknown as { id: string; name: string; white_label: boolean } | null;
              return (
                <tr key={d.id}>
                  <td className="px-4 py-2">
                    <Link href={`/drafts/${d.id}`} className="font-medium hover:text-green-d">
                      {d.title ?? (d.angle as { title?: string } | null)?.title ?? "New draft"}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      {c?.name}
                      {c?.white_label && <WhiteLabelBadge />}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted">{KINDS[d.kind as DraftKind]}</td>
                  <td className="px-4 py-2">{STATUS_LABEL[d.status] ?? d.status}</td>
                  <td className="px-4 py-2 text-muted">
                    {fmtDate(d.created_at)} · {who(d.created_by)}
                  </td>
                </tr>
              );
            })}
            {!drafts?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No drafts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {me.role === "admin" && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">House style for drafts</summary>
          <p className="mt-2 mb-3 text-xs text-muted">Added to Claude&apos;s instructions for every draft. Keep it short: tone, must-haves, things to avoid.</p>
          <HouseStyleForm style={(style?.value as { text?: string } | null)?.text ?? ""} />
        </details>
      )}
    </div>
  );
}
