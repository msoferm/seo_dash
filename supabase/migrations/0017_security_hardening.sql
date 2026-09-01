-- Security hardening (Supabase advisor + manual audit).

-- 1) oauth_states was created WITHOUT RLS — a table with RLS disabled is fully readable/
--    writable via the public anon key. Only Edge Functions (service role) use it, so
--    enabling RLS with NO policy denies all anon/authenticated access (service role bypasses).
alter table oauth_states enable row level security;

-- 2) Helper views ran as their owner (security_invoker off) → they BYPASSED the RLS of
--    the underlying tables, leaking every client's data to anyone with the anon key.
--    Make them run as the querying user so RLS applies (team members still see their data).
alter view client_stats set (security_invoker = on);
alter view gsc_daily set (security_invoker = on);
alter view zefo_rank_buckets set (security_invoker = on);

-- 3) Pin search_path on our functions (prevents search_path hijacking; critical for the
--    SECURITY DEFINER helper). Bodies re-created with fully-qualified names.
create or replace function public.is_team_member()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (select 1 from public.team_members where user_id = auth.uid())
$$;

create or replace function public.trg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.gsc_query_opportunities(p_client_id bigint, p_from text, p_to text)
returns table (term text, clicks bigint, impressions bigint, ctr numeric, "position" numeric)
language sql
stable
set search_path = ''
as $$
  select
    m.term,
    sum(m.clicks)::bigint as clicks,
    sum(m.impressions)::bigint as impressions,
    case when sum(m.impressions) > 0 then round(sum(m.clicks)::numeric / sum(m.impressions), 4) else 0 end as ctr,
    case when sum(m.impressions) > 0 then round((sum(m.position * m.impressions) / sum(m.impressions))::numeric, 1) else round(avg(m.position)::numeric, 1) end as "position"
  from public.gsc_metrics m
  where m.client_id = p_client_id and m.term is not null and m.term <> ''
    and m.date >= p_from and m.date <= p_to
  group by m.term
  having sum(m.impressions) >= 20
  order by sum(m.impressions) desc
  limit 400;
$$;

create or replace function public.gsc_page_query_map(p_client_id bigint, p_from text, p_to text)
returns table (page text, term text, clicks bigint, impressions bigint, ctr numeric, "position" numeric)
language sql
stable
set search_path = ''
as $$
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
  having sum(m.impressions) >= 10
  order by sum(m.impressions) desc
  limit 1500;
$$;
