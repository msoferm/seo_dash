-- Semi-automatic mode: the agent proposes a topic + rationale; the team approves
-- before the article is written & published.
alter table client_wordpress add column if not exists require_approval boolean not null default true;
alter table blog_posts add column if not exists reason text;   -- the proposal rationale
