-- 0012: שמירות על נתוני ההרשאות, כדי שמסך ההרשאות לא יוכל לשמור צירוף שלא עובד.
-- 1. למחירון אין "שלי" ואין "הצוות שלי" (לטיפול אין אחראית): רק "אין" או "הכול".
-- 2. שדה חובה לא יכול להיות חסום (אחרת אי אפשר ליצור רשומה), ושדה בהרשאת שדה חייב להיות בקטלוג.

alter table role_permissions add constraint role_permissions_treatments_scope check (
  object_key <> 'treatments'
  or (can_view in ('none', 'all') and can_create in ('none', 'all') and can_edit in ('none', 'all') and can_delete in ('none', 'all'))
);

create or replace function private.check_field_permission_target()
returns trigger language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  select fl.label, fl.is_required into f
    from public.object_fields fl join public.view_objects o on o.id = fl.object_id
   where o.object_key = new.object_key and fl.field_key = new.field_key;
  if not found then
    raise exception 'השדה "%" לא קיים באובייקט', new.field_key;
  end if;
  if new.access = 'hidden' and f.is_required then
    raise exception 'אי אפשר לחסום את השדה "%", כי הוא שדה חובה. אפשר להגדיר אותו לקריאה בלבד.', f.label;
  end if;
  return new;
end
$$;

create trigger field_permissions_target before insert or update on field_permissions
  for each row execute function private.check_field_permission_target();
