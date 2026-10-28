-- Per-proposal reference sources (URLs) the writer must draw on for a specific article.
alter table blog_posts add column if not exists sources jsonb;
