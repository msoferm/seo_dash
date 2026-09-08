-- Full structured crawl: expand pages with on-page SEO fields + an internal-link graph.
alter table pages add column if not exists status text;
alter table pages add column if not exists meta_description text;
alter table pages add column if not exists h1 text;
alter table pages add column if not exists subheadings int;
alter table pages add column if not exists word_count int;
alter table pages add column if not exists page_type text;
alter table pages add column if not exists images_total int;
alter table pages add column if not exists images_missing_alt int;
alter table pages add column if not exists internal_links_out int;
alter table pages add column if not exists wp_id bigint;
alter table pages add column if not exists wp_type text;
alter table pages add column if not exists last_full_crawl timestamptz;

create table if not exists page_links (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  from_url text not null,
  to_url text not null,
  anchor text,
  created_at timestamptz default now()
);
create index if not exists page_links_client_idx on page_links(client_id);
create index if not exists page_links_to_idx on page_links(client_id, to_url);

alter table page_links enable row level security;
drop policy if exists "page_links team access" on page_links;
create policy "page_links team access" on page_links
  for all using (is_team_member()) with check (is_team_member());
