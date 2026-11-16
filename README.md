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

Coming next: email to ticket (Microsoft 365 support inbox), Teams notifications, ProRankTracker weekly
results per client, and Claude-assisted tasks (drafts that a person approves).

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

Checks: `npm run typecheck`, `npm run lint`, `npm run build`. End-to-end test against a running app and
a freshly reset local database: `npm run test:e2e`.

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
