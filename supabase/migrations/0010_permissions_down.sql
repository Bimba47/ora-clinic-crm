-- ביטול 0010: חזרה למצב שאחרי 0009 (תפקיד קבוע manager/therapist בטבלת הצוות, RLS קבוע בקוד)
-- המדיניות והפונקציות כאן הן בדיוק אלה שהיו לפני 0010 (גובו לפני השינוי).

-- ===== מדיניות חדשה של חמש הטבלאות -> המדיניות הקודמת =====
drop policy clients_select on clients;
drop policy clients_insert on clients;
drop policy clients_update on clients;
drop policy clients_delete on clients;
drop policy appointments_select on appointments;
drop policy appointments_insert on appointments;
drop policy appointments_update on appointments;
drop policy appointments_delete on appointments;
drop policy service_requests_select on service_requests;
drop policy service_requests_insert on service_requests;
drop policy service_requests_update on service_requests;
drop policy service_requests_delete on service_requests;
drop policy treatments_select on treatments;
drop policy treatments_insert on treatments;
drop policy treatments_update on treatments;
drop policy treatments_delete on treatments;
drop policy staff_select on staff;
drop policy staff_insert on staff;
drop policy staff_update on staff;
drop policy staff_delete on staff;

-- ===== התפקיד חוזר להיות עמודה בטבלת הצוות =====
create type staff_role as enum ('manager', 'therapist');
alter table staff add column role staff_role not null default 'therapist';
update staff s set role = case when r.is_admin then 'manager'::staff_role else 'therapist'::staff_role end
  from roles r where r.id = s.role_id;

create or replace function private.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff
    where id = (select auth.uid()) and is_active and role = 'manager'
  )
$$;

create policy appointments_delete on public.appointments as PERMISSIVE for DELETE to authenticated using (( SELECT private.is_manager() AS is_manager));
create policy appointments_insert on public.appointments as PERMISSIVE for INSERT to authenticated with check (( SELECT private.is_active_staff() AS is_active_staff));
create policy appointments_select on public.appointments as PERMISSIVE for SELECT to authenticated using (( SELECT private.is_active_staff() AS is_active_staff));
create policy appointments_update on public.appointments as PERMISSIVE for UPDATE to authenticated using (( SELECT private.is_active_staff() AS is_active_staff)) with check (( SELECT private.is_active_staff() AS is_active_staff));
create policy clients_delete on public.clients as PERMISSIVE for DELETE to authenticated using (( SELECT private.is_manager() AS is_manager));
create policy clients_insert on public.clients as PERMISSIVE for INSERT to authenticated with check (( SELECT private.is_active_staff() AS is_active_staff));
create policy clients_select on public.clients as PERMISSIVE for SELECT to authenticated using (( SELECT private.is_active_staff() AS is_active_staff));
create policy clients_update on public.clients as PERMISSIVE for UPDATE to authenticated using (( SELECT private.is_active_staff() AS is_active_staff)) with check (( SELECT private.is_active_staff() AS is_active_staff));
create policy service_requests_delete on public.service_requests as PERMISSIVE for DELETE to authenticated using (( SELECT private.is_manager() AS is_manager));
create policy service_requests_insert on public.service_requests as PERMISSIVE for INSERT to authenticated with check (( SELECT private.is_active_staff() AS is_active_staff));
create policy service_requests_select on public.service_requests as PERMISSIVE for SELECT to authenticated using (( SELECT private.is_active_staff() AS is_active_staff));
create policy service_requests_update on public.service_requests as PERMISSIVE for UPDATE to authenticated using (( SELECT private.is_active_staff() AS is_active_staff)) with check (( SELECT private.is_active_staff() AS is_active_staff));
create policy staff_delete on public.staff as PERMISSIVE for DELETE to authenticated using (( SELECT private.is_manager() AS is_manager));
create policy staff_insert on public.staff as PERMISSIVE for INSERT to authenticated with check (( SELECT private.is_manager() AS is_manager));
create policy staff_select on public.staff as PERMISSIVE for SELECT to authenticated using ((( SELECT private.is_active_staff() AS is_active_staff) OR (id = ( SELECT auth.uid() AS uid))));
create policy staff_update on public.staff as PERMISSIVE for UPDATE to authenticated using (( SELECT private.is_manager() AS is_manager)) with check (( SELECT private.is_manager() AS is_manager));
create policy treatments_delete on public.treatments as PERMISSIVE for DELETE to authenticated using (( SELECT private.is_manager() AS is_manager));
create policy treatments_insert on public.treatments as PERMISSIVE for INSERT to authenticated with check (( SELECT private.is_manager() AS is_manager));
create policy treatments_select on public.treatments as PERMISSIVE for SELECT to authenticated using (( SELECT private.is_active_staff() AS is_active_staff));
create policy treatments_update on public.treatments as PERMISSIVE for UPDATE to authenticated using (( SELECT private.is_manager() AS is_manager)) with check (( SELECT private.is_manager() AS is_manager));

-- ===== טריגרים ופונקציות של 0010 =====
drop trigger clients_field_access on clients;
drop trigger appointments_field_access on appointments;
drop trigger service_requests_field_access on service_requests;
drop trigger treatments_field_access on treatments;
drop trigger staff_field_access on staff;
drop trigger staff_ensure_admin on staff;
drop function private.enforce_field_access();
drop function public.get_record(text, uuid);
drop function public.get_me();
drop function public.get_my_permissions();
drop function public.duplicate_role(uuid, text);

-- פונקציות הקריאה כפי שהיו (בהרשאות המשתמשת, RLS חל)
create or replace function private.ref_label_sql(p_field_id uuid)
returns text language sql stable set search_path = '' as $$
  select format('(select r.%I::text from public.%I r where r.id = t.%I)', o.display_field, o.object_key, f.field_key)
    from public.object_fields f join public.view_objects o on o.id = f.ref_object_id
   where f.id = p_field_id
$$;

create or replace function private.view_where(p_object text, p_def jsonb, p_search text)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_obj    public.view_objects;
  v_field  public.object_fields;
  v_parts  text[] := '{}';
  v_any    text[] := '{}';
  v_digits text;
  f        record;
  v_where  text := 'true';
begin
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found then raise exception 'אובייקט לא מוכר או שאין לך הרשאה: %', p_object; end if;

  for f in select x->>'field' as fld, (x->>'op')::public.filter_operator as op, x->>'value' as val
             from jsonb_array_elements(coalesce(p_def->'filters', '[]'::jsonb)) x loop
    select * into v_field from public.object_fields where object_id = v_obj.id and field_key = f.fld;
    if not found then raise exception 'שדה לא מוכר: %', f.fld; end if;
    if not v_field.is_filterable then raise exception 'אי אפשר לסנן לפי השדה %', v_field.label; end if;
    v_parts := v_parts || private.filter_sql(v_field, f.op, f.val);
  end loop;

  if cardinality(v_parts) > 0 then
    v_where := '(' || array_to_string(v_parts,
                 case when p_def->>'match' = 'any' then ' or ' else ' and ' end) || ')';
  end if;

  if p_search is not null and trim(p_search) <> '' then
    v_digits := regexp_replace(p_search, '\D', '', 'g');
    for v_field in select * from public.object_fields where object_id = v_obj.id and is_searchable loop
      if v_field.field_type = 'phone' then
        if length(v_digits) >= 2 then
          v_any := v_any || format('t.%I like %L', v_field.field_key,
                                   '%' || regexp_replace(v_digits, '^972', '0') || '%');
        end if;
      elsif v_field.field_type = 'reference' then
        v_any := v_any || format('%s ilike %L', private.ref_label_sql(v_field.id),
                                 '%' || private.like_escape(trim(p_search)) || '%');
      else
        v_any := v_any || format('t.%I::text ilike %L', v_field.field_key,
                                 '%' || private.like_escape(trim(p_search)) || '%');
      end if;
    end loop;
    v_where := v_where || ' and (' || coalesce(nullif(array_to_string(v_any, ' or '), ''), 'false') || ')';
  end if;

  return v_where;
end
$$;

create or replace function public.run_view(p_object text, p_def jsonb, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_obj    public.view_objects;
  v_field  public.object_fields;
  v_where  text;
  v_cols   text[] := array['t.id'];
  v_order  text[] := '{}';
  v_total  bigint;
  v_rows   jsonb;
  v_expr   text;
  s        record;
begin
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found then raise exception 'אובייקט לא מוכר או שאין לך הרשאה: %', p_object; end if;
  v_where := private.view_where(p_object, p_def, p_search);

  for v_field in
    select f.* from jsonb_array_elements_text(coalesce(p_def->'columns', '[]'::jsonb)) with ordinality c(k, n)
      join public.object_fields f on f.object_id = v_obj.id and f.field_key = c.k
     order by c.n loop
    if v_field.field_key <> 'id' then
      v_cols := v_cols || format('t.%I', v_field.field_key);
    end if;
    if v_field.field_type = 'reference' then
      v_cols := v_cols || format('%s as %I', private.ref_label_sql(v_field.id), v_field.field_key || '__label');
    end if;
  end loop;

  for s in select x->>'field' as fld, x->>'dir' as dir
             from jsonb_array_elements(coalesce(p_def->'sorts', '[]'::jsonb)) x loop
    select * into v_field from public.object_fields where object_id = v_obj.id and field_key = s.fld;
    if not found then raise exception 'שדה מיון לא מוכר: %', s.fld; end if;
    v_expr := case when v_field.field_type = 'reference' then private.ref_label_sql(v_field.id)
                   else format('t.%I', v_field.field_key) end;
    v_order := v_order || format('%s %s nulls last', v_expr, case when s.dir = 'desc' then 'desc' else 'asc' end);
  end loop;
  v_order := v_order || 't.created_at desc'::text || 't.id'::text;

  execute format('select count(*) from public.%I t where %s', p_object, v_where) into v_total;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(q) - ''__n'' order by q.__n), ''[]''::jsonb) from (
       select %s, row_number() over (order by %s) as __n
         from public.%I t where %s order by %s limit %s offset %s) q',
    array_to_string(v_cols, ', '), array_to_string(v_order, ', '),
    p_object, v_where, array_to_string(v_order, ', '),
    greatest(least(coalesce(p_limit, 25), 5000), 1), greatest(coalesce(p_offset, 0), 0))
  into v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end
$$;

create or replace function public.run_view_groups(p_object text, p_def jsonb, p_search text, p_group_field text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb; v_obj_id uuid;
begin
  select id into v_obj_id from public.view_objects where object_key = p_object;
  if not exists (select 1 from public.object_fields
                  where object_id = v_obj_id and field_key = p_group_field and field_type in ('choice', 'boolean')) then
    raise exception 'שדה קיבוץ לא מוכר: %', p_group_field;
  end if;
  execute format('select coalesce(jsonb_object_agg(coalesce(g, ''''), n), ''{}''::jsonb)
                    from (select t.%I::text as g, count(*) as n from public.%I t where %s group by 1) x',
                 p_group_field, p_object, private.view_where(p_object, p_def, p_search))
  into v_result;
  return v_result;
end
$$;

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_address text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_active_staff() then
    raise exception 'אין הרשאה';
  end if;
  update public.staff
     set full_name = p_full_name,
         phone     = p_phone,
         address   = nullif(trim(coalesce(p_address, '')), '')
   where id = (select auth.uid());
end
$$;

create or replace function public.get_staff_address(p_staff_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.address from public.staff s
  where s.id = p_staff_id
    and (private.is_manager() or p_staff_id = (select auth.uid()))
$$;

-- ===== הרשאות עמודה כפי שהיו =====
drop trigger field_permissions_sync_grants on field_permissions;
drop function private.sync_all_column_grants();
drop function private.sync_column_grants(text);
grant select on clients, appointments, service_requests, treatments to authenticated;
revoke select (address) on staff from authenticated;
grant select (id, full_name, email, role, is_active, created_at, phone, updated_at, updated_by) on staff to authenticated;

-- ===== הקטלוג =====
delete from object_fields f using view_objects o
 where o.id = f.object_id and o.object_key = 'staff' and f.field_key in ('role_id', 'team_id', 'address');
update object_fields f set position = f.position - 2
  from view_objects o where o.id = f.object_id and o.object_key = 'staff' and f.position >= 4;
insert into object_fields (object_id, field_key, label, field_type, options, position, default_visible, is_searchable, is_required, is_editable, is_filterable)
select o.id, 'role', 'תפקיד', 'choice', '[{"value":"manager","label":"מנהלת"},{"value":"therapist","label":"מטפלת"}]'::jsonb,
       2, true, false, true, true, true
  from view_objects o where o.object_key = 'staff';
update object_fields f set is_editable = true
  from view_objects o where o.id = f.object_id and o.object_key = 'staff' and f.field_key = 'is_active';
update view_columns c set position = c.position - 1
  from views v, view_objects o where v.id = c.view_id and o.id = v.object_id and o.object_key = 'staff' and c.position >= 4;
insert into view_columns (view_id, field_id, position, width, is_visible)
select v.id, f.id, 2, 140, true
  from views v join view_objects o on o.id = v.object_id and o.object_key = 'staff'
  join object_fields f on f.object_id = o.id and f.field_key = 'role';

delete from view_objects where object_key in ('roles', 'teams');
alter table view_objects drop column owner_field;
alter table view_objects drop constraint view_objects_object_key_check;
alter table view_objects add constraint view_objects_object_key_check
  check (object_key in ('staff', 'clients', 'treatments', 'appointments', 'service_requests', 'notifications'));

-- ===== טבלאות ההרשאות =====
alter table staff drop column role_id, drop column team_id;
drop trigger roles_ensure_admin on roles;
drop function private.ensure_admin_exists();
drop table field_permissions;
drop table role_permissions;
drop table teams;
drop table roles;
drop function private.init_role_permissions();
drop function private.check_field_permission();
drop function private.field_hidden(text, text);
drop function private.can_view_row(text, uuid);
drop function private.row_allowed(text, text, uuid);
drop function private.perm(text, text);
drop function private.my_team_id();
drop function private.my_role_id();
drop type field_access;
drop type perm_scope;
