-- Every client hears from us at least monthly through their report, so publishing a client report
-- counts as contact. The default reminder moves to 45 days: a normal monthly report never sets it off,
-- a skipped month or a client going quiet does.

alter table public.client_touchpoints drop constraint client_touchpoints_kind_check;
alter table public.client_touchpoints add constraint client_touchpoints_kind_check
  check (kind in ('checkin', 'snooze', 'email', 'logged', 'report'));

create or replace function public.touch_from_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.published_at is not null and new.published_at is distinct from old.published_at then
    insert into public.client_touchpoints (client_id, staff_id, kind, created_at)
      values (new.client_id, new.published_by, 'report', new.published_at);
  end if;
  return new;
end $$;

create trigger monthly_reports_contact_touch after update of published_at on public.monthly_reports
  for each row execute function public.touch_from_report();

-- Reports already published count too.
insert into public.client_touchpoints (client_id, staff_id, kind, created_at)
  select client_id, published_by, 'report', published_at from public.monthly_reports where published_at is not null;

alter table public.clients alter column checkin_days set default 45;
update public.clients set checkin_days = 45 where checkin_days = 30;
