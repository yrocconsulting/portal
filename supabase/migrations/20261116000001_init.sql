-- Yroc Portal: staff, clients, contacts, tickets, comments, events, attachments, onboarding templates.
-- Every table has row level security. Only active staff can read or write anything.

-- ---------- Enums ----------
create type public.ticket_status as enum ('new', 'in_progress', 'waiting', 'review', 'done', 'closed');
create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.ticket_source as enum ('manual', 'email', 'onboarding', 'claude', 'report');
create type public.staff_role as enum ('admin', 'member');

-- ---------- Helpers ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Staff ----------
create table public.staff (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        public.staff_role not null default 'member',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Only invited email addresses become staff when they first sign in.
create table public.staff_invites (
  email       text primary key check (email = lower(email)),
  role        public.staff_role not null default 'member',
  invited_by  uuid references public.staff (id) on delete set null,
  created_at  timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and active and role = 'admin');
$$;

-- On sign up (or first Microsoft sign in): turn a matching invite into a staff row.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv public.staff_invites%rowtype;
begin
  select * into inv from public.staff_invites where email = lower(new.email);
  if found then
    insert into public.staff (id, email, full_name, role)
    values (
      new.id,
      lower(new.email),
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      inv.role
    )
    on conflict (id) do nothing;
    delete from public.staff_invites where email = inv.email;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets an invited person who already had an auth account (e.g. signed in before being invited) claim access.
create or replace function public.claim_invite() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u   auth.users%rowtype;
  inv public.staff_invites%rowtype;
begin
  select * into u from auth.users where id = auth.uid();
  if not found then return false; end if;
  select * into inv from public.staff_invites where email = lower(u.email);
  if not found then return false; end if;
  insert into public.staff (id, email, full_name, role)
  values (u.id, lower(u.email), coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'), inv.role)
  on conflict (id) do nothing;
  delete from public.staff_invites where email = inv.email;
  return true;
end $$;

-- ---------- Clients ----------
create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  domain       text unique check (domain is null or domain = lower(domain)),
  status       text not null default 'active' check (status in ('onboarding', 'active', 'paused', 'former')),
  white_label  boolean not null default false,
  partner      text,            -- agency partner for white-label clients
  services     text[] not null default '{}',
  city         text,
  phone        text,
  website      text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null,
  email       text check (email is null or email = lower(email)),
  phone       text,
  title       text,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now()
);
create index contacts_client_idx on public.contacts (client_id);
create index contacts_email_idx on public.contacts (email);

-- ---------- Tickets ----------
create table public.tickets (
  id           uuid primary key default gen_random_uuid(),
  number       bigint generated always as identity (start with 1001) unique,
  title        text not null check (length(trim(title)) > 0),
  description  text,
  client_id    uuid references public.clients (id) on delete set null,
  contact_id   uuid references public.contacts (id) on delete set null,
  status       public.ticket_status not null default 'new',
  priority     public.ticket_priority not null default 'normal',
  type         text not null default 'task' check (type in ('request', 'issue', 'task', 'onboarding', 'report')),
  source       public.ticket_source not null default 'manual',
  assignee_id  uuid references public.staff (id) on delete set null,
  created_by   uuid references public.staff (id) on delete set null,
  due_date     date,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index tickets_status_idx on public.tickets (status);
create index tickets_client_idx on public.tickets (client_id);
create index tickets_assignee_idx on public.tickets (assignee_id);
create trigger tickets_touch before update on public.tickets for each row execute function public.touch_updated_at();

create table public.ticket_comments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.tickets (id) on delete cascade,
  author_id    uuid references public.staff (id) on delete set null,
  author_kind  text not null default 'staff' check (author_kind in ('staff', 'email', 'claude', 'system')),
  author_name  text,            -- sender name for email comments
  body         text not null check (length(trim(body)) > 0),
  internal     boolean not null default true,
  created_at   timestamptz not null default now()
);
create index ticket_comments_ticket_idx on public.ticket_comments (ticket_id, created_at);

-- Audit trail: who changed what, written by trigger.
create table public.ticket_events (
  id          bigint generated always as identity primary key,
  ticket_id   uuid not null references public.tickets (id) on delete cascade,
  actor_id    uuid references public.staff (id) on delete set null,
  kind        text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

create or replace function public.log_ticket_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
begin
  if not exists (select 1 from public.staff where id = actor) then
    actor := null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, actor_id, kind, data)
    values (new.id, actor, 'created', jsonb_build_object('source', new.source));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.ticket_events (ticket_id, actor_id, kind, data)
    values (new.id, actor, 'status', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.ticket_events (ticket_id, actor_id, kind, data)
    values (new.id, actor, 'assignee', jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
  end if;
  if new.priority is distinct from old.priority then
    insert into public.ticket_events (ticket_id, actor_id, kind, data)
    values (new.id, actor, 'priority', jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.ticket_events (ticket_id, actor_id, kind, data)
    values (new.id, actor, 'due_date', jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;
  if new.client_id is distinct from old.client_id then
    insert into public.ticket_events (ticket_id, actor_id, kind, data)
    values (new.id, actor, 'client', jsonb_build_object('from', old.client_id, 'to', new.client_id));
  end if;
  return new;
end $$;

create trigger tickets_log_insert after insert on public.tickets for each row execute function public.log_ticket_changes();
create trigger tickets_log_update after update on public.tickets for each row execute function public.log_ticket_changes();

-- Keep resolved_at in step with status.
create or replace function public.ticket_resolved_at() returns trigger
language plpgsql as $$
begin
  if new.status in ('done', 'closed') and (tg_op = 'INSERT' or old.status not in ('done', 'closed')) then
    new.resolved_at := now();
  elsif new.status not in ('done', 'closed') then
    new.resolved_at := null;
  end if;
  return new;
end $$;
create trigger tickets_resolved before insert or update of status on public.tickets
  for each row execute function public.ticket_resolved_at();

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.tickets (id) on delete cascade,
  path          text not null unique,   -- object path in the private "attachments" bucket
  name          text not null,
  size          bigint,
  content_type  text,
  uploaded_by   uuid references public.staff (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index attachments_ticket_idx on public.attachments (ticket_id);

-- ---------- Onboarding templates ----------
create table public.onboarding_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  created_at   timestamptz not null default now()
);

create table public.onboarding_steps (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.onboarding_templates (id) on delete cascade,
  position     int not null default 0,
  title        text not null,
  description  text,
  due_offset_days int not null default 0 check (due_offset_days >= 0),
  priority     public.ticket_priority not null default 'normal'
);
create index onboarding_steps_template_idx on public.onboarding_steps (template_id, position);

-- Creates one ticket per step for a client. Returns how many were created.
create or replace function public.start_onboarding(p_client uuid, p_template uuid, p_assignee uuid default null)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  n int;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;
  insert into public.tickets (title, description, client_id, type, source, priority, assignee_id, created_by, due_date)
  select s.title, s.description, p_client, 'onboarding', 'onboarding', s.priority, p_assignee, auth.uid(),
         current_date + s.due_offset_days
  from public.onboarding_steps s
  where s.template_id = p_template
  order by s.position;
  get diagnostics n = row_count;
  update public.clients set status = 'onboarding' where id = p_client and status <> 'onboarding';
  return n;
end $$;

-- ---------- Row level security ----------
alter table public.staff enable row level security;
alter table public.staff_invites enable row level security;
alter table public.clients enable row level security;
alter table public.contacts enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_events enable row level security;
alter table public.attachments enable row level security;
alter table public.onboarding_templates enable row level security;
alter table public.onboarding_steps enable row level security;

-- Staff directory: any active staff can see the team; admins manage it; everyone may edit their own name.
create policy staff_select on public.staff for select to authenticated using (public.is_staff() or id = auth.uid());
create policy staff_admin on public.staff for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy invites_admin on public.staff_invites for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy clients_staff on public.clients for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy contacts_staff on public.contacts for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy tickets_staff on public.tickets for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy comments_select on public.ticket_comments for select to authenticated using (public.is_staff());
create policy comments_insert on public.ticket_comments for insert to authenticated
  with check (public.is_staff() and author_kind = 'staff' and author_id = auth.uid());
create policy comments_own on public.ticket_comments for update to authenticated
  using (public.is_staff() and author_id = auth.uid()) with check (public.is_staff() and author_id = auth.uid());
create policy comments_delete on public.ticket_comments for delete to authenticated
  using (public.is_admin() or (public.is_staff() and author_id = auth.uid()));
create policy events_select on public.ticket_events for select to authenticated using (public.is_staff());
create policy attachments_staff on public.attachments for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy templates_staff on public.onboarding_templates for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy steps_staff on public.onboarding_steps for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Staff can update their own display name only (role/active stay admin-controlled).
create or replace function public.update_my_name(p_name text) returns void
language sql security definer set search_path = public as $$
  update public.staff set full_name = nullif(trim(p_name), '') where id = auth.uid() and active;
$$;

revoke execute on function public.claim_invite() from anon;
revoke execute on function public.update_my_name(text) from anon;
revoke execute on function public.start_onboarding(uuid, uuid, uuid) from anon;

-- ---------- File storage ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;

create policy attachments_bucket_staff on storage.objects for all to authenticated
  using (bucket_id = 'attachments' and public.is_staff())
  with check (bucket_id = 'attachments' and public.is_staff());

-- ---------- Starter onboarding template ----------
with t as (
  insert into public.onboarding_templates (name, description)
  values ('AI Search Optimization onboarding', 'Standard kickoff checklist for a new AI search optimization client.')
  returning id
)
insert into public.onboarding_steps (template_id, position, title, description, due_offset_days, priority)
select t.id, s.pos, s.title, s.descr, s.days, s.prio::public.ticket_priority from t, (values
  (1, 'Kickoff call and access checklist', 'Schedule the kickoff call. Collect website, Google Business Profile, analytics and Search Console access.', 2, 'high'),
  (2, 'Add client to ProRankTracker', 'Set up the AI visibility tracking project and the buyer prompts agreed on the kickoff call.', 3, 'high'),
  (3, 'Baseline AI visibility audit', 'Record where the business appears today in ChatGPT, Gemini, Perplexity and Google AI Overviews.', 7, 'normal'),
  (4, 'Entity and NAP review', 'Check name, address and phone consistency across the web and the knowledge graph.', 10, 'normal'),
  (5, 'Schema and structured data plan', 'Plan Organization, LocalBusiness, Service and FAQ markup for the site.', 14, 'normal'),
  (6, 'Content plan for priority prompts', 'Map the top buyer prompts to pages that answer them.', 14, 'normal'),
  (7, '30-day check-in', 'Review first results with the client and adjust the plan.', 30, 'normal')
) as s(pos, title, descr, days, prio);
