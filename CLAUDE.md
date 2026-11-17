@AGENTS.md

# Yroc Portal: working notes

Internal ticketing + client operations for Yroc Consulting (owner: Cory Long). Separate app from the
marketing site (`yrocconsulting/staging`). Users: internal staff (1 to 5 people) and, later, Claude.

## Rules
- Never use em dashes in copy, comments or UI text. Use commas, colons or periods.
- Brand: ink #0B1220, green #7ED957 (dark green #3F8F1C on light), steel #547590. Inter / Inter Tight
  (local font files in `src/fonts`). Tailwind theme tokens in `src/app/globals.css`.
- White-label clients (`clients.white_label`) are served through agency partners. They are never named
  on the website or used as case studies. Keep the badge visible wherever a client is shown.
- No secrets in the repo or in chat. Supabase publishable key + URL are public by design; anything else
  (service role key, Microsoft Graph secret, Anthropic key) goes in Vercel/Supabase/GitHub secrets.
- The portal never emails clients. The only outgoing mail is internal (confirmations to the staff
  member who forwarded an email), sent from the no-reply mailbox and checked against the staff list.
- Claude-assisted work must post drafts to the ticket for a person to approve. Nothing is sent to a
  client or published automatically.

## How it works
- Next.js 16: `src/proxy.ts` (replaces middleware) refreshes the Supabase session and sends signed-out
  users to `/login`. `params`/`searchParams` are Promises. Cache Components are off on purpose: every
  page depends on the signed-in user. Read `node_modules/next/dist/docs/` before using a new API.
- Auth: `src/lib/auth.ts` `requireStaff()` / `requireAdmin()` at the top of every page and server
  action. Access is enforced again in Postgres by RLS (`public.is_staff()`). The secret key client
  (`src/lib/supabase/admin.ts`) is only for machine endpoints with no signed-in user that check their
  own secret: the email intake (`src/lib/email/`, `/api/email/*`) and `/api/prt/ingest`.
- AI visibility: the website repo's Monday `ai-stats` job posts full ProRankTracker results to
  `/api/prt/ingest` (secret `PRT_INGEST_SECRET` here, `PORTAL_INGEST_SECRET` there). Results are stored
  by domain and joined to clients via `tracking_domain ?? domain` at read time.
- Email intake: staff forward client mail to the helpdesk mailbox (clients keep emailing their account
  manager; nobody's personal mailbox is read). `src/lib/email/parse.ts` (pure, unit tested) reads the
  forward; `process.ts` files it. Only active staff senders create tickets; others go to Inbox review.
- Client logins: `client_credentials.password_enc` is encrypted in the app (`src/lib/crypto.ts`,
  key `CREDENTIALS_KEY`). Never select `password_enc` into anything sent to the browser; reveal goes
  through `revealPassword()`, which logs to `credential_views`. The sheet import never reads logins.
- Data: server components and server actions use `src/lib/supabase/server.ts`. The browser client is
  only for direct uploads to the private `attachments` bucket.
- Schema: `supabase/migrations/` (new file per change). Ticket history is written by triggers into
  `ticket_events`; don't write events from the app.
- Redirects must use `requestOrigin()` (`src/lib/origin.ts`), not `nextUrl.origin`.

## Testing
Local Supabase in Docker (`npm run db:start`, `npm run db:reset`), then `npm run build && npm start`
and `npm run test:e2e` (Playwright, signs in via Mailpit magic links). Run typecheck, lint, build and
the e2e test before pushing.
