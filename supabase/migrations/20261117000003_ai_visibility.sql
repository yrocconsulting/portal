-- Weekly AI visibility results from the ProRankTracker report (sent by the website repo's Monday job).
-- Results are stored by tracked domain and joined to clients at read time, so fixing a client's domain
-- later also attaches past weeks.

alter table public.clients add column tracking_domain text check (tracking_domain is null or tracking_domain = lower(tracking_domain));
comment on column public.clients.tracking_domain is 'Domain tracked in ProRankTracker when it differs from the website domain.';

create table public.prt_reports (
  report_date  date primary key,
  received_at  timestamptz not null default now(),
  site_count   int not null default 0,
  prompt_count int not null default 0
);

create table public.prt_site_results (
  report_date  date not null references public.prt_reports (report_date) on delete cascade,
  domain       text not null,
  appearances  int not null default 0,
  mentions     int not null default 0,
  links        int not null default 0,
  visibility   int not null default 0,     -- percent
  prompts      int not null default 0,
  platforms    jsonb not null default '{}', -- appearances per platform: aio, ai_mode, chatgpt, copilot, gemini, perplexity
  primary key (report_date, domain)
);
create index prt_site_results_domain_idx on public.prt_site_results (domain, report_date desc);

create table public.prt_prompt_results (
  id           bigint generated always as identity primary key,
  report_date  date not null references public.prt_reports (report_date) on delete cascade,
  domain       text not null,
  prompt       text not null,
  platforms    text[] not null default '{}',  -- platforms that named the client
  appearances  int not null default 0,
  visibility   int not null default 0
);
create index prt_prompt_results_domain_idx on public.prt_prompt_results (domain, report_date desc);

alter table public.prt_reports enable row level security;
alter table public.prt_site_results enable row level security;
alter table public.prt_prompt_results enable row level security;
create policy prt_reports_staff on public.prt_reports for select to authenticated using (public.is_staff());
create policy prt_sites_staff on public.prt_site_results for select to authenticated using (public.is_staff());
create policy prt_prompts_staff on public.prt_prompt_results for select to authenticated using (public.is_staff());
-- Writes come only from the ingest endpoint (secret key); staff can't edit report data.
