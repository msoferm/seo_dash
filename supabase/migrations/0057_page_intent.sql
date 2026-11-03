-- Part 3 ("כוונת המשתמש"): the saved user-intent + page analysis per page. One row per
-- client+page. Produced by the page-intent edge function (AI) and edited by the team; read by
-- the work plan, recommendations and the auto-blog so the strategy honors the analysis.
create table if not exists page_intent (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  page_url text not null,
  intent_analysis text,          -- (1) who the user is + what they need, across the chosen keywords
  page_analysis text,            -- (2) analysis of the existing live page
  conclusions text,              -- editable text block: combined conclusions + opportunities (team-editable)
  quality_score int,             -- 1-10, how well the page serves the intent
  primary_keywords text[],       -- snapshot of the page's target keyword(s) at save time
  secondary_keywords text[],     -- snapshot of the page's secondary keywords at save time
  saved_summary text,            -- (4) the compact saved summary of everything
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (client_id, page_url)
);
create index if not exists page_intent_client_idx on page_intent(client_id);
alter table page_intent enable row level security;
create policy "page_intent team access" on page_intent
  for all using (is_team_member()) with check (is_team_member());
