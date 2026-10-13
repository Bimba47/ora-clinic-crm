-- ביטול 0015: מחיקת אובייקט המשימות והחזרת הרשימות הקודמות
delete from view_objects where object_key = 'tasks';   -- מוחק גם שדות ותצוגות (cascade)
delete from notifications where object_key = 'tasks';
delete from field_permissions where object_key = 'tasks';
delete from role_permissions where object_key = 'tasks';
drop table tasks;
drop type task_status;
alter table view_objects drop constraint view_objects_object_key_check;
alter table view_objects add constraint view_objects_object_key_check check (object_key in
  ('staff', 'clients', 'treatments', 'appointments', 'service_requests', 'notifications', 'roles', 'teams'));

alter table audit_log drop constraint audit_log_table_name_check;
alter table audit_log add constraint audit_log_table_name_check check (table_name in
  ('staff', 'clients', 'treatments', 'appointments', 'service_requests', 'notifications'))
  not valid;  -- שורות יומן של משימות נשארות (היומן לקריאה בלבד)
alter table notifications drop constraint notifications_object_check;
alter table notifications add constraint notifications_object_check check (object_key is null or object_key in
  ('clients', 'appointments', 'service_requests', 'staff', 'treatments'));
alter table role_permissions drop constraint role_permissions_object_key_check;
alter table role_permissions add constraint role_permissions_object_key_check check (object_key in
  ('clients', 'appointments', 'service_requests', 'treatments', 'staff'));
alter table field_permissions drop constraint field_permissions_object_key_check;
alter table field_permissions add constraint field_permissions_object_key_check check (object_key in
  ('clients', 'appointments', 'service_requests', 'treatments', 'staff'));

create or replace function private.init_role_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.role_permissions (role_id, object_key)
  select new.id, o from unnest(array['clients', 'appointments', 'service_requests', 'treatments', 'staff']) o
  on conflict do nothing;
  return new;
end
$$;

create or replace function private.can_view_row(p_object text, p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_object in ('clients', 'appointments', 'service_requests', 'treatments', 'staff')
      then private.row_allowed(p_object, 'view', p_owner) or (p_object = 'staff' and p_owner = (select auth.uid()))
    when p_object = 'notifications' then p_owner = (select auth.uid())
    else private.is_active_staff()
  end
$$;

create or replace function private.sync_all_column_grants()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  foreach t in array array['clients', 'appointments', 'service_requests', 'treatments', 'staff'] loop
    perform private.sync_column_grants(t);
  end loop;
  return null;
end
$$;
