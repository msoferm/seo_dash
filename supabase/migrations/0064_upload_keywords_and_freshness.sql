-- Uploaded files: keyword count, the period the file covers (chosen by the user), what was new
-- in it, and the original file in storage (download / view again).
alter table uploaded_datasets
  add column if not exists kw_count int,
  add column if not exists new_keywords text[],
  add column if not exists new_pages text[],
  add column if not exists period_label text,
  add column if not exists storage_path text;

-- The keyword a row contributes: GSC/GA4 "query"; other tools' "keyword" column (in GSC/GA4
-- exports a "keyword"-mapped column is a dimension like device, not a search term).
create or replace function public.uploaded_row_kw(p_query text, p_keyword text, p_source text)
returns text language sql immutable set search_path = '' as $$
  select nullif(trim(coalesce(
    nullif(trim(p_query), ''),
    case when coalesce(p_source, '') ilike '%search console%' or coalesce(p_source, '') ilike '%analytics%' then null else p_keyword end
  )), '')
$$;

update uploaded_datasets d set kw_count = (
  select count(distinct lower(public.uploaded_row_kw(r.query, r.keyword, d.source))) from uploaded_rows r where r.dataset_id = d.id
) where kw_count is null;

-- Every keyword from every uploaded file of a client (max across files, so re-uploading the
-- same export doesn't double the numbers).
create or replace function public.uploaded_keywords(p_client_id bigint)
returns table (term text, impressions numeric, clicks numeric, "position" numeric, files text[], first_uploaded timestamptz)
language sql stable set search_path = '' as $$
  with k as (
    select public.uploaded_row_kw(r.query, r.keyword, d.source) as term, r.impressions, r.clicks, r."position", d.filename, d.created_at
    from public.uploaded_rows r join public.uploaded_datasets d on d.id = r.dataset_id
    where r.client_id = p_client_id and d.client_id = p_client_id
  )
  select min(term) as term, max(impressions), max(clicks),
    (array_agg("position" order by impressions desc nulls last))[1],
    array_agg(distinct filename) filter (where filename is not null), min(created_at)
  from k where term is not null
  group by lower(term)
$$;
grant execute on function public.uploaded_keywords(bigint) to authenticated;

-- Page↔query map: optional minimum impressions (the structure tab now shows every keyword).
drop function if exists public.gsc_page_query_map(bigint, text, text);
create or replace function public.gsc_page_query_map(p_client_id bigint, p_from text, p_to text, p_min_impr int default 10)
returns table (page text, term text, clicks bigint, impressions bigint, ctr numeric, "position" numeric)
language sql stable set search_path = '' as $$
  select
    m.page, m.term,
    sum(m.clicks)::bigint as clicks,
    sum(m.impressions)::bigint as impressions,
    case when sum(m.impressions) > 0 then round(sum(m.clicks)::numeric / sum(m.impressions), 4) else 0 end as ctr,
    case when sum(m.impressions) > 0 then round((sum(m.position * m.impressions) / sum(m.impressions))::numeric, 1) else round(avg(m.position)::numeric, 1) end as "position"
  from public.gsc_metrics m
  where m.client_id = p_client_id
    and m.page is not null and m.page <> '' and m.term is not null and m.term <> ''
    and m.date >= p_from and m.date <= p_to
  group by m.page, m.term
  having sum(m.impressions) >= p_min_impr
  order by sum(m.impressions) desc
  limit 5000;
$$;
grant execute on function public.gsc_page_query_map(bigint, text, text, int) to authenticated;

-- Keywords the team removed as irrelevant (hidden from the structure tab and the AI analysis;
-- restorable — nothing is deleted from the source data).
create table if not exists excluded_keywords (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  keyword text not null,
  created_at timestamptz default now(),
  unique (client_id, keyword)
);
alter table excluded_keywords enable row level security;
drop policy if exists "excluded_keywords team access" on excluded_keywords;
create policy "excluded_keywords team access" on excluded_keywords for all using (is_team_member()) with check (is_team_member());

-- Keywords already seen in the structure tab; unacknowledged ones are new (shown in light purple).
create table if not exists kw_seen (
  client_id bigint not null references clients on delete cascade,
  keyword text not null,
  first_seen timestamptz default now(),
  acknowledged_at timestamptz,
  primary key (client_id, keyword)
);
alter table kw_seen enable row level security;
drop policy if exists "kw_seen team access" on kw_seen;
create policy "kw_seen team access" on kw_seen for all using (is_team_member()) with check (is_team_member());
-- Baseline: everything that exists today counts as already seen.
insert into kw_seen (client_id, keyword, acknowledged_at)
select distinct client_id, lower(trim(term)), now() from gsc_metrics where term is not null and trim(term) <> ''
on conflict do nothing;
insert into kw_seen (client_id, keyword, acknowledged_at)
select distinct r.client_id, lower(public.uploaded_row_kw(r.query, r.keyword, d.source)), now()
from uploaded_rows r join uploaded_datasets d on d.id = r.dataset_id
where public.uploaded_row_kw(r.query, r.keyword, d.source) is not null
on conflict do nothing;

-- Site scans: which pages are new / gone compared with the previous scan.
alter table site_scans
  add column if not exists new_pages jsonb,
  add column if not exists removed_pages jsonb;

-- Original uploaded files (private).
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false) on conflict (id) do nothing;
drop policy if exists "uploads files read" on storage.objects;
create policy "uploads files read" on storage.objects for select using (bucket_id = 'uploads' and public.is_team_member());
drop policy if exists "uploads files insert" on storage.objects;
create policy "uploads files insert" on storage.objects for insert with check (bucket_id = 'uploads' and public.is_team_member());
drop policy if exists "uploads files delete" on storage.objects;
create policy "uploads files delete" on storage.objects for delete using (bucket_id = 'uploads' and public.is_team_member());
