-- Accurate daily GSC totals (organic web search), one row per client+date.
-- The old gsc_daily VIEW summed the query/page-level gsc_metrics table, which is
-- capped at ~1000 rows AND excludes GSC's anonymized queries — so its totals badly
-- undercount real clicks/impressions. This table is populated from a date-only GSC
-- query (dimensions=["date"]), which returns GSC's authoritative daily totals.
create table if not exists gsc_daily_totals (
  client_id bigint not null references clients on delete cascade,
  date date not null,
  clicks int default 0,
  impressions int default 0,
  position numeric default 0,
  primary key (client_id, date)
);
create index if not exists gsc_daily_totals_idx on gsc_daily_totals(client_id, date);

alter table gsc_daily_totals enable row level security;
drop policy if exists "gsc_daily_totals team access" on gsc_daily_totals;
create policy "gsc_daily_totals team access" on gsc_daily_totals
  for all using (is_team_member()) with check (is_team_member());
