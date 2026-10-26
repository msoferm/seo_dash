-- Impact tracking v2: include applied recommendations, applied audit fixes AND completed
-- tasks (anything with a page). Use coalesce(applied/done date, created_at) so items marked
-- done manually (without applied_at) still appear.
drop function if exists impact_stats(bigint);
create or replace function impact_stats(p_client_id bigint)
returns table (
  rec_id text,
  kind text,
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
  with items as (
    select id::text as rec_id, 'rec' as kind, page, title, applied_note,
           coalesce(applied_at, created_at) as ref
    from recommendations
    where client_id = p_client_id and status in ('applied', 'done') and page is not null
    union all
    select 'audit:' || id, 'audit', page, issue, applied_note, created_at
    from audit_issues
    where client_id = p_client_id and status = 'applied' and page is not null
    union all
    select 'task:' || id, 'task', page_url, title, note, coalesce(done_at, created_at)
    from tasks
    where client_id = p_client_id and status = 'done' and page_url is not null
      and (source_type is null or source_type not in ('recommendation', 'audit'))
  )
  select
    i.rec_id, i.kind, i.page, i.title, i.applied_note, i.ref as applied_at,
    coalesce((select sum(m.clicks) from gsc_metrics m
      where m.client_id = p_client_id and lower(rtrim(m.page, '/')) = lower(rtrim(i.page, '/'))
        and m.date::date >= (i.ref::date - 30) and m.date::date < i.ref::date), 0) as clicks_before,
    coalesce((select sum(m.clicks) from gsc_metrics m
      where m.client_id = p_client_id and lower(rtrim(m.page, '/')) = lower(rtrim(i.page, '/'))
        and m.date::date >= (current_date - 30)), 0) as clicks_now,
    coalesce((select sum(m.impressions) from gsc_metrics m
      where m.client_id = p_client_id and lower(rtrim(m.page, '/')) = lower(rtrim(i.page, '/'))
        and m.date::date >= (i.ref::date - 30) and m.date::date < i.ref::date), 0) as impressions_before,
    coalesce((select sum(m.impressions) from gsc_metrics m
      where m.client_id = p_client_id and lower(rtrim(m.page, '/')) = lower(rtrim(i.page, '/'))
        and m.date::date >= (current_date - 30)), 0) as impressions_now
  from items i
  order by i.ref desc;
$$;
