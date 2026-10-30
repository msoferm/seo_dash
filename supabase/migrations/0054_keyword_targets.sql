-- #3: "אופטימיזציית מבנה ומילות מפתח" — the single source of truth for which page should
-- own which keyword. Other tabs (recommendations engine, content suggestions, work plan)
-- read this to respect the team's strategic focus and fight cannibalization.
--   page_url null + intent 'new_page' => the keyword should get a NEW dedicated page.
--   page_url set  + intent 'strengthen' => strengthen that existing page for the keyword.
create table if not exists keyword_targets (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  keyword text not null,
  page_url text,
  is_primary boolean not null default true,
  intent text not null default 'strengthen',   -- 'strengthen' | 'new_page'
  status text not null default 'active',        -- 'active' | 'done'
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (client_id, keyword)
);
create index if not exists keyword_targets_client_idx on keyword_targets(client_id);
alter table keyword_targets enable row level security;
create policy "keyword_targets team access" on keyword_targets
  for all using (is_team_member()) with check (is_team_member());
