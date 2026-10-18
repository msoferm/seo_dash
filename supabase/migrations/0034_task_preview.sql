-- Preview-before-execute: a draft (for text-writing tasks) or detailed steps (for guidance).
alter table tasks add column if not exists preview text;
alter table tasks add column if not exists writes_text boolean default false;
