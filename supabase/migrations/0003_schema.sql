-- CRM קליניקת אורה · שלב 3: השלמת הסכמה לפי ה-PRD ו-CLAUDE.md
-- 1. משתמשים (staff): טלפון וכתובת מגורים, ואימייל עם ואלידציה.
-- 2. created_at ו-updated_at בכל טבלה, ו-updated_at מתעדכן אוטומטית.
-- 3. ואלידציה בצד השרת: טלפון ואימייל מנורמלים ונבדקים במסד.
-- 4. יומן פעילות (audit_log): נכתב בטריגר, לקריאה בלבד.
-- 5. אינדקסים למפתחות הזרים.
-- ביטול השלב: 0003_schema_down.sql

-- ===== פונקציות עזר =====

-- updated_at מתעדכן בכל שינוי
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- נרמול טלפון לפני שמירה, כדי שגם "054-123 4567" או "+972541234567" יישמרו נכון
create or replace function private.normalize_phone_column()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.phone is not null then
    new.phone := public.normalize_phone(new.phone);
  end if;
  return new;
end
$$;

-- נרמול אימייל: בלי רווחים ובאותיות קטנות
create or replace function private.normalize_email_column()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.email := lower(trim(new.email));
  return new;
end
$$;

-- ===== staff (משתמשים): טלפון, כתובת מגורים, updated_at =====
alter table staff
  add column phone      text not null,
  add column address    text,
  add column updated_at timestamptz not null default now();

alter table staff
  add constraint staff_phone_format check (phone ~ '^0[0-9]{8,9}$'),
  add constraint staff_email_format check (email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
  add constraint staff_address_not_blank check (address is null or length(trim(address)) > 0);

create trigger staff_normalize_phone before insert or update of phone on staff
  for each row execute function private.normalize_phone_column();
create trigger staff_normalize_email before insert or update of email on staff
  for each row execute function private.normalize_email_column();

-- כתובת המגורים גלויה רק למנהלת ולעובדת עצמה. שאר העמודות גלויות לכל הצוות הפעיל.
revoke select on staff from authenticated;
grant select (id, full_name, phone, email, role, is_active, created_at, updated_at) on staff to authenticated;

create or replace function public.get_staff_address(p_staff_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.address from public.staff s
  where s.id = p_staff_id
    and (private.is_manager() or p_staff_id = (select auth.uid()))
$$;
revoke execute on function public.get_staff_address(uuid) from public, anon;
grant execute on function public.get_staff_address(uuid) to authenticated;

-- ===== clients: טלפון מנורמל אוטומטית ובפורמט ישראלי =====
alter table clients
  add constraint clients_phone_format check (phone ~ '^0[0-9]{8,9}$');
create trigger clients_normalize_phone before insert or update of phone on clients
  for each row execute function private.normalize_phone_column();

-- ===== treatments, notifications: השלמת created_at / updated_at =====
alter table treatments
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
alter table notifications
  add column updated_at timestamptz not null default now();

-- ===== updated_at אוטומטי בכל הטבלאות =====
create trigger staff_updated_at            before update on staff            for each row execute function private.set_updated_at();
create trigger clients_updated_at          before update on clients          for each row execute function private.set_updated_at();
create trigger treatments_updated_at       before update on treatments       for each row execute function private.set_updated_at();
create trigger appointments_updated_at     before update on appointments     for each row execute function private.set_updated_at();
create trigger service_requests_updated_at before update on service_requests for each row execute function private.set_updated_at();
create trigger notifications_updated_at    before update on notifications    for each row execute function private.set_updated_at();

-- ===== audit_log (יומן פעילות) =====
create type audit_action as enum ('create', 'update', 'delete');

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid references staff (id) on delete restrict,  -- ריק = פעולת מערכת (למשל n8n)
  action          audit_action not null,
  table_name      text not null check (table_name in
                    ('staff', 'clients', 'treatments', 'appointments', 'service_requests', 'notifications')),
  record_id       uuid not null,
  changed_fields  text[],
  old_values      jsonb,
  new_values      jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()   -- זהה ל-created_at, כי היומן לא מתעדכן
);

create index audit_log_record_idx  on audit_log (table_name, record_id, created_at desc);
create index audit_log_created_idx on audit_log (created_at desc);
create index audit_log_actor_idx   on audit_log (actor_id);

-- הטריגר שכותב ליומן. רץ במסד, ולכן תופס כל שינוי, גם כזה שלא הגיע מהממשק.
create or replace function private.write_audit_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid;
  v_old     jsonb;
  v_new     jsonb;
  v_fields  text[];
begin
  select s.id into v_actor from public.staff s where s.id = (select auth.uid());

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    select array_agg(k order by k) into v_fields from jsonb_object_keys(v_new) k;
    insert into public.audit_log (actor_id, action, table_name, record_id, changed_fields, new_values)
    values (v_actor, 'create', tg_table_name, new.id, v_fields, v_new);
    return new;

  elsif tg_op = 'UPDATE' then
    select array_agg(k order by k),
           jsonb_object_agg(k, to_jsonb(old) -> k),
           jsonb_object_agg(k, to_jsonb(new) -> k)
      into v_fields, v_old, v_new
      from jsonb_object_keys(to_jsonb(new)) k
     where k <> 'updated_at'
       and (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
    if v_fields is not null then
      insert into public.audit_log (actor_id, action, table_name, record_id, changed_fields, old_values, new_values)
      values (v_actor, 'update', tg_table_name, new.id, v_fields, v_old, v_new);
    end if;
    return new;

  else
    v_old := to_jsonb(old);
    select array_agg(k order by k) into v_fields from jsonb_object_keys(v_old) k;
    insert into public.audit_log (actor_id, action, table_name, record_id, changed_fields, old_values)
    values (v_actor, 'delete', tg_table_name, old.id, v_fields, v_old);
    return old;
  end if;
end
$$;

create trigger staff_audit            after insert or update or delete on staff            for each row execute function private.write_audit_log();
create trigger clients_audit          after insert or update or delete on clients          for each row execute function private.write_audit_log();
create trigger treatments_audit       after insert or update or delete on treatments       for each row execute function private.write_audit_log();
create trigger appointments_audit     after insert or update or delete on appointments     for each row execute function private.write_audit_log();
create trigger service_requests_audit after insert or update or delete on service_requests for each row execute function private.write_audit_log();
create trigger notifications_audit    after insert or update or delete on notifications    for each row execute function private.write_audit_log();

-- היומן לקריאה בלבד: אין עדכון, אין מחיקה ואין ריקון, לאף אחד
create or replace function private.audit_log_read_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'יומן הפעילות לקריאה בלבד';
end
$$;

create trigger audit_log_no_update_delete before update or delete on audit_log
  for each row execute function private.audit_log_read_only();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function private.audit_log_read_only();

alter table audit_log enable row level security;
revoke all on audit_log from anon, authenticated, service_role;
grant select on audit_log to authenticated, service_role;

-- רק מנהלת קוראת את היומן
create policy audit_log_select on audit_log for select to authenticated
  using ((select private.is_manager()));

-- ===== אינדקסים למפתחות זרים שעוד לא היו =====
create index appointments_treatment_idx       on appointments (treatment_id);
create index appointments_therapist_idx       on appointments (therapist_id, starts_at);
create index appointments_created_by_idx      on appointments (created_by);
create index clients_created_by_idx           on clients (created_by);
create index service_requests_assigned_idx    on service_requests (assigned_to);
create index service_requests_created_by_idx  on service_requests (created_by);
create index notifications_request_idx        on notifications (request_id);
