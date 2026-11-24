-- Email notifications to staff (never clients): a ticket assigned to you, and a client reply on a
-- ticket assigned to you. Filled by triggers so every path counts (ticket form, reassignment, forwarded
-- email, onboarding checklist, Claude drafts); the app sends the queue right after each action, and the
-- daily cron catches up. Nobody is emailed about something they did themselves.

-- One switch per email type, each person sets their own. New-ticket emails start on for everyone.
alter table public.staff
  add column notify_assigned     boolean not null default true,
  add column notify_client_reply boolean not null default true;

create table public.notifications (
  id          bigint generated always as identity primary key,
  staff_id    uuid not null references public.staff (id) on delete cascade,
  ticket_id   uuid not null references public.tickets (id) on delete cascade,
  kind        text not null check (kind in ('assigned', 'client_reply')),
  actor_id    uuid references public.staff (id) on delete set null,
  comment_id  uuid references public.ticket_comments (id) on delete cascade,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);
create index notifications_pending_idx on public.notifications (created_at) where sent_at is null;

-- Internal to the team; the queue is written only by the triggers below.
alter table public.notifications enable row level security;
create policy notifications_staff_read on public.notifications for select to authenticated using (public.is_staff());
create policy notifications_staff_mark on public.notifications for update to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.queue_assignment_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
begin
  if new.assignee_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;
  if not exists (select 1 from public.staff where id = actor) then
    actor := new.created_by;   -- machine paths (email intake) act for the person who forwarded it
  end if;
  if actor is distinct from new.assignee_id then
    insert into public.notifications (staff_id, ticket_id, kind, actor_id) values (new.assignee_id, new.id, 'assigned', actor);
  end if;
  return new;
end $$;
create trigger tickets_notify_assigned after insert or update of assignee_id on public.tickets
  for each row execute function public.queue_assignment_notice();

create or replace function public.queue_client_reply_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  assignee uuid;
begin
  if new.author_kind <> 'email' then
    return new;
  end if;
  select assignee_id into assignee from public.tickets where id = new.ticket_id;
  if assignee is not null and assignee is distinct from new.author_id then
    insert into public.notifications (staff_id, ticket_id, kind, actor_id, comment_id) values (assignee, new.ticket_id, 'client_reply', new.author_id, new.id);
  end if;
  return new;
end $$;
create trigger ticket_comments_notify_client after insert on public.ticket_comments
  for each row execute function public.queue_client_reply_notice();

-- People turn each kind of email on or off for themselves (profile page).
create or replace function public.set_my_notification(p_kind text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'assigned' then
    update public.staff set notify_assigned = p_on where id = auth.uid() and active;
  elsif p_kind = 'client_reply' then
    update public.staff set notify_client_reply = p_on where id = auth.uid() and active;
  else
    raise exception 'unknown notification kind';
  end if;
end $$;
revoke execute on function public.set_my_notification(text, boolean) from anon;
