-- #1b: list the client's known site pages (from GSC data) for the internal-links picker,
-- most-visible first. security invoker → respects RLS (team members only).
drop function if exists client_pages(bigint);
create or replace function client_pages(p_client_id bigint)
returns table (page text, impressions bigint, clicks bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.page,
         sum(m.impressions)::bigint as impressions,
         sum(m.clicks)::bigint as clicks
  from gsc_metrics m
  where m.client_id = p_client_id and m.page is not null and m.page <> ''
  group by m.page
  order by sum(m.impressions) desc
  limit 300;
$$;
