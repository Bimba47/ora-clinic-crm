-- ביטול 0026: הסרת ה-API והחזרת פונקציות הזהות לגרסה הקודמת (רק משתמשת מחוברת)
drop function if exists public.api_request(text, text, text, text, jsonb, jsonb);
drop function if exists private.api_dispatch(text, text, text, jsonb, jsonb);
drop function if exists private.api_db_error(text, text, text, text, text);
drop function if exists private.api_validate(text, jsonb, boolean);
drop function if exists private.api_errs_status(jsonb);
drop function if exists private.api_err(int, text, text, jsonb);
drop function if exists public.create_api_key(text, uuid);
drop table if exists api_logs;
drop table if exists api_keys;

create or replace function private.my_role_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select role_id from public.staff where id = (select auth.uid()) and is_active
$$;

create or replace function private.is_active_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where id = (select auth.uid()) and is_active)
$$;

create or replace function private.enforce_field_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if (select auth.uid()) is null or current_setting('app.self_profile', true) = 'on' or private.automation_depth() > 0 then
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

drop function if exists private.api_role();
alter table view_objects drop column if exists api_access;
alter table object_fields drop column if exists display_hidden;
