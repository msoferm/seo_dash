-- Generic data uploads: any tool's CSV, auto-detected (source, columns, date range)
-- and stored normalized so it can be joined by page / query / keyword.
create table if not exists uploaded_datasets (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  filename text,
  source text,
  data_type text,
  date_from text,
  date_to text,
  row_count int default 0,
  mapping jsonb,
  created_at timestamptz default now()
);
create index if not exists uploaded_datasets_client_idx on uploaded_datasets(client_id, created_at desc);

create table if not exists uploaded_rows (
  id bigserial primary key,
  dataset_id bigint not null references uploaded_datasets on delete cascade,
  client_id bigint not null,
  page text,
  query text,
  keyword text,
  clicks numeric,
  impressions numeric,
  ctr numeric,
  "position" numeric,
  sessions numeric,
  conversions numeric
);
create index if not exists uploaded_rows_dataset_idx on uploaded_rows(dataset_id);

alter table uploaded_datasets enable row level security;
alter table uploaded_rows enable row level security;
drop policy if exists "uploaded_datasets team access" on uploaded_datasets;
create policy "uploaded_datasets team access" on uploaded_datasets for all using (is_team_member()) with check (is_team_member());
drop policy if exists "uploaded_rows team access" on uploaded_rows;
create policy "uploaded_rows team access" on uploaded_rows for all using (is_team_member()) with check (is_team_member());
