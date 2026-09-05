-- Auto-blog: per-client WordPress connection + published-post history.

create table if not exists client_wordpress (
  client_id bigint primary key references clients on delete cascade,
  site_url text not null,               -- e.g. https://example.com
  username text not null,
  app_password text not null,           -- WordPress Application Password (revocable, scoped)
  mode text not null default 'publish' check (mode in ('publish', 'draft')),
  enabled boolean not null default true,
  last_published_at timestamptz,
  created_at timestamptz default now()
);
alter table client_wordpress enable row level security;
drop policy if exists "client_wordpress team access" on client_wordpress;
create policy "client_wordpress team access" on client_wordpress
  for all using (is_team_member()) with check (is_team_member());

create table if not exists blog_posts (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  title text not null,
  keyword text,
  wp_post_id bigint,
  url text,
  status text,                          -- 'publish' | 'draft' | 'error'
  error text,
  created_at timestamptz default now()
);
create index if not exists blog_posts_client_idx on blog_posts(client_id, created_at desc);
alter table blog_posts enable row level security;
drop policy if exists "blog_posts team access" on blog_posts;
create policy "blog_posts team access" on blog_posts
  for all using (is_team_member()) with check (is_team_member());
