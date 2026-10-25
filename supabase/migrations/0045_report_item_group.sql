-- Let the team merge several report actions under one custom heading (shown in the PDF).
alter table report_items add column if not exists custom_group text;
