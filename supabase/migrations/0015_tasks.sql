-- 0015: אובייקט "משימות" (tasks): משימת מעקב עם תאריך יעד, אחראית, ולקוחה או קריאה מקושרות.
-- משמש גם את המודול "המשימות שלי" באפיון, ואת מנוע האוטומציות (0016) שיוצר וסוגר משימות.
-- נכנס לכל המקומות שבהם רשומים אובייקטי העסק: הרשאות, הרשאות שדות, יומן פעילות, התראות, קטלוג ותצוגות.

create type task_status as enum ('open', 'done');

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  due_date    date,
  status      task_status not null default 'open',
  assigned_to uuid references staff (id) on delete restrict,
  client_id   uuid references clients (id) on delete restrict,
  request_id  uuid references service_requests (id) on delete set null,
  notes       text,
  created_by  uuid default auth.uid() references staff (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff (id) on delete set null
);
create index tasks_assigned_idx on tasks (assigned_to, status, due_date);
create index tasks_client_idx   on tasks (client_id);
create index tasks_request_idx  on tasks (request_id);
create index tasks_created_by_idx on tasks (created_by);
create index tasks_updated_by_idx on tasks (updated_by);

create trigger tasks_updated_at before update on tasks for each row execute function private.set_updated_at();
create trigger tasks_updated_by before insert or update on tasks for each row execute function private.set_updated_by();
create trigger tasks_field_access before insert or update on tasks for each row execute function private.enforce_field_access();

-- יומן פעילות
alter table audit_log drop constraint audit_log_table_name_check;
alter table audit_log add constraint audit_log_table_name_check check (table_name in
  ('staff', 'clients', 'treatments', 'appointments', 'service_requests', 'notifications', 'tasks'));
create trigger tasks_audit after insert or update or delete on tasks for each row execute function private.write_audit_log();

-- התראה יכולה לקשר למשימה
alter table notifications drop constraint notifications_object_check;
alter table notifications add constraint notifications_object_check check (object_key is null or object_key in
  ('clients', 'appointments', 'service_requests', 'staff', 'treatments', 'tasks'));

-- ===== הרשאות =====
alter table role_permissions drop constraint role_permissions_object_key_check;
alter table role_permissions add constraint role_permissions_object_key_check check (object_key in
  ('clients', 'appointments', 'service_requests', 'treatments', 'staff', 'tasks'));
alter table field_permissions drop constraint field_permissions_object_key_check;
alter table field_permissions add constraint field_permissions_object_key_check check (object_key in
  ('clients', 'appointments', 'service_requests', 'treatments', 'staff', 'tasks'));

-- ברירת מחדל: מנהלת – הכול. כל תפקיד אחר – צפייה, יצירה ועריכה, בלי מחיקה (כמו לקוחות, תורים וקריאות)
insert into role_permissions (role_id, object_key, can_view, can_create, can_edit, can_delete)
select r.id, 'tasks', 'all', 'all', 'all', case when r.is_admin then 'all' else 'none' end::perm_scope
  from roles r
on conflict (role_id, object_key) do nothing;

create or replace function private.init_role_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.role_permissions (role_id, object_key)
  select new.id, o from unnest(array['clients', 'appointments', 'service_requests', 'treatments', 'staff', 'tasks']) o
  on conflict do nothing;
  return new;
end
$$;

create or replace function private.can_view_row(p_object text, p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_object in ('clients', 'appointments', 'service_requests', 'treatments', 'staff', 'tasks')
      then private.row_allowed(p_object, 'view', p_owner) or (p_object = 'staff' and p_owner = (select auth.uid()))
    when p_object = 'notifications' then p_owner = (select auth.uid())
    else private.is_active_staff()
  end
$$;

create or replace function private.sync_all_column_grants()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  foreach t in array array['clients', 'appointments', 'service_requests', 'treatments', 'staff', 'tasks'] loop
    perform private.sync_column_grants(t);
  end loop;
  return null;
end
$$;

-- "שלי" במשימה = האחראית
alter table tasks enable row level security;
create policy tasks_select on tasks for select to authenticated using (private.row_allowed('tasks', 'view', assigned_to));
create policy tasks_insert on tasks for insert to authenticated with check (private.row_allowed('tasks', 'create', assigned_to));
create policy tasks_update on tasks for update to authenticated
  using (private.row_allowed('tasks', 'edit', assigned_to)) with check (private.row_allowed('tasks', 'edit', assigned_to));
create policy tasks_delete on tasks for delete to authenticated using (private.row_allowed('tasks', 'delete', assigned_to));
revoke all on tasks from anon;
grant select, insert, update, delete on tasks to authenticated;
select private.sync_column_grants('tasks');

-- ===== קטלוג ותצוגה =====
alter table view_objects drop constraint view_objects_object_key_check;
alter table view_objects add constraint view_objects_object_key_check check (object_key in
  ('staff', 'clients', 'treatments', 'appointments', 'service_requests', 'notifications', 'roles', 'teams', 'tasks'));

insert into view_objects (object_key, label, label_plural, display_field, can_create, owner_field)
values ('tasks', 'משימה', 'משימות', 'title', true, 'assigned_to');

insert into object_fields (object_id, field_key, label, field_type, options, ref_object_id,
                           position, default_visible, is_searchable, is_required, is_editable, is_filterable)
select o.id, f.field_key, f.label, f.field_type::field_type, f.options::jsonb, r.id,
       f.position, f.default_visible, f.is_searchable, f.is_required, f.is_editable, f.is_filterable
  from (values
  ('title', 'משימה', 'text', null, null, 1, true, true, true, true, true),
  ('due_date', 'תאריך יעד', 'date', null, null, 2, true, false, false, true, true),
  ('status', 'סטטוס', 'choice', '[{"value":"open","label":"פתוחה"},{"value":"done","label":"בוצעה"}]', null, 3, true, false, true, true, true),
  ('assigned_to', 'אחראית', 'reference', null, 'staff', 4, true, true, false, true, true),
  ('client_id', 'לקוחה', 'reference', null, 'clients', 5, true, true, false, true, true),
  ('request_id', 'קריאה', 'reference', null, 'service_requests', 6, false, false, false, true, true),
  ('notes', 'הערות', 'long_text', null, null, 7, false, true, false, true, false),
  ('created_by', 'נוצרה על ידי', 'reference', null, 'staff', 8, false, false, false, false, true),
  ('created_at', 'נוצרה', 'datetime', null, null, 9, false, false, false, false, true),
  ('updated_at', 'עודכנה', 'datetime', null, null, 10, false, false, false, false, true),
  ('updated_by', 'עודכנה על ידי', 'reference', null, 'staff', 11, false, false, false, false, true)
  ) f(field_key, label, field_type, options, ref_key, position, default_visible, is_searchable, is_required, is_editable, is_filterable)
  join view_objects o on o.object_key = 'tasks'
  left join view_objects r on r.object_key = f.ref_key;

insert into views (object_id, name, view_type, owner_id, is_shared, is_default, kanban_field_id)
select o.id, 'כל המשימות', 'list', null, true, true,
       (select f.id from object_fields f where f.object_id = o.id and f.field_key = 'status')
  from view_objects o where o.object_key = 'tasks';

insert into view_columns (view_id, field_id, position, width, is_visible)
select v.id, f.id, f.position,
       case when f.field_type = 'long_text' then 280 when f.field_type = 'text' then 240
            when f.field_type in ('reference', 'datetime') then 170 else 130 end,
       f.default_visible
  from views v join view_objects o on o.id = v.object_id and o.object_key = 'tasks'
  join object_fields f on f.object_id = o.id;

insert into view_sorts (view_id, field_id, direction, position)
select v.id, f.id, 'asc', 1
  from views v join view_objects o on o.id = v.object_id and o.object_key = 'tasks'
  join object_fields f on f.object_id = o.id and f.field_key = 'due_date';
