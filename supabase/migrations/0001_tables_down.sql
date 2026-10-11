-- ביטול שלב 1: מוחק את הטבלאות, הסוגים ופונקציות העזר של 0001_tables
-- מריצים רק אחרי 0004, 0003 ו-0002 down (בסדר הזה). מוחק את כל הנתונים בטבלאות.

drop table if exists notifications;
drop table if exists service_requests;
drop table if exists appointments;
drop table if exists treatments;
drop table if exists clients;
drop table if exists staff;

drop function if exists within_opening_hours(timestamptz, int);
drop function if exists appointment_range(timestamptz, int);
drop function if exists normalize_phone(text);

drop type if exists request_status;
drop type if exists appointment_status;
drop type if exists client_source;
drop type if exists staff_role;

-- btree_gist נשאר מותקן, כי אולי הוא היה קיים לפני השלב הזה.
