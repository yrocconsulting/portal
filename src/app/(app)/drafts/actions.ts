"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { buildContext, KINDS, type DraftKind } from "@/lib/drafts/context";
import { AngleSchema, claudeConfigured, MODEL, suggestAngles, writeDraft, type Angle, type Usage } from "@/lib/drafts/claude";
import { str } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

async function houseStyle(db: Db): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "draft_style").maybeSingle();
  return (data?.value as { text?: string } | null)?.text ?? null;
}

const usageEntry = (step: string, u: Usage) => ({ step, model: MODEL, at: new Date().toISOString(), ...u });

/** Runs step 1 after the response is sent; the page polls until it's done. */
function runAngles(db: Db, id: string, clientId: string, kind: DraftKind, brief: string | null, prevUsage: unknown[] = []) {
  after(async () => {
    try {
      const [ctx, style] = await Promise.all([buildContext(db, clientId), houseStyle(db)]);
      const { angles, usage } = await suggestAngles(ctx, kind, brief, style);
      await db.from("ai_drafts").update({ status: "angles_ready", angles, error: null, usage: { steps: [...prevUsage, usageEntry("angles", usage)] } }).eq("id", id);
    } catch (e) {
      await db.from("ai_drafts").update({ status: "failed", error: (e as Error).message }).eq("id", id);
    }
  });
}

export async function startDraft(_prev: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  await requireStaff();
  if (!claudeConfigured()) return { error: "Claude isn't connected yet: add ANTHROPIC_API_KEY in Vercel and redeploy." };
  const clientId = str(fd, "client_id");
  const kind = str(fd, "kind") as DraftKind | null;
  if (!clientId) return { error: "Choose a client." };
  if (!kind || !(kind in KINDS)) return { error: "Choose what to write." };
  const brief = str(fd, "brief");
  const db = await createClient();
  const { data, error } = await db
    .from("ai_drafts")
    .insert({ client_id: clientId, kind, brief, ticket_id: str(fd, "ticket_id") })
    .select("id")
    .single();
  if (error) return { error: error.message };
  runAngles(db, data.id, clientId, kind, brief);
  redirect(`/drafts/${data.id}`);
}

export async function retryAngles(id: string) {
  await requireStaff();
  const db = await createClient();
  const { data: d } = await db.from("ai_drafts").select("client_id, kind, brief, usage").eq("id", id).single();
  if (!d) return;
  await db.from("ai_drafts").update({ status: "angles_pending", error: null, angles: null, angle: null, body: null, notes: null }).eq("id", id);
  runAngles(db, id, d.client_id, d.kind as DraftKind, d.brief, (d.usage as { steps?: unknown[] })?.steps ?? []);
  revalidatePath(`/drafts/${id}`);
}

export async function chooseAngle(id: string, angle: Angle, brief: string | null) {
  await requireStaff();
  const parsed = AngleSchema.safeParse(angle);
  if (!parsed.success) return { error: "That angle is incomplete." };
  const db = await createClient();
  const { data: d } = await db.from("ai_drafts").select("client_id, kind, usage").eq("id", id).single();
  if (!d) return { error: "Draft not found." };
  await db.from("ai_drafts").update({ status: "draft_pending", angle: parsed.data, brief, error: null }).eq("id", id);
  const prev = (d.usage as { steps?: unknown[] })?.steps ?? [];
  after(async () => {
    try {
      const [ctx, style] = await Promise.all([buildContext(db, d.client_id), houseStyle(db)]);
      const r = await writeDraft(ctx, d.kind as DraftKind, parsed.data, brief, style);
      await db
        .from("ai_drafts")
        .update({ status: "draft_ready", title: r.title, body: r.body, notes: r.notes, sources: r.sources, usage: { steps: [...prev, usageEntry("draft", r.usage)] } })
        .eq("id", id);
    } catch (e) {
      await db.from("ai_drafts").update({ status: "angles_ready", error: (e as Error).message }).eq("id", id);
    }
  });
  revalidatePath(`/drafts/${id}`);
  return {};
}

export async function saveDraftText(id: string, body: string, notes: string) {
  await requireStaff();
  const db = await createClient();
  const title = body.match(/^# (.+)$/m)?.[1]?.trim();
  const { error } = await db.from("ai_drafts").update({ body, notes, ...(title ? { title } : {}) }).eq("id", id);
  return error ? { error: error.message } : { ok: Date.now() };
}

/** Puts the draft on a ticket for review (creating one for the client's lead if needed). Nothing is sent. */
export async function postToTicket(id: string) {
  const me = await requireStaff();
  const db = await createClient();
  const { data: d } = await db.from("ai_drafts").select("*, client:clients(id, name, lead_id)").eq("id", id).single();
  if (!d || !d.body) return { error: "There's no draft to post yet." };
  const client = d.client as { id: string; name: string; lead_id: string | null };
  let ticketId: string | null = d.ticket_id;
  if (!ticketId) {
    const { data: t, error } = await db
      .from("tickets")
      .insert({
        title: `${KINDS[d.kind as DraftKind]}: ${d.title ?? "draft"}`.slice(0, 200),
        description: "Draft written with Claude. Review, fill in every [[CONFIRM]] placeholder, and get approval before anything is published or sent.",
        client_id: client.id,
        type: "task",
        source: "claude",
        created_by: me.id,
        assignee_id: client.lead_id ?? me.id,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    ticketId = t.id;
  }
  const body = [`**Draft for review** (${KINDS[d.kind as DraftKind]}). Fill in every [[CONFIRM]] before use.`, "", d.body, d.notes ? `\n---\n\n## Notes for the team\n\n${d.notes}` : ""].join("\n");
  const { error } = await db.from("ticket_comments").insert({ ticket_id: ticketId, author_id: me.id, author_kind: "claude", body, internal: true });
  if (error) return { error: error.message };
  await db.from("ai_drafts").update({ status: "posted", ticket_id: ticketId }).eq("id", id);
  const { data: t } = await db.from("tickets").select("number").eq("id", ticketId).single();
  revalidatePath("/", "layout");
  redirect(`/tickets/${t?.number}`);
}

export async function saveHouseStyle(_prev: { error?: string; ok?: number }, fd: FormData): Promise<{ error?: string; ok?: number }> {
  await requireAdmin();
  const db = await createClient();
  const { error } = await db.from("app_settings").upsert({ key: "draft_style", value: { text: str(fd, "style") ?? "" }, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath("/drafts");
  return { ok: Date.now() };
}
