-- Staged combined analysis: the full keyword→intent-cluster map and the hierarchical site map are
-- kept alongside the recommendations; decisions keep the structured considerations behind them.
alter table structure_ai_analysis add column if not exists map jsonb;
alter table structure_ai_analysis add column if not exists hierarchy jsonb;
alter table structure_ai_analysis add column if not exists stage text;
alter table structure_decisions add column if not exists considerations jsonb;
alter table structure_decisions add column if not exists hub text;
