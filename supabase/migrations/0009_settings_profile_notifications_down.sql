-- ביטול 0009: חוזר למצב שאחרי 0008
-- התראות: הקישור הכללי חוזר ל-request_id (רק התראות שמקושרות לקריאה נשמרות; האחרות נמחקות).
-- הגדרות, העדפות ולוגו נמחקים. קבצי לוגו שהועלו נמחקים מהאחסון.

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime drop table notifications;
  end if;
end $$;

delete from object_fields f using view_objects o
 where o.id = f.object_id and o.object_key = 'notifications' and f.field_key = 'kind';

alter table notifications add column request_id uuid references service_requests (id) on delete cascade;
delete from notifications where object_key is distinct from 'service_requests';
update notifications set request_id = record_id;
alter table notifications alter column request_id set not null;
alter table notifications
  drop constraint notifications_link_check,
  drop constraint notifications_object_check,
  drop column kind,
  drop column object_key,
  drop column record_id;
drop type notification_kind;

insert into object_fields (object_id, field_key, label, field_type, ref_object_id, position, default_visible, is_searchable, is_required, is_editable, is_filterable)
select o.id, 'request_id', 'קריאה', 'reference', (select id from view_objects where object_key = 'service_requests'),
       2, true, false, false, false, true
  from view_objects o where o.object_key = 'notifications';

drop function if exists public.sync_my_email();
drop function if exists public.update_my_profile(text, text, text);
drop table if exists user_preferences;

drop policy if exists branding_read on storage.objects;
drop policy if exists branding_insert on storage.objects;
drop policy if exists branding_update on storage.objects;
drop policy if exists branding_delete on storage.objects;
delete from storage.objects where bucket_id = 'branding';
delete from storage.buckets where id = 'branding';

drop table if exists app_settings;
