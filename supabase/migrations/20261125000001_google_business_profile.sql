-- Google Business Profile: performance, search terms and reviews for every profile the agency's
-- manager account can see. One OAuth connection (refresh token encrypted in the app with
-- CREDENTIALS_KEY, stored in app_settings 'gbp_oauth', admins only). Synced daily by the cron and on
-- demand by admins. Profiles are matched to clients by website domain, or set by an admin.

create table public.gbp_locations (
  name            text primary key,           -- "locations/123"
  account         text not null,              -- "accounts/456" (needed for reviews)
  title           text not null,
  website         text,
  domain          text,                       -- from website, for matching
  address         text,
  maps_uri        text,
  client_id       uuid references public.clients (id) on delete set null,
  matched_by      text check (matched_by in ('domain', 'admin')),
  average_rating  numeric(2, 1),
  review_count    int,
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz not null default now()
);
create index gbp_locations_client_idx on public.gbp_locations (client_id);

create table public.gbp_daily (
  location            text not null references public.gbp_locations (name) on delete cascade,
  date                date not null,
  views_search        int not null default 0,   -- profile views on Google Search (mobile + desktop)
  views_maps          int not null default 0,   -- profile views on Google Maps (mobile + desktop)
  calls               int not null default 0,
  website_clicks      int not null default 0,
  directions          int not null default 0,
  bookings            int not null default 0,
  messages            int not null default 0,   -- messaging clicks
  primary key (location, date)
);

create table public.gbp_keywords (
  location     text not null references public.gbp_locations (name) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  keyword      text not null,
  impressions  int not null default 0,
  below        boolean not null default false,  -- Google only says "fewer than N"
  primary key (location, month, keyword)
);

create table public.gbp_reviews (
  name          text primary key,              -- "accounts/../locations/../reviews/.."
  location      text not null references public.gbp_locations (name) on delete cascade,
  reviewer      text,
  rating        int check (rating between 1 and 5),
  comment       text,
  created_at    timestamptz not null,
  updated_at    timestamptz,
  reply         text,
  replied_at    timestamptz,
  first_seen_at timestamptz not null default now()
);
create index gbp_reviews_location_idx on public.gbp_reviews (location, created_at desc);

alter table public.gbp_locations enable row level security;
alter table public.gbp_daily enable row level security;
alter table public.gbp_keywords enable row level security;
alter table public.gbp_reviews enable row level security;
create policy gbp_locations_read on public.gbp_locations for select to authenticated using (public.is_staff());
create policy gbp_locations_admin on public.gbp_locations for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy gbp_daily_read on public.gbp_daily for select to authenticated using (public.is_staff());
create policy gbp_keywords_read on public.gbp_keywords for select to authenticated using (public.is_staff());
create policy gbp_reviews_read on public.gbp_reviews for select to authenticated using (public.is_staff());

-- Admins manage the connection setting (the sync itself uses the secret key).
create policy settings_admin_write_gbp on public.app_settings for all to authenticated
  using (public.is_admin() and key = 'gbp_oauth') with check (public.is_admin() and key = 'gbp_oauth');

-- Monthly reports: show the Business Profile section like Search Console (auto = only when it's up).
alter table public.monthly_reports
  add column gbp_display text not null default 'auto' check (gbp_display in ('auto', 'show', 'hide'));

-- New-review emails to the client's account manager and lead (their own switch, on by default).
alter table public.staff add column notify_new_review boolean not null default true;
alter table public.notifications alter column ticket_id drop not null;
alter table public.notifications add column review_name text references public.gbp_reviews (name) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('assigned', 'client_reply', 'new_review'));

create or replace function public.set_my_notification(p_kind text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'assigned' then
    update public.staff set notify_assigned = p_on where id = auth.uid() and active;
  elsif p_kind = 'client_reply' then
    update public.staff set notify_client_reply = p_on where id = auth.uid() and active;
  elsif p_kind = 'new_review' then
    update public.staff set notify_new_review = p_on where id = auth.uid() and active;
  else
    raise exception 'unknown notification kind';
  end if;
end $$;
