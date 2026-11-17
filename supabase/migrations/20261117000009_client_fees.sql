-- What each client pays per month, its change history, and the expected monthly total over time.

alter table public.clients add column monthly_fee numeric(10, 2) check (monthly_fee is null or monthly_fee >= 0);
comment on column public.clients.package is 'Original free-text package/pricing note from the client sheet (kept for reference).';

-- Start from the dollar amounts already written in the old text field, e.g. "AIO - $3000", "$1,500/mo".
update public.clients
   set monthly_fee = (regexp_match(replace(package, ',', ''), '\$\s*([0-9]+(\.[0-9]+)?)'))[1]::numeric
 where monthly_fee is null and package ~ '\$\s*[0-9]';

-- Every fee change, for reference ("when did they go from $2,500 to $3,750?").
create table public.client_fee_history (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.clients (id) on delete cascade,
  old_fee     numeric(10, 2),
  new_fee     numeric(10, 2),
  changed_by  uuid references public.staff (id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index client_fee_history_client_idx on public.client_fee_history (client_id, changed_at desc);

create or replace function public.log_fee_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.monthly_fee is not null then
      insert into public.client_fee_history (client_id, old_fee, new_fee, changed_by)
      values (new.id, null, new.monthly_fee, (select id from public.staff where id = auth.uid()));
    end if;
  elsif new.monthly_fee is distinct from old.monthly_fee then
    insert into public.client_fee_history (client_id, old_fee, new_fee, changed_by)
    values (new.id, old.monthly_fee, new.monthly_fee, (select id from public.staff where id = auth.uid()));
  end if;
  return new;
end $$;
create trigger clients_fee_log after insert or update of monthly_fee on public.clients
  for each row execute function public.log_fee_change();

-- Record today's fees as history for clients that already have one.
insert into public.client_fee_history (client_id, old_fee, new_fee)
select id, null, monthly_fee from public.clients where monthly_fee is not null;

-- Expected monthly total, saved per month (updated daily and whenever the Revenue page is opened).
create table public.revenue_months (
  month        date primary key check (extract(day from month) = 1),
  expected     numeric(12, 2) not null default 0,
  paying       int not null default 0,     -- clients with a fee
  missing_fee  int not null default 0,     -- active clients without a fee yet
  updated_at   timestamptz not null default now()
);

create or replace function public.snapshot_revenue() returns void
language sql security definer set search_path = public as $$
  insert into public.revenue_months (month, expected, paying, missing_fee, updated_at)
  select date_trunc('month', now() at time zone 'America/Chicago')::date,
         coalesce(sum(monthly_fee), 0),
         count(*) filter (where monthly_fee is not null),
         count(*) filter (where monthly_fee is null),
         now()
    from public.clients
   where status in ('onboarding', 'active')
  on conflict (month) do update
     set expected = excluded.expected, paying = excluded.paying, missing_fee = excluded.missing_fee, updated_at = now();
$$;
revoke all on function public.snapshot_revenue() from public, anon;
grant execute on function public.snapshot_revenue() to authenticated, service_role;
select public.snapshot_revenue();

alter table public.client_fee_history enable row level security;
alter table public.revenue_months enable row level security;
create policy fee_history_admin on public.client_fee_history for select to authenticated using (public.is_admin());
create policy revenue_admin on public.revenue_months for select to authenticated using (public.is_admin());
