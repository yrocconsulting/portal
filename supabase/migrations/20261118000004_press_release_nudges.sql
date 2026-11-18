-- Press release reminders for leads. Every AI optimization client gets one press release a month,
-- tracked by the "Digital PR / Authority Outreach" item on their monthly report. From the 16th, if that
-- item has nothing on it yet, the client's lead gets a gentle reminder on their dashboard (one at a time,
-- at most once a day, shared with the check-in reminders). Answers are kept here.

create table public.nudge_answers (
  id          bigint generated always as identity primary key,
  staff_id    uuid not null references public.staff (id) on delete cascade default auth.uid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  kind        text not null check (kind in ('press_release')),
  answer      text not null check (answer in ('yes', 'no')),
  month       date not null,                    -- the report month it was about
  until       date,                             -- for "not yet": ask again on or after this date
  created_at  timestamptz not null default now()
);
create index nudge_answers_staff_idx on public.nudge_answers (staff_id, created_at desc);

alter table public.nudge_answers enable row level security;
create policy nudge_answers_select on public.nudge_answers for select to authenticated using (public.is_staff());
create policy nudge_answers_insert on public.nudge_answers for insert to authenticated
  with check (public.is_staff() and staff_id = auth.uid());
