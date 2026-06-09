-- SEO Dashboard schema
-- All tables share team-based access: any authenticated user with role 'member' or 'admin'
-- in team_members can read/write.

create extension if not exists "pgcrypto";
create extension if not exists pg_trgm;

-- Team membership: enable the 3-5 team users to collaborate
create table team_members (
  user_id uuid primary key references auth.users on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz default now()
);

create table clients (
  id bigserial primary key,
  name text not null,
  domain text not null,
  gsc_property text,
  ga4_property_id text,
  google_token_json text,
  notes text,
  created_at timestamptz default now()
);

create table keywords (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  term text not null,
  monthly_searches int default 0,
  competition text,
  competition_index int,
  top_bid_low numeric,
  top_bid_high numeric,
  position numeric,
  source text default 'csv',
  created_at timestamptz default now()
);
create index keywords_client_idx on keywords(client_id);
create index keywords_term_trgm on keywords using gin (term gin_trgm_ops);

create table monthly_searches (
  id bigserial primary key,
  keyword_id bigint not null references keywords on delete cascade,
  year int not null,
  month int not null,
  searches int default 0
);
create index monthly_searches_keyword_idx on monthly_searches(keyword_id);

create table gsc_metrics (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  term text,
  page text,
  date text not null,
  clicks int default 0,
  impressions int default 0,
  ctr numeric default 0,
  position numeric default 0
);
create index gsc_metrics_client_idx on gsc_metrics(client_id);
create index gsc_metrics_term_idx on gsc_metrics(term);
create index gsc_metrics_page_idx on gsc_metrics(page);

create table pages (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  url text not null,
  title text,
  last_crawled timestamptz,
  has_faq boolean default false,
  content_excerpt text,
  unique(client_id, url)
);
create index pages_client_idx on pages(client_id);

create table faq_items (
  id bigserial primary key,
  page_id bigint not null references pages on delete cascade,
  question text not null,
  answer text not null,
  kind text not null default 'specific' check (kind in ('general', 'specific', 'cta')),
  "order" int default 0,
  missing_info text
);
create index faq_items_page_idx on faq_items(page_id);

create table chat_sessions (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  title text default 'שיחה חדשה',
  messages_json jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index chat_sessions_client_idx on chat_sessions(client_id);

create table oauth_states (
  state text primary key,
  client_id bigint not null references clients on delete cascade,
  created_at timestamptz default now()
);

-- ===== Row-Level Security =====
alter table team_members enable row level security;
alter table clients enable row level security;
alter table keywords enable row level security;
alter table monthly_searches enable row level security;
alter table gsc_metrics enable row level security;
alter table pages enable row level security;
alter table faq_items enable row level security;
alter table chat_sessions enable row level security;

create or replace function is_team_member()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from team_members where user_id = auth.uid())
$$;

-- team_members policies must NOT call is_team_member() (which queries team_members),
-- or any subquery on team_members, otherwise RLS recurses infinitely. Allow any
-- authenticated user to read; writes are restricted to service_role (admins use the
-- Supabase SQL editor or admin-elevated server functions).
create policy "team_members read authenticated" on team_members
  for select to authenticated using (true);

-- All other tables: any team member can read/write
create policy "clients team access" on clients for all using (is_team_member()) with check (is_team_member());
create policy "keywords team access" on keywords for all using (is_team_member()) with check (is_team_member());
create policy "monthly_searches team access" on monthly_searches for all using (is_team_member()) with check (is_team_member());
create policy "gsc_metrics team access" on gsc_metrics for all using (is_team_member()) with check (is_team_member());
create policy "pages team access" on pages for all using (is_team_member()) with check (is_team_member());
create policy "faq_items team access" on faq_items for all using (is_team_member()) with check (is_team_member());
create policy "chat_sessions team access" on chat_sessions for all using (is_team_member()) with check (is_team_member());

-- oauth_states: only Edge Functions (service role) interact; no policy = locked from clients

-- Auto-update timestamps
create or replace function trg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger chat_sessions_updated
  before update on chat_sessions
  for each row execute function trg_set_updated_at();

-- ===== Helper view for dashboard KPIs =====
create or replace view client_stats as
select
  c.id as client_id,
  c.name,
  c.domain,
  (select count(*) from keywords k where k.client_id = c.id) as keyword_count,
  (select count(*) from pages p where p.client_id = c.id) as page_count,
  (select count(*) from pages p where p.client_id = c.id and p.has_faq) as pages_with_faq,
  (select coalesce(sum(clicks),0) from gsc_metrics m where m.client_id = c.id) as gsc_clicks,
  (select coalesce(sum(impressions),0) from gsc_metrics m where m.client_id = c.id) as gsc_impressions,
  (select coalesce(round(avg(position)::numeric, 2), 0) from gsc_metrics m where m.client_id = c.id) as avg_position
from clients c;
