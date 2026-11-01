-- #4a: user-controlled month folders for the blog history. Each folder has a name the user
-- chooses (renameable), a date range, and can be deleted. Every article whose created_at falls
-- inside a folder's [date_from, date_to] range is shown ONLY inside that folder.
-- Articles outside every range fall into an "ללא תיקייה" (unfiled) bucket in the UI.
create table if not exists blog_folders (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  name text not null,
  date_from date,
  date_to date,
  created_at timestamptz default now()
);
create index if not exists blog_folders_client_idx on blog_folders(client_id);
alter table blog_folders enable row level security;
create policy "blog_folders team access" on blog_folders
  for all using (is_team_member()) with check (is_team_member());
