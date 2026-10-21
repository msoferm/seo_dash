-- "פעולות שבוצעו" inside a report: each completed action (from any tab) with a
-- client-facing title + why/how-it-contributes + a link to the specific page.
create table if not exists report_items (
  id bigserial primary key,
  report_id bigint not null references reports on delete cascade,
  client_id bigint not null references clients on delete cascade,
  title text not null,
  why text,                       -- client-facing: why it was done and how it contributes
  page_url text,
  source_type text,               -- recommendation | audit | task | manual
  source_ref text,                -- id / key, for dedupe when re-syncing
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists report_items_report_idx on report_items(report_id, sort_order);
create unique index if not exists report_items_dedupe_uq on report_items(report_id, source_type, source_ref)
  where source_ref is not null;

alter table report_items enable row level security;
drop policy if exists "report_items team access" on report_items;
create policy "report_items team access" on report_items
  for all using (is_team_member()) with check (is_team_member());

drop trigger if exists report_items_updated on report_items;
create trigger report_items_updated before update on report_items
  for each row execute function trg_set_updated_at();
