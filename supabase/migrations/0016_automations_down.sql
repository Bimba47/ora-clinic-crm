-- ביטול 0016: מחיקת מנוע האוטומציות (הכללים, הלוג, הטריגרים ומשימות ה-cron)
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname like 'automation\_%' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

drop trigger clients_automation on clients;
drop trigger appointments_automation on appointments;
drop trigger service_requests_automation on service_requests;
drop trigger treatments_automation on treatments;
drop trigger staff_automation on staff;
drop trigger tasks_automation on tasks;

drop function public.automation_schema();
drop function public.automation_rule_list();
drop table automation_logs;
drop table automation_rules;
drop function private.automation_on_change();
drop function private.automation_dispatch(text, text, jsonb, jsonb);
drop function private.automation_run_scheduled(uuid);
drop function private.automation_sync_cron();
drop function private.automation_validate();
drop function private.automation_execute(jsonb, text, jsonb);
drop function private.automation_conditions_met(jsonb, text, jsonb, jsonb);
drop function private.automation_compare(text, text, text);
drop function private.automation_value(jsonb, text, jsonb);
drop function private.automation_render(text, text, jsonb);
drop function private.automation_token(text, text, jsonb);
drop function private.automation_label(text, text, text);
drop function private.automation_field(text, text);
drop function private.automation_change_ops();
drop function private.automation_ops(text);
drop function private.automation_objects();
drop type automation_log_status;
drop type automation_event;

-- הפונקציות שקיבלו עקיפה לפעולות מערכת חוזרות לגרסה הקודמת
create or replace function private.enforce_field_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if (select auth.uid()) is null or current_setting('app.self_profile', true) = 'on' then
    return new;
  end if;
  for r in
    select fp.field_key, fp.access, f.label
      from public.field_permissions fp
      join public.view_objects o on o.object_key = fp.object_key
      join public.object_fields f on f.object_id = o.id and f.field_key = fp.field_key
     where fp.role_id = private.my_role_id() and fp.object_key = tg_table_name
       and fp.field_key not in ('created_at', 'updated_at', 'updated_by')
  loop
    if tg_op = 'UPDATE' and (to_jsonb(new) -> r.field_key) is distinct from (to_jsonb(old) -> r.field_key) then
      raise exception 'אין לך הרשאה לשנות את השדה "%"', r.label;
    end if;
    if tg_op = 'INSERT' and r.access = 'hidden' and coalesce(to_jsonb(new) -> r.field_key, 'null'::jsonb) <> 'null'::jsonb
       and r.field_key not in ('created_by', 'is_active') then
      raise exception 'אין לך הרשאה למלא את השדה "%"', r.label;
    end if;
  end loop;
  return new;
end
$$;

create or replace function private.check_request_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is not distinct from
     (case when tg_op = 'UPDATE' then old.assigned_to end) then
    return new;
  end if;
  if new.assigned_to is not null and not exists (
    select 1 from public.staff where id = new.assigned_to and is_active
  ) then
    raise exception 'אפשר לשייך קריאה רק לאשת צוות פעילה';
  end if;
  if (select auth.uid()) is not null and not private.is_manager() then
    if not (new.assigned_to = (select auth.uid())
            or (new.assigned_to is null and tg_op = 'UPDATE'
                and old.assigned_to = (select auth.uid()))) then
      raise exception 'מטפלת יכולה לשייך קריאה רק לעצמה';
    end if;
  end if;
  return new;
end
$$;

drop function private.automation_depth();
