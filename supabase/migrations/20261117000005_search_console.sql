-- Google Search Console data per property, synced daily with a read-only service account.
-- Properties are joined to clients by domain (or an explicit gsc_site_url on the client).

alter table public.clients add column gsc_site_url text;
comment on column public.clients.gsc_site_url is 'Search Console property (e.g. sc-domain:example.com) when it does not match the website domain.';

create table public.gsc_sites (
  site_url        text primary key,        -- as Google names it: "sc-domain:example.com" or "https://www.example.com/"
  domain          text not null,           -- example.com
  permission      text,
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz not null default now()
);
create index gsc_sites_domain_idx on public.gsc_sites (domain);

create table public.gsc_daily (
  site_url     text not null references public.gsc_sites (site_url) on delete cascade,
  date         date not null,
  clicks       int not null default 0,
  impressions  int not null default 0,
  ctr          real not null default 0,    -- 0..1
  position     real not null default 0,
  primary key (site_url, date)
);

-- Top queries and pages for the latest 28 days (replaced on each sync).
create table public.gsc_top (
  id           bigint generated always as identity primary key,
  site_url     text not null references public.gsc_sites (site_url) on delete cascade,
  kind         text not null check (kind in ('query', 'page')),
  period_start date not null,
  period_end   date not null,
  key          text not null,
  clicks       int not null default 0,
  impressions  int not null default 0,
  ctr          real not null default 0,
  position     real not null default 0
);
create index gsc_top_site_idx on public.gsc_top (site_url, kind, clicks desc);

alter table public.gsc_sites enable row level security;
alter table public.gsc_daily enable row level security;
alter table public.gsc_top enable row level security;
create policy gsc_sites_staff on public.gsc_sites for select to authenticated using (public.is_staff());
create policy gsc_daily_staff on public.gsc_daily for select to authenticated using (public.is_staff());
create policy gsc_top_staff on public.gsc_top for select to authenticated using (public.is_staff());
-- Writes only from the sync job (secret key).
