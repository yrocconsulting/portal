-- Monthly work records. Packages (tiers) hold the deliverables list; each client is on a package; each
-- month a record is created per client with its own copy of the package's items (so editing a package
-- later never changes past months).

create table public.packages (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  price_monthly  numeric,
  description    text,
  position       int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.package_items (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references public.packages (id) on delete cascade,
  section       text,
  name          text not null,
  frequency     text,                         -- Monthly, Weekly, Quarterly, Ongoing, ...
  kind          text not null default 'check' check (kind in ('check', 'count', 'actions')),
  target        int,                          -- per month, for count/actions
  target_label  text,                         -- "2 per week", "5 per month"
  level         text,                         -- Core, Advanced, Expanded, ...
  optional      boolean not null default false,
  notes         text,
  position      int not null default 0
);
create index package_items_pkg_idx on public.package_items (package_id, position);

-- Types of Search Growth Action ("What counts as an action").
create table public.action_types (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  category  text,
  purpose   text,
  example   text,
  position  int not null default 0
);

alter table public.clients add column package_id uuid references public.packages (id) on delete set null;

create table public.monthly_reports (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients (id) on delete cascade,
  month           date not null check (extract(day from month) = 1),
  package_id      uuid references public.packages (id) on delete set null,
  package_name    text,                       -- copy, in case the package is renamed or removed
  status          text not null default 'in_progress' check (status in ('in_progress', 'complete')),
  wins            text,                       -- highlights for a future client-facing report
  summary         text,                       -- what shipped / changed / learned
  next_priorities text,
  organic_leads   int,
  results         jsonb not null default '{}', -- Google Search + AI visibility snapshot for the month
  results_at      timestamptz,
  created_by      uuid references public.staff (id) on delete set null,
  completed_by    uuid references public.staff (id) on delete set null,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (client_id, month)
);
create trigger monthly_reports_touch before update on public.monthly_reports for each row execute function public.touch_updated_at();

create table public.report_items (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.monthly_reports (id) on delete cascade,
  section       text,
  name          text not null,
  frequency     text,
  kind          text not null default 'check' check (kind in ('check', 'count', 'actions')),
  target        int,
  target_label  text,
  level         text,
  optional      boolean not null default false,
  guidance      text,                         -- the package's note for this item
  status        text not null default 'todo' check (status in ('todo', 'done', 'na')),
  count         int,
  links         text[] not null default '{}',
  notes         text,
  position      int not null default 0
);
create index report_items_report_idx on public.report_items (report_id, position);

-- Each Search Growth Action delivered that month.
create table public.report_actions (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.monthly_reports (id) on delete cascade,
  action_type  text,
  title        text not null,
  url          text,
  notes        text,
  done_on      date,
  created_by   uuid references public.staff (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index report_actions_report_idx on public.report_actions (report_id, created_at);

alter table public.packages enable row level security;
alter table public.package_items enable row level security;
alter table public.action_types enable row level security;
alter table public.monthly_reports enable row level security;
alter table public.report_items enable row level security;
alter table public.report_actions enable row level security;
create policy packages_read on public.packages for select to authenticated using (public.is_staff());
create policy packages_admin on public.packages for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy package_items_read on public.package_items for select to authenticated using (public.is_staff());
create policy package_items_admin on public.package_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy action_types_read on public.action_types for select to authenticated using (public.is_staff());
create policy action_types_admin on public.action_types for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy reports_staff on public.monthly_reports for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy report_items_staff on public.report_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy report_actions_staff on public.report_actions for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Creates a client's record for a month from their package (or returns the existing one).
create or replace function public.start_monthly_report(p_client uuid, p_month date)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  m date := date_trunc('month', p_month)::date;
  rid uuid;
  pkg uuid;
begin
  if not public.is_staff() then raise exception 'not allowed'; end if;
  select id into rid from public.monthly_reports where client_id = p_client and month = m;
  if found then return rid; end if;
  select package_id into pkg from public.clients where id = p_client;
  insert into public.monthly_reports (client_id, month, package_id, package_name, created_by)
  values (p_client, m, pkg, (select name from public.packages where id = pkg), auth.uid())
  returning id into rid;
  insert into public.report_items (report_id, section, name, frequency, kind, target, target_label, level, optional, guidance, position)
  select rid, section, name, frequency, kind, target, target_label, level, optional, notes, position
  from public.package_items where package_id = pkg order by position;
  return rid;
end $$;
revoke execute on function public.start_monthly_report(uuid, date) from anon;

-- Starting packages and deliverables, generated from the Yroc deliverables sheet (Monthly Deliverables tab).
-- Edit them in the portal under Packages; past monthly records keep their own copy.
insert into public.packages (name, price_monthly, description, position) values ('Search Foundation', 2500, 'Local and service businesses establishing visibility', 1);
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Search Growth Actions', 'Monthly', 'actions', 5, '5 per month', null, false, 'Used across new pages, content refreshes, authority content, comparisons, FAQs and other priority opportunities', 1 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Title Tags + Meta Descriptions', 'Monthly', 'check', null, null, null, false, null, 5 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Alt Image Text Optimisation', 'Monthly / As Needed', 'check', null, null, null, false, null, 6 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'FAQ + Question-Led Content Optimisation', 'Monthly', 'check', null, null, 'Core', false, null, 10 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Internal Linking Optimisation', 'Monthly', 'check', null, null, null, false, null, 11 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Schema Markup Maintenance / Expansion', 'Monthly / As Needed', 'check', null, null, 'Core', false, null, 12 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Content Cannibalisation / Thin Content Review', 'Ongoing', 'check', null, null, 'Core', false, null, 13 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Posting', 'Weekly', 'count', 4, '1 per week', null, false, null, 15 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Q&A / Service Information Optimisation', 'Monthly', 'count', 2, '2 per month', null, false, 'Research, data, benchmark, definitive guide, etc.', 16 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Picture / Media Uploads', 'Weekly', 'count', 8, '2 per week', null, false, null, 17 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Review Monitoring', 'Ongoing', 'check', null, null, null, false, null, 18 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Review Responses', 'Ongoing', 'check', null, null, null, true, null, 19 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Citation Management + Cleanup', 'Ongoing', 'check', null, null, 'Core', false, null, 20 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Search / Map Visibility Optimisation', 'Monthly', 'check', null, null, 'Core', false, null, 21 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Competitor Monitoring', 'Monthly', 'check', null, null, 'Core', false, null, 22 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Search Visibility Monitoring', 'Monthly', 'check', null, null, 'Core', false, null, 23 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'Priority AI Query / Prompt Tracking', 'Monthly', 'check', null, null, 'Priority Set', false, null, 24 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Citation Monitoring', 'Monthly', 'check', null, null, 'Core', false, null, 25 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Cited Page / Source Analysis', 'Monthly', 'check', null, null, 'Core', false, null, 26 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Citation Opportunity Analysis', 'Monthly', 'check', null, null, 'Core', false, null, 27 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'Entity SEO / Brand Reinforcement', 'Monthly', 'check', null, null, 'Core', false, null, 29 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'E-E-A-T / Trust Signal Enhancements', 'Monthly / As Prioritised', 'check', null, null, 'Core', false, null, 30 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Answer / Extractability Optimisation', 'Monthly', 'check', null, null, 'Core', false, null, 31 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Referral Traffic Monitoring', 'Monthly', 'check', null, null, 'Where measurable', false, null, 32 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Backlink Profile Monitoring', 'Monthly', 'check', null, null, null, false, null, 33 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Advanced Link Building', 'Monthly', 'check', null, null, 'Foundational', false, 'Focus on relevant, natural, authoritative links rather than quantity guarantees', 34 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Brand Mention / Unlinked Mention Opportunities', 'Monthly', 'check', null, null, 'Core', false, null, 36 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Competitor Backlink Gap Opportunities', 'Monthly', 'check', null, null, 'Core', false, null, 37 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Industry Profile / Authority Placements', 'Monthly / As Available', 'check', null, null, 'Core', false, null, 38 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Technical SEO Monitoring', 'Monthly', 'check', null, null, null, false, null, 41 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Indexation / Crawl Error Monitoring', 'Monthly', 'check', null, null, null, false, null, 42 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Redirect / Canonical Monitoring', 'Monthly / As Needed', 'check', null, null, null, false, null, 43 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Site Speed + Core Web Vitals Review', 'Quarterly', 'check', null, null, null, false, null, 44 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Monthly SEO Performance Report', 'Monthly', 'check', null, null, null, false, null, 45 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Search Visibility Dashboard', 'Monthly / Live', 'check', null, null, null, false, null, 46 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Organic Traffic + Conversion Reporting', 'Monthly', 'check', null, null, null, false, null, 47 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Commercial Keyword Visibility', 'Monthly', 'check', null, null, null, false, null, 48 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'GBP / Local Performance Reporting', 'Monthly', 'check', null, null, null, false, null, 49 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'AI Visibility + Citation Reporting', 'Monthly', 'check', null, null, 'Core', false, null, 50 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Authority / Backlink Reporting', 'Monthly', 'check', null, null, 'Core', false, null, 51 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Work Completed + Next Priorities', 'Monthly', 'check', null, null, null, false, null, 52 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Quarterly 90-Day Strategy Reset', 'Quarterly', 'check', null, null, null, false, null, 53 from public.packages where name = 'Search Foundation';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Dedicated Account Manager', 'Ongoing', 'check', null, null, null, false, null, 54 from public.packages where name = 'Search Foundation';
insert into public.packages (name, price_monthly, description, position) values ('Search Growth', 3750, 'Competitive businesses actively growing leads and visibility', 2);
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Search Growth Actions', 'Monthly', 'actions', 10, '10 per month', null, false, 'Used across new pages, content refreshes, authority content, comparisons, FAQs and other priority opportunities', 1 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Title Tags + Meta Descriptions', 'Monthly', 'check', null, null, null, false, null, 5 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Alt Image Text Optimisation', 'Monthly / As Needed', 'check', null, null, null, false, null, 6 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'FAQ + Question-Led Content Optimisation', 'Monthly', 'check', null, null, 'Advanced', false, null, 10 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Internal Linking Optimisation', 'Monthly', 'check', null, null, null, false, null, 11 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Schema Markup Maintenance / Expansion', 'Monthly / As Needed', 'check', null, null, 'Advanced', false, null, 12 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Content Cannibalisation / Thin Content Review', 'Ongoing', 'check', null, null, null, false, null, 13 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'On-Page Video / Rich Media Optimisation', 'As Available', 'check', null, null, null, false, null, 14 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Posting', 'Weekly', 'count', 8, '2 per week', null, false, null, 15 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Q&A / Service Information Optimisation', 'Monthly', 'count', 4, '4 per month', null, false, 'Research, data, benchmark, definitive guide, etc.', 16 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Picture / Media Uploads', 'Weekly', 'count', 20, '5 per week', null, false, null, 17 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Review Monitoring', 'Ongoing', 'check', null, null, null, false, null, 18 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Review Responses', 'Ongoing', 'check', null, null, null, false, null, 19 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Citation Management + Cleanup', 'Ongoing', 'check', null, null, 'Expanded', false, null, 20 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Search / Map Visibility Optimisation', 'Monthly', 'check', null, null, 'Advanced', false, null, 21 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Competitor Monitoring', 'Monthly', 'check', null, null, null, false, null, 22 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Search Visibility Monitoring', 'Monthly', 'check', null, null, 'Advanced', false, null, 23 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'Priority AI Query / Prompt Tracking', 'Monthly', 'check', null, null, 'Expanded Set', false, null, 24 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Citation Monitoring', 'Monthly', 'check', null, null, null, false, null, 25 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Cited Page / Source Analysis', 'Monthly', 'check', null, null, null, false, null, 26 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Citation Opportunity Analysis', 'Monthly', 'check', null, null, null, false, null, 27 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'Competitor AI Visibility Tracking', 'Monthly', 'check', null, null, null, false, null, 28 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'Entity SEO / Brand Reinforcement', 'Monthly', 'check', null, null, 'Advanced', false, null, 29 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'E-E-A-T / Trust Signal Enhancements', 'Monthly / As Prioritised', 'check', null, null, null, false, null, 30 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Answer / Extractability Optimisation', 'Monthly', 'check', null, null, null, false, null, 31 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Referral Traffic Monitoring', 'Monthly', 'check', null, null, 'Where measurable', false, null, 32 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Backlink Profile Monitoring', 'Monthly', 'check', null, null, null, false, null, 33 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Advanced Link Building', 'Monthly', 'check', null, null, null, false, 'Focus on relevant, natural, authoritative links rather than quantity guarantees', 34 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Digital PR / Authority Outreach', 'Monthly / Campaign', 'check', null, null, null, false, null, 35 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Brand Mention / Unlinked Mention Opportunities', 'Monthly', 'check', null, null, null, false, null, 36 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Competitor Backlink Gap Opportunities', 'Monthly', 'check', null, null, null, false, null, 37 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Industry Profile / Authority Placements', 'Monthly / As Available', 'check', null, null, null, false, null, 38 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Technical SEO Monitoring', 'Monthly', 'check', null, null, null, false, null, 41 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Indexation / Crawl Error Monitoring', 'Monthly', 'check', null, null, null, false, null, 42 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Redirect / Canonical Monitoring', 'Monthly / As Needed', 'check', null, null, null, false, null, 43 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Site Speed + Core Web Vitals Review', 'Quarterly', 'check', null, null, null, false, null, 44 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Monthly SEO Performance Report', 'Monthly', 'check', null, null, null, false, null, 45 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Search Visibility Dashboard', 'Monthly / Live', 'check', null, null, null, false, null, 46 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Organic Traffic + Conversion Reporting', 'Monthly', 'check', null, null, null, false, null, 47 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Commercial Keyword Visibility', 'Monthly', 'check', null, null, null, false, null, 48 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'GBP / Local Performance Reporting', 'Monthly', 'check', null, null, null, false, null, 49 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'AI Visibility + Citation Reporting', 'Monthly', 'check', null, null, 'Advanced', false, null, 50 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Authority / Backlink Reporting', 'Monthly', 'check', null, null, null, false, null, 51 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Work Completed + Next Priorities', 'Monthly', 'check', null, null, null, false, null, 52 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Quarterly 90-Day Strategy Reset', 'Quarterly', 'check', null, null, null, false, null, 53 from public.packages where name = 'Search Growth';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Dedicated Account Manager', 'Ongoing', 'check', null, null, null, false, null, 54 from public.packages where name = 'Search Growth';
insert into public.packages (name, price_monthly, description, position) values ('Search Authority', 6000, 'Established, aggressive-growth or multi-location brands', 3);
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Search Growth Actions', 'Monthly', 'actions', 15, '15 per month', null, false, 'Used across new pages, content refreshes, authority content, comparisons, FAQs and other priority opportunities', 1 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Title Tags + Meta Descriptions', 'Monthly', 'check', null, null, null, false, null, 5 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Alt Image Text Optimisation', 'Monthly / As Needed', 'check', null, null, null, false, null, 6 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'FAQ + Question-Led Content Optimisation', 'Monthly', 'check', null, null, 'Advanced', false, null, 10 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Internal Linking Optimisation', 'Monthly', 'check', null, null, null, false, null, 11 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Schema Markup Maintenance / Expansion', 'Monthly / As Needed', 'check', null, null, 'Advanced', false, null, 12 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'Content Cannibalisation / Thin Content Review', 'Ongoing', 'check', null, null, null, false, null, 13 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'On-page SEO + Content', 'On-Page Video / Rich Media Optimisation', 'As Available', 'check', null, null, null, false, null, 14 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Posting', 'Weekly', 'count', 16, '4 per week', null, false, null, 15 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Q&A / Service Information Optimisation', 'Monthly', 'count', 8, '8 per month', null, false, 'Research, data, benchmark, definitive guide, etc.', 16 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Picture / Media Uploads', 'Weekly', 'count', 32, '8 per week', null, false, null, 17 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Review Monitoring', 'Ongoing', 'check', null, null, null, false, null, 18 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'GBP Review Responses', 'Ongoing', 'check', null, null, null, false, null, 19 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Citation Management + Cleanup', 'Ongoing', 'check', null, null, 'Advanced', false, null, 20 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Search / Map Visibility Optimisation', 'Monthly', 'check', null, null, 'Advanced', false, null, 21 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'GBP + Local SEO', 'Local Competitor Monitoring', 'Monthly', 'check', null, null, null, false, null, 22 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Search Visibility Monitoring', 'Monthly', 'check', null, null, 'Advanced', false, null, 23 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'Priority AI Query / Prompt Tracking', 'Monthly', 'check', null, null, 'Large Competitive Set', false, null, 24 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Citation Monitoring', 'Monthly', 'check', null, null, 'Advanced', false, null, 25 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Cited Page / Source Analysis', 'Monthly', 'check', null, null, 'Advanced', false, null, 26 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Citation Opportunity Analysis', 'Monthly', 'check', null, null, 'Advanced', false, null, 27 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'Competitor AI Visibility Tracking', 'Monthly', 'check', null, null, null, false, null, 28 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'Entity SEO / Brand Reinforcement', 'Monthly', 'check', null, null, 'Advanced', false, null, 29 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'E-E-A-T / Trust Signal Enhancements', 'Monthly / As Prioritised', 'check', null, null, null, false, null, 30 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Answer / Extractability Optimisation', 'Monthly', 'check', null, null, 'Advanced', false, null, 31 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'AI Search + Entity Optimisation', 'AI Referral Traffic Monitoring', 'Monthly', 'check', null, null, 'Where measurable', false, null, 32 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Backlink Profile Monitoring', 'Monthly', 'check', null, null, null, false, null, 33 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Advanced Link Building', 'Monthly', 'check', null, null, 'Advanced', false, 'Focus on relevant, natural, authoritative links rather than quantity guarantees', 34 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Digital PR / Authority Outreach', 'Monthly / Campaign', 'check', null, null, 'Advanced', false, null, 35 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Brand Mention / Unlinked Mention Opportunities', 'Monthly', 'check', null, null, 'Advanced', false, null, 36 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Competitor Backlink Gap Opportunities', 'Monthly', 'check', null, null, 'Advanced', false, null, 37 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Industry Profile / Authority Placements', 'Monthly / As Available', 'check', null, null, 'Advanced', false, null, 38 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Major Authority Asset / Campaign', 'Monthly', 'count', 1, '1+ per month', null, false, 'Research, benchmark, pricing study, statistics hub, definitive guide or similar', 39 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Off-page SEO + Authority Building', 'Original Research / Data Content', 'As Prioritised', 'check', null, null, null, false, null, 40 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Technical SEO Monitoring', 'Monthly', 'check', null, null, null, false, null, 41 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Indexation / Crawl Error Monitoring', 'Monthly', 'check', null, null, null, false, null, 42 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Redirect / Canonical Monitoring', 'Monthly / As Needed', 'check', null, null, null, false, null, 43 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Technical + Performance', 'Site Speed + Core Web Vitals Review', 'Quarterly', 'check', null, null, null, false, null, 44 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Monthly SEO Performance Report', 'Monthly', 'check', null, null, null, false, null, 45 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Search Visibility Dashboard', 'Monthly / Live', 'check', null, null, null, false, null, 46 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Organic Traffic + Conversion Reporting', 'Monthly', 'check', null, null, null, false, null, 47 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Commercial Keyword Visibility', 'Monthly', 'check', null, null, null, false, null, 48 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'GBP / Local Performance Reporting', 'Monthly', 'check', null, null, null, false, null, 49 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'AI Visibility + Citation Reporting', 'Monthly', 'check', null, null, 'Advanced', false, null, 50 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Authority / Backlink Reporting', 'Monthly', 'check', null, null, 'Advanced', false, null, 51 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Work Completed + Next Priorities', 'Monthly', 'check', null, null, null, false, null, 52 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Quarterly 90-Day Strategy Reset', 'Quarterly', 'check', null, null, null, false, null, 53 from public.packages where name = 'Search Authority';
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, position) select id, 'Reporting + Strategy', 'Dedicated Account Manager', 'Ongoing', 'check', null, null, null, false, null, 54 from public.packages where name = 'Search Authority';
-- Types of Search Growth Action (What Counts As An Action tab).
insert into public.action_types (name, category, purpose, example, position) values ('New service / landing page', 'Commercial', 'Capture high-intent demand', 'Roof Replacement Austin', 1);
insert into public.action_types (name, category, purpose, example, position) values ('Money-page optimisation', 'Commercial', 'Improve existing revenue page', 'Rebuild primary service page', 2);
insert into public.action_types (name, category, purpose, example, position) values ('Authority content asset', 'Authority', 'Build topical authority / citations', 'Definitive industry guide', 3);
insert into public.action_types (name, category, purpose, example, position) values ('Content refresh', 'SEO', 'Recover / grow existing visibility', 'Update declining guide', 4);
insert into public.action_types (name, category, purpose, example, position) values ('Comparison page', 'Decision-stage', 'Capture buyers comparing options', 'Metal vs shingle roofing', 5);
insert into public.action_types (name, category, purpose, example, position) values ('Question / answer content', 'AI + SEO', 'Answer important customer queries', 'Cost / process question', 6);
insert into public.action_types (name, category, purpose, example, position) values ('Location page', 'Local', 'Expand relevant local visibility', 'Roofing Contractor Round Rock', 7);
insert into public.action_types (name, category, purpose, example, position) values ('Case study optimisation', 'Proof', 'Strengthen evidence and trust', 'Project/result case study', 8);
insert into public.action_types (name, category, purpose, example, position) values ('AI answer optimisation', 'AI Search', 'Improve retrievability / citeability', 'Restructure expert guide', 9);
insert into public.action_types (name, category, purpose, example, position) values ('Statistics / resource asset', 'Authority', 'Create source-worthy information', 'Industry statistics hub', 10);
