-- Unified recommendation engine: one filterable list across all opportunity types,
-- with scoring, estimated new visits, effort, and per-item actions.
create table if not exists recommendations (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  type text not null,               -- title_meta | improve_page | add_keywords | new_content | cannibalization | internal_link | performance_drop | technical
  source text,                      -- gsc | ga4 | zefo | crawl | mixed
  page text,
  keyword text,
  title text not null,              -- short label
  opportunity text,                 -- why (data-based)
  whats_missing text,               -- what's missing in the page
  action text,                      -- recommended action
  potential text default 'medium',  -- high | medium | low
  est_visits int default 0,         -- estimated new monthly visits
  effort text default 'medium',     -- low | medium | high
  confidence text default 'medium',
  score numeric default 0,
  status text not null default 'pending' check (status in ('pending', 'applied', 'ignored', 'done')),
  example text,                     -- on-demand generated draft
  applied_note text,
  applied_at timestamptz,
  dedupe_key text,                  -- type|page|keyword — avoid duplicate pendings
  created_at timestamptz default now()
);
create index if not exists recommendations_client_idx on recommendations(client_id, status, score desc);
create index if not exists recommendations_dedupe_idx on recommendations(client_id, dedupe_key);

alter table recommendations enable row level security;
drop policy if exists "recommendations team access" on recommendations;
create policy "recommendations team access" on recommendations
  for all using (is_team_member()) with check (is_team_member());
