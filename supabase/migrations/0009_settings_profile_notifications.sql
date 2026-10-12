-- 0009: אזור הגדרות, פרופיל אישי ומרכז התראות

-- ===== 1. הגדרות המערכת: טבלת מפתח-ערך =====
-- הקוד קורא מכאן את שם המערכת והלוגו. אין שם או לוגו בקוד.
create table app_settings (
  key         text primary key check (key ~ '^[a-z_]+$'),
  value       jsonb not null default 'null'::jsonb,
  label       text not null,
  is_public   boolean not null default false,   -- גלוי גם לפני כניסה (למשל במסך הכניסה)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff (id) on delete set null
);

insert into app_settings (key, value, label, is_public) values
  ('app_name', to_jsonb('קליניקת אורה'::text), 'שם המערכת', true),
  ('logo_url', 'null'::jsonb, 'לוגו', true);

create trigger app_settings_updated_at before update on app_settings for each row execute function private.set_updated_at();
create trigger app_settings_updated_by before insert or update on app_settings for each row execute function private.set_updated_by();

alter table app_settings enable row level security;
-- לפני כניסה: רק הגדרות ציבוריות (שם ולוגו למסך הכניסה). אחרי כניסה: כל ההגדרות לצוות פעיל.
create policy app_settings_select_public on app_settings for select to anon
  using (is_public);
create policy app_settings_select on app_settings for select to authenticated
  using (is_public or (select private.is_active_staff()));
create policy app_settings_update on app_settings for update to authenticated
  using ((select private.is_manager())) with check ((select private.is_manager()));
-- מפתחות נוספים רק במיגרציה: אין הרשאת הוספה או מחיקה מהממשק
revoke insert, delete, truncate on app_settings from anon, authenticated;
revoke update on app_settings from anon;

-- ===== לוגו: אחסון קבצים. קריאה לכולם, העלאה והחלפה למנהלת בלבד =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

create policy branding_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'branding');  -- בלי פונקציית הרשאה, כדי שגם לפני כניסה הלוגו ייטען
create policy branding_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and (select private.is_manager()));
create policy branding_update on storage.objects for update to authenticated
  using (bucket_id = 'branding' and (select private.is_manager()));
create policy branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and (select private.is_manager()));

-- ===== 2. פרופיל אישי =====
-- העדפות של כל משתמשת: איזה מסך נפתח בכניסה, והאם לקבל התראות גם במייל
create table user_preferences (
  staff_id             uuid primary key default auth.uid() references staff (id) on delete cascade,
  landing_path         text not null default '/'
                       check (landing_path in ('/', '/clients', '/appointments/list', '/requests', '/notifications')),
  email_notifications  boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on user_preferences for each row execute function private.set_updated_at();

alter table user_preferences enable row level security;
create policy user_preferences_select on user_preferences for select to authenticated
  using (staff_id = (select auth.uid()));
create policy user_preferences_insert on user_preferences for insert to authenticated
  with check (staff_id = (select auth.uid()) and (select private.is_active_staff()));
create policy user_preferences_update on user_preferences for update to authenticated
  using (staff_id = (select auth.uid())) with check (staff_id = (select auth.uid()));
revoke all on user_preferences from anon;
revoke delete, truncate on user_preferences from authenticated;

-- עדכון הפרטים שלי: שם, טלפון וכתובת, רק בשורה שלי (התפקיד והסטטוס לא משתנים מכאן)
create or replace function public.update_my_profile(p_full_name text, p_phone text, p_address text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_active_staff() then
    raise exception 'אין הרשאה';
  end if;
  update public.staff
     set full_name = p_full_name,
         phone     = p_phone,
         address   = nullif(trim(coalesce(p_address, '')), '')
   where id = (select auth.uid());
end
$$;
revoke execute on function public.update_my_profile(text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text) to authenticated;

-- אחרי החלפת אימייל ב-Supabase Auth (ואישור בקישור): מעדכן את האימייל גם בטבלת הצוות
create or replace function public.sync_my_email()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.staff s
     set email = u.email
    from auth.users u
   where u.id = (select auth.uid()) and s.id = u.id and s.email is distinct from u.email;
end
$$;
revoke execute on function public.sync_my_email() from public, anon;
grant execute on function public.sync_my_email() to authenticated;

-- ===== 3. מרכז התראות: סוג וקישור לכל רשומה =====
-- יצירת התראה היא הוספת שורה אחת: recipient_id, message, ואופציונלית kind ו-object_key + record_id.
create type notification_kind as enum ('assignment', 'reminder', 'update', 'system');

alter table notifications
  add column kind       notification_kind not null default 'system',
  add column object_key text,
  add column record_id  uuid;

update notifications set kind = 'assignment', object_key = 'service_requests', record_id = request_id;

alter table notifications
  add constraint notifications_link_check check ((object_key is null) = (record_id is null)),
  add constraint notifications_object_check
    check (object_key is null or object_key in ('clients', 'appointments', 'service_requests', 'staff', 'treatments'));

-- הקישור הישן לקריאה בלבד מוחלף בקישור הכללי (גם בקטלוג ובתצוגות)
delete from object_fields f using view_objects o
 where o.id = f.object_id and o.object_key = 'notifications' and f.field_key = 'request_id';
alter table notifications drop column request_id;

insert into object_fields (object_id, field_key, label, field_type, options, position, default_visible, is_searchable, is_required, is_editable, is_filterable)
select o.id, 'kind', 'סוג', 'choice',
       '[{"value":"assignment","label":"שיוך"},{"value":"reminder","label":"תזכורת"},{"value":"update","label":"עדכון"},{"value":"system","label":"מערכת"}]'::jsonb,
       2, true, false, false, false, true
  from view_objects o where o.object_key = 'notifications';

-- בתצוגות ההתראות: עמודת "סוג" אחרי ההודעה
update view_columns c set position = c.position + 1
  from views v, view_objects o
 where v.id = c.view_id and o.id = v.object_id and o.object_key = 'notifications' and c.position >= 1;
insert into view_columns (view_id, field_id, position, width, is_visible)
select v.id, f.id, 1, 120, true
  from views v
  join view_objects o on o.id = v.object_id and o.object_key = 'notifications'
  join object_fields f on f.object_id = o.id and f.field_key = 'kind';

-- עדכון חי של מונה ההתראות (Realtime מכבד את ה-RLS: כל אחת מקבלת רק את שלה)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
