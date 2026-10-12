-- ביטול 0005: מחזיר את המסד למצב שאחרי 0004 (בלי updated_by)

delete from object_fields where field_key = 'updated_by';

drop trigger if exists staff_updated_by            on staff;
drop trigger if exists clients_updated_by          on clients;
drop trigger if exists treatments_updated_by       on treatments;
drop trigger if exists appointments_updated_by     on appointments;
drop trigger if exists service_requests_updated_by on service_requests;
drop trigger if exists notifications_updated_by    on notifications;
drop function if exists private.set_updated_by();

-- יומן הפעילות כפי שהיה: רק updated_at מוחרג מ"שדות שהשתנו"
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

revoke select (updated_by) on staff from authenticated;

alter table staff            drop column if exists updated_by;
alter table clients          drop column if exists updated_by;
alter table treatments       drop column if exists updated_by;
alter table appointments     drop column if exists updated_by;
alter table service_requests drop column if exists updated_by;
alter table notifications    drop column if exists updated_by;
