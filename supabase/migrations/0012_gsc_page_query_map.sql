-- Per page+query aggregation for the "query map per page" analysis (report #5):
-- helps spot cannibalization (one query → several pages) and sharpen each page's topic.
-- SECURITY INVOKER (default) so RLS on gsc_metrics restricts rows to team members.
create or replace function gsc_page_query_map(p_client_id bigint, p_from text, p_to text)
returns table (
  page text,
  term text,
  clicks bigint,
  impressions bigint,
  ctr numeric,
  "position" numeric
)
language sql
stable
as $$
  select
    m.page,
    m.term,
    sum(m.clicks)::bigint as clicks,
    sum(m.impressions)::bigint as impressions,
    case when sum(m.impressions) > 0
         then round(sum(m.clicks)::numeric / sum(m.impressions), 4)
         else 0 end as ctr,
    case when sum(m.impressions) > 0
         then round((sum(m.position * m.impressions) / sum(m.impressions))::numeric, 1)
         else round(avg(m.position)::numeric, 1) end as "position"
  from gsc_metrics m
  where m.client_id = p_client_id
    and m.page is not null and m.page <> ''
    and m.term is not null and m.term <> ''
    and m.date >= p_from and m.date <= p_to
  group by m.page, m.term
  having sum(m.impressions) >= 10
  order by sum(m.impressions) desc
  limit 1500;
$$;

grant execute on function gsc_page_query_map(bigint, text, text) to authenticated;
