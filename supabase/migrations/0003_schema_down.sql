-- ביטול שלב 3: מחזיר את המסד למצב שאחרי שלב 2
-- שימי לב: הביטול מוחק את יומן הפעילות ואת הטלפון והכתובת של המשתמשים.

drop index if exists appointments_treatment_idx;
drop index if exists appointments_therapist_idx;
drop index if exists appointments_created_by_idx;
drop index if exists clients_created_by_idx;
drop index if exists service_requests_assigned_idx;
drop index if exists service_requests_created_by_idx;
drop index if exists notifications_request_idx;

drop trigger if exists staff_audit on staff;
drop trigger if exists clients_audit on clients;
drop trigger if exists treatments_audit on treatments;
drop trigger if exists appointments_audit on appointments;
drop trigger if exists service_requests_audit on service_requests;
drop trigger if exists notifications_audit on notifications;
drop function if exists private.write_audit_log();

-- טריגר הקריאה-בלבד חוסם גם ריקון, ולכן מסירים אותו לפני מחיקת הטבלה
drop trigger if exists audit_log_no_update_delete on audit_log;
drop trigger if exists audit_log_no_truncate on audit_log;
drop table if exists audit_log;
drop function if exists private.audit_log_read_only();
drop type if exists audit_action;

drop trigger if exists staff_updated_at on staff;
drop trigger if exists clients_updated_at on clients;
drop trigger if exists treatments_updated_at on treatments;
drop trigger if exists appointments_updated_at on appointments;
drop trigger if exists service_requests_updated_at on service_requests;
drop trigger if exists notifications_updated_at on notifications;

alter table notifications drop column if exists updated_at;
alter table treatments drop column if exists created_at, drop column if exists updated_at;

drop trigger if exists clients_normalize_phone on clients;
alter table clients drop constraint if exists clients_phone_format;

drop function if exists public.get_staff_address(uuid);
grant select on staff to authenticated;

drop trigger if exists staff_normalize_phone on staff;
drop trigger if exists staff_normalize_email on staff;
alter table staff
  drop constraint if exists staff_phone_format,
  drop constraint if exists staff_email_format,
  drop constraint if exists staff_address_not_blank,
  drop column if exists phone,
  drop column if exists address,
  drop column if exists updated_at;

drop function if exists private.set_updated_at();
drop function if exists private.normalize_phone_column();
drop function if exists private.normalize_email_column();
