-- Forum / URL-specific link outreach.
-- The team registers specific sites (mostly forums/communities) they're active on.
-- A scan reads recent thread titles, finds ones relevant to the business (or that can be
-- creatively tied to it or to one of the site's pages), reads the question, and drafts a
-- genuinely helpful reply that naturally links to the best page on the business site.
-- The team reviews each lead and posts it manually.

create table if not exists forum_sites (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  url text not null,                      -- forum / listing URL the team is registered on
  name text,                              -- friendly label
  max_pages int not null default 3,       -- how many listing (pagination) pages to scan
  max_threads int not null default 5,     -- how many relevant threads to open & draft for
  active boolean not null default true,
  last_scanned_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists forum_sites_client_idx on forum_sites(client_id, active);

create table if not exists forum_leads (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  forum_site_id bigint references forum_sites on delete set null,
  thread_url text not null,               -- URL of the specific user's message/thread
  thread_title text,                      -- topic / subject of the thread
  question text,                          -- the full question the user asked
  suggested_reply text,                   -- a helpful reply that naturally links our site
  target_url text,                        -- the business-site URL to link to
  score int default 0,                    -- 0-100 relevance/opportunity
  status text not null default 'new'
    check (status in ('new', 'approved', 'in_progress', 'done', 'rejected')),
  notes text,
  created_at timestamptz default now()
);
create index if not exists forum_leads_client_idx on forum_leads(client_id, status, score desc);
create unique index if not exists forum_leads_thread_uq on forum_leads(client_id, thread_url);

-- Per-client guidance for the forum agent (tone, what to link, do/don't).
alter table clients add column if not exists forum_prefs text;

alter table forum_sites enable row level security;
alter table forum_leads enable row level security;
drop policy if exists "forum_sites team access" on forum_sites;
create policy "forum_sites team access" on forum_sites for all using (is_team_member()) with check (is_team_member());
drop policy if exists "forum_leads team access" on forum_leads;
create policy "forum_leads team access" on forum_leads for all using (is_team_member()) with check (is_team_member());
