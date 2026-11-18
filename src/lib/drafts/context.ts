import "server-only";
import { siteForClient } from "@/lib/gsc/match";
import { PR_ITEM_PATTERN } from "@/lib/press-release";
import type { createClient } from "@/lib/supabase/server";
import { trackedDomain } from "@/lib/visibility";

type Db = Awaited<ReturnType<typeof createClient>>;

export const KINDS = {
  press_release: "Press release",
  article: "Authority article / blog post",
  service_page: "Service page",
  faq: "FAQ content",
} as const;
export type DraftKind = keyof typeof KINDS;

export const STATUS_LABEL: Record<string, string> = {
  angles_pending: "Finding angles",
  angles_ready: "Pick an angle",
  draft_pending: "Writing",
  draft_ready: "Draft ready",
  posted: "Posted to ticket",
  failed: "Failed",
};

export type DraftContext = {
  client: {
    name: string;
    website: string | null;
    domain: string | null;
    city: string | null;
    industry: string | null;
    services: string[];
    locations: string | null;
    white_label: boolean;
  };
  prompts: { prompt: string; visibility: number; platforms: string[] }[];
  promptsDate: string | null;
  siteVisibility: number | null;
  queries: { query: string; clicks: number; impressions: number; position: number }[];
  wins: { month: string; wins: string | null; summary: string | null }[];
  pastPieces: { date: string; kind: string; title: string }[];
};

/** Everything Claude gets to know about a client, read with the signed-in person's access. */
export async function buildContext(db: Db, clientId: string): Promise<DraftContext> {
  const { data: c, error } = await db
    .from("clients")
    .select("id, name, website, domain, tracking_domain, gsc_site_url, city, industry, services, locations, white_label")
    .eq("id", clientId)
    .single();
  if (error || !c) throw new Error("Client not found.");
  const tracked = trackedDomain(c);

  // Tracked AI prompts from the latest weekly report.
  let prompts: DraftContext["prompts"] = [];
  let promptsDate: string | null = null;
  let siteVisibility: number | null = null;
  if (tracked) {
    const { data: site } = await db.from("prt_site_results").select("report_date, visibility").eq("domain", tracked).order("report_date", { ascending: false }).limit(1).maybeSingle();
    if (site) {
      promptsDate = site.report_date;
      siteVisibility = site.visibility;
      const { data: rows } = await db.from("prt_prompt_results").select("prompt, visibility, platforms").eq("domain", tracked).eq("report_date", site.report_date).order("visibility").limit(80);
      prompts = (rows ?? []).map((r) => ({ prompt: r.prompt, visibility: r.visibility, platforms: r.platforms ?? [] }));
    }
  }

  // Top Google queries from Search Console.
  let queries: DraftContext["queries"] = [];
  const { data: sites } = await db.from("gsc_sites").select("site_url, domain");
  const siteUrl = siteForClient(c, sites ?? []);
  if (siteUrl) {
    const { data: latest } = await db.from("gsc_top").select("period_end").eq("site_url", siteUrl).eq("kind", "query").order("period_end", { ascending: false }).limit(1).maybeSingle();
    if (latest) {
      const { data: rows } = await db
        .from("gsc_top")
        .select("key, clicks, impressions, position")
        .eq("site_url", siteUrl)
        .eq("kind", "query")
        .eq("period_end", latest.period_end)
        .order("impressions", { ascending: false })
        .limit(30);
      queries = (rows ?? []).map((r) => ({ query: r.key, clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 }));
    }
  }

  // Recent wins, and what was already written (so angles aren't repeated).
  const [{ data: reports }, { data: drafts }] = await Promise.all([
    db.from("monthly_reports").select("id, month, wins, summary").eq("client_id", clientId).order("month", { ascending: false }).limit(6),
    db.from("ai_drafts").select("created_at, kind, title, angle").eq("client_id", clientId).in("status", ["draft_ready", "posted"]).order("created_at", { ascending: false }).limit(15),
  ]);
  const reportIds = (reports ?? []).map((r) => r.id);
  const { data: prItems } = reportIds.length
    ? await db.from("report_items").select("report_id, notes, links").in("report_id", reportIds).ilike("name", PR_ITEM_PATTERN)
    : { data: [] as { report_id: string; notes: string | null; links: string[] }[] };

  const pastPieces: DraftContext["pastPieces"] = [
    ...(drafts ?? []).map((d) => ({
      date: d.created_at.slice(0, 10),
      kind: KINDS[d.kind as DraftKind] ?? d.kind,
      title: d.title ?? (d.angle as { title?: string } | null)?.title ?? "(untitled)",
    })),
    ...(prItems ?? [])
      .filter((i) => i.notes?.trim() || i.links?.length)
      .map((i) => ({
        date: (reports ?? []).find((r) => r.id === i.report_id)?.month.slice(0, 7) ?? "",
        kind: "Press release (from the monthly report)",
        title: [i.notes?.trim(), ...(i.links ?? [])].filter(Boolean).join(" · ").slice(0, 300),
      })),
  ];

  return {
    client: {
      name: c.name,
      website: c.website ?? (c.domain ? `https://${c.domain}` : null),
      domain: c.domain,
      city: c.city,
      industry: c.industry,
      services: c.services ?? [],
      locations: c.locations,
      white_label: c.white_label,
    },
    prompts,
    promptsDate,
    siteVisibility,
    queries,
    wins: (reports ?? []).filter((r) => r.wins || r.summary).slice(0, 3).map((r) => ({ month: r.month.slice(0, 7), wins: r.wins, summary: r.summary })),
    pastPieces,
  };
}

/** The context as plain text for Claude. */
export function contextText(ctx: DraftContext): string {
  const c = ctx.client;
  const lines: string[] = [
    "<client>",
    `Name: ${c.name}`,
    c.website && `Website: ${c.website}`,
    c.city && `City: ${c.city}`,
    c.industry && `Industry: ${c.industry}`,
    c.locations && `Their locations:\n${c.locations}`,
    "</client>",
    "",
    `<tracked_ai_prompts date="${ctx.promptsDate ?? "none"}" overall_visibility="${ctx.siteVisibility ?? "unknown"}%">`,
    ctx.prompts.length
      ? "Each line: visibility % across AI platforms | platforms that name the client | prompt. Low visibility = an opportunity.\n" +
        ctx.prompts.map((p) => `${p.visibility}% | ${p.platforms.join(", ") || "none"} | ${p.prompt}`).join("\n")
      : "No tracked prompts for this client yet.",
    "</tracked_ai_prompts>",
    "",
    "<google_search_queries>",
    ctx.queries.length
      ? "Each line: impressions | clicks | average position | query\n" + ctx.queries.map((q) => `${q.impressions} | ${q.clicks} | ${q.position} | ${q.query}`).join("\n")
      : "No Search Console data for this client.",
    "</google_search_queries>",
    "",
    "<recent_wins>",
    ctx.wins.length ? ctx.wins.map((w) => `${w.month}: ${[w.wins, w.summary].filter(Boolean).join(" / ")}`).join("\n") : "None recorded.",
    "</recent_wins>",
    "",
    "<already_written>",
    ctx.pastPieces.length ? ctx.pastPieces.map((p) => `${p.date} | ${p.kind} | ${p.title}`).join("\n") : "Nothing yet.",
    "</already_written>",
  ].filter((l): l is string => typeof l === "string");
  return lines.join("\n");
}
