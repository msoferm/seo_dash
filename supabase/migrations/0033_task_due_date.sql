-- Daily scheduling: spread the 3-month plan across actual working dates.
alter table tasks add column if not exists due_date date;
create index if not exists tasks_due_idx on tasks(client_id, due_date);
