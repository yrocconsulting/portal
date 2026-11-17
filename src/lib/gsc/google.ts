import "server-only";
import { createSign } from "node:crypto";

/**
 * Minimal Google Search Console client using a service account (read-only scope). The service account's
 * email must be added as a user on each Search Console property it should read.
 */

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

/** Why the service account setting can't be used (for the Search Console page), or null when it's fine. */
export function gscConfigProblem(): string | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT?.trim();
  if (!raw) return "The GSC_SERVICE_ACCOUNT setting isn't set in Vercel (or the portal hasn't been redeployed since it was added).";
  if (gscConfig()) return null;
  const looksJson = raw.startsWith("{");
  return looksJson
    ? "GSC_SERVICE_ACCOUNT is set but isn't a complete service account key. Paste the entire contents of the downloaded .json file, from the first { to the last }."
    : "GSC_SERVICE_ACCOUNT is set but doesn't look like the .json key file. Paste the file's entire contents, starting with {.";
}

export function gscConfig(): { sa: ServiceAccount; apiBase: string; tokenUrl: string } | null {
  const raw = process.env.GSC_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  let json = raw;
  if (!raw.startsWith("{")) {
    try {
      json = Buffer.from(raw, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    const sa = JSON.parse(json) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return {
      sa,
      apiBase: (process.env.GSC_API_BASE || "https://searchconsole.googleapis.com").replace(/\/$/, ""),
      tokenUrl: process.env.GOOGLE_TOKEN_URL || sa.token_uri || "https://oauth2.googleapis.com/token",
    };
  } catch {
    return null;
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let cached: { token: string; exp: number; who: string } | null = null;

async function token(cfg: NonNullable<ReturnType<typeof gscConfig>>): Promise<string> {
  if (cached && cached.who === cfg.sa.client_email && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: cfg.sa.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: cfg.tokenUrl, iat: now, exp: now + 3600 }),
  );
  const signature = b64url(createSign("RSA-SHA256").update(`${header}.${claims}`).sign(cfg.sa.private_key));
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google sign in failed: ${j.error_description ?? j.error ?? res.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000, who: cfg.sa.client_email };
  return j.access_token;
}

async function call<T>(cfg: NonNullable<ReturnType<typeof gscConfig>>, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${await token(cfg)}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search Console: ${(j as { error?: { message?: string } }).error?.message ?? res.status}`);
  return j as T;
}

export type GscSite = { siteUrl: string; permissionLevel: string };
export type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function listSites(cfg: NonNullable<ReturnType<typeof gscConfig>>): Promise<GscSite[]> {
  const r = await call<{ siteEntry?: GscSite[] }>(cfg, "/webmasters/v3/sites");
  return (r.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}

export async function query(
  cfg: NonNullable<ReturnType<typeof gscConfig>>,
  siteUrl: string,
  body: { startDate: string; endDate: string; dimensions: string[]; rowLimit?: number },
): Promise<GscRow[]> {
  const r = await call<{ rows?: GscRow[] }>(cfg, `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    ...body,
    dataState: "final",
  });
  return r.rows ?? [];
}

/** "sc-domain:example.com" / "https://www.example.com/" -> "example.com" */
export function siteDomain(siteUrl: string): string {
  return siteUrl
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}
