-- Fix: ON CONFLICT (report_id, source_type, source_ref) needs a non-partial unique index.
-- Postgres treats NULLs as distinct, so manual items (source_ref NULL) are still unconstrained.
drop index if exists report_items_dedupe_uq;
create unique index if not exists report_items_dedupe_uq on report_items(report_id, source_type, source_ref);
