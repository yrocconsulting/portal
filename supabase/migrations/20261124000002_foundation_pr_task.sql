-- Search Foundation clients get a press release each month too: copy the PR task from Search Growth
-- (same wording, definition of done and client-facing flag), and add it to Foundation months still in
-- progress. Archived months keep what they recorded.
insert into public.package_items (package_id, section, name, frequency, kind, target, target_label, level, optional, notes, done_when, client_facing, position)
select f.id, g.section, g.name, g.frequency, g.kind, g.target, g.target_label, g.level, g.optional, g.notes, g.done_when, g.client_facing, g.position
from public.package_items g
join public.packages gp on gp.id = g.package_id and gp.name = 'Search Growth'
cross join public.packages f
where f.name = 'Search Foundation'
  and g.name ilike '%distribute PR%'
  and not exists (select 1 from public.package_items x where x.package_id = f.id and x.name ilike '%distribute PR%');

insert into public.report_items (report_id, section, name, frequency, kind, target, target_label, level, optional, guidance, done_when, client_facing, position)
select r.id, pi.section, pi.name, pi.frequency, pi.kind, pi.target, pi.target_label, pi.level, pi.optional, pi.notes, pi.done_when, pi.client_facing, pi.position
from public.monthly_reports r
join public.packages f on f.id = r.package_id and f.name = 'Search Foundation'
join public.package_items pi on pi.package_id = f.id and pi.name ilike '%distribute PR%'
where r.status = 'in_progress'
  and not exists (select 1 from public.report_items x where x.report_id = r.id and x.name ilike '%distribute PR%');
