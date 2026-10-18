-- Direct link to the specific page on the business site a task relates to.
alter table tasks add column if not exists page_url text;
