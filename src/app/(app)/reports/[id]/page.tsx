import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { requireStaff, staffName } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { progress } from "@/lib/report-progress";
import { monthLabel, type Results } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { deleteReport } from "../actions";
import { ResultsCard } from "../results-card";
import { headers } from "next/headers";
import { ReportButtons } from "./buttons";
import { DesignCard, type DesignQuote } from "./design-card";
import { gscPositive, mediaUrl } from "@/lib/client-report";
import { ClientReportCard } from "./client-report-card";
import { ReportEditor, type EditorAction, type EditorItem } from "./editor";

export const metadata: Metadata = { title: "Monthly report" };

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const me = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from("monthly_reports").select("*, client:clients(id, name, white_label)").eq("id", id).maybeSingle();
  if (!r) notFound();
  const [{ data: items }, { data: actions }, { data: types }, { data: staff }, { data: media }, { data: quotes }] = await Promise.all([
    supabase.from("report_items").select("*").eq("report_id", id).order("position"),
    supabase.from("report_actions").select("*").eq("report_id", id).order("created_at"),
    supabase.from("action_types").select("name, category").order("position"),
    supabase.from("staff").select("id, full_name, email"),
    supabase.from("report_media").select("id, kind, caption, path").eq("report_id", id).order("position"),
    supabase.from("report_quotes").select("id, platform, prompt, quote, note, cited_urls").eq("report_id", id).order("position"),
  ]);
  const who = (sid: string | null) => {
    const s = (staff ?? []).find((x) => x.id === sid);
    return s ? staffName(s) : "";
  };
  const client = r.client as unknown as { id: string; name: string; white_label: boolean };
  const readOnly = r.status === "complete";
  const p = progress((items ?? []) as EditorItem[], (actions ?? []).length);
  const month = (r.month as string).slice(0, 7);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const changedSincePublish = !!r.published_at && !!r.content_changed_at && r.content_changed_at > r.published_at;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="text-sm text-muted">
        <Link href={`/reports?month=${month}`} className="hover:text-ink">
          Monthly reports
        </Link>{" "}
        / {monthLabel(month)}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">
              <Link href={`/clients/${client.id}`} className="hover:text-green-d">
                {client.name}
              </Link>
              : {monthLabel(month)}
            </h1>
            {client.white_label && <WhiteLabelBadge />}
          </div>
          <p className="mt-1 text-sm text-muted">
            {r.package_name ?? "No package"} · {p.done} of {p.total} deliverables done
            {readOnly && r.completed_at && ` · completed ${fmtDateTime(r.completed_at)} by ${who(r.completed_by)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.status !== "complete" && (
            <Link href={`/drafts/new?client=${r.client_id}&kind=press_release`} className="btn-ghost">
              Draft PR with Claude
            </Link>
          )}
          <ReportButtons id={r.id} status={r.status} isAdmin={me.role === "admin"} />
        </div>
      </div>

      {readOnly && (
        <p className="rounded-lg bg-green/10 px-4 py-2 text-sm text-green-d">
          This month is complete and archived. It&apos;s read-only{me.role === "admin" ? "; reopen it to make changes" : "; an admin can reopen it"}.
        </p>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Results this month</h2>
        <ResultsCard results={(r.results ?? {}) as Results} at={r.results_at} />
      </section>

      {(items ?? []).length === 0 && (
        <p className="card p-4 text-sm text-muted">This record has no deliverables because the client had no package when it was started. Set their package, then delete and restart this month.</p>
      )}

      <ClientReportCard
        origin={origin}
        reportId={r.id}
        note={r.client_note ?? ""}
        token={r.share_token}
        publishedAt={r.published_at}
        publishedBy={who(r.published_by)}
        views={r.share_views ?? 0}
        lastViewed={r.share_last_viewed}
        whiteLabel={client.white_label}
        changedSincePublish={changedSincePublish}
      />

      <DesignCard
        reportId={r.id}
        readOnly={readOnly}
        heroTitle={r.hero_title ?? ""}
        defaultTitle={`${client.name}: *${monthLabel(month).split(" ")[0]} results.*`}
        gscDisplay={r.gsc_display ?? "auto"}
        gscAuto={gscPositive((r.results ?? {}) as Results)}
        hasGsc={!!((r.results ?? {}) as Results).gsc}
        media={(media ?? []).map((m) => ({ id: m.id, kind: m.kind, caption: m.caption, url: mediaUrl(m.path) }))}
        quotes={(quotes ?? []) as DesignQuote[]}
        clientName={client.name}
      />

      <ReportEditor
        report={r}
        items={(items ?? []) as EditorItem[]}
        actions={((actions ?? []) as (Omit<EditorAction, "by"> & { created_by: string | null })[]).map((a) => ({ ...a, by: who(a.created_by) }))}
        types={types ?? []}
        readOnly={readOnly}
      />

      {me.role === "admin" && (
        <form action={deleteReport} className="flex justify-end">
          <input type="hidden" name="id" value={r.id} />
          <ConfirmButton message="Delete this month's record permanently? Archived months are kept for reference; only delete mistakes." className="btn-danger text-xs">
            Delete this record
          </ConfirmButton>
        </form>
      )}
    </div>
  );
}
