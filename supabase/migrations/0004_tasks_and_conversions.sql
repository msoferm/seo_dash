-- Tasks board: tasks per client (from Claude suggestions, uploaded files, or manual entry)
create table if not exists tasks (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  title text not null,
  details text,
  status text not null default 'open',    -- 'open' | 'done'
  source text not null default 'manual',  -- 'manual' | 'claude' | 'upload'
  priority text,                           -- 'high' | 'medium' | 'low' | null
  sort_order int default 0,
  created_at timestamptz default now(),
  done_at timestamptz
);
create index if not exists tasks_client_idx on tasks(client_id, status, sort_order);

alter table tasks enable row level security;
drop policy if exists "tasks team access" on tasks;
create policy "tasks team access" on tasks
  for all using (is_team_member()) with check (is_team_member());

-- GA4 conversions aggregated by channel + source (ALL channels) for the overview.
-- Separate from ga4_metrics (which stays organic-only for the traffic chart).
create table if not exists ga4_conversions (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  channel text,
  source text,
  conversions numeric default 0,
  sessions int default 0,
  last_synced timestamptz default now()
);
create index if not exists ga4_conversions_client_idx on ga4_conversions(client_id);

alter table ga4_conversions enable row level security;
drop policy if exists "ga4_conversions team access" on ga4_conversions;
create policy "ga4_conversions team access" on ga4_conversions
  for all using (is_team_member()) with check (is_team_member());
