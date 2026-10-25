-- Recreate the auto-log trigger so it also sets the report item's category.
create or replace function autolog_report_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare rep bigint; v_cid bigint; v_title text; v_page text; v_stype text; v_sref text; v_cat text;
begin
  if TG_TABLE_NAME = 'recommendations' then
    if new.status not in ('applied', 'done') then return new; end if;
    v_cid := new.client_id; v_title := new.title; v_page := new.page; v_stype := 'recommendation'; v_sref := new.id::text;
    v_cat := case when new.type in ('title_meta','improve_page','add_keywords','new_content','internal_link','cannibalization')
                  then 'תוכן באתר' else 'אופטימיזציה טכנית ותיקונים' end;
  elsif TG_TABLE_NAME = 'audit_issues' then
    if new.status <> 'applied' then return new; end if;
    v_cid := new.client_id; v_title := new.issue; v_page := new.page; v_stype := 'audit'; v_sref := new.id::text;
    v_cat := case when new.issue ~* 'h1|מטא|meta|כותר|title|תוכן|content|faq|alt|תיאור' then 'תוכן באתר' else 'אופטימיזציה טכנית ותיקונים' end;
  elsif TG_TABLE_NAME = 'tasks' then
    if new.status <> 'done' or new.source_type in ('recommendation', 'audit') then return new; end if;
    v_cid := new.client_id; v_title := new.title; v_page := new.page_url; v_stype := 'task'; v_sref := new.id::text;
    v_cat := case new.category
               when 'content' then 'תוכן באתר' when 'traffic' then 'תוכן באתר'
               when 'technical' then 'אופטימיזציה טכנית ותיקונים' when 'speed' then 'אופטימיזציה טכנית ותיקונים'
               when 'authority' then 'קישורים' when 'conversions' then 'המרות ו-UX' else 'אחר' end;
  else
    return new;
  end if;

  select id into rep from reports where client_id = v_cid order by period_to desc, created_at desc limit 1;
  if rep is null then return new; end if;

  insert into report_items (report_id, client_id, title, page_url, source_type, source_ref, category)
    values (rep, v_cid, left(coalesce(v_title, 'פעולה'), 300), v_page, v_stype, v_sref, v_cat)
    on conflict (report_id, source_type, source_ref) do nothing;
  return new;
end $$;
