-- Team-wide custom names for link types (shown in the "סוג קישור" picker).
create table if not exists link_type_presets (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz default now()
);
alter table link_type_presets enable row level security;
drop policy if exists "link_type_presets team access" on link_type_presets;
create policy "link_type_presets team access" on link_type_presets
  for all using (is_team_member()) with check (is_team_member());
