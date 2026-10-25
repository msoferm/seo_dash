-- Extend source→task sync: when a recommendation/audit is applied/done and there is NO
-- linked task yet (no plan built), create a completed task so it shows in לוח משימות.
create or replace function sync_tasks_from_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare new_status text; v_cat text;
begin
  if TG_TABLE_NAME = 'recommendations' then
    if new.status in ('applied', 'done') then new_status := 'done';
    elsif new.status = 'ignored' then new_status := 'ignored';
    elsif new.status = 'pending' then new_status := 'open';
    else return new; end if;

    update tasks set status = new_status, done_at = case when new_status = 'done' then now() else null end
      where source = 'plan' and source_type = 'recommendation' and source_ref = new.id::text
        and status is distinct from new_status;

    if new.status in ('applied', 'done')
       and not exists (select 1 from tasks where source_type = 'recommendation' and source_ref = new.id::text) then
      v_cat := case when new.type in ('new_content','performance_drop') then 'traffic'
                    when new.type = 'technical' then 'technical' else 'content' end;
      insert into tasks (client_id, title, details, status, source, source_type, source_ref, page_url, kind, category, done_at)
        values (new.client_id, left(coalesce(new.title,'המלצה'),300), new.action, 'done', 'manual', 'recommendation', new.id::text, new.page, 'claude', v_cat, now());
    end if;

  elsif TG_TABLE_NAME = 'audit_issues' then
    if new.status = 'applied' then new_status := 'done';
    elsif new.status = 'rejected' then new_status := 'ignored';
    elsif new.status = 'pending' then new_status := 'open';
    else return new; end if;

    update tasks set status = new_status, done_at = case when new_status = 'done' then now() else null end
      where source = 'plan' and source_type = 'audit' and source_ref = new.id::text
        and status is distinct from new_status;

    if new.status = 'applied'
       and not exists (select 1 from tasks where source_type = 'audit' and source_ref = new.id::text) then
      v_cat := case when new.issue ~* 'h1|מטא|meta|כותר|title|תוכן|content|faq|alt|תיאור' then 'content' else 'technical' end;
      insert into tasks (client_id, title, details, status, source, source_type, source_ref, page_url, kind, category, done_at)
        values (new.client_id, left(coalesce(new.issue,'תיקון'),300), new.fix, 'done', 'manual', 'audit', new.id::text, new.page, 'claude', v_cat, now());
    end if;
  end if;
  return new;
end $$;
