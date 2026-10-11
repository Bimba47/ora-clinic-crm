-- ביטול שלב 2: מחזיר את המסד לגרסה 1 (טבלאות בלבד, RLS נעול)

delete from treatments where name in (
  'התייעצות / טיפול ניסיון', 'טיפול פנים קלאסי', 'ניקוי פנים עמוק',
  'בוטוקס (אזור בודד)', 'חומצה היאלורונית (מילוי)',
  'טיפול לייזר (פנים מלא)', 'סדרת 6 טיפולי לייזר');

drop trigger if exists service_requests_assignment on service_requests;
drop function if exists private.check_request_assignment();

drop policy if exists staff_select on staff;
drop policy if exists staff_insert on staff;
drop policy if exists staff_update on staff;
drop policy if exists staff_delete on staff;
drop policy if exists treatments_select on treatments;
drop policy if exists treatments_insert on treatments;
drop policy if exists treatments_update on treatments;
drop policy if exists treatments_delete on treatments;
drop policy if exists clients_select on clients;
drop policy if exists clients_insert on clients;
drop policy if exists clients_update on clients;
drop policy if exists clients_delete on clients;
drop policy if exists appointments_select on appointments;
drop policy if exists appointments_insert on appointments;
drop policy if exists appointments_update on appointments;
drop policy if exists appointments_delete on appointments;
drop policy if exists service_requests_select on service_requests;
drop policy if exists service_requests_insert on service_requests;
drop policy if exists service_requests_update on service_requests;
drop policy if exists service_requests_delete on service_requests;
drop policy if exists notifications_select on notifications;
drop policy if exists notifications_update on notifications;
drop policy if exists notifications_delete on notifications;

grant insert, update on notifications to authenticated;
grant all on staff, clients, treatments, appointments, service_requests, notifications to anon;

alter table clients          alter column created_by drop default;
alter table appointments     alter column created_by drop default;
alter table service_requests alter column created_by drop default;

drop function if exists private.is_active_staff();
drop function if exists private.is_manager();
drop schema if exists private;
