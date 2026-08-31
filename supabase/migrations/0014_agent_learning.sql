-- Free-text link-building preferences per client. The prospecting agent always
-- respects these, on top of learning from past approve/reject decisions.
alter table clients add column if not exists link_prefs text;
