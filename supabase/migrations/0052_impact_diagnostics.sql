-- #3: diagnostics for the "מעקב השפעה" page. When the table is empty, the user had no way
-- to know WHICH precondition is missing. This returns the exact state for a client so the UI
-- can say precisely what to fix. Returns only booleans/counts — never the Google token itself.
-- security invoker → respects RLS (team members only), like impact_stats.
drop function if exists impact_diagnostics(bigint);
create or replace function impact_diagnostics(p_client_id bigint)
returns table (
  has_google_token boolean,
  has_gsc_property boolean,
  gsc_metric_rows bigint,
  actions_with_page bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    exists (select 1 from clients c where c.id = p_client_id and c.google_token_json is not null),
    exists (select 1 from clients c where c.id = p_client_id and coalesce(c.gsc_property, '') <> ''),
    (select count(*) from gsc_metrics m where m.client_id = p_client_id),
    (
      (select count(*) from recommendations r
         where r.client_id = p_client_id and r.status in ('applied', 'done') and r.page is not null)
      + (select count(*) from audit_issues a
         where a.client_id = p_client_id and a.status = 'applied' and a.page is not null)
      + (select count(*) from tasks t
         where t.client_id = p_client_id and t.status = 'done' and t.page_url is not null
           and (t.source_type is null or t.source_type not in ('recommendation', 'audit')))
    );
$$;
