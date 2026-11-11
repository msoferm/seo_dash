-- Diagnostics of the last combined AI analysis (per-part errors / parse counts), so an empty
-- result can be explained instead of failing silently.
alter table structure_ai_analysis add column if not exists debug jsonb;
