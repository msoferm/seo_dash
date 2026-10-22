-- Auto-log: when an action is completed anywhere, add it to the client's most recent report
-- immediately (raw title + page). The report's "הוסף פעולות שבוצעו" backfills the AI "why".
create or replace function autolog_report_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare rep bigint; v_cid bigint; v_title text; v_page text; v_stype text; v_sref text;
begin
  if TG_TABLE_NAME = 'recommendations' then
    if new.status not in ('applied', 'done') then return new; end if;
    v_cid := new.client_id; v_title := new.title; v_page := new.page; v_stype := 'recommendation'; v_sref := new.id::text;
  elsif TG_TABLE_NAME = 'audit_issues' then
    if new.status <> 'applied' then return new; end if;
    v_cid := new.client_id; v_title := new.issue; v_page := new.page; v_stype := 'audit'; v_sref := new.id::text;
  elsif TG_TABLE_NAME = 'tasks' then
    if new.status <> 'done' or new.source_type in ('recommendation', 'audit') then return new; end if;
    v_cid := new.client_id; v_title := new.title; v_page := new.page_url; v_stype := 'task'; v_sref := new.id::text;
  else
    return new;
  end if;

  select id into rep from reports where client_id = v_cid order by period_to desc, created_at desc limit 1;
  if rep is null then return new; end if;

  insert into report_items (report_id, client_id, title, page_url, source_type, source_ref)
    values (rep, v_cid, left(coalesce(v_title, 'פעולה'), 300), v_page, v_stype, v_sref)
    on conflict (report_id, source_type, source_ref) do nothing;
  return new;
end $$;

drop trigger if exists trg_autolog_rec on recommendations;
create trigger trg_autolog_rec after update of status on recommendations for each row execute function autolog_report_item();
drop trigger if exists trg_autolog_audit on audit_issues;
create trigger trg_autolog_audit after update of status on audit_issues for each row execute function autolog_report_item();
drop trigger if exists trg_autolog_task on tasks;
create trigger trg_autolog_task after insert or update of status on tasks for each row execute function autolog_report_item();
