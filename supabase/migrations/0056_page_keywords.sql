-- Part 2 ("עמודי יעד וביטויי משנה"): secondary keywords attached to a page. The primary/target
-- keyword→page mapping lives in keyword_targets; this table holds the ADDITIONAL keywords the
-- team decides a page should also compete on. Consumed by the recommendations engine, the work
-- plan, content suggestions and the auto-blog so the page gets optimized for these too.
create table if not exists page_keywords (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  page_url text not null,
  keyword text not null,
  role text not null default 'secondary',   -- 'secondary'
  created_at timestamptz default now(),
  unique (client_id, page_url, keyword)
);
create index if not exists page_keywords_client_idx on page_keywords(client_id);
alter table page_keywords enable row level security;
create policy "page_keywords team access" on page_keywords
  for all using (is_team_member()) with check (is_team_member());

-- keyword_targets.status gains a 'parked' value ("שים כרגע בצד") — keywords set aside with no
-- page decision yet. No schema change needed (status is free text); documented here for clarity.
