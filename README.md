# Yroc Portal

Internal ticketing and client operations for Yroc Consulting. Separate from the marketing website
(`yrocconsulting/staging`).

**Stack:** Next.js 16 (App Router) on Vercel, Supabase (Postgres, Auth, Storage). Staff sign in with
Microsoft 365 or an emailed link; only invited email addresses get in.

## What it does (stage 1)

- **Tickets:** create, assign, prioritize, set due dates, comment, attach files, full activity history.
  Filters, search (`#1042` jumps to a ticket) and an overdue view.
- **Clients:** contacts, services, status, notes and a **white-label** flag (with the agency partner).
  White-label clients must never be named on the website or used as case studies.
- **Onboarding:** checklists whose steps become tickets for a client, due N days after the start.
- **Team:** admins invite people by email and set roles. Members can't delete tickets or clients.
- **Profiles:** everyone sets their name, job title, phone and photo under **My profile** (click your
  name in the sidebar); admins can edit anyone's from **Team**. Photos live in the private `avatars`
  bucket and are shown with short-lived signed links.

- **Email intake:** staff forward client emails to the helpdesk mailbox. The portal reads the original
  sender from the forward, links the client (by contact email, then by domain, creating the contact),
  attaches files and emails the forwarder a confirmation from no-reply. `#1042` in the subject adds the
  email to that ticket instead. Mail from anyone who isn't staff waits in **Inbox > Needs review**.
  Microsoft notifies `/api/email/webhook` as mail arrives; `/api/cron/daily` (`vercel.json`)
  renews that subscription and catches up. Staff can also log a client call or email on any ticket.

- **Client records:** contact, address, industry, package, payment method, start date, locations,
  Drive folder and online profiles. **Import from sheet** (admins) reads the client workbook (.xlsx):
  one tab per client, labels in column A, values in column B; tabs after "Past Clients" are former
  clients. Logins in the sheet are never imported. Re-running updates instead of duplicating.
- **Client logins:** website, hosting, registrar and other logins per client. Passwords are encrypted
  with `CREDENTIALS_KEY` (AES-256-GCM), hidden until **Reveal**, and every view or change is logged.

- **AI visibility:** each Monday the website repo's `ai-stats` job reads the ProRankTracker PDF and
  posts every tracked domain and prompt to `/api/prt/ingest`. Client pages show the latest week,
  platform split, weekly trend and every prompt; **AI visibility** lists all tracked sites and links
  any domain that isn't matched to a client (sets `tracking_domain`).

- **Google Search:** a read-only Google service account (`GSC_SERVICE_ACCOUNT`) syncs every Search
  Console property shared with it, daily via `/api/cron/daily` (16 months on the first run, then the
  last 10 days) or with **Sync now**. Client pages show 28-day clicks, impressions, CTR and position
  against the previous 28 days, a 90-day chart, and top queries and pages. **Search Console** lists
  all properties and links any that don't match a client by domain (`clients.gsc_site_url`).

- **Monthly reports:** clients are on a package (Search Foundation / Growth / Authority, seeded from
  the deliverables sheet; admins edit them under **Packages**). Each month a record is created per
  client with its own copy of the package's deliverables: done / not done / N/A, counts against
  targets, links and notes; a Search Growth Actions log by action type; wins, summary, next
  priorities and organic leads; and a saved Google Search + AI visibility snapshot. **Mark complete**
  archives the month read-only (admins can reopen). Print view at `/reports/[id]/print`.

- **Client reports:** from a monthly record, **Publish** takes a client-safe snapshot (wins, Google and
  AI results with charts, completed work with links, next month's plan; never internal notes,
  unfinished items, staff names or prices) and gives a secret link `/r/<token>` to send yourself.
  Update keeps the link; Turn off kills it. White-label clients' reports carry no Yroc name or logo.
- **Client leads:** each client can have a Lead (fulfillment) and an Account manager. New tickets,
  emailed tickets and onboarding default to the lead; "My clients" filters on Clients and Monthly
  reports.

Coming next: Claude-assisted tasks (drafts that a person approves).

## Local development

Needs Node 22 and Docker.

```bash
npm install
npm run db:start              # local Supabase in Docker
cp .env.example .env.local    # fill in values from `npx supabase status`
npm run db:reset              # applies migrations + supabase/seed.sql (local test users)
npm run dev
```

Sign in at http://127.0.0.1:3000 with `admin@yroc.test` (or `member@yroc.test`) using the email link;
local emails land in Mailpit at http://127.0.0.1:54324.

Checks: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`. End-to-end tests
against a running app and a freshly reset local database: `npm run test:e2e`, then (with
`node tests/mock-graph.cjs` running and the MS_* test settings from `tests/e2e-email.cjs` in
`.env.local`) `npm run test:e2e:email`.

## Database

Schema lives in `supabase/migrations/`. Add a new timestamped file for every change; never edit one that
has already been applied. Every table has row level security: only active staff (`public.is_staff()`)
can read or write. `staff_invites` turns into a `staff` row when that email first signs in.

Pushing a new migration to `main` applies it to production via `.github/workflows/db-migrate.yml`.

## Deployment

- **Vercel** builds every push to `main` (production) and every pull request (preview).
  Environment variables: see `.env.example`.
- **Supabase** production project: migrations via the GitHub workflow above.
  GitHub secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`.
- **Microsoft 365 sign in:** an Entra ID app registration, configured in Supabase under
  Authentication > Providers > Azure.
