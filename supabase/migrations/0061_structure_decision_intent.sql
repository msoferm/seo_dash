-- Decisions now carry the detailed user-intent analysis of their keyword group, the extra steps
-- and the proposed new-page title — shown in full in the "כוונת המשתמש" tab.
alter table structure_decisions add column if not exists intent_analysis text;
alter table structure_decisions add column if not exists extra_steps text;
alter table structure_decisions add column if not exists new_page_title text;
