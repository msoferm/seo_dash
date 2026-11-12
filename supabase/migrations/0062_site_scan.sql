-- "סרוק את כל דפי האתר" (upload tab): the full text of every page, so AI analyses (structure,
-- user intent, chat) read what is actually written — plus a log of each scan run and its issues.
alter table pages add column if not exists content_text text;
alter table pages add column if not exists text_scanned_at timestamptz;
alter table pages add column if not exists scan_error text;

create table if not exists site_scans (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  status text not null default 'running',  -- running | done | failed
  method text,                              -- wordpress | sitemap
  started_at timestamptz default now(),
  finished_at timestamptz,
  pages_total int default 0,
  pages_ok int default 0,
  pages_failed int default 0,
  pages jsonb not null default '[]',        -- [{url, title, words, ok, issue}]
  error text
);
create index if not exists site_scans_client_idx on site_scans(client_id, started_at desc);
alter table site_scans enable row level security;
create policy "site_scans team access" on site_scans
  for all using (is_team_member()) with check (is_team_member());
