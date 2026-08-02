-- Monthly SEO reports per client.
-- Metrics (rankings, clicks, conversions) are pulled live from existing tables when a
-- report is viewed; only the manual link-building log and the editable narrative persist.

-- Manual link-building log — feeds the "קישורים שבוצעו" section of the report.
-- Each row is one external link the team built for the client (like page 3 of the sample PDF).
create table if not exists report_links (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  link_type text not null,                 -- e.g. 'אינדקס עסקים', 'פוסט בבלוג', 'מאמר ממומן'
  url text not null,
  notes text,
  done_on date not null default current_date,
  created_at timestamptz default now()
);
create index if not exists report_links_client_idx on report_links(client_id, done_on desc);

alter table report_links enable row level security;
drop policy if exists "report_links team access" on report_links;
create policy "report_links team access" on report_links
  for all using (is_team_member()) with check (is_team_member());

-- Saved report = a period + the editable narrative text (Claude-drafted, then edited).
-- The numbers themselves are re-pulled live for period_from..period_to on view.
create table if not exists reports (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  title text,
  period_from date not null,
  period_to date not null,
  summary_text text,             -- "סיכום פעילות" (Claude draft, editable)
  recommendations_text text,     -- "המלצות להמשך" (Claude draft, editable)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists reports_client_idx on reports(client_id, period_to desc);

alter table reports enable row level security;
drop policy if exists "reports team access" on reports;
create policy "reports team access" on reports
  for all using (is_team_member()) with check (is_team_member());

drop trigger if exists reports_updated on reports;
create trigger reports_updated
  before update on reports
  for each row execute function trg_set_updated_at();
