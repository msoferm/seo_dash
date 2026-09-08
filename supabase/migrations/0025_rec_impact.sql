-- Impact tracking: snapshot the page's clicks when a recommendation is applied, so the
-- effect can be measured later (before vs current).
alter table recommendations add column if not exists clicks_before int;
