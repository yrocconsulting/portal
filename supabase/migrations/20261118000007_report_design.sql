-- New client report design: each client's logo and brand color, screenshots, AI quotes from
-- ProRankTracker, a headline per month, per-prompt platform counts, and the Search Console rule.

-- Per-prompt appearances on each AI platform, from the weekly report: {"chatgpt": 8, "gemini": 2}.
alter table public.prt_prompt_results add column platform_counts jsonb not null default '{}';

-- Client branding for their report.
alter table public.clients
  add column logo_path   text,
  add column brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');

-- Per month: a headline for the top of the report (*asterisks* mark the highlighted words),
-- and whether Search Console shows: auto = only when clicks or impressions are up.
alter table public.monthly_reports
  add column hero_title  text,
  add column gsc_display text not null default 'auto' check (gsc_display in ('auto', 'show', 'hide'));

-- Images on client reports (logos and screenshots). Public read so a shared report can show them;
-- every path has a random part, so they can't be guessed. Only staff can add or remove them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-media', 'report-media', true, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do nothing;
create policy report_media_write on storage.objects for insert to authenticated with check (bucket_id = 'report-media' and public.is_staff());
create policy report_media_update on storage.objects for update to authenticated using (bucket_id = 'report-media' and public.is_staff());
create policy report_media_delete on storage.objects for delete to authenticated using (bucket_id = 'report-media' and public.is_staff());
create policy report_media_list on storage.objects for select to authenticated using (bucket_id = 'report-media' and public.is_staff());

create table public.report_media (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.monthly_reports (id) on delete cascade,
  kind        text not null check (kind in ('ai', 'gsc', 'pr', 'other')),
  path        text not null,
  caption     text,
  position    int not null default 0,
  created_by  uuid references public.staff (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index report_media_report_idx on public.report_media (report_id, position);

-- What AI said about the client, taken from ProRankTracker's answer text.
create table public.report_quotes (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.monthly_reports (id) on delete cascade,
  platform    text not null,
  prompt      text,
  quote       text not null,
  note        text,                          -- short line under the quote
  cited_urls  text[] not null default '{}',  -- the client's pages the answer cited
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index report_quotes_report_idx on public.report_quotes (report_id, position);

alter table public.report_media enable row level security;
alter table public.report_quotes enable row level security;
create policy report_media_staff on public.report_media for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy report_quotes_staff on public.report_quotes for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Editing either one changes what the client report would show.
create or replace function public.touch_report_content() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.monthly_reports set content_changed_at = now() where id = coalesce(new.report_id, old.report_id);
  return coalesce(new, old);
end $$;
create trigger report_media_content after insert or update or delete on public.report_media for each row execute function public.touch_report_content();
create trigger report_quotes_content after insert or update or delete on public.report_quotes for each row execute function public.touch_report_content();
