-- Suggestions board: add a workflow status + threaded comments.

-- Status: פתוח (open) / בטיפול (in_progress) / בוצע (done)
alter table suggestions add column if not exists status text not null default 'open'
  check (status in ('open', 'in_progress', 'done'));
alter table suggestions add column if not exists done_at timestamptz;

-- Threaded replies on a suggestion
create table if not exists suggestion_comments (
  id bigserial primary key,
  suggestion_id bigint not null references suggestions on delete cascade,
  author text not null,                 -- 'moshe' | 'mordechai'
  body text not null,
  created_at timestamptz default now()
);
create index if not exists suggestion_comments_idx on suggestion_comments(suggestion_id, created_at);

alter table suggestion_comments enable row level security;
drop policy if exists "suggestion_comments team access" on suggestion_comments;
create policy "suggestion_comments team access" on suggestion_comments
  for all using (is_team_member()) with check (is_team_member());
