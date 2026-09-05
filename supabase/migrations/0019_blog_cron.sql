-- Weekly auto-blog: pg_cron fires pg_net → agents publish one article per connected
-- client. Secret read from Vault (no secret in this file). Extensions enabled in 0015.
select cron.schedule(
  'weekly-auto-blog',
  '0 8 * * 1',          -- Monday 08:00 UTC
  $$
  select net.http_post(
    url := 'https://dnweyiopirzwnbrqdhmg.supabase.co/functions/v1/blog-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
