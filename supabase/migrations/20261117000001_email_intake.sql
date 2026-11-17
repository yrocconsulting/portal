-- Email intake: staff forward client emails to the helpdesk mailbox; the portal turns them into tickets.

-- Every message the portal has seen in the helpdesk mailbox (also prevents processing one twice).
create table public.email_messages (
  id                   uuid primary key default gen_random_uuid(),
  graph_id             text not null unique,     -- Microsoft Graph message id
  internet_message_id  text,
  mailbox              text not null,
  from_email           text,
  from_name            text,
  subject              text,
  body                 text,
  received_at          timestamptz,
  status               text not null default 'processing'
                       check (status in ('processing', 'ticket', 'comment', 'unmatched', 'dismissed', 'error')),
  ticket_id            uuid references public.tickets (id) on delete set null,
  staff_id             uuid references public.staff (id) on delete set null,   -- who forwarded it
  original_from_email  text,                     -- the client, parsed from the forwarded message
  original_from_name   text,
  attachment_count     int not null default 0,
  error                text,
  created_at           timestamptz not null default now()
);
create index email_messages_status_idx on public.email_messages (status, received_at desc);

alter table public.email_messages enable row level security;
create policy email_select on public.email_messages for select to authenticated using (public.is_staff());
create policy email_update on public.email_messages for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- Small key/value store for integration state (e.g. the Graph subscription). Server only.
create table public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy settings_admin_read on public.app_settings for select to authenticated using (public.is_admin());

-- History: when a ticket is created without a signed-in user (email intake), credit the creator.
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
    values (new.id, coalesce(actor, new.created_by), 'created', jsonb_build_object('source', new.source));
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

-- Staff can log a client's call or email on a ticket by hand: author_kind 'email' with themselves as author_id.
drop policy comments_insert on public.ticket_comments;
create policy comments_insert on public.ticket_comments for insert to authenticated
  with check (public.is_staff() and author_id = auth.uid() and author_kind in ('staff', 'email'));

-- Where a comment came from (for email-forwarded comments, the email record).
alter table public.ticket_comments add column email_message_id uuid references public.email_messages (id) on delete set null;
