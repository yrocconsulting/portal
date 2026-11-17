import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const PLATFORMS = ["aio", "ai_mode", "chatgpt", "copilot", "gemini", "perplexity"];

type Site = { domain: string; appearances: number; mentions: number; links: number; visibility: number; prompts: number; platforms: Record<string, number> };
type Prompt = { domain: string; prompt: string; platforms: string[]; appearances: number; visibility: number };

const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
const dom = (v: unknown) => (typeof v === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);

function authorized(request: NextRequest): boolean {
  // Trim both sides: pasted secrets often pick up a trailing space or line break.
  const secret = process.env.PRT_INGEST_SECRET?.trim();
  const got = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!secret || got.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

/**
 * Weekly results from the website repo's ai-stats job (tools/prt_report.py --portal-out).
 * Re-sending the same report date replaces that week.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { report_date?: string; sites?: Site[]; prompts?: Prompt[] } | null;
  const date = body?.report_date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "report_date (YYYY-MM-DD) is required" }, { status: 400 });

  const sites = (body.sites ?? [])
    .map((s) => {
      const domain = dom(s?.domain);
      if (!domain) return null;
      const platforms = Object.fromEntries(PLATFORMS.map((p) => [p, int(s.platforms?.[p])]));
      return { report_date: date, domain, appearances: int(s.appearances), mentions: int(s.mentions), links: int(s.links), visibility: Math.min(100, int(s.visibility)), prompts: int(s.prompts), platforms };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const prompts = (body.prompts ?? [])
    .map((p) => {
      const domain = dom(p?.domain);
      const text = typeof p?.prompt === "string" ? p.prompt.trim().slice(0, 500) : "";
      if (!domain || !text) return null;
      return {
        report_date: date,
        domain,
        prompt: text,
        platforms: (Array.isArray(p.platforms) ? p.platforms : []).filter((x): x is string => PLATFORMS.includes(x)),
        appearances: int(p.appearances),
        visibility: Math.min(100, int(p.visibility)),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!sites.length) return NextResponse.json({ error: "no sites in the report" }, { status: 400 });

  const db = createAdminClient();
  // Replace the week: deleting the report row cascades to its results.
  await db.from("prt_reports").delete().eq("report_date", date);
  const { error: e1 } = await db.from("prt_reports").insert({ report_date: date, site_count: sites.length, prompt_count: prompts.length });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  const { error: e2 } = await db.from("prt_site_results").insert(sites);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  if (prompts.length) {
    const { error: e3 } = await db.from("prt_prompt_results").insert(prompts);
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, report_date: date, sites: sites.length, prompts: prompts.length });
}
