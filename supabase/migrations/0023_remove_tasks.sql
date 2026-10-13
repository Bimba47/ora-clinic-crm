-- 0023: הסרת אובייקט המשימות (החלטת ענבל, v24). המשימות לא באפיון וחפפו לקריאות השירות.
-- נשארים: קריאות שירות (מה שמטפלים בו) והתראות (הודעה שמשהו קרה). הווידג'ט "המשימות שלי" נקרא "הקריאות שלי".
-- גיבוי הנתונים לפני ההסרה: versions/v24-tasks-removal/backup.json.
-- ה-check constraints שמתירים 'tasks' נשארים כמו שהם: ביומן הפעילות יש שורות של משימות, והוא לקריאה בלבד.

-- כללי האוטומציה של המשימות (הלוג שלהם נמחק איתם, on delete cascade)
delete from automation_rules
 where id in ('3d80323f-c954-4f71-9c3e-f36105933e0d', 'e6696507-c534-4bf7-a4dd-59b5822a30e8')
    or object_name = 'tasks' or actions::text like '%"object": "tasks"%';

-- הווידג'ט בלוח "ראשי" מציג קריאות פתוחות שמשויכות אלייך
update dashboard_widgets set title = 'הקריאות שלי' where title = 'המשימות שלי';
delete from dashboard_widgets where object_name = 'tasks';

-- הרשאות, קטלוג ותצוגות (שדות ותצוגות נמחקים עם האובייקט, on delete cascade)
delete from field_permissions where object_key = 'tasks';
delete from role_permissions where object_key = 'tasks';
delete from notifications where object_key = 'tasks';
delete from view_objects where object_key = 'tasks';

-- רשימות האובייקטים בפונקציות
create or replace function private.automation_objects()
returns text[] language sql immutable set search_path = '' as $$
  select array['clients', 'appointments', 'service_requests', 'treatments', 'staff']
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

create or replace function private.init_role_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.role_permissions (role_id, object_key)
  select new.id, o from unnest(array['clients', 'appointments', 'service_requests', 'treatments', 'staff']) o
  on conflict do nothing;
  return new;
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

-- הטבלה עצמה (הטריגרים שלה נמחקים איתה)
drop table public.tasks;
drop type if exists public.task_status;
