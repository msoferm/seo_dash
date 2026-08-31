-- Weekly auto-run disabled at the user's request (cost control). The agents-cron
-- function and its secret remain, so it can be run manually or re-scheduled later.
select cron.unschedule('weekly-link-prospecting')
where exists (select 1 from cron.job where jobname = 'weekly-link-prospecting');
