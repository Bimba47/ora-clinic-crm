-- 0005: "עודכנה על ידי" (updated_by) בכל שש טבלאות העסק
-- נקבע אוטומטית במסד בכל יצירה ועדכון, לפי המשתמשת המחוברת. פעולת מערכת (בלי משתמשת) משאירה אותו ריק.
-- נדרש למסך הרשומה: "מי עדכן אחרון ומתי".

-- ===== העמודה =====
alter table staff            add column updated_by uuid references staff (id) on delete set null;
alter table clients          add column updated_by uuid references staff (id) on delete set null;
alter table treatments       add column updated_by uuid references staff (id) on delete set null;
alter table appointments     add column updated_by uuid references staff (id) on delete set null;
alter table service_requests add column updated_by uuid references staff (id) on delete set null;
alter table notifications    add column updated_by uuid references staff (id) on delete set null;

create index staff_updated_by_idx            on staff (updated_by);
create index clients_updated_by_idx          on clients (updated_by);
create index treatments_updated_by_idx       on treatments (updated_by);
create index appointments_updated_by_idx     on appointments (updated_by);
create index service_requests_updated_by_idx on service_requests (updated_by);
create index notifications_updated_by_idx    on notifications (updated_by);

-- בטבלת הצוות ההרשאות הן לפי עמודה (בגלל הכתובת), ולכן צריך לאפשר קריאה גם של העמודה החדשה
grant select (updated_by) on staff to authenticated;

-- ===== מילוי לרשומות קיימות =====
-- מי שעדכנה אחרונה לפי יומן הפעילות. אם אין, מי שיצרה (בטבלאות שיש להן created_by).
-- בלי להפעיל את הטריגרים של updated_at ושל היומן, כדי שהמילוי לא ייראה כעדכון.
alter table staff            disable trigger staff_updated_at,            disable trigger staff_audit;
alter table clients          disable trigger clients_updated_at,          disable trigger clients_audit;
alter table treatments       disable trigger treatments_updated_at,       disable trigger treatments_audit;
alter table appointments     disable trigger appointments_updated_at,     disable trigger appointments_audit;
alter table service_requests disable trigger service_requests_updated_at, disable trigger service_requests_audit;
alter table notifications    disable trigger notifications_updated_at,    disable trigger notifications_audit;

create temp table _last_actor on commit drop as
  select distinct on (table_name, record_id) table_name, record_id, actor_id
    from audit_log
   where actor_id is not null
   order by table_name, record_id, created_at desc;

update staff t set updated_by = a.actor_id from _last_actor a where a.table_name = 'staff' and a.record_id = t.id;
update treatments t set updated_by = a.actor_id from _last_actor a where a.table_name = 'treatments' and a.record_id = t.id;
update notifications t set updated_by = a.actor_id from _last_actor a where a.table_name = 'notifications' and a.record_id = t.id;
update clients t set updated_by = coalesce(
  (select actor_id from _last_actor a where a.table_name = 'clients' and a.record_id = t.id), t.created_by);
update appointments t set updated_by = coalesce(
  (select actor_id from _last_actor a where a.table_name = 'appointments' and a.record_id = t.id), t.created_by);
update service_requests t set updated_by = coalesce(
  (select actor_id from _last_actor a where a.table_name = 'service_requests' and a.record_id = t.id), t.created_by);

alter table staff            enable trigger staff_updated_at,            enable trigger staff_audit;
alter table clients          enable trigger clients_updated_at,          enable trigger clients_audit;
alter table treatments       enable trigger treatments_updated_at,       enable trigger treatments_audit;
alter table appointments     enable trigger appointments_updated_at,     enable trigger appointments_audit;
alter table service_requests enable trigger service_requests_updated_at, enable trigger service_requests_audit;
alter table notifications    enable trigger notifications_updated_at,    enable trigger notifications_audit;

-- ===== מילוי אוטומטי מעכשיו =====
create or replace function private.set_updated_by()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- רק משתמשת שרשומה בצוות. פעולת מערכת משאירה ריק.
  select s.id into new.updated_by from public.staff s where s.id = (select auth.uid());
  return new;
end
$$;

create trigger staff_updated_by            before insert or update on staff            for each row execute function private.set_updated_by();
create trigger clients_updated_by          before insert or update on clients          for each row execute function private.set_updated_by();
create trigger treatments_updated_by       before insert or update on treatments       for each row execute function private.set_updated_by();
create trigger appointments_updated_by     before insert or update on appointments     for each row execute function private.set_updated_by();
create trigger service_requests_updated_by before insert or update on service_requests for each row execute function private.set_updated_by();
create trigger notifications_updated_by    before insert or update on notifications    for each row execute function private.set_updated_by();

-- ===== יומן הפעילות: updated_by לא נחשב "שדה שהשתנה", בדיוק כמו updated_at =====
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
     where k not in ('updated_at', 'updated_by')
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

-- ===== קטלוג מנוע התצוגות: השדה החדש, לקריאה בלבד =====
insert into object_fields (object_id, field_key, label, field_type, ref_object_id, position, default_visible, is_searchable, is_required, is_editable)
select o.id, 'updated_by', x.label, 'reference', (select id from view_objects where object_key = 'staff'),
       (select coalesce(max(position), 0) + 1 from object_fields f where f.object_id = o.id),
       false, false, false, false
  from view_objects o
  join (values
    ('staff', 'עודכנה על ידי'),
    ('clients', 'עודכנה על ידי'),
    ('treatments', 'עודכן על ידי'),
    ('appointments', 'עודכן על ידי'),
    ('service_requests', 'עודכנה על ידי'),
    ('notifications', 'עודכנה על ידי')
  ) as x(object_key, label) on x.object_key = o.object_key;
