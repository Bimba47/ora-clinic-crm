-- 0026: ממשק API כללי לכל אובייקט (v27).
-- מפתח API פועל בשם תפקיד. כל בקשה עוברת דרך public.api_request (רק service_role מריץ אותה, מהשרת שלנו):
-- היא מזהה את המפתח, מציבה את התפקיד שלו (app.api_role), ומשם אותן פונקציות הרשאה של שלב 10 חלות על ה-API.
-- האובייקט נפתר מהקטלוג (view_objects). אובייקט חדש זמין מיד, לפי view_objects.api_access.

-- שדה "hidden" בקטלוג (למשל לאן מובילה התראה): לא חשוף ב-API, רק עוזר לממשק
alter table object_fields add column display_hidden boolean generated always as (coalesce(options ->> 'display', '') = 'hidden') stored;

-- ===== אילו אובייקטים חשופים ב-API =====
alter table view_objects add column api_access text not null default 'full'
  check (api_access in ('none', 'read', 'full'));
comment on column view_objects.api_access is 'API: none = לא חשוף, read = קריאה בלבד, full = כל הפעולות. אובייקט חדש: full';
update view_objects set api_access = 'none' where object_key in ('notifications', 'roles', 'teams');
update view_objects set api_access = 'read' where object_key = 'staff';

-- ===== מפתחות =====
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  key_prefix text not null,                 -- תחילת המפתח, לזיהוי במסך (המפתח המלא לא נשמר)
  key_hash text not null unique,            -- sha256 של המפתח המלא
  role_id uuid not null references roles(id),
  rate_limit int not null default 60 check (rate_limit between 1 and 10000), -- בקשות לדקה
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid references staff(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id)
);
create trigger api_keys_updated_at before update on api_keys for each row execute function private.set_updated_at();
create trigger api_keys_updated_by before insert or update on api_keys for each row execute function private.set_updated_by();
alter table api_keys enable row level security;
create policy api_keys_admin_read on api_keys for select to authenticated using (private.is_manager());
create policy api_keys_admin_update on api_keys for update to authenticated using (private.is_manager()) with check (private.is_manager());
revoke all on api_keys from anon, authenticated;
grant select (id, name, key_prefix, role_id, rate_limit, is_active, last_used_at, created_by, created_at, updated_at) on api_keys to authenticated;
grant update (name, is_active) on api_keys to authenticated;

-- ===== לוג בקשות =====
create table api_logs (
  id uuid primary key default gen_random_uuid(),
  key_id uuid references api_keys(id) on delete set null,
  key_name text,
  method text not null,
  path text not null,
  object_key text,
  status int not null,
  duration_ms int not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id)
);
create index api_logs_key_time on api_logs (key_id, created_at desc);
create index api_logs_time on api_logs (created_at desc);
alter table api_logs enable row level security;
create policy api_logs_admin_read on api_logs for select to authenticated using (private.is_manager());
revoke all on api_logs from anon, authenticated;
grant select on api_logs to authenticated;

-- ===== הזהות בבקשת API: התפקיד של המפתח =====
-- רק כשאין משתמשת מחוברת. app.api_role מוצב רק בתוך api_request (שרק service_role מריץ).
create or replace function private.api_role()
returns uuid language sql stable set search_path = '' as $$
  select case when (select auth.uid()) is null then nullif(current_setting('app.api_role', true), '')::uuid end
$$;

create or replace function private.my_role_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select role_id from public.staff where id = (select auth.uid()) and is_active), private.api_role())
$$;

create or replace function private.is_active_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where id = (select auth.uid()) and is_active)
      or private.api_role() is not null
$$;

-- שדה לקריאה בלבד נחסם גם בבקשת API (קודם הטריגר דילג כשאין משתמשת)
create or replace function private.enforce_field_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if ((select auth.uid()) is null and private.api_role() is null)
     or current_setting('app.self_profile', true) = 'on' or private.automation_depth() > 0 then
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

-- ===== יצירת מפתח: הערך המלא חוזר פעם אחת בלבד =====
create or replace function public.create_api_key(p_name text, p_role_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text; v_id uuid;
begin
  if not private.is_manager() then raise exception 'רק מנהלת מערכת יוצרת מפתחות API'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'צריך לתת שם למפתח'; end if;
  if not exists (select 1 from public.roles where id = p_role_id) then raise exception 'התפקיד לא קיים'; end if;
  v_key := 'ora_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_keys (name, key_prefix, key_hash, role_id)
  values (btrim(p_name), left(v_key, 12), encode(extensions.digest(v_key, 'sha256'), 'hex'), p_role_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key);
end
$$;
revoke execute on function public.create_api_key(text, uuid) from public, anon;
grant execute on function public.create_api_key(text, uuid) to authenticated;

-- ===== תשובות =====
create or replace function private.api_err(p_status int, p_code text, p_message text, p_details jsonb default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('status', p_status, 'body', jsonb_build_object('error',
    jsonb_strip_nulls(jsonb_build_object('status', p_status, 'code', p_code, 'message', p_message, 'details', p_details))))
$$;

-- קוד התשובה לרשימת שגיאות שדה: 400 קודם (שדה לא קיים / לקריאה בלבד), אחר כך 403, ואחרת 422
create or replace function private.api_errs_status(p_errs jsonb)
returns int language sql immutable set search_path = '' as $$
  select case when bool_or(e ->> 'status' = '400') then 400 when bool_or(e ->> 'status' = '403') then 403 else 422 end
    from jsonb_array_elements(p_errs) e
$$;

-- ===== ולידציה של גוף בקשה מול הקטלוג =====
-- מחזירה רשימת שגיאות [{field, code, message, status}]. status: 400 שדה לא קיים או לקריאה בלבד, 403 שדה חסום לתפקיד, 422 ערך לא תקין.
create or replace function private.api_validate(p_object text, p_body jsonb, p_create boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_obj public.view_objects; f public.object_fields; k text; v jsonb; s text;
  v_errs jsonb := '[]'; v_access text; v_ref text; v_opts jsonb; v_ok boolean;
begin
  select * into v_obj from public.view_objects where object_key = p_object;
  for k, v in select * from jsonb_each(p_body) loop
    select * into f from public.object_fields where object_id = v_obj.id and field_key = k;
    if not found or f.display_hidden then
      v_errs := v_errs || jsonb_build_object('field', k, 'status', 400, 'code', 'unknown_field',
        'message', format('השדה "%s" לא קיים באובייקט %s', k, p_object));
      continue;
    end if;
    if f.computed is not null or not f.is_editable then
      v_errs := v_errs || jsonb_build_object('field', k, 'status', 400, 'code', 'read_only',
        'message', format('השדה "%s" (%s) לקריאה בלבד', k, f.label));
      continue;
    end if;
    v_access := null;
    select access::text into v_access from public.field_permissions
     where role_id = private.my_role_id() and object_key = p_object and field_key = k;
    if v_access is not null then
      v_errs := v_errs || jsonb_build_object('field', k, 'status', 403, 'code', 'forbidden_field',
        'message', format('לתפקיד של המפתח אין הרשאה לשנות את השדה "%s" (%s)', k, f.label));
      continue;
    end if;
    if v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if f.is_required then
        v_errs := v_errs || jsonb_build_object('field', k, 'status', 422, 'code', 'required', 'message', format('השדה "%s" (%s) חובה', k, f.label));
      end if;
      continue;
    end if;
    s := v #>> '{}';
    v_ok := true;
    case f.field_type::text
      when 'number', 'money' then v_ok := jsonb_typeof(v) = 'number';
      when 'boolean' then v_ok := jsonb_typeof(v) = 'boolean';
      when 'date' then
        v_ok := jsonb_typeof(v) = 'string' and s ~ '^\d{4}-\d{2}-\d{2}$';
        if v_ok then begin perform s::date; exception when others then v_ok := false; end; end if;
      when 'datetime' then
        v_ok := jsonb_typeof(v) = 'string' and s ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}';
        if v_ok then begin perform s::timestamptz; exception when others then v_ok := false; end; end if;
      when 'choice' then
        v_opts := coalesce(f.options, '[]');
        v_ok := jsonb_typeof(v) = 'string' and exists (select 1 from jsonb_array_elements(v_opts) o where o ->> 'value' = s);
        if not v_ok then
          v_errs := v_errs || jsonb_build_object('field', k, 'status', 422, 'code', 'invalid_choice',
            'message', format('ערך לא חוקי בשדה "%s" (%s)', k, f.label),
            'allowed', (select jsonb_agg(o -> 'value') from jsonb_array_elements(v_opts) o));
          continue;
        end if;
      when 'reference' then
        v_ok := jsonb_typeof(v) = 'string' and s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
        if v_ok then
          select object_key into v_ref from public.view_objects where id = f.ref_object_id;
          execute format('select exists (select 1 from public.%I where id = $1)', v_ref) into v_ok using s::uuid;
          if not v_ok then
            v_errs := v_errs || jsonb_build_object('field', k, 'status', 422, 'code', 'not_found',
              'message', format('לא נמצאה רשומה ב-%s עם המזהה שבשדה "%s"', v_ref, k));
            continue;
          end if;
        end if;
      else v_ok := jsonb_typeof(v) = 'string';
    end case;
    if not v_ok then
      v_errs := v_errs || jsonb_build_object('field', k, 'status', 422, 'code', 'invalid_type',
        'message', format('הערך בשדה "%s" (%s) צריך להיות %s', k, f.label, case f.field_type::text
          when 'number' then 'מספר' when 'money' then 'מספר (סכום)' when 'boolean' then 'true או false'
          when 'date' then 'תאריך בפורמט YYYY-MM-DD' when 'datetime' then 'תאריך ושעה בפורמט ISO, למשל 2026-10-20T10:30:00+03:00'
          when 'reference' then 'מזהה (uuid)' else 'טקסט' end));
    end if;
  end loop;

  -- ביצירה: שדה חובה שלא נשלח (ואין לו ברירת מחדל במסד)
  if p_create then
    for f in select of2.* from public.object_fields of2
              where of2.object_id = v_obj.id and of2.is_required and of2.is_editable and of2.computed is null
                and not p_body ? of2.field_key
                and not exists (select 1 from information_schema.columns c
                                 where c.table_schema = 'public' and c.table_name = p_object
                                   and c.column_name = of2.field_key and c.column_default is not null) loop
      v_errs := v_errs || jsonb_build_object('field', f.field_key, 'status', 422, 'code', 'required',
        'message', format('השדה "%s" (%s) חובה', f.field_key, f.label));
    end loop;
  end if;
  return v_errs;
end
$$;

-- שגיאת מסד בזמן כתיבה → קוד ושדה (409 התנגשות, 422 ולידציה)
create or replace function private.api_db_error(p_object text, p_state text, p_msg text, p_constraint text, p_column text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_field text;
begin
  v_field := coalesce(nullif(p_column, ''),
    (select f.field_key from public.object_fields f join public.view_objects o on o.id = f.object_id
      where o.object_key = p_object and p_constraint like '%' || f.field_key || '%'
      order by length(f.field_key) desc limit 1));
  if p_state = '23505' then
    return private.api_err(409, 'duplicate', coalesce(case when v_field = 'phone' then 'מספר הטלפון כבר קיים במערכת' end,
      format('כבר קיימת רשומה עם הערך הזה בשדה "%s"', v_field)), jsonb_build_array(jsonb_build_object('field', v_field)));
  elsif p_state = '23P01' or p_msg ~ '^ל.+ יש תור ב-' then
    return private.api_err(409, 'conflict', case when p_state = '23P01' then 'למטפלת כבר יש תור בשעה הזו' else p_msg end,
      jsonb_build_array(jsonb_build_object('field', 'starts_at')));
  elsif p_state = '23503' then
    return private.api_err(409, 'has_related', 'אי אפשר: יש רשומות מקושרות (או שהרשומה המקושרת לא קיימת)', null);
  elsif p_state = '23514' and p_constraint = 'appointments_opening_hours' then
    return private.api_err(422, 'validation', 'הקליניקה סגורה בשעה הזו', jsonb_build_array(jsonb_build_object('field', 'starts_at')));
  elsif p_state = '23514' and p_constraint = 'service_requests_assignee_required' then
    return private.api_err(422, 'validation', 'יש לבחור אחראית', jsonb_build_array(jsonb_build_object('field', 'assigned_to')));
  elsif p_state = '23514' then
    return private.api_err(422, 'validation', case when v_field in ('phone', 'email') then format('הערך בשדה "%s" לא תקין', v_field) else p_msg end,
      case when v_field is not null then jsonb_build_array(jsonb_build_object('field', v_field)) end);
  elsif p_state = '23502' then
    return private.api_err(422, 'required', format('השדה "%s" חובה', v_field), jsonb_build_array(jsonb_build_object('field', v_field)));
  elsif p_msg like '%"בוצע" רק אחרי%' then
    return private.api_err(422, 'validation', p_msg, jsonb_build_array(jsonb_build_object('field', 'status')));
  elsif p_msg like 'אין לך הרשאה%' or p_msg like 'מטפלת יכולה%' then
    return private.api_err(403, 'forbidden', p_msg, null);
  else
    return private.api_err(422, 'validation', p_msg, null);
  end if;
end
$$;

-- ===== הבקשה עצמה =====
-- p_query: פרמטרים של רשימה: limit, offset או page, sort ("field" או "-field", כמה עם פסיק), search, fields,
-- וסינון: field=value (שווה ל) או field[op]=value (op מתוך אופרטורי הסינון של התצוגות).
create or replace function public.api_request(p_key text, p_method text, p_object text, p_id text, p_query jsonb, p_body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key public.api_keys; v_res jsonb;
begin
  -- 1. מפתח
  if coalesce(btrim(p_key), '') = '' then
    return private.api_err(401, 'missing_key', 'חסר מפתח API. שלחי אותו בכותרת Authorization: Bearer <key>');
  end if;
  select * into v_key from public.api_keys where key_hash = encode(extensions.digest(btrim(p_key), 'sha256'), 'hex');
  if not found or not v_key.is_active then
    return private.api_err(401, 'invalid_key', 'מפתח API שגוי או מבוטל');
  end if;

  -- 2. הגבלת קצב: בקשות בדקה האחרונה
  if (select count(*) from public.api_logs where key_id = v_key.id and created_at > now() - interval '1 minute') >= v_key.rate_limit then
    return private.api_err(429, 'rate_limited', format('יותר מדי בקשות. המגבלה: %s בקשות בדקה למפתח', v_key.rate_limit))
           || jsonb_build_object('key_id', v_key.id, 'key_name', v_key.name);
  end if;
  update public.api_keys set last_used_at = now() where id = v_key.id;
  perform set_config('app.api_role', v_key.role_id::text, true);

  v_res := private.api_dispatch(p_method, p_object, p_id, p_query, p_body);
  return v_res || jsonb_build_object('key_id', v_key.id, 'key_name', v_key.name);
end
$$;

create or replace function private.api_dispatch(p_method text, p_object text, p_id text, p_query jsonb, p_body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_obj public.view_objects; v_res jsonb; v_errs jsonb; v_status int;
  v_id uuid; v_owner uuid; v_found boolean; v_cols text; v_set text;
  v_limit int; v_offset int; v_filters jsonb := '[]'; v_sorts jsonb := '[]'; v_columns jsonb;
  k text; v text; m text[]; s text; v_field public.object_fields;
  v_state text; v_msg text; v_con text; v_col text;
  v_reserved text[] := array['limit', 'offset', 'page', 'sort', 'search', 'fields'];
begin
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found or v_obj.api_access = 'none' then
    return private.api_err(404, 'unknown_object', format('אין אובייקט "%s" ב-API', p_object),
      (select jsonb_agg(object_key order by object_key) from public.view_objects where api_access <> 'none'));
  end if;
  if p_method in ('POST', 'PATCH', 'DELETE') and v_obj.api_access <> 'full' then
    return private.api_err(403, 'read_only_object', format('האובייקט "%s" זמין ב-API לקריאה בלבד', p_object));
  end if;
  if p_id is not null then
    if p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return private.api_err(404, 'not_found', 'הרשומה לא נמצאה (המזהה לא תקין)');
    end if;
    v_id := p_id::uuid;
  end if;

  -- ===== GET רשימה =====
  if p_method = 'GET' and v_id is null then
    if private.perm(p_object, 'view') = 'none' then
      return private.api_err(403, 'forbidden', format('לתפקיד של המפתח אין הרשאת צפייה ב-%s', p_object));
    end if;
    begin
      v_limit := coalesce(nullif(p_query ->> 'limit', '')::int, 25);
      v_offset := coalesce(nullif(p_query ->> 'offset', '')::int, (coalesce(nullif(p_query ->> 'page', '')::int, 1) - 1) * v_limit);
    exception when others then
      return private.api_err(400, 'bad_param', 'limit, offset ו-page צריכים להיות מספרים שלמים');
    end;
    if v_limit < 1 or v_limit > 100 or v_offset < 0 then
      return private.api_err(400, 'bad_param', 'limit בין 1 ל-100, ו-offset לא שלילי');
    end if;
    -- עמודות: fields=a,b או כל השדות (בלי השדות המוסתרים של הקטלוג)
    if coalesce(p_query ->> 'fields', '') <> '' then
      v_columns := to_jsonb(string_to_array(replace(p_query ->> 'fields', ' ', ''), ','));
    else
      select jsonb_agg(field_key order by position) into v_columns from public.object_fields
       where object_id = v_obj.id and not display_hidden;
    end if;
    for k in select jsonb_array_elements_text(v_columns) loop
      if not exists (select 1 from public.object_fields where object_id = v_obj.id and field_key = k and not display_hidden) then
        return private.api_err(400, 'unknown_field', format('השדה "%s" לא קיים באובייקט %s', k, p_object), jsonb_build_array(jsonb_build_object('field', k)));
      end if;
    end loop;
    -- מיון
    if coalesce(p_query ->> 'sort', '') <> '' then
      foreach s in array string_to_array(replace(p_query ->> 'sort', ' ', ''), ',') loop
        k := ltrim(s, '-');
        if not exists (select 1 from public.object_fields where object_id = v_obj.id and field_key = k and not display_hidden) then
          return private.api_err(400, 'unknown_field', format('אי אפשר למיין לפי "%s": השדה לא קיים', k), jsonb_build_array(jsonb_build_object('field', k)));
        end if;
        v_sorts := v_sorts || jsonb_build_object('field', k, 'dir', case when s like '-%' then 'desc' else 'asc' end);
      end loop;
    end if;
    -- סינון
    for k, v in select key, value from jsonb_each_text(coalesce(p_query, '{}')) loop
      continue when k = any(v_reserved);
      m := regexp_match(k, '^([a-z_0-9]+)(?:\[([a-z_]+)\])?$');
      if m is null then
        return private.api_err(400, 'bad_param', format('פרמטר לא מוכר: "%s"', k));
      end if;
      select * into v_field from public.object_fields where object_id = v_obj.id and field_key = m[1] and not display_hidden;
      if not found then
        return private.api_err(400, 'unknown_field', format('אי אפשר לסנן לפי "%s": השדה לא קיים באובייקט %s', m[1], p_object), jsonb_build_array(jsonb_build_object('field', m[1])));
      end if;
      if not v_field.is_filterable then
        return private.api_err(400, 'not_filterable', format('אי אפשר לסנן לפי השדה "%s"', m[1]), jsonb_build_array(jsonb_build_object('field', m[1])));
      end if;
      if coalesce(m[2], 'eq') not in (select unnest(enum_range(null::public.filter_operator))::text) then
        return private.api_err(400, 'bad_operator', format('אופרטור לא מוכר: "%s"', m[2]),
          jsonb_build_array(jsonb_build_object('field', m[1], 'allowed', (select jsonb_agg(x) from unnest(enum_range(null::public.filter_operator)) x))));
      end if;
      v_filters := v_filters || jsonb_build_object('field', m[1], 'op', coalesce(m[2], 'eq'), 'value', v);
    end loop;
    begin
      v_res := public.run_view(p_object, jsonb_build_object('columns', v_columns, 'filters', v_filters, 'match', 'all', 'sorts', v_sorts),
                               nullif(p_query ->> 'search', ''), v_limit, v_offset);
    exception when others then
      return private.api_err(400, 'bad_query', sqlerrm);
    end;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object('data', v_res -> 'rows', 'total', v_res -> 'total', 'limit', v_limit, 'offset', v_offset));
  end if;

  -- ===== GET רשומה =====
  if p_method = 'GET' then
    if private.perm(p_object, 'view') = 'none' then
      return private.api_err(403, 'forbidden', format('לתפקיד של המפתח אין הרשאת צפייה ב-%s', p_object));
    end if;
    v_res := public.get_record(p_object, v_id);
    if v_res is null then return private.api_err(404, 'not_found', 'הרשומה לא נמצאה'); end if;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object('data', v_res));
  end if;

  -- ===== POST יצירה =====
  if p_method = 'POST' then
    if v_id is not null then return private.api_err(400, 'bad_path', 'ביצירה אין מזהה בנתיב: POST /api/v1/' || p_object); end if;
    if p_body is null or jsonb_typeof(p_body) <> 'object' or p_body = '{}' then
      return private.api_err(400, 'bad_body', 'גוף הבקשה צריך להיות אובייקט JSON עם השדות');
    end if;
    if private.perm(p_object, 'create') = 'none' then
      return private.api_err(403, 'forbidden', format('לתפקיד של המפתח אין הרשאת יצירה ב-%s', p_object));
    end if;
    v_errs := private.api_validate(p_object, p_body, true);
    if jsonb_array_length(v_errs) > 0 then
      v_status := private.api_errs_status(v_errs);
      return private.api_err(v_status, case v_status when 400 then 'bad_field' when 403 then 'forbidden_field' else 'validation' end,
        'בדיקת השדות נכשלה', v_errs);
    end if;
    -- היקף "שלי"/"הצוות שלי" דורש משתמשת. למפתח רק "הכול" מתיר
    if v_obj.owner_field is not null and not private.row_allowed(p_object, 'create', nullif(p_body ->> v_obj.owner_field, '')::uuid) then
      return private.api_err(403, 'forbidden', 'לתפקיד של המפתח אין הרשאה ליצור את הרשומה הזו');
    end if;
    select string_agg(format('%I', key), ', ') into v_cols from jsonb_object_keys(p_body) key;
    begin
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
                     p_object, v_cols, v_cols, p_object) into v_id using p_body;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_con = constraint_name, v_col = column_name;
      return private.api_db_error(p_object, v_state, v_msg, v_con, v_col);
    end;
    return jsonb_build_object('status', 201, 'body', jsonb_build_object('data', public.get_record(p_object, v_id)));
  end if;

  -- ===== PATCH / DELETE: הרשומה קיימת, ומותר לי לגעת בה =====
  if p_method in ('PATCH', 'DELETE') then
    if v_id is null then return private.api_err(400, 'bad_path', format('חסר מזהה בנתיב: %s /api/v1/%s/{id}', p_method, p_object)); end if;
    execute format('select true, %s from public.%I t where t.id = $1',
                   case when v_obj.owner_field is null then 'null::uuid' else format('t.%I', v_obj.owner_field) end, p_object)
      into v_found, v_owner using v_id;
    if not coalesce(v_found, false) or not private.can_view_row(p_object, v_owner) then
      return private.api_err(404, 'not_found', 'הרשומה לא נמצאה');
    end if;
    if not private.row_allowed(p_object, case p_method when 'PATCH' then 'edit' else 'delete' end, v_owner) then
      return private.api_err(403, 'forbidden', format('לתפקיד של המפתח אין הרשאת %s ברשומה הזו', case p_method when 'PATCH' then 'עריכה' else 'מחיקה' end));
    end if;
  end if;

  if p_method = 'PATCH' then
    if p_body is null or jsonb_typeof(p_body) <> 'object' or p_body = '{}' then
      return private.api_err(400, 'bad_body', 'גוף הבקשה צריך להיות אובייקט JSON עם השדות לעדכון');
    end if;
    v_errs := private.api_validate(p_object, p_body, false);
    if jsonb_array_length(v_errs) > 0 then
      v_status := private.api_errs_status(v_errs);
      return private.api_err(v_status, case v_status when 400 then 'bad_field' when 403 then 'forbidden_field' else 'validation' end,
        'בדיקת השדות נכשלה', v_errs);
    end if;
    select string_agg(format('%1$I = r.%1$I', key), ', ') into v_set from jsonb_object_keys(p_body) key;
    begin
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2',
                     p_object, v_set, p_object) using p_body, v_id;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_con = constraint_name, v_col = column_name;
      return private.api_db_error(p_object, v_state, v_msg, v_con, v_col);
    end;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object('data', public.get_record(p_object, v_id)));
  end if;

  if p_method = 'DELETE' then
    begin
      execute format('delete from public.%I where id = $1', p_object) using v_id;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_con = constraint_name, v_col = column_name;
      return private.api_db_error(p_object, v_state, v_msg, v_con, v_col);
    end;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object('deleted', true, 'id', v_id));
  end if;

  return private.api_err(405, 'method_not_allowed', 'פעולה לא נתמכת. אפשר: GET, POST, PATCH, DELETE');
end
$$;


-- רק השרת שלנו (service_role) מריץ את הבקשה. משתמשות ו-anon לא
revoke execute on function public.api_request(text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.api_request(text, text, text, text, jsonb, jsonb) to service_role;
revoke execute on function private.api_dispatch(text, text, text, jsonb, jsonb) from public, anon, authenticated;
