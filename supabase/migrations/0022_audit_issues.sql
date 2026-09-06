-- Persisted audit findings so results survive a refresh; each issue keeps its status
-- until the user acts on it (apply / apply-with-change / reject).
create table if not exists audit_issues (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  page text not null,
  issue text not null,
  fix text,
  severity text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  applied_note text,
  created_at timestamptz default now()
);
create index if not exists audit_issues_client_idx on audit_issues(client_id, created_at desc);

alter table audit_issues enable row level security;
drop policy if exists "audit_issues team access" on audit_issues;
create policy "audit_issues team access" on audit_issues
  for all using (is_team_member()) with check (is_team_member());
