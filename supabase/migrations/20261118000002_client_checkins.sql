-- Gentle check-in reminders for account managers.
-- A client is "due" when nothing counts as contact for checkin_days. The dashboard shows each account
-- manager at most one reminder, at most once a day. Thumbs up records a check-in; thumbs down snoozes 3 days.

alter table public.clients add column checkin_days int default 30 check (checkin_days is null or checkin_days between 1 and 365);
comment on column public.clients.checkin_days is 'Remind the account manager to check in after this many days without contact. Null = off.';

create table public.client_touchpoints (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.clients (id) on delete cascade,
  staff_id    uuid references public.staff (id) on delete set null,
  kind        text not null check (kind in ('checkin', 'snooze', 'email', 'logged')),
  via_nudge   boolean not null default false,   -- answered from the dashboard reminder
  until       date,                             -- for snoozes: remind again on or after this date
  created_at  timestamptz not null default now()
);
create index client_touchpoints_client_idx on public.client_touchpoints (client_id, created_at desc);
create index client_touchpoints_staff_idx on public.client_touchpoints (staff_id, created_at desc);

alter table public.client_touchpoints enable row level security;
create policy touchpoints_select on public.client_touchpoints for select to authenticated using (public.is_staff());
create policy touchpoints_insert on public.client_touchpoints for insert to authenticated
  with check (public.is_staff() and staff_id = auth.uid() and kind in ('checkin', 'snooze'));

-- Client communication on tickets counts as contact: forwarded client emails and logged calls/emails.
create or replace function public.touch_from_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if new.author_kind = 'email' then
    select client_id into cid from public.tickets where id = new.ticket_id;
    if cid is not null then
      insert into public.client_touchpoints (client_id, staff_id, kind)
      values (cid, new.author_id, case when new.email_message_id is null then 'logged' else 'email' end);
    end if;
  end if;
  return new;
end $$;
create trigger ticket_comments_contact_touch after insert on public.ticket_comments
  for each row execute function public.touch_from_comment();

create or replace function public.touch_from_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'email' and new.client_id is not null then
    insert into public.client_touchpoints (client_id, staff_id, kind) values (new.client_id, new.created_by, 'email');
  end if;
  return new;
end $$;
create trigger tickets_contact_touch after insert on public.tickets
  for each row execute function public.touch_from_ticket();
