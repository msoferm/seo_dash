-- "הצעות ייעול" — efficiency/improvement suggestions log per client.
-- Each entry has free text and/or file attachments, tagged by author (Moshe / Mordechai).
create table if not exists suggestions (
  id bigserial primary key,
  client_id bigint not null references clients on delete cascade,
  author text not null,                              -- 'moshe' | 'mordechai'
  body text,
  attachments jsonb not null default '[]'::jsonb,    -- [{name, path, type, size}]
  created_at timestamptz default now()
);
create index if not exists suggestions_client_idx on suggestions(client_id, created_at desc);

alter table suggestions enable row level security;
drop policy if exists "suggestions team access" on suggestions;
create policy "suggestions team access" on suggestions
  for all using (is_team_member()) with check (is_team_member());

-- Private storage bucket for suggestion file attachments
insert into storage.buckets (id, name, public)
values ('suggestions', 'suggestions', false)
on conflict (id) do nothing;

drop policy if exists "suggestions files read" on storage.objects;
create policy "suggestions files read" on storage.objects
  for select using (bucket_id = 'suggestions' and public.is_team_member());

drop policy if exists "suggestions files insert" on storage.objects;
create policy "suggestions files insert" on storage.objects
  for insert with check (bucket_id = 'suggestions' and public.is_team_member());

drop policy if exists "suggestions files delete" on storage.objects;
create policy "suggestions files delete" on storage.objects
  for delete using (bucket_id = 'suggestions' and public.is_team_member());
