-- Per-client branding for reports: logo + accent color (kept separate from the clients
-- table so the clients list query stays light).
create table if not exists client_branding (
  client_id bigint primary key references clients on delete cascade,
  logo_url text,          -- data URL or external URL
  brand_color text,       -- hex, e.g. #1d4ed8
  updated_at timestamptz default now()
);
alter table client_branding enable row level security;
drop policy if exists "client_branding team access" on client_branding;
create policy "client_branding team access" on client_branding
  for all using (is_team_member()) with check (is_team_member());
