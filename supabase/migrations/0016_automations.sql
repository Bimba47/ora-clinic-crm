-- 0016: מנוע אוטומציות שמוגדר מהממשק.
-- כלל = אובייקט + טריגר (יצירה / עדכון / תזמון) + תנאים + פעולות. הכללים הם נתונים (automation_rules), לא קוד.
-- פונקציה גנרית אחת (private.automation_dispatch) נקראת מטריגר AFTER INSERT OR UPDATE על כל טבלת אובייקט,
-- ובתזמון מ-pg_cron. כל הרצה נרשמת ב-automation_logs (הצלחה, כישלון, דילוג).
-- הגנה מלולאה: עומק ההרצה נשמר בהקשר הטרנזקציה (app.automation_depth). מעל עומק 3 – עצירה ודילוג.
-- כישלון בכלל אחד לא מפיל את השמירה ולא עוצר כללים אחרים (כל כלל בתת-טרנזקציה משלו).

create extension if not exists pg_cron;

create type automation_event as enum ('create', 'update', 'schedule');
create type automation_log_status as enum ('success', 'failed', 'skipped');

-- ===== טבלאות =====
create table automation_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  object_name    text not null,
  is_active      boolean not null default true,
  trigger_event  automation_event not null,
  trigger_fields text[] not null default '{}',       -- רק לעדכון: ריק = כל שינוי
  schedule_cron  text,                               -- רק לתזמון (לפי UTC)
  conditions     jsonb not null default '{"match":"all","rules":[]}',
  actions        jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references staff (id) on delete set null
);
create index automation_rules_lookup_idx on automation_rules (object_name, trigger_event) where is_active;
create index automation_rules_updated_by_idx on automation_rules (updated_by);

create table automation_logs (
  id          uuid primary key default gen_random_uuid(),
  rule_id     uuid not null references automation_rules (id) on delete cascade,
  object_name text,
  record_id   uuid,
  status      automation_log_status not null,
  message     text,
  executed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index automation_logs_rule_idx on automation_logs (rule_id, executed_at desc);
create index automation_logs_time_idx on automation_logs (executed_at desc);

create trigger automation_rules_updated_at before update on automation_rules for each row execute function private.set_updated_at();
create trigger automation_rules_updated_by before insert or update on automation_rules for each row execute function private.set_updated_by();

-- רק מנהלת מערכת מגדירה כללים ורואה את הלוג. הלוג נכתב רק על ידי המנוע.
alter table automation_rules enable row level security;
alter table automation_logs enable row level security;
create policy automation_rules_all on automation_rules for all to authenticated
  using ((select private.is_manager())) with check ((select private.is_manager()));
create policy automation_logs_select on automation_logs for select to authenticated using ((select private.is_manager()));
revoke all on automation_rules, automation_logs from anon;
grant select, insert, update, delete on automation_rules to authenticated;
grant select on automation_logs to authenticated;

-- ===== הסכמה: אובייקטים, סוגי שדות ואופרטורים =====
create or replace function private.automation_objects()
returns text[] language sql immutable set search_path = '' as $$
  select array['clients', 'appointments', 'service_requests', 'treatments', 'staff', 'tasks']
$$;

-- אופרטורים לפי סוג שדה (לפי המפרט). שינוי (changed…) מותר רק בעדכון, לכל סוג.
create or replace function private.automation_ops(p_type text)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_type in ('text', 'long_text', 'phone', 'email') then array['eq', 'neq', 'contains', 'is_empty', 'is_not_empty']
    when p_type in ('number', 'money', 'date', 'datetime') then array['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty']
    when p_type = 'choice' then array['eq', 'neq', 'in', 'not_in']
    when p_type = 'reference' then array['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty']
    when p_type = 'boolean' then array['is_true', 'is_false']
    else array[]::text[]
  end
$$;

create or replace function private.automation_change_ops()
returns text[] language sql immutable set search_path = '' as $$
  select array['changed', 'changed_to', 'changed_from']
$$;

create or replace function private.automation_field(p_object text, p_field text)
returns table (field_type text, label text, options jsonb, ref_object text)
language sql stable security definer set search_path = '' as $$
  select f.field_type::text, f.label, f.options, r.object_key
    from public.object_fields f
    join public.view_objects o on o.id = f.object_id
    left join public.view_objects r on r.id = f.ref_object_id
   where o.object_key = p_object and f.field_key = p_field
$$;

-- ===== ערכים ותבניות: {{field}}, {{field:label}}, {{ref.field}}, {{today}}, {{today+1}}, {{now}}, {{user}}, {{user_name}}, {{a|b}} =====
create or replace function private.automation_label(p_object text, p_field text, p_value text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare f record; v text;
begin
  if p_value is null then return null; end if;
  select * into f from private.automation_field(p_object, p_field);
  if not found then return p_value; end if;
  if f.field_type in ('choice', 'boolean') then
    select o->>'label' into v from jsonb_array_elements(coalesce(f.options, '[]')) o where o->>'value' = p_value;
    return coalesce(v, p_value);
  elsif f.field_type = 'reference' then
    execute format('select t.%I::text from public.%I t where t.id = $1',
                   (select display_field from public.view_objects where object_key = f.ref_object), f.ref_object)
      into v using p_value::uuid;
    return v;
  elsif f.field_type = 'datetime' then
    return to_char(p_value::timestamptz at time zone 'Asia/Jerusalem', 'DD.MM.YYYY HH24:MI');
  elsif f.field_type = 'date' then
    return to_char(p_value::date, 'DD.MM.YYYY');
  end if;
  return p_value;
end
$$;

create or replace function private.automation_token(p_token text, p_object text, p_rec jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_tok text := trim(p_token); v_alt text; v_val text; v_field text; v_sub text; v_ref text; n int;
begin
  if position('|' in v_tok) > 0 then   -- הראשון שיש לו ערך
    foreach v_alt in array string_to_array(v_tok, '|') loop
      v_val := private.automation_token(v_alt, p_object, p_rec);
      if coalesce(v_val, '') <> '' then return v_val; end if;
    end loop;
    return null;
  end if;
  if v_tok = 'now' then return to_jsonb(now()) #>> '{}'; end if;
  if v_tok ~ '^today([+-][0-9]+)?$' then
    n := coalesce(nullif(substring(v_tok from 6), ''), '0')::int;
    return ((now() at time zone 'Asia/Jerusalem')::date + n)::text;
  end if;
  if v_tok = 'user' then return (select auth.uid())::text; end if;
  if v_tok = 'user_name' then
    return coalesce((select full_name from public.staff where id = (select auth.uid())), 'המערכת');
  end if;
  if v_tok like '%:label' then
    v_field := split_part(v_tok, ':', 1);
    return private.automation_label(p_object, v_field, p_rec ->> v_field);
  end if;
  if position('.' in v_tok) > 0 then   -- שדה ברשומה המקושרת, למשל {{treatment_id.price}}
    v_field := split_part(v_tok, '.', 1);
    v_sub := split_part(v_tok, '.', 2);
    select ref_object into v_ref from private.automation_field(p_object, v_field);
    if v_ref is null or p_rec ->> v_field is null then return null; end if;
    if v_sub <> 'id' and not exists (select 1 from private.automation_field(v_ref, v_sub)) then return null; end if;
    execute format('select to_jsonb(t) ->> %L from public.%I t where t.id = $1', v_sub, v_ref)
      into v_val using (p_rec ->> v_field)::uuid;
    return v_val;
  end if;
  return p_rec ->> v_tok;
end
$$;

create or replace function private.automation_render(p_text text, p_object text, p_rec jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare m text[]; v_out text := p_text;
begin
  if p_text is null then return null; end if;
  if p_text ~ '^\s*\{\{[^{}]+\}\}\s*$' then   -- תבנית אחת בלבד: הערך עצמו (גם ריק)
    return private.automation_token(substring(p_text from '\{\{([^{}]+)\}\}'), p_object, p_rec);
  end if;
  for m in select regexp_matches(p_text, '(\{\{([^{}]+)\}\})', 'g') loop
    v_out := replace(v_out, m[1], coalesce(private.automation_token(m[2], p_object, p_rec), ''));
  end loop;
  return v_out;
end
$$;

-- ערך מתוך jsonb (מחרוזת עם תבניות, מספר, בוליאני). מחרוזת ריקה = ריק.
create or replace function private.automation_value(p_value jsonb, p_object text, p_rec jsonb)
returns text language sql stable security definer set search_path = '' as $$
  select nullif(case jsonb_typeof(p_value)
                  when 'string' then private.automation_render(p_value #>> '{}', p_object, p_rec)
                  when 'null' then null
                  else p_value #>> '{}'
                end, '')
$$;

-- השוואה לפי סוג השדה: -1 / 0 / 1, או null אם אחד הצדדים ריק
create or replace function private.automation_compare(p_type text, a text, b text)
returns int language plpgsql stable set search_path = '' as $$
begin
  if a is null or b is null then return null; end if;
  if p_type in ('number', 'money') then return sign(a::numeric - b::numeric)::int; end if;
  if p_type = 'date' then return case when a::date = b::date then 0 when a::date < b::date then -1 else 1 end; end if;
  if p_type = 'datetime' then
    if b ~ '^\d{4}-\d{2}-\d{2}$' then   -- השוואה ליום (למשל {{today}}) לפי שעון ישראל
      return case when (a::timestamptz at time zone 'Asia/Jerusalem')::date = b::date then 0
                  when (a::timestamptz at time zone 'Asia/Jerusalem')::date < b::date then -1 else 1 end;
    end if;
    return case when a::timestamptz = b::timestamptz then 0 when a::timestamptz < b::timestamptz then -1 else 1 end;
  end if;
  return case when a = b then 0 when a < b then -1 else 1 end;
end
$$;

-- ===== תנאים =====
create or replace function private.automation_conditions_met(p_cond jsonb, p_object text, p_new jsonb, p_old jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb; v_rules jsonb := coalesce(p_cond -> 'rules', '[]'); v_any boolean := false; v_all boolean := true;
  f text; op text; t text; a text; o text; b text; arr text[]; ok boolean; cmp int;
begin
  if jsonb_array_length(v_rules) = 0 then return true; end if;
  for r in select * from jsonb_array_elements(v_rules) loop
    f := r ->> 'field';
    op := r ->> 'op';
    select field_type into t from private.automation_field(p_object, f);
    a := nullif(p_new ->> f, '');
    o := case when p_old is null then null else nullif(p_old ->> f, '') end;
    b := private.automation_value(r -> 'value', p_object, p_new);
    if op in ('in', 'not_in') then
      arr := case when jsonb_typeof(r -> 'value') = 'array'
                  then (select array_agg(private.automation_value(x, p_object, p_new)) from jsonb_array_elements(r -> 'value') x)
                  else string_to_array(coalesce(b, ''), ',') end;
    end if;
    cmp := case when op in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'changed_to') then private.automation_compare(t, a, b)
                when op = 'changed_from' then private.automation_compare(t, o, b) end;
    ok := case op
      when 'eq' then cmp = 0
      when 'neq' then coalesce(cmp <> 0, (a is null) <> (b is null))
      when 'contains' then a ilike '%' || coalesce(b, '') || '%'
      when 'gt' then cmp > 0
      when 'gte' then cmp >= 0
      when 'lt' then cmp < 0
      when 'lte' then cmp <= 0
      when 'is_empty' then a is null
      when 'is_not_empty' then a is not null
      when 'in' then a = any(arr)
      when 'not_in' then a is null or not (a = any(arr))
      when 'is_true' then a = 'true'
      when 'is_false' then coalesce(a, 'false') = 'false'
      when 'changed' then p_old is not null and a is distinct from o
      when 'changed_to' then p_old is not null and a is distinct from o and cmp = 0
      when 'changed_from' then p_old is not null and a is distinct from o and cmp = 0
    end;
    if coalesce(ok, false) then v_any := true; else v_all := false; end if;
  end loop;
  return case when p_cond ->> 'match' = 'any' then v_any else v_all end;
end
$$;

-- ===== פעולות =====
create or replace function private.automation_execute(p_actions jsonb, p_object text, p_rec jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  a jsonb; v text; obj text; fld text; n int; v_id uuid := (p_rec ->> 'id')::uuid; v_new uuid;
  v_vals jsonb; k text; cols text; v_to text; v_msg text; v_out text[] := '{}';
begin
  for a in select * from jsonb_array_elements(p_actions) loop
    case a ->> 'type'
    when 'update_field' then
      fld := a ->> 'field';
      v := private.automation_value(a -> 'value', p_object, p_rec);
      execute format('update public.%I set %I = (jsonb_populate_record(null::public.%I, $1)).%I where id = $2',
                     p_object, fld, p_object, fld)
        using jsonb_build_object(fld, v), v_id;
      v_out := v_out || format('עודכן %s', (select label from private.automation_field(p_object, fld)));

    when 'update_related' then
      obj := a ->> 'object';
      fld := a ->> 'field';
      v := private.automation_value(a -> 'value', p_object, p_rec);
      -- רק רשומות שעוד לא מכילות את הערך (למשל: רק משימות פתוחות נסגרות)
      execute format('update public.%1$I t set %2$I = (jsonb_populate_record(null::public.%1$I, $1)).%2$I
                       where t.%3$I = $2 and t.%2$I is distinct from (jsonb_populate_record(null::public.%1$I, $1)).%2$I',
                     obj, fld, a ->> 'match_field')
        using jsonb_build_object(fld, v), v_id;
      get diagnostics n = row_count;
      v_out := v_out || format('עודכנו %s רשומות ב%s', n, (select label_plural from public.view_objects where object_key = obj));

    when 'create_record' then
      obj := a ->> 'object';
      v_vals := '{}';
      for k in select jsonb_object_keys(coalesce(a -> 'values', '{}')) loop
        v_vals := v_vals || jsonb_build_object(k, private.automation_value(a -> 'values' -> k, p_object, p_rec));
      end loop;
      if coalesce(a ->> 'link_field', '') <> '' then
        v_vals := v_vals || jsonb_build_object(a ->> 'link_field', v_id);
      end if;
      select string_agg(quote_ident(x), ', ') into cols from jsonb_object_keys(v_vals) x;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
                     obj, cols, cols, obj)
        into v_new using v_vals;
      v_out := v_out || format('נוצרה רשומה ב%s', (select label_plural from public.view_objects where object_key = obj));

    when 'notify' then
      v_to := case when a ->> 'to' = 'record_owner'
                   then p_rec ->> (select owner_field from public.view_objects where object_key = p_object)
                   else private.automation_value(a -> 'to', p_object, p_rec) end;
      v_msg := private.automation_value(a -> 'message', p_object, p_rec);
      if v_to is null or not exists (select 1 from public.staff where id = v_to::uuid and is_active) then
        v_out := v_out || 'לא נשלחה התראה: אין נמענת פעילה';
      else
        insert into public.notifications (recipient_id, message, kind, object_key, record_id)
        values (v_to::uuid, coalesce(v_msg, ''), coalesce(nullif(a ->> 'kind', ''), 'system')::public.notification_kind, p_object, v_id);
        v_out := v_out || format('נשלחה התראה ל%s', (select full_name from public.staff where id = v_to::uuid));
      end if;

    else
      raise exception 'סוג פעולה לא מוכר: %', a ->> 'type';
    end case;
  end loop;
  return array_to_string(v_out, '; ');
end
$$;

-- ===== המנוע =====
create or replace function private.automation_depth()
returns int language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.automation_depth', true), ''), '0')::int
$$;

create or replace function private.automation_dispatch(p_object text, p_event text, p_new jsonb, p_old jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rule public.automation_rules; d int := private.automation_depth(); v_changed text[]; v_msg text;
  v_id uuid := (p_new ->> 'id')::uuid;
begin
  if p_event = 'update' then
    select array_agg(k) into v_changed from jsonb_object_keys(p_new) k
     where k not in ('updated_at', 'updated_by') and (p_new -> k) is distinct from (p_old -> k);
    if v_changed is null then return; end if;
  end if;

  for rule in
    select * from public.automation_rules
     where is_active and object_name = p_object and trigger_event = p_event::public.automation_event
     order by created_at
  loop
    -- שדות טריגר: הכלל רץ רק אם אחד מהם השתנה (ריק = כל שינוי). כלל שלא הופעל לא נרשם.
    if p_event = 'update' and cardinality(rule.trigger_fields) > 0 and not (rule.trigger_fields && v_changed) then
      continue;
    end if;
    -- הגנה מלולאה: כלל שמעדכן רשומה מפעיל את המנוע שוב. מעל עומק 3 – עוצרים.
    if d >= 3 then
      insert into public.automation_logs (rule_id, object_name, record_id, status, message)
      values (rule.id, p_object, v_id, 'skipped', format('נעצר: עומק הרצה %s גדול מ-3 (הגנה מלולאה)', d + 1));
      continue;
    end if;
    begin
      if not private.automation_conditions_met(rule.conditions, p_object, p_new, p_old) then
        insert into public.automation_logs (rule_id, object_name, record_id, status, message)
        values (rule.id, p_object, v_id, 'skipped', 'התנאים לא התקיימו');
      else
        perform set_config('app.automation_depth', (d + 1)::text, true);
        v_msg := private.automation_execute(rule.actions, p_object, p_new);
        perform set_config('app.automation_depth', d::text, true);
        insert into public.automation_logs (rule_id, object_name, record_id, status, message)
        values (rule.id, p_object, v_id, 'success', v_msg);
      end if;
    exception when others then
      -- הפעולות של הכלל הזה מתבטלות, השמירה והכללים האחרים ממשיכים
      perform set_config('app.automation_depth', d::text, true);
      insert into public.automation_logs (rule_id, object_name, record_id, status, message)
      values (rule.id, p_object, v_id, 'failed', sqlerrm);
    end;
  end loop;
end
$$;

-- הטריגר על כל טבלת אובייקט
create or replace function private.automation_on_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event text := case tg_op when 'INSERT' then 'create' else 'update' end;
begin
  if exists (select 1 from public.automation_rules
              where is_active and object_name = tg_table_name and trigger_event = v_event::public.automation_event) then
    begin
      perform private.automation_dispatch(tg_table_name, v_event, to_jsonb(new),
                                          case when tg_op = 'UPDATE' then to_jsonb(old) end);
    exception when others then
      raise warning 'automation dispatch failed: %', sqlerrm;   -- לעולם לא מפיל את השמירה
    end;
  end if;
  return null;
end
$$;

create trigger clients_automation          after insert or update on clients          for each row execute function private.automation_on_change();
create trigger appointments_automation     after insert or update on appointments     for each row execute function private.automation_on_change();
create trigger service_requests_automation after insert or update on service_requests for each row execute function private.automation_on_change();
create trigger treatments_automation       after insert or update on treatments       for each row execute function private.automation_on_change();
create trigger staff_automation            after insert or update on staff            for each row execute function private.automation_on_change();
create trigger tasks_automation            after insert or update on tasks            for each row execute function private.automation_on_change();

-- ===== תזמון (pg_cron) =====
create or replace function private.automation_run_scheduled(p_rule_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare rule public.automation_rules; rec jsonb; v_msg text; v_ok int := 0; v_fail int := 0;
begin
  select * into rule from public.automation_rules where id = p_rule_id;
  if not found or not rule.is_active or rule.trigger_event <> 'schedule' then return; end if;
  for rec in execute format('select to_jsonb(t) from public.%I t order by t.created_at limit 2000', rule.object_name) loop
    begin
      if private.automation_conditions_met(rule.conditions, rule.object_name, rec, null) then
        perform set_config('app.automation_depth', '1', true);
        v_msg := private.automation_execute(rule.actions, rule.object_name, rec);
        perform set_config('app.automation_depth', '0', true);
        insert into public.automation_logs (rule_id, object_name, record_id, status, message)
        values (rule.id, rule.object_name, (rec ->> 'id')::uuid, 'success', v_msg);
        v_ok := v_ok + 1;
      end if;
    exception when others then
      perform set_config('app.automation_depth', '0', true);
      insert into public.automation_logs (rule_id, object_name, record_id, status, message)
      values (rule.id, rule.object_name, (rec ->> 'id')::uuid, 'failed', sqlerrm);
      v_fail := v_fail + 1;
    end;
  end loop;
  if v_ok = 0 and v_fail = 0 then
    insert into public.automation_logs (rule_id, object_name, status, message)
    values (rule.id, rule.object_name, 'skipped', 'הרצה מתוזמנת: אין רשומות שעומדות בתנאים');
  end if;
end
$$;
revoke execute on function private.automation_run_scheduled(uuid) from public;

-- כלל מתוזמן פעיל = משימה ב-pg_cron בשם automation_<id>. מתעדכן אוטומטית עם הכלל.
create or replace function private.automation_sync_cron()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'automation_' || old.id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.is_active and new.trigger_event = 'schedule' then
    perform cron.schedule('automation_' || new.id, new.schedule_cron,
                          format('select private.automation_run_scheduled(%L)', new.id));
  end if;
  return null;
end
$$;
create trigger automation_rules_cron after insert or update or delete on automation_rules
  for each row execute function private.automation_sync_cron();

-- ===== בדיקת כלל לפני שמירה: אובייקט, שדות, אופרטורים ופעולות לפי הקטלוג =====
create or replace function private.automation_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb; a jsonb; t text; k text; v_fields text[]; v_obj text;
begin
  if not (new.object_name = any(private.automation_objects())) then
    raise exception 'אובייקט לא נתמך: %', new.object_name;
  end if;
  select array_agg(f.field_key) into v_fields
    from public.object_fields f join public.view_objects o on o.id = f.object_id where o.object_key = new.object_name;

  if new.trigger_event = 'schedule' then
    if coalesce(trim(new.schedule_cron), '') = '' then raise exception 'בתזמון חובה להגדיר מתי הכלל רץ'; end if;
  else
    new.schedule_cron := null;
  end if;
  if new.trigger_event <> 'update' then new.trigger_fields := '{}'; end if;
  if not (new.trigger_fields <@ v_fields) then raise exception 'שדה טריגר לא קיים באובייקט'; end if;

  if jsonb_typeof(new.conditions) <> 'object' or coalesce(new.conditions ->> 'match', 'all') not in ('all', 'any')
     or jsonb_typeof(coalesce(new.conditions -> 'rules', '[]')) <> 'array' then
    raise exception 'מבנה התנאים לא תקין';
  end if;
  for r in select * from jsonb_array_elements(coalesce(new.conditions -> 'rules', '[]')) loop
    select field_type into t from private.automation_field(new.object_name, r ->> 'field');
    if t is null then raise exception 'שדה תנאי לא קיים: %', r ->> 'field'; end if;
    if (r ->> 'op') = any(private.automation_change_ops()) then
      if new.trigger_event <> 'update' then raise exception '"השתנה" אפשרי רק בכלל של עדכון'; end if;
    elsif not ((r ->> 'op') = any(private.automation_ops(t))) then
      raise exception 'האופרטור % לא מתאים לשדה %', r ->> 'op', r ->> 'field';
    end if;
  end loop;

  if jsonb_typeof(new.actions) <> 'array' or jsonb_array_length(new.actions) = 0 then
    raise exception 'כלל צריך לפחות פעולה אחת';
  end if;
  for a in select * from jsonb_array_elements(new.actions) loop
    case a ->> 'type'
    when 'update_field' then
      if not exists (select 1 from private.automation_field(new.object_name, a ->> 'field'))
         or a ->> 'field' in ('created_at', 'updated_at', 'updated_by', 'created_by') then
        raise exception 'שדה לעדכון לא תקין: %', a ->> 'field';
      end if;
    when 'update_related' then
      v_obj := a ->> 'object';
      if not (v_obj = any(private.automation_objects()))
         or not exists (select 1 from private.automation_field(v_obj, a ->> 'match_field') where ref_object = new.object_name)
         or not exists (select 1 from private.automation_field(v_obj, a ->> 'field')) then
        raise exception 'פעולת "עדכון רשומות מקושרות" לא תקינה';
      end if;
    when 'create_record' then
      v_obj := a ->> 'object';
      if not (v_obj = any(private.automation_objects())) then raise exception 'אובייקט לא נתמך: %', v_obj; end if;
      for k in select jsonb_object_keys(coalesce(a -> 'values', '{}')) loop
        if not exists (select 1 from private.automation_field(v_obj, k)) then raise exception 'שדה לא קיים: %', k; end if;
      end loop;
      if coalesce(a ->> 'link_field', '') <> ''
         and not exists (select 1 from private.automation_field(v_obj, a ->> 'link_field') where ref_object = new.object_name) then
        raise exception 'שדה הקישור צריך להצביע על %', new.object_name;
      end if;
    when 'notify' then
      if coalesce(a ->> 'to', '') = '' or coalesce(a ->> 'message', '') = '' then
        raise exception 'בהתראה חובה נמענת והודעה';
      end if;
    else
      raise exception 'סוג פעולה לא מוכר: %', a ->> 'type';
    end case;
  end loop;
  return new;
end
$$;
create trigger automation_rules_validate before insert or update on automation_rules
  for each row execute function private.automation_validate();

-- ===== פעולות של כלל הן פעולות מערכת: לא נחסמות בהרשאות השדה ובכלל "מטפלת משייכת רק לעצמה" =====
create or replace function private.enforce_field_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if (select auth.uid()) is null or current_setting('app.self_profile', true) = 'on' or private.automation_depth() > 0 then
    return new;
  end if;
  for r in
    select fp.field_key, fp.access, f.label
      from public.field_permissions fp
      join public.view_objects o on o.object_key = fp.object_key
      join public.object_fields f on f.object_id = o.id and f.field_key = fp.field_key
     where fp.role_id = private.my_role_id() and fp.object_key = tg_table_name
       and fp.field_key not in ('created_at', 'updated_at', 'updated_by')
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

create or replace function private.check_request_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is not distinct from
     (case when tg_op = 'UPDATE' then old.assigned_to end) then
    return new;
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.staff where id = new.assigned_to and is_active
  ) then
    raise exception 'אפשר לשייך קריאה רק לאשת צוות פעילה';
  end if;

  if (select auth.uid()) is not null and not private.is_manager() and private.automation_depth() = 0 then
    if not (new.assigned_to = (select auth.uid())
            or (new.assigned_to is null and tg_op = 'UPDATE'
                and old.assigned_to = (select auth.uid()))) then
      raise exception 'מטפלת יכולה לשייך קריאה רק לעצמה';
    end if;
  end if;

  return new;
end
$$;

-- ===== לממשק: הסכמה (אובייקטים, שדות, אופרטורים) ורשימת הכללים עם ההרצה האחרונה =====
create or replace function public.automation_schema()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.is_manager() then raise exception 'רק מנהלת מערכת מגדירה אוטומציות'; end if;
  return jsonb_build_object(
    'objects', (
      select jsonb_agg(jsonb_build_object(
               'key', o.object_key, 'label', o.label, 'label_plural', o.label_plural,
               'owner_field', o.owner_field, 'display_field', o.display_field,
               'fields', (select jsonb_agg(jsonb_build_object(
                                 'key', f.field_key, 'label', f.label, 'type', f.field_type,
                                 'options', f.options, 'ref_object', r.object_key,
                                 'required', f.is_required, 'editable', f.is_editable) order by f.position)
                            from public.object_fields f left join public.view_objects r on r.id = f.ref_object_id
                           where f.object_id = o.id))
             order by array_position(private.automation_objects(), o.object_key))
        from public.view_objects o where o.object_key = any(private.automation_objects())),
    'ops', (select jsonb_object_agg(t, private.automation_ops(t))
              from unnest(array['text', 'long_text', 'phone', 'email', 'number', 'money', 'date', 'datetime', 'boolean', 'choice', 'reference']) t),
    'change_ops', to_jsonb(private.automation_change_ops())
  );
end
$$;

create or replace function public.automation_rule_list()
returns table (id uuid, name text, object_name text, trigger_event public.automation_event, is_active boolean,
               schedule_cron text, last_run_at timestamptz, last_status public.automation_log_status,
               runs_success bigint, runs_failed bigint)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.name, r.object_name, r.trigger_event, r.is_active, r.schedule_cron,
         l.executed_at, l.status,
         (select count(*) from public.automation_logs x where x.rule_id = r.id and x.status = 'success'),
         (select count(*) from public.automation_logs x where x.rule_id = r.id and x.status = 'failed')
    from public.automation_rules r
    left join lateral (select executed_at, status from public.automation_logs x
                        where x.rule_id = r.id and x.status <> 'skipped'
                        order by executed_at desc limit 1) l on true
   order by r.created_at
$$;
revoke execute on function public.automation_schema() from public, anon;
revoke execute on function public.automation_rule_list() from public, anon;
grant execute on function public.automation_schema() to authenticated;
grant execute on function public.automation_rule_list() to authenticated;

-- ===== הכללים ההתחלתיים: שלוש הדוגמאות של המפרט, והאוטומציות שחיכו (CLAUDE.md סעיף 4) =====
insert into automation_rules (name, object_name, trigger_event, trigger_fields, conditions, actions) values
(
  'משימת מעקב לקריאה חדשה', 'service_requests', 'create', '{}',
  '{"match":"all","rules":[]}',
  '[{"type":"create_record","object":"tasks","link_field":"request_id","values":{"title":"מעקב: {{client_id:label}}","due_date":"{{today+1}}","assigned_to":"{{assigned_to|user}}","client_id":"{{client_id}}","notes":"{{description}}"}}]'
),
(
  'תאריך סגירה כשקריאה נסגרת', 'service_requests', 'update', '{status}',
  '{"match":"all","rules":[{"field":"status","op":"changed_to","value":"closed"}]}',
  '[{"type":"update_field","field":"closed_at","value":"{{now}}"}]'
),
(
  'סגירת משימות פתוחות כשקריאה נסגרת', 'service_requests', 'update', '{status}',
  '{"match":"all","rules":[{"field":"status","op":"changed_to","value":"closed"}]}',
  '[{"type":"update_related","object":"tasks","match_field":"request_id","field":"status","value":"done"}]'
),
(
  'ניקוי תאריך סגירה בפתיחה מחדש', 'service_requests', 'update', '{status}',
  '{"match":"all","rules":[{"field":"status","op":"changed_from","value":"closed"}]}',
  '[{"type":"update_field","field":"closed_at","value":""}]'
),
(
  'התראה על שיוך קריאה (בעדכון)', 'service_requests', 'update', '{assigned_to}',
  '{"match":"all","rules":[{"field":"assigned_to","op":"is_not_empty"},{"field":"assigned_to","op":"neq","value":"{{user}}"}]}',
  '[{"type":"notify","to":"record_owner","kind":"assignment","message":"{{user_name}} שייכה אלייך קריאה: {{client_id:label}}"}]'
),
(
  'התראה על שיוך קריאה (ביצירה)', 'service_requests', 'create', '{}',
  '{"match":"all","rules":[{"field":"assigned_to","op":"is_not_empty"},{"field":"assigned_to","op":"neq","value":"{{user}}"}]}',
  '[{"type":"notify","to":"record_owner","kind":"assignment","message":"{{user_name}} שייכה אלייך קריאה: {{client_id:label}}"}]'
);
