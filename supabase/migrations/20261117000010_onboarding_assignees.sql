-- Who gets each onboarding step's ticket, and template renaming.

alter table public.onboarding_steps
  add column assign_to text not null default 'lead'
    check (assign_to in ('lead', 'account_manager', 'starter', 'staff', 'none')),
  add column assign_staff_id uuid references public.staff (id) on delete set null;

comment on column public.onboarding_steps.assign_to is
  'lead = the client''s lead, account_manager = the client''s account manager, starter = whoever starts onboarding, staff = assign_staff_id, none = unassigned';

-- The kickoff call is the account manager's job by default.
update public.onboarding_steps set assign_to = 'account_manager' where title ilike 'kickoff call%';

-- p_assignee set: every ticket goes to that person. Null: each step's own setting.
create or replace function public.start_onboarding(p_client uuid, p_template uuid, p_assignee uuid default null)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  n int;
  c record;
begin
  if not public.is_staff() then
    raise exception 'not allowed';
  end if;
  select lead_id, account_manager_id into c from public.clients where id = p_client;
  insert into public.tickets (title, description, client_id, type, source, priority, assignee_id, created_by, due_date)
  select s.title, s.description, p_client, 'onboarding', 'onboarding', s.priority,
         coalesce(
           p_assignee,
           case s.assign_to
             when 'lead' then c.lead_id
             when 'account_manager' then c.account_manager_id
             when 'starter' then auth.uid()
             when 'staff' then (select id from public.staff where id = s.assign_staff_id and active)
             else null
           end),
         auth.uid(),
         current_date + s.due_offset_days
  from public.onboarding_steps s
  where s.template_id = p_template
  order by s.position;
  get diagnostics n = row_count;
  update public.clients set status = 'onboarding' where id = p_client and status <> 'onboarding';
  return n;
end $$;
