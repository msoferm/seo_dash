-- Per-page GSC performance for the all-pages master screen.
create or replace function gsc_page_stats(p_client_id bigint, p_from text, p_to text)
returns table (page text, clicks bigint, impressions bigint, ctr numeric, "position" numeric)
language sql
stable
set search_path = ''
as $$
  select
    m.page,
    sum(m.clicks)::bigint as clicks,
    sum(m.impressions)::bigint as impressions,
    case when sum(m.impressions) > 0 then round(sum(m.clicks)::numeric / sum(m.impressions), 4) else 0 end as ctr,
    case when sum(m.impressions) > 0 then round((sum(m.position * m.impressions) / sum(m.impressions))::numeric, 1) else round(avg(m.position)::numeric, 1) end as "position"
  from public.gsc_metrics m
  where m.client_id = p_client_id and m.page is not null and m.page <> '' and m.date >= p_from and m.date <= p_to
  group by m.page
  having sum(m.impressions) >= 5
  order by sum(m.clicks) desc, sum(m.impressions) desc
  limit 300;
$$;
grant execute on function gsc_page_stats(bigint, text, text) to authenticated;
