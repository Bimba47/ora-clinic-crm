-- 0010: שכבת הרשאות שמנוהלת מהממשק
-- ההרשאות הן דאטה: תפקידים, צוותים, הרשאה לכל תפקיד ואובייקט (צפייה/יצירה/עריכה/מחיקה, כל אחת עם היקף),
-- והרשאות ברמת שדה (חסום / קריאה בלבד). ה-RLS קורא מהטבלאות האלה, ולכן הוספת תפקיד או שינוי הרשאה
-- הם שינוי דאטה, בלי קוד ובלי מיגרציה. שדה חסום לא נשלח ללקוח בכלל.
-- נתוני ההתחלה שומרים בדיוק את מה שכל תפקיד יכול היום.

-- ===== סוגים =====
create type perm_scope as enum ('none', 'own', 'team', 'all');      -- ללא, רק שלי, הצוות שלי, הכול
create type field_access as enum ('hidden', 'read');                -- חסום, קריאה בלבד

-- ===== תפקידים וצוותים =====
create table roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  description text,
  is_admin    boolean not null default false,   -- מנהלת מערכת: הגדרות, הרשאות ומשתמשים
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff (id) on delete set null
);

create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff (id) on delete set null
);

-- הרשאה לכל צירוף של תפקיד ואובייקט. לכל פעולה היקף משלה.
create table role_permissions (
  role_id     uuid not null references roles (id) on delete cascade,
  object_key  text not null check (object_key in ('clients', 'appointments', 'service_requests', 'treatments', 'staff')),
  can_view    perm_scope not null default 'none',
  can_create  perm_scope not null default 'none',
  can_edit    perm_scope not null default 'none',
  can_delete  perm_scope not null default 'none',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff (id) on delete set null,
  primary key (role_id, object_key)
);

-- הרשאות ברמת שדה: לאיזה תפקיד שדה חסום או לקריאה בלבד. בלי שורה = לפי הרשאות האובייקט.
create table field_permissions (
  role_id     uuid not null references roles (id) on delete cascade,
  object_key  text not null check (object_key in ('clients', 'appointments', 'service_requests', 'treatments', 'staff')),
  field_key   text not null,
  access      field_access not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff (id) on delete set null,
  primary key (role_id, object_key, field_key)
);

create trigger roles_updated_at before update on roles for each row execute function private.set_updated_at();
create trigger roles_updated_by before insert or update on roles for each row execute function private.set_updated_by();
create trigger teams_updated_at before update on teams for each row execute function private.set_updated_at();
create trigger teams_updated_by before insert or update on teams for each row execute function private.set_updated_by();
create trigger role_permissions_updated_at before update on role_permissions for each row execute function private.set_updated_at();
create trigger role_permissions_updated_by before insert or update on role_permissions for each row execute function private.set_updated_by();
create trigger field_permissions_updated_at before update on field_permissions for each row execute function private.set_updated_at();
create trigger field_permissions_updated_by before insert or update on field_permissions for each row execute function private.set_updated_by();

-- ===== נתוני התחלה =====
insert into roles (name, description, is_admin) values
  ('מנהלת', 'בעלת הקליניקה: גישה מלאה, הגדרות, הרשאות ומשתמשים', true),
  ('מטפלת', 'עובדת עם לקוחות, תורים וקריאות. לא מוחקת, ולא מנהלת צוות ומחירון', false);

insert into teams (name, description) values
  ('הנהלה', 'ניהול הקליניקה'),
  ('לייזר ופנים', 'טיפולי לייזר וטיפולי פנים'),
  ('הזרקות', 'בוטוקס וחומצה היאלורונית');

alter table staff
  add column role_id uuid references roles (id),
  add column team_id uuid references teams (id) on delete set null;

update staff set role_id = (select id from roles where name = case when staff.role = 'manager' then 'מנהלת' else 'מטפלת' end);
update staff set team_id = (select id from teams where name = 'הנהלה') where role = 'manager';
update staff set team_id = (select id from teams where name = 'לייזר ופנים') where email = 'liat@ora-clinic.co.il';
update staff set team_id = (select id from teams where name = 'הזרקות') where email = 'netta@ora-clinic.co.il';
alter table staff alter column role_id set not null;
create index staff_role_idx on staff (role_id);
create index staff_team_idx on staff (team_id);

-- ההרשאות של היום, כנתונים
insert into role_permissions (role_id, object_key, can_view, can_create, can_edit, can_delete)
select r.id, o, 'all', 'all', 'all', 'all'
  from roles r, unnest(array['clients', 'appointments', 'service_requests', 'treatments', 'staff']) o
 where r.name = 'מנהלת';
insert into role_permissions (role_id, object_key, can_view, can_create, can_edit, can_delete)
select r.id, x.o, x.v::perm_scope, x.c::perm_scope, x.e::perm_scope, x.d::perm_scope
  from roles r, (values
    ('clients', 'all', 'all', 'all', 'none'),
    ('appointments', 'all', 'all', 'all', 'none'),
    ('service_requests', 'all', 'all', 'all', 'none'),
    ('treatments', 'all', 'none', 'none', 'none'),
    ('staff', 'all', 'none', 'none', 'none')
  ) as x(o, v, c, e, d)
 where r.name = 'מטפלת';

-- ===== הקטלוג: תפקידים וצוותים כאובייקטים (לשמות בשדות מקושרים), ותפקיד/צוות/כתובת בצוות =====
alter table view_objects drop constraint view_objects_object_key_check;
alter table view_objects add constraint view_objects_object_key_check
  check (object_key in ('staff', 'clients', 'treatments', 'appointments', 'service_requests', 'notifications', 'roles', 'teams'));

-- "רק שלי" לפי האחריות: איזה שדה ברשומה מצביע על מי שהיא שלה
alter table view_objects add column owner_field text;
update view_objects set owner_field = case object_key
  when 'clients' then 'created_by'
  when 'appointments' then 'therapist_id'
  when 'service_requests' then 'assigned_to'
  when 'staff' then 'id'
  when 'notifications' then 'recipient_id'
end;

insert into view_objects (object_key, label, label_plural, display_field, can_create) values
  ('roles', 'תפקיד', 'תפקידים', 'name', false),
  ('teams', 'צוות', 'צוותים', 'name', false);

insert into object_fields (object_id, field_key, label, field_type, options, position, default_visible, is_searchable, is_required, is_editable)
select o.id, x.k, x.l, x.t::field_type, x.opt::jsonb, x.p, true, x.k = 'name', x.k = 'name', true
  from view_objects o, (values
    ('roles', 'name', 'שם', 'text', null, 1),
    ('roles', 'description', 'תיאור', 'long_text', null, 2),
    ('roles', 'is_admin', 'מנהלת מערכת', 'boolean', '[{"value":"true","label":"כן"},{"value":"false","label":"לא"}]', 3),
    ('teams', 'name', 'שם', 'text', null, 1),
    ('teams', 'description', 'תיאור', 'long_text', null, 2)
  ) as x(obj, k, l, t, opt, p)
 where o.object_key = x.obj;

-- בצוות: "תפקיד" הופך לקישור לטבלת התפקידים, ונוספים צוות וכתובת מגורים (שדה רגיל, חסום למטפלת בהרשאות)
delete from object_fields f using view_objects o where o.id = f.object_id and o.object_key = 'staff' and f.field_key = 'role';
alter table staff drop column role;
drop type staff_role;

update object_fields f set position = f.position + 2
  from view_objects o where o.id = f.object_id and o.object_key = 'staff' and f.position >= 2;
insert into object_fields (object_id, field_key, label, field_type, ref_object_id, position, default_visible, is_searchable, is_required, is_editable, is_filterable)
select o.id, x.k, x.l, 'reference', (select id from view_objects where object_key = x.ref), x.p, true, false, x.req, true, true
  from view_objects o, (values ('role_id', 'תפקיד', 'roles', 2, true), ('team_id', 'צוות', 'teams', 3, false)) as x(k, l, ref, p, req)
 where o.object_key = 'staff';
insert into object_fields (object_id, field_key, label, field_type, position, default_visible, is_searchable, is_required, is_editable, is_filterable)
select o.id, 'address', 'כתובת מגורים', 'text',
       (select max(position) + 1 from object_fields f where f.object_id = o.id), false, false, false, true, false
  from view_objects o where o.object_key = 'staff';

-- סטטוס פעילה/מושבתת משתנה רק דרך "השבתה" / "הפעלה" (חוסם גם את הכניסה ב-Auth), לא בעריכה רגילה
update object_fields f set is_editable = false
  from view_objects o where o.id = f.object_id and o.object_key = 'staff' and f.field_key = 'is_active';

-- בתצוגות הצוות: תפקיד וצוות אחרי השם
update view_columns c set position = c.position + 2
  from views v, view_objects o where v.id = c.view_id and o.id = v.object_id and o.object_key = 'staff' and c.position >= 2;
insert into view_columns (view_id, field_id, position, width, is_visible)
select v.id, f.id, case f.field_key when 'role_id' then 2 else 3 end, 140, true
  from views v
  join view_objects o on o.id = v.object_id and o.object_key = 'staff'
  join object_fields f on f.object_id = o.id and f.field_key in ('role_id', 'team_id');

-- הכתובת חסומה למטפלת (כמו עד היום). אשת צוות רואה את הכתובת שלה בפרופיל.
insert into field_permissions (role_id, object_key, field_key, access)
select id, 'staff', 'address', 'hidden' from roles where name = 'מטפלת';

-- שדה בהרשאות חייב להיות שדה בקטלוג של האובייקט
create or replace function private.check_field_permission()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.field_key = 'id' or not exists (
    select 1 from public.object_fields f join public.view_objects o on o.id = f.object_id
     where o.object_key = new.object_key and f.field_key = new.field_key
  ) then
    raise exception 'השדה % לא קיים באובייקט %', new.field_key, new.object_key;
  end if;
  return new;
end
$$;
create trigger field_permissions_check before insert or update on field_permissions
  for each row execute function private.check_field_permission();

-- ===== פונקציות ההרשאה (נקראות מה-RLS ומהפונקציות) =====
create or replace function private.my_role_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select role_id from public.staff where id = (select auth.uid()) and is_active
$$;

create or replace function private.my_team_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select team_id from public.staff where id = (select auth.uid()) and is_active
$$;

-- "מנהלת" = תפקיד שמסומן כמנהלת מערכת (נשען על הדאטה, לא על שם קבוע)
create or replace function private.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s join public.roles r on r.id = s.role_id
     where s.id = (select auth.uid()) and s.is_active and r.is_admin
  )
$$;

-- ההיקף שיש לי לפעולה על אובייקט (none אם אין שורה, או אם אני לא פעילה)
create or replace function private.perm(p_object text, p_action text)
returns public.perm_scope language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_action when 'view' then rp.can_view when 'create' then rp.can_create
                         when 'edit' then rp.can_edit when 'delete' then rp.can_delete end
      from public.role_permissions rp
     where rp.role_id = private.my_role_id() and rp.object_key = p_object
  ), 'none'::public.perm_scope)
$$;

-- האם מותר לי לבצע פעולה על רשומה, לפי ההיקף ולפי מי שהרשומה שלה (owner)
create or replace function private.row_allowed(p_object text, p_action text, p_owner uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare s public.perm_scope := private.perm(p_object, p_action);
begin
  return case s
    when 'all' then true
    when 'own' then p_owner is not null and p_owner = (select auth.uid())
    when 'team' then p_owner is not null and (
      p_owner = (select auth.uid())
      or exists (select 1 from public.staff o
                  where o.id = p_owner and o.team_id is not null and o.team_id = private.my_team_id()))
    else false
  end;
end
$$;

-- צפייה ברשומה, לכל אובייקט בקטלוג (גם התראות, תפקידים וצוותים שאינם בטבלת ההרשאות)
create or replace function private.can_view_row(p_object text, p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_object in ('clients', 'appointments', 'service_requests', 'treatments', 'staff')
      then private.row_allowed(p_object, 'view', p_owner) or (p_object = 'staff' and p_owner = (select auth.uid()))
    when p_object = 'notifications' then p_owner = (select auth.uid())
    else private.is_active_staff()
  end
$$;

create or replace function private.field_hidden(p_object text, p_field text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.field_permissions
                  where role_id = private.my_role_id() and object_key = p_object
                    and field_key = p_field and access = 'hidden')
$$;

-- ===== RLS: כל המדיניות של חמש הטבלאות נקראת מטבלת ההרשאות =====
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

create policy clients_select on clients for select to authenticated using (private.row_allowed('clients', 'view', created_by));
create policy clients_insert on clients for insert to authenticated with check (private.row_allowed('clients', 'create', created_by));
create policy clients_update on clients for update to authenticated
  using (private.row_allowed('clients', 'edit', created_by)) with check (private.row_allowed('clients', 'edit', created_by));
create policy clients_delete on clients for delete to authenticated using (private.row_allowed('clients', 'delete', created_by));

create policy appointments_select on appointments for select to authenticated using (private.row_allowed('appointments', 'view', therapist_id));
create policy appointments_insert on appointments for insert to authenticated with check (private.row_allowed('appointments', 'create', therapist_id));
create policy appointments_update on appointments for update to authenticated
  using (private.row_allowed('appointments', 'edit', therapist_id)) with check (private.row_allowed('appointments', 'edit', therapist_id));
create policy appointments_delete on appointments for delete to authenticated using (private.row_allowed('appointments', 'delete', therapist_id));

create policy service_requests_select on service_requests for select to authenticated using (private.row_allowed('service_requests', 'view', assigned_to));
create policy service_requests_insert on service_requests for insert to authenticated with check (private.row_allowed('service_requests', 'create', assigned_to));
create policy service_requests_update on service_requests for update to authenticated
  using (private.row_allowed('service_requests', 'edit', assigned_to)) with check (private.row_allowed('service_requests', 'edit', assigned_to));
create policy service_requests_delete on service_requests for delete to authenticated using (private.row_allowed('service_requests', 'delete', assigned_to));

-- במחירון אין "שלי": רק "הכול" נותן גישה
create policy treatments_select on treatments for select to authenticated using (private.row_allowed('treatments', 'view', null));
create policy treatments_insert on treatments for insert to authenticated with check (private.row_allowed('treatments', 'create', null));
create policy treatments_update on treatments for update to authenticated
  using (private.row_allowed('treatments', 'edit', null)) with check (private.row_allowed('treatments', 'edit', null));
create policy treatments_delete on treatments for delete to authenticated using (private.row_allowed('treatments', 'delete', null));

-- בצוות "שלי" = אני. כל אחת רואה תמיד את השורה של עצמה.
create policy staff_select on staff for select to authenticated using (private.row_allowed('staff', 'view', id) or id = (select auth.uid()));
create policy staff_insert on staff for insert to authenticated with check (private.row_allowed('staff', 'create', id));
create policy staff_update on staff for update to authenticated
  using (private.row_allowed('staff', 'edit', id)) with check (private.row_allowed('staff', 'edit', id));
create policy staff_delete on staff for delete to authenticated using (private.row_allowed('staff', 'delete', id));

-- הטבלאות של שכבת ההרשאות: קריאה לצוות פעיל (שמות תפקיד וצוות), כתיבה למנהלת מערכת בלבד
alter table roles enable row level security;
alter table teams enable row level security;
alter table role_permissions enable row level security;
alter table field_permissions enable row level security;

create policy roles_select on roles for select to authenticated using ((select private.is_active_staff()));
create policy roles_write on roles for all to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));
create policy teams_select on teams for select to authenticated using ((select private.is_active_staff()));
create policy teams_write on teams for all to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));
create policy role_permissions_select on role_permissions for select to authenticated
  using ((select private.is_manager()) or role_id = (select private.my_role_id()));
create policy role_permissions_write on role_permissions for all to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));
create policy field_permissions_select on field_permissions for select to authenticated
  using ((select private.is_manager()) or role_id = (select private.my_role_id()));
create policy field_permissions_write on field_permissions for all to authenticated using ((select private.is_manager())) with check ((select private.is_manager()));
revoke all on roles, teams, role_permissions, field_permissions from anon;

-- תפקיד חדש מקבל שורת הרשאות "ללא" לכל אובייקט (מתחיל סגור)
create or replace function private.init_role_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.role_permissions (role_id, object_key)
  select new.id, o from unnest(array['clients', 'appointments', 'service_requests', 'treatments', 'staff']) o
  on conflict do nothing;
  return new;
end
$$;
create trigger roles_init_permissions after insert on roles for each row execute function private.init_role_permissions();

-- תמיד נשארת לפחות מנהלת מערכת פעילה אחת (כדי שאף אחת לא תינעל מחוץ להגדרות)
create or replace function private.ensure_admin_exists()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff s join public.roles r on r.id = s.role_id where s.is_active and r.is_admin) then
    raise exception 'חייבת להישאר לפחות מנהלת מערכת פעילה אחת';
  end if;
  return null;
end
$$;
create trigger roles_ensure_admin after update or delete on roles for each statement execute function private.ensure_admin_exists();
create trigger staff_ensure_admin after update or delete on staff for each statement execute function private.ensure_admin_exists();

-- ===== שדה לקריאה בלבד או חסום: לא משתנה בעדכון (חוץ מפעולת מערכת, ומעדכון הפרופיל של עצמי) =====
create or replace function private.enforce_field_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if (select auth.uid()) is null or current_setting('app.self_profile', true) = 'on' then
    return new;
  end if;
  for r in
    select fp.field_key, fp.access, f.label
      from public.field_permissions fp
      join public.view_objects o on o.object_key = fp.object_key
      join public.object_fields f on f.object_id = o.id and f.field_key = fp.field_key
     where fp.role_id = private.my_role_id() and fp.object_key = tg_table_name
       and fp.field_key not in ('created_at', 'updated_at', 'updated_by')  -- שדות מערכת מתעדכנים אוטומטית
  loop
    if tg_op = 'UPDATE' and (to_jsonb(new) -> r.field_key) is distinct from (to_jsonb(old) -> r.field_key) then
      raise exception 'אין לך הרשאה לשנות את השדה "%"', r.label;
    end if;
    if tg_op = 'INSERT' and r.access = 'hidden' and coalesce(to_jsonb(new) -> r.field_key, 'null'::jsonb) <> 'null'::jsonb
       and r.field_key not in ('created_by', 'is_active') then
      raise exception 'אין לך הרשאה למלא את השדה "%"', r.label;
    end if;
  end loop;
  return new;
end
$$;
create trigger clients_field_access before insert or update on clients for each row execute function private.enforce_field_access();
create trigger appointments_field_access before insert or update on appointments for each row execute function private.enforce_field_access();
create trigger service_requests_field_access before insert or update on service_requests for each row execute function private.enforce_field_access();
create trigger treatments_field_access before insert or update on treatments for each row execute function private.enforce_field_access();
create trigger staff_field_access before insert or update on staff for each row execute function private.enforce_field_access();

-- עדכון הפרופיל של עצמי: לא נחסם בהרשאות השדה (רק השורה שלי, רק שם/טלפון/כתובת)
create or replace function public.update_my_profile(p_full_name text, p_phone text, p_address text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_active_staff() then
    raise exception 'אין הרשאה';
  end if;
  perform set_config('app.self_profile', 'on', true);
  update public.staff
     set full_name = p_full_name,
         phone     = p_phone,
         address   = nullif(trim(coalesce(p_address, '')), '')
   where id = (select auth.uid());
  perform set_config('app.self_profile', 'off', true);
end
$$;

-- ===== שדה חסום לא נשלח ללקוח בכלל: הרשאת עמודה =====
-- עמודה שחסומה לתפקיד כלשהו לא ניתנת לקריאה ישירה מהטבלה. היא נקראת רק דרך הפונקציות
-- (run_view, get_record), שמחזירות אותה רק למי שמותר. מתעדכן אוטומטית כשמשנים הרשאת שדה.
create or replace function private.sync_column_grants(p_table text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_all text; v_allowed text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_all
    from information_schema.columns where table_schema = 'public' and table_name = p_table;
  select string_agg(quote_ident(c.column_name), ', ') into v_allowed
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table
     and c.column_name not in (select fp.field_key from public.field_permissions fp
                                where fp.object_key = p_table and fp.access = 'hidden');
  execute format('revoke select on public.%I from authenticated', p_table);
  execute format('revoke select (%s) on public.%I from authenticated', v_all, p_table);
  execute format('grant select (%s) on public.%I to authenticated', v_allowed, p_table);
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
create trigger field_permissions_sync_grants after insert or update or delete on field_permissions
  for each statement execute function private.sync_all_column_grants();
revoke execute on function private.sync_column_grants(text) from public;
revoke execute on function private.sync_all_column_grants() from public;

do $$
declare t text;
begin
  foreach t in array array['clients', 'appointments', 'service_requests', 'treatments', 'staff'] loop
    perform private.sync_column_grants(t);
  end loop;
end $$;
grant update (role_id, team_id) on staff to authenticated;

-- ===== קריאה דרך הפונקציות: היקף שורות לפי ההרשאות, ובלי שדות חסומים =====
-- שם של רשומה מקושרת: רק אם מותר לי לראות אותה, ורק אם שדה השם לא חסום לי
create or replace function private.ref_label_sql(p_field_id uuid)
returns text language sql stable set search_path = '' as $$
  select format(
    '(select case when private.field_hidden(%L, %L) then null else r.%I::text end from public.%I r where r.id = t.%I and private.can_view_row(%L, %s))',
    o.object_key, o.display_field, o.display_field, o.object_key, f.field_key, o.object_key,
    case when o.owner_field is null then 'null::uuid' else format('r.%I', o.owner_field) end)
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
    if not v_field.is_filterable or private.field_hidden(p_object, v_field.field_key) then
      raise exception 'אי אפשר לסנן לפי השדה %', v_field.label;
    end if;
    v_parts := v_parts || private.filter_sql(v_field, f.op, f.val);
  end loop;

  if cardinality(v_parts) > 0 then
    v_where := '(' || array_to_string(v_parts,
                 case when p_def->>'match' = 'any' then ' or ' else ' and ' end) || ')';
  end if;

  if p_search is not null and trim(p_search) <> '' then
    v_digits := regexp_replace(p_search, '\D', '', 'g');
    for v_field in select * from public.object_fields
                    where object_id = v_obj.id and is_searchable and not private.field_hidden(p_object, field_key) loop
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

  -- רק שורות שמותר לי לראות (הפונקציות שקוראות מכאן רצות בהרשאות המערכת)
  v_where := v_where || format(' and private.can_view_row(%L, %s)', p_object,
               case when v_obj.owner_field is null then 'null::uuid' else format('t.%I', v_obj.owner_field) end);
  return v_where;
end
$$;

create or replace function public.run_view(p_object text, p_def jsonb, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
  if not private.is_active_staff() then raise exception 'אין הרשאה'; end if;
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found then raise exception 'אובייקט לא מוכר או שאין לך הרשאה: %', p_object; end if;
  v_where := private.view_where(p_object, p_def, p_search);

  -- עמודה חסומה לא נכנסת לשאילתה, ולכן לא נשלחת בכלל
  for v_field in
    select f.* from jsonb_array_elements_text(coalesce(p_def->'columns', '[]'::jsonb)) with ordinality c(k, n)
      join public.object_fields f on f.object_id = v_obj.id and f.field_key = c.k
     where not private.field_hidden(p_object, f.field_key)
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
    if private.field_hidden(p_object, v_field.field_key) then continue; end if;
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
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_obj_id uuid;
begin
  if not private.is_active_staff() then raise exception 'אין הרשאה'; end if;
  select id into v_obj_id from public.view_objects where object_key = p_object;
  if not exists (select 1 from public.object_fields
                  where object_id = v_obj_id and field_key = p_group_field and field_type in ('choice', 'boolean'))
     or private.field_hidden(p_object, p_group_field) then
    raise exception 'שדה קיבוץ לא מוכר: %', p_group_field;
  end if;
  execute format('select coalesce(jsonb_object_agg(coalesce(g, ''''), n), ''{}''::jsonb)
                    from (select t.%I::text as g, count(*) as n from public.%I t where %s group by 1) x',
                 p_group_field, p_object, private.view_where(p_object, p_def, p_search))
  into v_result;
  return v_result;
end
$$;

-- רשומה אחת: רק אם מותר לי לראות אותה, רק שדות הקטלוג שלא חסומים לי, ושמות לשדות מקושרים
create or replace function public.get_record(p_object text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_obj   public.view_objects;
  v_row   jsonb;
  v_owner uuid;
  v_out   jsonb;
  v_label text;
  f       public.object_fields;
begin
  if not private.is_active_staff() then raise exception 'אין הרשאה'; end if;
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found then raise exception 'אובייקט לא מוכר: %', p_object; end if;
  execute format('select to_jsonb(t), %s from public.%I t where t.id = $1',
                 case when v_obj.owner_field is null then 'null::uuid' else format('t.%I', v_obj.owner_field) end, p_object)
    into v_row, v_owner using p_id;
  if v_row is null or not private.can_view_row(p_object, v_owner) then return null; end if;

  v_out := jsonb_build_object('id', v_row -> 'id');
  for f in select * from public.object_fields where object_id = v_obj.id and not private.field_hidden(p_object, field_key) loop
    v_out := v_out || jsonb_build_object(f.field_key, v_row -> f.field_key);
    if f.field_type = 'reference' then
      execute format('select %s from public.%I t where t.id = $1', private.ref_label_sql(f.id), p_object) into v_label using p_id;
      v_out := v_out || jsonb_build_object(f.field_key || '__label', v_label);
    end if;
  end loop;
  return v_out;
end
$$;
revoke execute on function public.get_record(text, uuid) from anon;

-- ===== מי אני והרשאות שלי (לממשק: אילו כפתורים ושדות להציג. האכיפה עצמה במסד) =====
create or replace function public.get_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'full_name', s.full_name, 'email', s.email, 'phone', s.phone, 'address', s.address,
    'is_active', s.is_active, 'role_id', s.role_id, 'role_name', r.name, 'is_admin', r.is_admin,
    'team_id', s.team_id, 'team_name', t.name)
    from public.staff s join public.roles r on r.id = s.role_id left join public.teams t on t.id = s.team_id
   where s.id = (select auth.uid())
$$;
revoke execute on function public.get_me() from anon;

create or replace function public.get_my_permissions()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'objects', coalesce((select jsonb_object_agg(object_key, jsonb_build_object(
                 'view', can_view, 'create', can_create, 'edit', can_edit, 'delete', can_delete))
               from public.role_permissions where role_id = private.my_role_id()), '{}'::jsonb),
    'fields', coalesce((select jsonb_object_agg(object_key || '.' || field_key, access)
               from public.field_permissions where role_id = private.my_role_id()), '{}'::jsonb))
$$;
revoke execute on function public.get_my_permissions() from anon;

-- שכפול תפקיד: אותן הרשאות אובייקט ושדה, בשם חדש
create or replace function public.duplicate_role(p_role_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_manager() then raise exception 'רק מנהלת מערכת יכולה לנהל תפקידים'; end if;
  insert into public.roles (name, description, is_admin)
  select p_name, description, false from public.roles where id = p_role_id
  returning id into v_id;
  if v_id is null then raise exception 'התפקיד המקורי לא נמצא'; end if;
  insert into public.role_permissions (role_id, object_key, can_view, can_create, can_edit, can_delete)
  select v_id, object_key, can_view, can_create, can_edit, can_delete from public.role_permissions where role_id = p_role_id
  on conflict (role_id, object_key) do update
    set can_view = excluded.can_view, can_create = excluded.can_create, can_edit = excluded.can_edit, can_delete = excluded.can_delete;
  insert into public.field_permissions (role_id, object_key, field_key, access)
  select v_id, object_key, field_key, access from public.field_permissions where role_id = p_role_id;
  return v_id;
end
$$;
revoke execute on function public.duplicate_role(uuid, text) from anon;

-- הכתובת נקראת עכשיו כשדה רגיל (get_record למורשות, get_me לעצמי)
drop function public.get_staff_address(uuid);
