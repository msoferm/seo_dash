-- Link-building prospects discovered by the research agent (Phase 1).
-- The agent proposes; the team reviews, approves, and (Phase 2) drafts outreach.
create table if not exists link_prospects (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  type text not null default 'other',      -- 'directory' | 'blog' | 'forum' | 'mention' | 'local' | 'other'
  url text not null,
  title text,
  reason text,                              -- why it's relevant
  suggested_action text,                    -- how to get the link
  contact text,                             -- email / contact page if found
  score int default 0,                      -- 0-100 relevance/priority
  status text not null default 'new'        -- 'new' | 'approved' | 'in_progress' | 'done' | 'rejected'
    check (status in ('new', 'approved', 'in_progress', 'done', 'rejected')),
  notes text,
  created_at timestamptz default now()
);
create index if not exists link_prospects_client_idx on link_prospects(client_id, status, score desc);

alter table link_prospects enable row level security;
drop policy if exists "link_prospects team access" on link_prospects;
create policy "link_prospects team access" on link_prospects
  for all using (is_team_member()) with check (is_team_member());
