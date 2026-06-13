-- ZEFO site linkage per client (one-to-one)
alter table clients add column if not exists zefo_site_id bigint;

-- ZEFO keywords (rank tracking)
create table if not exists zefo_keywords (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  zefo_keyword_id bigint not null,
  keyword text not null,
  engine text,
  is_mobile boolean default false,
  country_code text,
  linked_page text,
  rank_page text,
  ranking int,
  previous_ranking int,
  initial_ranking int,
  initial_ranking_date date,
  best_rank int,
  best_rank_date date,
  local_searches int,
  global_searches int,
  difficulty int,
  num_results int,
  cannibalization int default 0,
  rich_results jsonb,
  monthly_history jsonb,
  last_synced timestamptz default now(),
  unique (client_id, zefo_keyword_id)
);
create index if not exists zefo_keywords_client_idx on zefo_keywords(client_id);
create index if not exists zefo_keywords_ranking_idx on zefo_keywords(client_id, ranking);

alter table zefo_keywords enable row level security;
create policy "zefo_keywords team access" on zefo_keywords
  for all using (is_team_member()) with check (is_team_member());

-- GA4 metrics — daily organic traffic per page
create table if not exists ga4_metrics (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  date date not null,
  page_path text,
  sessions int default 0,
  total_users int default 0,
  engaged_sessions int default 0,
  conversions int default 0,
  session_source text,
  session_medium text
);
create index if not exists ga4_metrics_client_date_idx on ga4_metrics(client_id, date);
create index if not exists ga4_metrics_page_idx on ga4_metrics(client_id, page_path);

alter table ga4_metrics enable row level security;
create policy "ga4_metrics team access" on ga4_metrics
  for all using (is_team_member()) with check (is_team_member());

-- Daily GSC totals view — for time-series charts
create or replace view gsc_daily as
select client_id, date,
       sum(clicks) as clicks,
       sum(impressions) as impressions,
       avg(position) as avg_position
from gsc_metrics
where date is not null and date <> ''
group by client_id, date;

-- Ranking distribution view — for "how many keywords in top 3 / top 10 / etc"
create or replace view zefo_rank_buckets as
select client_id,
       count(*) filter (where ranking between 1 and 3) as top3,
       count(*) filter (where ranking between 4 and 10) as top10,
       count(*) filter (where ranking between 11 and 30) as top30,
       count(*) filter (where ranking between 31 and 100) as top100,
       count(*) filter (where ranking is null or ranking <= 0 or ranking > 100) as unranked,
       count(*) as total
from zefo_keywords
group by client_id;
