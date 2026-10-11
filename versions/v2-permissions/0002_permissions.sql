-- CRM קליניקת אורה · שלב 2: הרשאות לפי תפקיד (RLS) ומחירון
-- לפי טבלת ההרשאות ב-PRD: מנהלת = הכול. מטפלת = צפייה, יצירה ועריכה,
-- שיוך קריאה רק לעצמה, בלי מחיקה ובלי ניהול צוות ומחירון.
-- ביטול השלב: 0002_permissions_down.sql

-- ===== פונקציות עזר (בסכמה פרטית שלא נחשפת ב-API) =====
create schema if not exists private;
grant usage on schema private to authenticated;

-- האם המשתמשת המחוברת היא איש צוות פעיל
create or replace function private.is_active_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff
    where id = (select auth.uid()) and is_active
  )
$$;

-- האם המשתמשת המחוברת היא מנהלת פעילה
create or replace function private.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff
    where id = (select auth.uid()) and is_active and role = 'manager'
  )
$$;

grant execute on function private.is_active_staff() to authenticated;
grant execute on function private.is_manager() to authenticated;

-- ===== גישה בסיסית =====
-- משתמשת לא מחוברת (anon) לא ניגשת לשום טבלה
revoke all on staff, clients, treatments, appointments, service_requests, notifications from anon;

-- "נוצרה על ידי" מתמלא אוטומטית במשתמשת המחוברת
alter table clients          alter column created_by set default auth.uid();
alter table appointments     alter column created_by set default auth.uid();
alter table service_requests alter column created_by set default auth.uid();

-- ===== staff (צוות) =====
-- כל הצוות הפעיל רואה את רשימת הצוות; כל משתמשת רואה את השורה של עצמה
create policy staff_select on staff for select to authenticated
  using ((select private.is_active_staff()) or id = (select auth.uid()));
create policy staff_insert on staff for insert to authenticated
  with check ((select private.is_manager()));
create policy staff_update on staff for update to authenticated
  using ((select private.is_manager())) with check ((select private.is_manager()));
create policy staff_delete on staff for delete to authenticated
  using ((select private.is_manager()));

-- ===== treatments (מחירון): כולן רואות, רק מנהלת עורכת =====
create policy treatments_select on treatments for select to authenticated
  using ((select private.is_active_staff()));
create policy treatments_insert on treatments for insert to authenticated
  with check ((select private.is_manager()));
create policy treatments_update on treatments for update to authenticated
  using ((select private.is_manager())) with check ((select private.is_manager()));
create policy treatments_delete on treatments for delete to authenticated
  using ((select private.is_manager()));

-- ===== clients, appointments, service_requests =====
-- כל הצוות הפעיל: צפייה, יצירה ועריכה. מחיקה: מנהלת בלבד.
create policy clients_select on clients for select to authenticated
  using ((select private.is_active_staff()));
create policy clients_insert on clients for insert to authenticated
  with check ((select private.is_active_staff()));
create policy clients_update on clients for update to authenticated
  using ((select private.is_active_staff())) with check ((select private.is_active_staff()));
create policy clients_delete on clients for delete to authenticated
  using ((select private.is_manager()));

create policy appointments_select on appointments for select to authenticated
  using ((select private.is_active_staff()));
create policy appointments_insert on appointments for insert to authenticated
  with check ((select private.is_active_staff()));
create policy appointments_update on appointments for update to authenticated
  using ((select private.is_active_staff())) with check ((select private.is_active_staff()));
create policy appointments_delete on appointments for delete to authenticated
  using ((select private.is_manager()));

create policy service_requests_select on service_requests for select to authenticated
  using ((select private.is_active_staff()));
create policy service_requests_insert on service_requests for insert to authenticated
  with check ((select private.is_active_staff()));
create policy service_requests_update on service_requests for update to authenticated
  using ((select private.is_active_staff())) with check ((select private.is_active_staff()));
create policy service_requests_delete on service_requests for delete to authenticated
  using ((select private.is_manager()));

-- ===== notifications: כל אחת רואה רק את ההתראות שלה =====
-- היא יכולה רק לסמן "נקרא". ההתראות עצמן ייווצרו אוטומטית בשלב הטריגרים.
create policy notifications_select on notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notifications_update on notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy notifications_delete on notifications for delete to authenticated
  using (recipient_id = (select auth.uid()));
revoke insert, update on notifications from authenticated;
grant update (is_read) on notifications to authenticated;

-- ===== שיוך קריאה: מטפלת משייכת רק לעצמה, ורק למשתמשת פעילה =====
-- פעולות מערכת (למשל n8n עם מפתח שרת) לא עוברות את הבדיקה של מי מחוברת.
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

create trigger service_requests_assignment
  before insert or update of assigned_to on service_requests
  for each row execute function private.check_request_assignment();

-- ===== מחירון הקליניקה (מתוך כרטיס העסק) =====
insert into treatments (name, price, duration_minutes) values
  ('התייעצות / טיפול ניסיון',       150,  45),
  ('טיפול פנים קלאסי',              350,  60),
  ('ניקוי פנים עמוק',               450,  75),
  ('בוטוקס (אזור בודד)',            800,  30),
  ('חומצה היאלורונית (מילוי)',      1200, 45),
  ('טיפול לייזר (פנים מלא)',        600,  60),
  ('סדרת 6 טיפולי לייזר',           3000, 60);
