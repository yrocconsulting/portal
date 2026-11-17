-- Client-facing monthly reports: a snapshot taken when the team publishes, shown at a secret link.
-- The snapshot holds only client-safe content (no internal notes, staff names, prices or unfinished items).

alter table public.monthly_reports
  add column client_note        text,          -- optional message to the client, shown under the headline
  add column share_token        text unique,   -- secret link; null = not shared (or switched off)
  add column published_snapshot jsonb,
  add column published_at       timestamptz,
  add column published_by       uuid references public.staff (id) on delete set null,
  add column share_views        int not null default 0,
  add column share_last_viewed  timestamptz,
  add column content_changed_at timestamptz;   -- last edit to anything the client report shows

-- The only way the public can read anything: a valid token returns that report's published snapshot.
create or replace function public.get_shared_report(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  snap jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  update public.monthly_reports
     set share_views = share_views + 1, share_last_viewed = now()
   where share_token = p_token and published_snapshot is not null
  returning published_snapshot into snap;
  return snap;
end $$;

revoke all on function public.get_shared_report(text) from public;
grant execute on function public.get_shared_report(text) to anon, authenticated;
