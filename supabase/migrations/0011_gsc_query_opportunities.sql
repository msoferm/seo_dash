-- Aggregate GSC query-level stats for a period, for the report's opportunity analyses:
--   1) queries near the first page (position 8-20, real impressions) — fastest growth
--   2) high impressions + low CTR (title/meta opportunities)
-- SECURITY INVOKER (default) so RLS on gsc_metrics restricts rows to team members.
create or replace function gsc_query_opportunities(p_client_id bigint, p_from text, p_to text)
returns table (
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
    and m.term is not null and m.term <> ''
    and m.date >= p_from and m.date <= p_to
  group by m.term
  having sum(m.impressions) >= 20
  order by sum(m.impressions) desc
  limit 400;
$$;

grant execute on function gsc_query_opportunities(bigint, text, text) to authenticated;
