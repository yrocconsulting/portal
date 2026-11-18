-- Reporting is the account manager's job, not a fulfillment deliverable: take the "Reporting + Strategy"
-- section out of the packages and out of months still in progress. Archived (complete) months keep it.
delete from public.package_items where section = 'Reporting + Strategy';

delete from public.report_items
 where section = 'Reporting + Strategy'
   and report_id in (select id from public.monthly_reports where status <> 'complete');
