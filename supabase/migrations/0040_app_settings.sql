-- Team-wide app settings (e.g. the customizable sidebar menu layout).
create table if not exists app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);
alter table app_settings enable row level security;
drop policy if exists "app_settings team access" on app_settings;
create policy "app_settings team access" on app_settings
  for all using (is_team_member()) with check (is_team_member());
