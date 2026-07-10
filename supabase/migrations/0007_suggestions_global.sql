-- "הצעות ייעול" is a single shared board across the whole team — not per-client.
-- Make client_id optional so global suggestions don't need a client, and keep the
-- column only for backward-compatibility with older rows.
alter table suggestions alter column client_id drop not null;

-- Index the feed by recency (the board is queried globally, ordered by created_at desc).
create index if not exists suggestions_created_idx on suggestions(created_at desc);
