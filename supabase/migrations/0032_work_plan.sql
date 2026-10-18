-- Strategic 3-month work plan: tasks become hierarchical (pillar → subtasks),
-- categorized, scheduled across months, and linked back to their source feature.
alter table tasks add column if not exists parent_id bigint references tasks(id) on delete cascade;
alter table tasks add column if not exists category text;       -- pillar key: technical|speed|content|traffic|authority|conversions
alter table tasks add column if not exists is_pillar boolean default false;
alter table tasks add column if not exists kind text;           -- 'claude' (auto-executable) | 'manual' (guided)
alter table tasks add column if not exists target_month int;    -- 1..3
alter table tasks add column if not exists impact text;         -- high|medium|low (expected)
alter table tasks add column if not exists effort text;         -- high|medium|low
alter table tasks add column if not exists note text;           -- execution result / Claude guidance
alter table tasks add column if not exists source_type text;    -- recommendation|audit|tool|manual
alter table tasks add column if not exists source_ref text;     -- id (recommendation/audit) or tool key
create index if not exists tasks_parent_idx on tasks(client_id, parent_id);
create index if not exists tasks_pillar_idx on tasks(client_id, is_pillar);
