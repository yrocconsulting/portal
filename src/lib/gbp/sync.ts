import "server-only";
import { decryptSecret } from "@/lib/crypto";
import { cleanDomain } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessToken, dailyMetrics, gbpOAuthConfig, listAccounts, listLocations, listReviews, monthlyKeywords, STARS, type DailyColumn } from "./google";

export type GbpConnection = { refresh_enc: string; email: string | null; connected_at: string; connected_by: string | null; last_sync?: string; last_error?: string | null };
export type GbpSyncResult = { configured: boolean; connected: boolean; locations: number; days: number; reviews: number; newReviews: number; errors: string[] };

type Admin = ReturnType<typeof createAdminClient>;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86400000));
const monthStart = (offset: number) => {
  const d = new Date();
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)));
};
const hostOf = (u: string | null | undefined) => {
  if (!u) return null;
  try {
    return cleanDomain(new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname);
  } catch {
    return null;
  }
};

export async function gbpConnection(db: Admin): Promise<GbpConnection | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "gbp_oauth").maybeSingle();
  const v = data?.value as GbpConnection | undefined;
  return v?.refresh_enc ? v : null;
}

/**
 * Pulls every profile the connected manager account can see: details, daily performance (18 months on
 * the first run, then the last 10 days), monthly search terms and reviews. Matches profiles to clients by
 * website domain unless an admin chose one. Queues new-review emails, but not for the first import.
 */
export async function syncGbp(): Promise<GbpSyncResult> {
  const out: GbpSyncResult = { configured: !!gbpOAuthConfig(), connected: false, locations: 0, days: 0, reviews: 0, newReviews: 0, errors: [] };
  if (!out.configured) return out;
  const db = createAdminClient();
  const conn = await gbpConnection(db);
  if (!conn) return out;
  out.connected = true;

  let token: string;
  try {
    token = await accessToken(decryptSecret(conn.refresh_enc));
  } catch (e) {
    out.errors.push((e as Error).message);
    await db.from("app_settings").upsert({ key: "gbp_oauth", value: { ...conn, last_error: (e as Error).message, last_sync: new Date().toISOString() }, updated_at: new Date().toISOString() });
    return out;
  }

  const { data: clients } = await db.from("clients").select("id, domain, website, status").neq("status", "former");
  const clientByDomain = new Map<string, string>();
  for (const c of clients ?? []) {
    for (const d of [cleanDomain(c.domain), hostOf(c.website)]) if (d && !clientByDomain.has(d)) clientByDomain.set(d, c.id);
  }

  const seen = new Set<string>();
  try {
    for (const account of await listAccounts(token)) {
      for (const loc of await listLocations(token, account.name)) {
        if (seen.has(loc.name)) continue;
        seen.add(loc.name);
        try {
          await syncLocation(db, token, account.name, loc, clientByDomain, out);
          out.locations++;
        } catch (e) {
          const msg = (e as Error).message;
          out.errors.push(`${loc.title ?? loc.name}: ${msg}`);
          await db.from("gbp_locations").update({ last_error: msg.slice(0, 500) }).eq("name", loc.name);
        }
      }
    }
  } catch (e) {
    out.errors.push((e as Error).message);
  }
  await db.from("app_settings").upsert({
    key: "gbp_oauth",
    value: { ...conn, last_sync: new Date().toISOString(), last_error: out.errors[0] ?? null },
    updated_at: new Date().toISOString(),
  });
  return out;
}

async function syncLocation(
  db: Admin,
  token: string,
  account: string,
  loc: Awaited<ReturnType<typeof listLocations>>[number],
  clientByDomain: Map<string, string>,
  out: GbpSyncResult,
) {
  const a = loc.storefrontAddress;
  const address = a ? [...(a.addressLines ?? []), [a.locality, a.administrativeArea].filter(Boolean).join(", "), a.postalCode].filter(Boolean).join(", ") : null;
  const domain = hostOf(loc.websiteUri);
  const { data: existing } = await db.from("gbp_locations").select("client_id, matched_by").eq("name", loc.name).maybeSingle();
  const match = existing?.matched_by === "admin" ? null : domain ? clientByDomain.get(domain) ?? null : null;
  await db.from("gbp_locations").upsert({
    name: loc.name,
    account,
    title: loc.title ?? loc.name,
    website: loc.websiteUri ?? null,
    domain,
    address,
    maps_uri: loc.metadata?.mapsUri ?? null,
    ...(existing?.matched_by === "admin" ? {} : { client_id: match, matched_by: match ? "domain" : null }),
  });

  // Daily performance.
  const { data: last } = await db.from("gbp_daily").select("date").eq("location", loc.name).order("date", { ascending: false }).limit(1).maybeSingle();
  const start = last?.date ? ymd(new Date(new Date(`${last.date}T00:00:00Z`).getTime() - 10 * 86400000)) : daysAgo(540);
  const days = await dailyMetrics(token, loc.name, start, daysAgo(1));
  const cols: DailyColumn[] = ["views_search", "views_maps", "calls", "website_clicks", "directions", "bookings", "messages"];
  const rows = [...days.entries()].map(([date, v]) => ({ location: loc.name, date, ...Object.fromEntries(cols.map((c) => [c, v[c] ?? 0])) }));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from("gbp_daily").upsert(rows.slice(i, i + 1000));
    if (error) throw new Error(error.message);
  }
  out.days += rows.length;

  // Search terms: the last two complete months (six on the first run).
  const months = last?.date ? [-1, -2] : [-1, -2, -3, -4, -5, -6];
  for (const m of months) {
    const month = monthStart(m);
    const kw = await monthlyKeywords(token, loc.name, month);
    if (kw.length) {
      await db.from("gbp_keywords").delete().eq("location", loc.name).eq("month", month);
      await db.from("gbp_keywords").upsert(kw.slice(0, 200).map((k) => ({ location: loc.name, month, keyword: k.keyword.slice(0, 300), impressions: k.impressions, below: k.below })));
    }
  }

  // Reviews: everything on the first run, then the most recently updated.
  const { count: had } = await db.from("gbp_reviews").select("name", { count: "exact", head: true }).eq("location", loc.name);
  const firstImport = !had;
  const { reviews, average, total } = await listReviews(token, account, loc.name, firstImport ? 20 : 2);
  const names = reviews.map((r) => r.name);
  const { data: known } = names.length ? await db.from("gbp_reviews").select("name").in("name", names) : { data: [] as { name: string }[] };
  const knownSet = new Set((known ?? []).map((k) => k.name));
  if (reviews.length) {
    const { error } = await db.from("gbp_reviews").upsert(
      reviews.map((r) => ({
        name: r.name,
        location: loc.name,
        reviewer: r.reviewer?.isAnonymous ? "Anonymous" : r.reviewer?.displayName ?? null,
        rating: STARS[r.starRating ?? ""] ?? null,
        comment: r.comment?.slice(0, 5000) ?? null,
        created_at: r.createTime,
        updated_at: r.updateTime ?? null,
        reply: r.reviewReply?.comment?.slice(0, 5000) ?? null,
        replied_at: r.reviewReply?.updateTime ?? null,
      })),
    );
    if (error) throw new Error(error.message);
  }
  out.reviews += reviews.length;
  await db
    .from("gbp_locations")
    .update({ average_rating: average === null ? null : Math.round(average * 10) / 10, review_count: total, last_synced_at: new Date().toISOString(), last_error: null })
    .eq("name", loc.name);

  // New reviews (not the first import, written in the last week): email the client's account manager and lead.
  const fresh = firstImport ? [] : reviews.filter((r) => !knownSet.has(r.name) && Date.parse(r.createTime) > Date.now() - 7 * 86400000);
  const clientId = existing?.matched_by === "admin" ? existing.client_id : match;
  if (fresh.length && clientId) {
    const { data: c } = await db.from("clients").select("account_manager_id, lead_id").eq("id", clientId).single();
    const people = [...new Set([c?.account_manager_id, c?.lead_id].filter((x): x is string => !!x))];
    const rowsToQueue = fresh.flatMap((r) => people.map((staff_id) => ({ staff_id, kind: "new_review", review_name: r.name })));
    if (rowsToQueue.length) await db.from("notifications").insert(rowsToQueue);
    out.newReviews += fresh.length;
  }
}
