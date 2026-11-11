-- Structure tab "ניתוח AI כולל": the latest AI analysis (recommendations) per client, and the
-- decisions the team accepted from it. A decision applies keyword→page targets (keyword_targets),
-- creates work-plan tasks, and keeps a snapshot of the previous targets so it can be undone.
create table if not exists structure_ai_analysis (
  client_id bigint primary key references clients on delete cascade,
  recs jsonb not null default '[]',
  date_from text,
  date_to text,
  created_at timestamptz default now()
);
alter table structure_ai_analysis enable row level security;
create policy "structure_ai_analysis team access" on structure_ai_analysis
  for all using (is_team_member()) with check (is_team_member());

create table if not exists structure_decisions (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  rec_key text,                 -- id of the AI recommendation it came from
  rec_type text,                -- same_intent | cannibalization | unassigned | new_page
  title text not null,
  explanation text,             -- why (from the AI)
  keywords text[] not null default '{}',
  pages text[] not null default '{}',
  actions jsonb not null default '[]',   -- applied [{keyword, page_url|null, intent}]
  accept_mode text not null default 'full', -- full | partial | note
  note text,
  color int not null default 0,
  prev_targets jsonb not null default '[]', -- keyword_targets rows (or {keyword, missing:true}) before applying
  task_ids bigint[] not null default '{}',
  created_at timestamptz default now()
);
create index if not exists structure_decisions_client_idx on structure_decisions(client_id);
alter table structure_decisions enable row level security;
create policy "structure_decisions team access" on structure_decisions
  for all using (is_team_member()) with check (is_team_member());
