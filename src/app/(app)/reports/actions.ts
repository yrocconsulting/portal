"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { str } from "@/lib/format";
import { computeResults } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

async function refreshResults(reportId: string) {
  const supabase = await createClient();
  const { data: r } = await supabase.from("monthly_reports").select("month, client:clients(domain, tracking_domain, gsc_site_url)").eq("id", reportId).single();
  if (!r) return;
  const client = r.client as unknown as { domain: string | null; tracking_domain: string | null; gsc_site_url: string | null };
  const results = await computeResults(client, r.month as string);
  await supabase.from("monthly_reports").update({ results, results_at: new Date().toISOString() }).eq("id", reportId);
}

/** Creates (or opens) a client's record for a month from their package. */
export async function startReport(fd: FormData) {
  await requireStaff();
  const clientId = str(fd, "client_id");
  const month = str(fd, "month");
  if (!clientId || !month || !/^\d{4}-\d{2}$/.test(month)) return;
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("start_monthly_report", { p_client: clientId, p_month: `${month}-01` });
  if (error) throw new Error(error.message);
  await refreshResults(id as string);
  revalidatePath("/reports");
  redirect(`/reports/${id}`);
}

/** Starts records for every active client with a package that doesn't have one this month yet. */
export async function startAll(fd: FormData) {
  await requireStaff();
  const month = str(fd, "month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return;
  const supabase = await createClient();
  const [{ data: clients }, { data: existing }] = await Promise.all([
    supabase.from("clients").select("id").in("status", ["onboarding", "active"]).not("package_id", "is", null),
    supabase.from("monthly_reports").select("client_id").eq("month", `${month}-01`),
  ]);
  const have = new Set((existing ?? []).map((e) => e.client_id));
  for (const c of clients ?? []) {
    if (have.has(c.id)) continue;
    const { data: id } = await supabase.rpc("start_monthly_report", { p_client: c.id, p_month: `${month}-01` });
    if (id) await refreshResults(id as string);
  }
  revalidatePath("/reports");
}

type ItemInput = { id: string; status: string; count: number | null; links: string[]; notes: string | null };
type ReportInput = { wins: string | null; summary: string | null; next_priorities: string | null; organic_leads: number | null; items: ItemInput[] };

const clean = (v: string | null | undefined, max = 20000) => (v && v.trim() ? v.trim().slice(0, max) : null);

export async function saveReport(reportId: string, input: ReportInput): Promise<{ error?: string; ok?: number }> {
  await requireStaff();
  const supabase = await createClient();
  const { data: r } = await supabase.from("monthly_reports").select("status").eq("id", reportId).single();
  if (!r) return { error: "Record not found." };
  if (r.status === "complete") return { error: "This month is archived. An admin can reopen it to make changes." };

  const { error } = await supabase
    .from("monthly_reports")
    .update({
      wins: clean(input.wins),
      summary: clean(input.summary),
      next_priorities: clean(input.next_priorities),
      organic_leads: Number.isFinite(input.organic_leads) && input.organic_leads !== null ? Math.max(0, Math.round(input.organic_leads)) : null,
    })
    .eq("id", reportId);
  if (error) return { error: error.message };

  for (const it of input.items ?? []) {
    const status = ["todo", "done", "na"].includes(it.status) ? it.status : "todo";
    const links = (it.links ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 50);
    await supabase
      .from("report_items")
      .update({
        status,
        count: it.count === null || !Number.isFinite(it.count) ? null : Math.max(0, Math.round(it.count)),
        links,
        notes: clean(it.notes, 5000),
      })
      .eq("id", it.id)
      .eq("report_id", reportId);
  }
  revalidatePath(`/reports/${reportId}`);
  return { ok: Date.now() };
}

export async function addAction(_prev: { error?: string; ok?: number }, fd: FormData): Promise<{ error?: string; ok?: number }> {
  const me = await requireStaff();
  const reportId = str(fd, "report_id");
  const title = str(fd, "title");
  if (!reportId || !title) return { error: "Give the action a short title." };
  const supabase = await createClient();
  const { data: r } = await supabase.from("monthly_reports").select("status").eq("id", reportId).single();
  if (r?.status === "complete") return { error: "This month is archived." };
  const url = str(fd, "url");
  const { error } = await supabase.from("report_actions").insert({
    report_id: reportId,
    action_type: str(fd, "action_type"),
    title,
    url: url && !/^https?:\/\//i.test(url) ? `https://${url}` : url,
    notes: str(fd, "notes"),
    done_on: str(fd, "done_on"),
    created_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
  return { ok: Date.now() };
}

export async function deleteAction(id: string, reportId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data: r } = await supabase.from("monthly_reports").select("status").eq("id", reportId).single();
  if (r?.status === "complete") return;
  await supabase.from("report_actions").delete().eq("id", id).eq("report_id", reportId);
  revalidatePath(`/reports/${reportId}`);
}

export async function refreshReportResults(reportId: string) {
  await requireStaff();
  await refreshResults(reportId);
  revalidatePath(`/reports/${reportId}`);
}

/** Archive the month: refresh its numbers one last time and make it read-only. */
export async function completeReport(reportId: string) {
  const me = await requireStaff();
  await refreshResults(reportId);
  const supabase = await createClient();
  await supabase.from("monthly_reports").update({ status: "complete", completed_by: me.id, completed_at: new Date().toISOString() }).eq("id", reportId);
  revalidatePath("/", "layout");
}

export async function reopenReport(reportId: string) {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("monthly_reports").update({ status: "in_progress", completed_by: null, completed_at: null }).eq("id", reportId);
  revalidatePath("/", "layout");
}

export async function deleteReport(fd: FormData) {
  await requireAdmin();
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("monthly_reports").delete().eq("id", id);
  revalidatePath("/reports");
  redirect("/reports");
}
