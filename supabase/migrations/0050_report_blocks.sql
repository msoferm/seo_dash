-- #1: turn report_items into a block model so the report can hold, besides action items,
-- free-text boxes and manual headings — all orderable by drag (sort_order).
--   block_type:  'action' (default, existing + auto-synced items) | 'heading' | 'text'
--   heading_kind: for headings — 'action' (blue, "כותרת לפעולות שבוצעו") | 'general' (neutral)
--   text_size:    for text blocks — 'sm' | 'base' | 'lg' | 'xl'
alter table report_items add column if not exists block_type text not null default 'action';
alter table report_items add column if not exists heading_kind text;
alter table report_items add column if not exists text_size text;
-- A heading/text block does not need a page; headings store their text in `title`,
-- text blocks store their content in `why` (title may be empty).
