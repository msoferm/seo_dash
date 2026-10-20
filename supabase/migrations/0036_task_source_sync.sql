-- Two-way sync: when a recommendation / audit issue changes status anywhere (inner tabs,
-- apply functions, direct updates), mirror it onto the linked plan task. The other
-- direction (task → source) is done by the app calling the source's status setter.
create or replace function sync_tasks_from_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare new_status text;
begin
  if TG_TABLE_NAME = 'recommendations' then
    if new.status in ('applied', 'done') then new_status := 'done';
    elsif new.status = 'ignored' then new_status := 'ignored';
    elsif new.status = 'pending' then new_status := 'open';
    else return new; end if;
    update tasks set status = new_status, done_at = case when new_status = 'done' then now() else null end
      where source = 'plan' and source_type = 'recommendation' and source_ref = new.id::text
        and status is distinct from new_status;
  elsif TG_TABLE_NAME = 'audit_issues' then
    if new.status = 'applied' then new_status := 'done';
    elsif new.status = 'rejected' then new_status := 'ignored';
    elsif new.status = 'pending' then new_status := 'open';
    else return new; end if;
    update tasks set status = new_status, done_at = case when new_status = 'done' then now() else null end
      where source = 'plan' and source_type = 'audit' and source_ref = new.id::text
        and status is distinct from new_status;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_tasks_rec on recommendations;
create trigger trg_sync_tasks_rec after update of status on recommendations
  for each row execute function sync_tasks_from_source();

drop trigger if exists trg_sync_tasks_audit on audit_issues;
create trigger trg_sync_tasks_audit after update of status on audit_issues
  for each row execute function sync_tasks_from_source();
