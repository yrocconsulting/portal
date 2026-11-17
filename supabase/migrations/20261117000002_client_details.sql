-- Full client records (from the client sheet) and a place for client logins.

alter table public.clients
  add column address        text,
  add column industry       text,
  add column package        text,      -- "Services/Package" as written in the sheet
  add column payment_method text,
  add column drive_url      text,
  add column locations      text,
  add column start_date     date,
  add column links          jsonb not null default '{}';  -- gbp, facebook, youtube, linkedin, instagram, x, yelp, tiktok

-- Client logins (website, hosting, domain registrar, ...). Passwords are encrypted by the app with a key
-- that lives only in the server environment (CREDENTIALS_KEY), so the database alone never holds them in
-- readable form. Every reveal is recorded in credential_views.
create table public.client_credentials (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  kind          text not null default 'other' check (kind in ('website', 'hosting', 'registrar', 'google', 'social', 'other')),
  label         text,
  url           text,
  username      text,
  password_enc  text,          -- "v1:<iv>:<tag>:<ciphertext>" (AES-256-GCM, base64)
  notes         text,
  updated_by    uuid references public.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index client_credentials_client_idx on public.client_credentials (client_id);
create trigger client_credentials_touch before update on public.client_credentials for each row execute function public.touch_updated_at();

create table public.credential_views (
  id             bigint generated always as identity primary key,
  credential_id  uuid references public.client_credentials (id) on delete set null,
  client_id      uuid references public.clients (id) on delete cascade,
  staff_id       uuid references public.staff (id) on delete set null,
  action         text not null default 'reveal' check (action in ('reveal', 'create', 'update', 'delete')),
  created_at     timestamptz not null default now()
);
create index credential_views_client_idx on public.credential_views (client_id, created_at desc);

alter table public.client_credentials enable row level security;
alter table public.credential_views enable row level security;

create policy credentials_staff on public.client_credentials for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy credential_views_insert on public.credential_views for insert to authenticated
  with check (public.is_staff() and staff_id = auth.uid());
create policy credential_views_select on public.credential_views for select to authenticated
  using (public.is_staff());
