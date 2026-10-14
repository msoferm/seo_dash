-- Diagnostics + grouping for forum outreach.
-- Record why a scan produced what it did, so "scan finished but nothing showed" is explainable.
alter table forum_sites add column if not exists last_scan_note text;
alter table forum_sites add column if not exists last_scan_found int;
-- Optional grouping: a parent forum this sub-forum was discovered under.
alter table forum_sites add column if not exists parent_url text;
