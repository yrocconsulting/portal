import "server-only";

/**
 * Minimal Microsoft Graph client for the helpdesk mailbox (app-only auth, client credentials).
 * The Entra app should be limited to the helpdesk and no-reply mailboxes with an Exchange application
 * access policy, so it cannot read anyone else's mail.
 */

export type MailConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  helpdesk: string;
  noreply: string;
  graphBase: string;
  loginBase: string;
};

export function mailConfig(): MailConfig | null {
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_MAIL_CLIENT_ID;
  const clientSecret = process.env.MS_MAIL_CLIENT_SECRET;
  const helpdesk = process.env.HELPDESK_MAILBOX?.toLowerCase().trim();
  if (!tenantId || !clientId || !clientSecret || !helpdesk) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    helpdesk,
    noreply: process.env.NOREPLY_MAILBOX?.toLowerCase().trim() || helpdesk,
    graphBase: (process.env.MS_GRAPH_BASE || "https://graph.microsoft.com").replace(/\/$/, ""),
    loginBase: (process.env.MS_LOGIN_BASE || "https://login.microsoftonline.com").replace(/\/$/, ""),
  };
}

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string | null;
  from?: { emailAddress?: { name?: string; address?: string } } | null;
  body?: { contentType?: string; content?: string } | null;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  internetMessageHeaders?: { name: string; value: string }[];
};

export type GraphAttachment = {
  "@odata.type"?: string;
  name: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
};

let cached: { token: string; exp: number; key: string } | null = null;

async function token(cfg: MailConfig): Promise<string> {
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  if (cached && cached.key === key && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${cfg.loginBase}/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Microsoft sign in failed: ${j.error_description?.split("\n")[0] ?? res.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000, key };
  return j.access_token;
}

async function graph<T>(cfg: MailConfig, path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${await token(cfg)}` };
  if (init.body) headers["content-type"] = "application/json";
  if (init.prefer) headers.prefer = init.prefer;
  const res = await fetch(`${cfg.graphBase}/v1.0${path}`, { ...init, headers });
  if (res.status === 202 || res.status === 204) return undefined as T;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Graph ${init.method ?? "GET"} ${path.split("?")[0]}: ${(j as { error?: { message?: string } }).error?.message ?? res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return j as T;
}

const mb = (address: string) => `/users/${encodeURIComponent(address)}`;

/** Unread messages in the mailbox inbox, oldest first (plain-text bodies). */
export async function listUnread(cfg: MailConfig, top = 25): Promise<GraphMessage[]> {
  const select = "id,internetMessageId,subject,from,body,receivedDateTime,hasAttachments,internetMessageHeaders";
  const r = await graph<{ value: GraphMessage[] }>(
    cfg,
    `${mb(cfg.helpdesk)}/mailFolders('Inbox')/messages?$filter=isRead eq false&$top=${top}&$select=${select}`,
    { prefer: 'outlook.body-content-type="text"' },
  );
  return (r.value ?? []).sort((a, b) => (a.receivedDateTime ?? "").localeCompare(b.receivedDateTime ?? ""));
}

export async function listAttachments(cfg: MailConfig, messageId: string): Promise<GraphAttachment[]> {
  const r = await graph<{ value: GraphAttachment[] }>(cfg, `${mb(cfg.helpdesk)}/messages/${encodeURIComponent(messageId)}/attachments`);
  return r.value ?? [];
}

export async function markRead(cfg: MailConfig, messageId: string): Promise<void> {
  await graph(cfg, `${mb(cfg.helpdesk)}/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) });
}

export async function sendMail(cfg: MailConfig, to: string, subject: string, text: string): Promise<void> {
  await graph(cfg, `${mb(cfg.noreply)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: { subject, body: { contentType: "Text", content: text }, toRecipients: [{ emailAddress: { address: to } }] },
      saveToSentItems: false,
    }),
  });
}

/** Change notifications for new mail. Mail subscriptions last at most about 7 days; we renew daily. */
export async function upsertSubscription(
  cfg: MailConfig,
  notificationUrl: string,
  clientState: string,
  existingId: string | null,
): Promise<{ id: string; expirationDateTime: string }> {
  const expirationDateTime = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  if (existingId) {
    try {
      return await graph(cfg, `/subscriptions/${encodeURIComponent(existingId)}`, { method: "PATCH", body: JSON.stringify({ expirationDateTime }) });
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
    }
  }
  return graph(cfg, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created",
      notificationUrl,
      resource: `users/${cfg.helpdesk}/mailFolders('Inbox')/messages`,
      expirationDateTime,
      clientState,
    }),
  });
}
