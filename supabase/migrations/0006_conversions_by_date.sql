-- Add a date dimension to ga4_conversions so the overview can filter conversions by date range.
alter table ga4_conversions add column if not exists date date;
create index if not exists ga4_conversions_client_date_idx on ga4_conversions(client_id, date);
