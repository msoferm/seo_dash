-- Impact tracking computed live from GSC history:
-- for each applied recommendation, clicks/impressions in the 30 days BEFORE the fix
-- (baseline) vs the last 30 days (now). Matched by normalized page URL.
create or replace function impact_stats(p_client_id bigint)
returns table (
  rec_id bigint,
  page text,
  title text,
  applied_note text,
  applied_at timestamptz,
  clicks_before numeric,
  clicks_now numeric,
  impressions_before numeric,
  impressions_now numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with recs as (
    select id, page, title, applied_note, applied_at
    from recommendations
    where client_id = p_client_id
      and status in ('applied', 'done')
      and applied_at is not null
      and page is not null
  )
  select
    r.id, r.page, r.title, r.applied_note, r.applied_at,
    coalesce((select sum(m.clicks) from gsc_metrics m
      where m.client_id = p_client_id
        and lower(rtrim(m.page, '/')) = lower(rtrim(r.page, '/'))
        and m.date::date >= (r.applied_at::date - 30) and m.date::date < r.applied_at::date), 0) as clicks_before,
    coalesce((select sum(m.clicks) from gsc_metrics m
      where m.client_id = p_client_id
        and lower(rtrim(m.page, '/')) = lower(rtrim(r.page, '/'))
        and m.date::date >= (current_date - 30)), 0) as clicks_now,
    coalesce((select sum(m.impressions) from gsc_metrics m
      where m.client_id = p_client_id
        and lower(rtrim(m.page, '/')) = lower(rtrim(r.page, '/'))
        and m.date::date >= (r.applied_at::date - 30) and m.date::date < r.applied_at::date), 0) as impressions_before,
    coalesce((select sum(m.impressions) from gsc_metrics m
      where m.client_id = p_client_id
        and lower(rtrim(m.page, '/')) = lower(rtrim(r.page, '/'))
        and m.date::date >= (current_date - 30)), 0) as impressions_now
  from recs r
  order by r.applied_at desc;
$$;
