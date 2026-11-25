import "server-only";

/**
 * Google Business Profile APIs through one OAuth connection (the agency's manager account).
 * No Google SDK: plain fetch, like the Search Console client. For tests, GBP_API_BASE points every
 * service at one local server (paths are prefixed with the service name) and GBP_AUTH_URL /
 * GBP_TOKEN_URL replace Google's sign-in endpoints.
 */

export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

const HOSTS = {
  accounts: "https://mybusinessaccountmanagement.googleapis.com",
  info: "https://mybusinessbusinessinformation.googleapis.com",
  performance: "https://businessprofileperformance.googleapis.com",
  v4: "https://mybusiness.googleapis.com",
} as const;
type Service = keyof typeof HOSTS;

export function gbpOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const authUrl = () => process.env.GBP_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const tokenUrl = () => process.env.GBP_TOKEN_URL || "https://oauth2.googleapis.com/token";

function url(service: Service, path: string): string {
  const base = process.env.GBP_API_BASE?.replace(/\/$/, "");
  return base ? `${base}/${service}${path}` : `${HOSTS[service]}${path}`;
}

export class GbpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function signInUrl(redirectUri: string, state: string): string {
  const cfg = gbpOAuthConfig();
  if (!cfg) throw new Error("Google sign-in isn't set up: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel.");
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${GBP_SCOPE} openid email`,
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    include_granted_scopes: "true",
    state,
  });
  return `${authUrl()}?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; id_token?: string }> {
  const res = await fetch(tokenUrl(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const reason = data.error_description || data.error || res.statusText;
    throw new GbpError(data.error === "invalid_grant" ? "The Google connection expired or was removed. Reconnect it." : `Google sign-in failed: ${reason}`, res.status);
  }
  return data;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const cfg = gbpOAuthConfig()!;
  const t = await tokenRequest({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new GbpError("Google didn't return a long-lived connection. Remove Yroc Portal from the Google account's third-party access and connect again.", 400);
  // The email of the account that signed in, from the ID token (signed by Google; only shown to admins).
  let email: string | null = null;
  try {
    email = JSON.parse(Buffer.from((t.id_token ?? "").split(".")[1] ?? "", "base64url").toString()).email ?? null;
  } catch {
    /* not needed */
  }
  return { refreshToken: t.refresh_token, email };
}

export async function accessToken(refreshToken: string): Promise<string> {
  const cfg = gbpOAuthConfig();
  if (!cfg) throw new GbpError("Google sign-in isn't set up.", 0);
  return (await tokenRequest({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" })).access_token;
}

async function get<T>(token: string, service: Service, path: string): Promise<T> {
  const res = await fetch(url(service, path), { headers: { authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new GbpError(
      res.status === 403 && /not been used|disabled|SERVICE_DISABLED/i.test(msg)
        ? `A Business Profile API isn't turned on in Google Cloud (${service}). ${msg}`
        : res.status === 429 || /quota/i.test(msg)
          ? "Google's Business Profile quota is 0 or used up. Usually this means API access hasn't been approved yet."
          : `Google Business Profile: ${msg}`,
      res.status,
    );
  }
  return data as T;
}

async function all<T, K extends string>(fetchPage: (pageToken: string | null) => Promise<{ nextPageToken?: string } & Partial<Record<K, T[]>>>, key: K, max = 20): Promise<T[]> {
  const out: T[] = [];
  let token: string | null = null;
  for (let i = 0; i < max; i++) {
    const page = await fetchPage(token);
    out.push(...((page[key] as T[] | undefined) ?? []));
    if (!page.nextPageToken) break;
    token = page.nextPageToken;
  }
  return out;
}

export type GbpAccount = { name: string; accountName?: string; type?: string };
export type GbpLocation = {
  name: string;
  title?: string;
  websiteUri?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string };
  metadata?: { mapsUri?: string; placeId?: string };
};

export const listAccounts = (token: string) =>
  all<GbpAccount, "accounts">((p) => get(token, "accounts", `/v1/accounts?pageSize=20${p ? `&pageToken=${encodeURIComponent(p)}` : ""}`), "accounts");

export const listLocations = (token: string, account: string) =>
  all<GbpLocation, "locations">(
    (p) => get(token, "info", `/v1/${account}/locations?pageSize=100&readMask=name,title,websiteUri,storefrontAddress,metadata${p ? `&pageToken=${encodeURIComponent(p)}` : ""}`),
    "locations",
  );

export const DAILY_METRICS = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "views_search",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "views_search",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "views_maps",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "views_maps",
  CALL_CLICKS: "calls",
  WEBSITE_CLICKS: "website_clicks",
  BUSINESS_DIRECTION_REQUESTS: "directions",
  BUSINESS_BOOKINGS: "bookings",
  MESSAGING_CLICKS: "messages", // BUSINESS_CONVERSATIONS is deprecated
} as const;
export type DailyColumn = (typeof DAILY_METRICS)[keyof typeof DAILY_METRICS];

type DateParts = { year: number; month: number; day?: number };
const parts = (ymd: string): DateParts => {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day };
};

/** Daily metrics for one location, summed into our columns: { "2026-11-01": { calls: 3, ... } }. */
export async function dailyMetrics(token: string, location: string, start: string, end: string): Promise<Map<string, Partial<Record<DailyColumn, number>>>> {
  const s = parts(start);
  const e = parts(end);
  const q = new URLSearchParams();
  for (const m of Object.keys(DAILY_METRICS)) q.append("dailyMetrics", m);
  q.set("dailyRange.start_date.year", String(s.year));
  q.set("dailyRange.start_date.month", String(s.month));
  q.set("dailyRange.start_date.day", String(s.day));
  q.set("dailyRange.end_date.year", String(e.year));
  q.set("dailyRange.end_date.month", String(e.month));
  q.set("dailyRange.end_date.day", String(e.day));
  type Resp = {
    multiDailyMetricTimeSeries?: {
      dailyMetricTimeSeries?: { dailyMetric: keyof typeof DAILY_METRICS; timeSeries?: { datedValues?: { date: DateParts; value?: string }[] } }[];
    }[];
  };
  const data = await get<Resp>(token, "performance", `/v1/${location}:fetchMultiDailyMetricsTimeSeries?${q}`);
  const out = new Map<string, Partial<Record<DailyColumn, number>>>();
  for (const group of data.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      const col = DAILY_METRICS[series.dailyMetric];
      if (!col) continue;
      for (const dv of series.timeSeries?.datedValues ?? []) {
        const key = `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}-${String(dv.date.day).padStart(2, "0")}`;
        const row = out.get(key) ?? {};
        row[col] = (row[col] ?? 0) + (Number(dv.value) || 0); // Google leaves out zero values
        out.set(key, row);
      }
    }
  }
  return out;
}

/** Search terms people used to find the profile, for one month. */
export async function monthlyKeywords(token: string, location: string, month: string): Promise<{ keyword: string; impressions: number; below: boolean }[]> {
  const m = parts(month);
  const q = new URLSearchParams({
    "monthlyRange.start_month.year": String(m.year),
    "monthlyRange.start_month.month": String(m.month),
    "monthlyRange.end_month.year": String(m.year),
    "monthlyRange.end_month.month": String(m.month),
    pageSize: "100",
  });
  type Row = { searchKeyword: string; insightsValue?: { value?: string; threshold?: string } };
  const rows = await all<Row, "searchKeywordsCounts">(
    (p) => get(token, "performance", `/v1/${location}/searchkeywords/impressions/monthly?${q}${p ? `&pageToken=${encodeURIComponent(p)}` : ""}`),
    "searchKeywordsCounts",
    3,
  );
  return rows.map((r) => ({
    keyword: r.searchKeyword,
    impressions: Number(r.insightsValue?.value ?? r.insightsValue?.threshold ?? 0) || 0,
    below: r.insightsValue?.value === undefined,
  }));
}

export type GbpReview = {
  name: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";
  comment?: string;
  createTime: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};
export const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** Reviews, newest first (v4 API: needs the account in the path). */
export async function listReviews(token: string, account: string, location: string, pages: number) {
  const id = location.replace(/^locations\//, "");
  type Resp = { reviews?: GbpReview[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string };
  let average: number | null = null;
  let total: number | null = null;
  const reviews = await all<GbpReview, "reviews">(async (p) => {
    const r = await get<Resp>(token, "v4", `/v4/${account}/locations/${id}/reviews?pageSize=50&orderBy=updateTime%20desc${p ? `&pageToken=${encodeURIComponent(p)}` : ""}`);
    average ??= r.averageRating ?? null;
    total ??= r.totalReviewCount ?? null;
    return r;
  }, "reviews", pages);
  return { reviews, average: average as number | null, total: total as number | null };
}
