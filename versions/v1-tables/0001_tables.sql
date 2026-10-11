-- CRM קליניקת אורה · שלב 1: טבלאות בלבד
-- לפי המבנה המאושר ב-CLAUDE.md (11.10.2026).
-- טריגרים, מדיניות RLS ונתוני מחירון יגיעו בשלבים הבאים.

create extension if not exists btree_gist with schema extensions;

-- ===== סוגים (enums) =====
create type staff_role         as enum ('manager', 'therapist');
create type client_source      as enum ('instagram', 'facebook', 'website', 'referral', 'other');
create type appointment_status as enum ('upcoming', 'done', 'cancelled');
create type request_status     as enum ('new', 'in_progress', 'closed');

-- ===== פונקציות עזר =====
-- נרמול טלפון: רק ספרות, ו-972 בהתחלה הופך ל-0
create or replace function normalize_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^972', '0')
$$;

-- טווח הזמן של תור (מוסיפים רק דקות, ולכן התוצאה קבועה)
create or replace function appointment_range(starts timestamptz, minutes int)
returns tstzrange language sql immutable set search_path = '' as $$
  select tstzrange(starts, starts + make_interval(mins => minutes), '[)')
$$;

-- בדיקת שעות פעילות לפי שעון ישראל: א'-ה' 09:00-19:00, ו' 09:00-13:00
create or replace function within_opening_hours(starts timestamptz, minutes int)
returns boolean language sql immutable set search_path = '' as $$
  with t as (
    select (starts at time zone 'Asia/Jerusalem') as s,
           ((starts + make_interval(mins => minutes)) at time zone 'Asia/Jerusalem') as e
  )
  select s::date = e::date
     and s::time >= time '09:00'
     and case extract(dow from s)
           when 5 then e::time <= time '13:00'
           when 6 then false
           else e::time <= time '19:00'
         end
  from t
$$;

-- ===== staff (צוות) =====
create table staff (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  email       text not null unique,
  role        staff_role not null default 'therapist',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ===== clients (לקוחות) =====
create table clients (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (length(trim(full_name)) > 0),
  phone       text not null unique check (phone = normalize_phone(phone) and length(phone) between 9 and 10),
  source      client_source,
  created_by  uuid references staff (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ===== treatments (מחירון) =====
create table treatments (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique check (length(trim(name)) > 0),
  price             numeric(10,2) not null check (price >= 0),
  duration_minutes  int not null check (duration_minutes > 0),
  is_active         boolean not null default true
);

-- ===== appointments (תורים) =====
create table appointments (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients (id) on delete restrict,
  treatment_id      uuid not null references treatments (id) on delete restrict,
  therapist_id      uuid not null references staff (id) on delete restrict,
  starts_at         timestamptz not null,
  duration_minutes  int not null check (duration_minutes > 0),
  price             numeric(10,2) not null check (price >= 0),
  status            appointment_status not null default 'upcoming',
  notes             text,
  created_by        uuid references staff (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint appointments_opening_hours
    check (within_opening_hours(starts_at, duration_minutes)),
  -- אין שני תורים חופפים לאותה מטפלת (תורים שבוטלו לא נחשבים)
  constraint appointments_no_overlap
    exclude using gist (
      therapist_id with =,
      appointment_range(starts_at, duration_minutes) with &&
    ) where (status <> 'cancelled')
);

-- ===== service_requests (קריאות שירות) =====
create table service_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients (id) on delete restrict,
  description  text not null check (length(trim(description)) > 0),
  status       request_status not null default 'new',
  assigned_to  uuid references staff (id) on delete set null,
  created_by   uuid references staff (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz,
  -- אין "בטיפול" בלי אחראית
  constraint service_requests_assignee_required
    check (status <> 'in_progress' or assigned_to is not null)
);

-- ===== notifications (התראות שיוך) =====
create table notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references staff (id) on delete cascade,
  request_id    uuid not null references service_requests (id) on delete cascade,
  message       text not null,
  is_read       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ===== אינדקסים לחיפוש ולמסכים =====
create index clients_phone_pattern_idx      on clients (phone text_pattern_ops);
create index appointments_client_idx        on appointments (client_id, starts_at desc);
create index appointments_starts_idx        on appointments (starts_at);
create index service_requests_client_idx    on service_requests (client_id, created_at desc);
create index service_requests_status_idx    on service_requests (status, assigned_to);
create index notifications_recipient_idx    on notifications (recipient_id, is_read, created_at desc);

-- ===== אבטחה: RLS פעיל על כל הטבלאות =====
-- בלי מדיניות עדיין, ולכן אף משתמשת לא יכולה לקרוא או לכתוב עד השלב הבא.
alter table staff            enable row level security;
alter table clients          enable row level security;
alter table treatments       enable row level security;
alter table appointments     enable row level security;
alter table service_requests enable row level security;
alter table notifications    enable row level security;
