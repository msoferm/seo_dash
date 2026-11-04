-- Tab "מילים ללא עמוד" (keywords without a dedicated page): the manual "נכתב" marks.
-- A keyword is marked done when the team wrote/updated a page for it. The mark is MANUAL —
-- it is NOT an automatic confirmation that a page was published or verified. It persists
-- across refreshes and further imports, and can be reverted. An optional written_url records
-- which page was written or updated.
create table if not exists kw_written (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  keyword text not null,
  written_url text,
  created_at timestamptz default now(),
  unique (client_id, keyword)
);
create index if not exists kw_written_client_idx on kw_written(client_id);
alter table kw_written enable row level security;
drop policy if exists "kw_written team access" on kw_written;
create policy "kw_written team access" on kw_written
  for all using (is_team_member()) with check (is_team_member());
