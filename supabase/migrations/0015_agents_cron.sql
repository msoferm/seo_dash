-- Weekly automatic run of the link-prospecting agent (server-side, computer-off).
-- pg_cron fires pg_net, which POSTs to the agents-cron edge function with a secret
-- read from Vault (so no secret lives in this file).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every Monday 06:00 UTC
select cron.schedule(
  'weekly-link-prospecting',
  '0 6 * * 1',
  $$
  select net.http_post(
    url := 'https://dnweyiopirzwnbrqdhmg.supabase.co/functions/v1/agents-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
