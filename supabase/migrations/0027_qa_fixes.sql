-- 0027: תיקוני בקרת האיכות (v28).
-- 1-2. ביצועים: ההרשאה מחושבת פעם אחת לשאילתה (initplan) ולא לכל שורה. הבדיקה לכל שורה היא owner_ok, פונקציית SQL
--      פשוטה ש-Postgres משלב בשאילתה. אותה לוגיקה בדיוק כמו row_allowed. run_view מחשב עמודות רק לשורות של העמוד.
-- 3.   הגבלת קצב גם לבקשות API בלי מפתח תקין (לפי כתובת IP), ובלי לרשום בלוג את מה שנחסם.
-- 4.   תור: רק אצל מטפלת פעילה, ורק עם טיפול פעיל.
-- 5.   תור: תאריך הגיוני (מ-2020 ועד שנתיים קדימה).

-- ===== הרשאה לשורה, בלי קריאה לפונקציה כבדה בכל שורה =====
-- p_scope ו-p_team מחושבים פעם אחת לשאילתה: (select private.perm(...)), (select private.my_team_members())
create or replace function private.owner_ok(p_scope public.perm_scope, p_owner uuid, p_uid uuid, p_team uuid[])
returns boolean language sql immutable set search_path = '' as $$
  select case p_scope
    when 'all' then true
    when 'own' then p_owner is not null and p_owner = p_uid
    when 'team' then p_owner is not null and (p_owner = p_uid or p_owner = any(p_team))
    else false
  end
$$;

-- אנשי הצוות שלי (כולל אותי). בלי צוות: רק אני
create or replace function private.my_team_members()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id), '{}') from public.staff s
   where s.team_id is not null and s.team_id = private.my_team_id()
$$;

grant execute on function private.owner_ok(public.perm_scope, uuid, uuid, uuid[]) to authenticated, service_role;
grant execute on function private.my_team_members() to authenticated, service_role;

-- תנאי SQL לשאילתה דינמית (תצוגות): אותו דבר כמו can_view_row, אבל בלי קריאה לכל שורה
create or replace function private.view_scope_sql(p_object text, p_owner_expr text)
returns text language sql stable set search_path = '' as $$
  select case
    when p_object in ('clients', 'appointments', 'service_requests', 'treatments', 'staff') then
      format('(private.owner_ok((select private.perm(%L, ''view'')), %s, (select auth.uid()), (select private.my_team_members()))%s)',
             p_object, p_owner_expr, case when p_object = 'staff' then format(' or %s = (select auth.uid())', p_owner_expr) else '' end)
    when p_object = 'notifications' then format('(%s = (select auth.uid()))', p_owner_expr)
    else '(select private.is_active_staff())'
  end
$$;

create or replace function private.can_view_row(p_object text, p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_object in ('clients', 'appointments', 'service_requests', 'treatments', 'staff')
      then private.owner_ok(private.perm(p_object, 'view'), p_owner, (select auth.uid()), private.my_team_members())
           or (p_object = 'staff' and p_owner = (select auth.uid()))
    when p_object = 'notifications' then p_owner = (select auth.uid())
    else private.is_active_staff()
  end
$$;

-- ===== מדיניות RLS: אותם כללים, בצורה מהירה =====
do $$
declare t record; a text; v_owner text; v_sql text;
begin
  for t in select * from (values ('clients', 'created_by'), ('appointments', 'therapist_id'), ('service_requests', 'assigned_to'),
                                 ('treatments', 'null::uuid'), ('staff', 'id')) x(tbl, owner) loop
    foreach a in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t.tbl || '_' || a, t.tbl);
      v_sql := format('private.owner_ok((select private.perm(%L, %L)), %s, (select auth.uid()), (select private.my_team_members()))',
                      t.tbl, case a when 'select' then 'view' when 'insert' then 'create' when 'update' then 'edit' else 'delete' end, t.owner);
      if t.tbl = 'staff' and a = 'select' then v_sql := v_sql || ' or id = (select auth.uid())'; end if;
      execute case a
        when 'select' then format('create policy %I on public.%I for select to authenticated using (%s)', t.tbl || '_' || a, t.tbl, v_sql)
        when 'insert' then format('create policy %I on public.%I for insert to authenticated with check (%s)', t.tbl || '_' || a, t.tbl, v_sql)
        when 'update' then format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t.tbl || '_' || a, t.tbl, v_sql, v_sql)
        else format('create policy %I on public.%I for delete to authenticated using (%s)', t.tbl || '_' || a, t.tbl, v_sql)
      end;
    end loop;
  end loop;
end $$;

-- ===== תצוגות: אותו סינון הרשאות, בלי קריאה לכל שורה =====
create or replace function private.view_where(p_object text, p_def jsonb, p_search text)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_obj    public.view_objects;
  v_field  public.object_fields;
  v_parts  text[] := '{}';
  v_any    text[] := '{}';
  v_digits text;
  f        record;
  v_val    text;
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
    v_val := case when position('{{' in coalesce(f.val, '')) > 0
                  then private.automation_render(f.val, p_object, '{}'::jsonb) else f.val end;
    v_parts := v_parts || private.filter_sql(v_field, f.op, v_val);
  end loop;

  if cardinality(v_parts) > 0 then
    v_where := '(' || array_to_string(v_parts,
                 case when p_def->>'match' = 'any' then ' or ' else ' and ' end) || ')';
  end if;

  if p_search is not null and trim(p_search) <> '' then
    v_digits := regexp_replace(p_search, '\D', '', 'g');
    for v_field in select * from public.object_fields
                    where object_id = v_obj.id and is_searchable and computed is null and not private.field_hidden(p_object, field_key) loop
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

  v_where := v_where || ' and ' || private.view_scope_sql(p_object,
               case when v_obj.owner_field is null then 'null::uuid' else format('t.%I', v_obj.owner_field) end);
  return v_where;
end
$$;

-- run_view: קודם מזהי השורות של העמוד (סינון, מיון, עימוד), ורק להן מחשבים את העמודות (כולל שדות מחושבים)
create or replace function public.run_view(p_object text, p_def jsonb, p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_obj    public.view_objects;
  v_field  public.object_fields;
  v_where  text;
  v_cols   text[] := array['t.id'];
  v_order  text[] := '{}';
  v_total  bigint;
  v_ids    uuid[];
  v_rows   jsonb;
  v_expr   text;
  s        record;
begin
  if not private.is_active_staff() then raise exception 'אין הרשאה'; end if;
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found then raise exception 'אובייקט לא מוכר או שאין לך הרשאה: %', p_object; end if;
  v_where := private.view_where(p_object, p_def, p_search);

  for v_field in
    select f.* from jsonb_array_elements_text(coalesce(p_def->'columns', '[]'::jsonb)) with ordinality c(k, n)
      join public.object_fields f on f.object_id = v_obj.id and f.field_key = c.k
     where not private.field_hidden(p_object, f.field_key)
     order by c.n loop
    if v_field.field_key <> 'id' then
      v_cols := v_cols || format('%s as %I', private.field_expr(v_field), v_field.field_key);
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
                   else private.field_expr(v_field) end;
    v_order := v_order || format('%s %s nulls last', v_expr, case when s.dir = 'desc' then 'desc' else 'asc' end);
  end loop;
  v_order := v_order || 't.created_at desc'::text || 't.id'::text;

  execute format('select count(*) from public.%I t where %s', p_object, v_where) into v_total;
  execute format('select coalesce(array_agg(id), ''{}'') from (select t.id from public.%I t where %s order by %s limit %s offset %s) p',
                 p_object, v_where, array_to_string(v_order, ', '),
                 greatest(least(coalesce(p_limit, 25), 5000), 1), greatest(coalesce(p_offset, 0), 0))
    into v_ids;
  execute format('select coalesce(jsonb_agg(to_jsonb(q) order by array_position($1, q.id)), ''[]''::jsonb) from (select %s from public.%I t where t.id = any($1)) q',
                 array_to_string(v_cols, ', '), p_object)
    into v_rows using v_ids;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end
$$;

-- שדות מחושבים: אותה הרשאה, בלי קריאה לכל שורה
update object_fields f set computed = v.computed
  from (values
    ('clients', 'next_appointment',
     '(select min(a.starts_at) from public.appointments a where a.client_id = t.id and a.status = ''upcoming'' and a.starts_at >= now() and private.owner_ok((select private.perm(''appointments'', ''view'')), a.therapist_id, (select auth.uid()), (select private.my_team_members())))'),
    ('clients', 'open_requests',
     '(select count(*) from public.service_requests r where r.client_id = t.id and r.status <> ''closed'' and private.owner_ok((select private.perm(''service_requests'', ''view'')), r.assigned_to, (select auth.uid()), (select private.my_team_members())))')
  ) v(object_key, field_key, computed), view_objects o
 where o.object_key = v.object_key and f.object_id = o.id and f.field_key = v.field_key;

-- ===== תור: מטפלת פעילה, טיפול פעיל, ותאריך הגיוני =====
create or replace function private.check_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o record; v_name text;
begin
  if tg_op = 'INSERT' or old.starts_at is distinct from new.starts_at then
    if new.starts_at < timestamptz '2020-01-01 00:00+02' or new.starts_at > now() + interval '2 years' then
      raise exception 'תאריך התור לא הגיוני: אפשר לקבוע תור מ-2020 ועד שנתיים קדימה';
    end if;
  end if;
  if (tg_op = 'INSERT' or old.therapist_id is distinct from new.therapist_id)
     and not exists (select 1 from public.staff where id = new.therapist_id and is_active) then
    raise exception 'אפשר לקבוע תור רק אצל מטפלת פעילה';
  end if;
  if (tg_op = 'INSERT' or old.treatment_id is distinct from new.treatment_id)
     and not exists (select 1 from public.treatments where id = new.treatment_id and is_active) then
    raise exception 'הטיפול הזה הוצא משימוש. בחרי טיפול פעיל מהמחירון';
  end if;
  if new.status = 'done' and new.starts_at > now()
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'אפשר לסמן "בוצע" רק אחרי מועד התור';
  end if;
  if new.status <> 'cancelled' and (tg_op = 'INSERT' or old.starts_at is distinct from new.starts_at
       or old.duration_minutes is distinct from new.duration_minutes or old.therapist_id is distinct from new.therapist_id
       or old.status is distinct from new.status) then
    select a.starts_at, a.duration_minutes into o
      from public.appointments a
     where a.therapist_id = new.therapist_id and a.id <> new.id and a.status <> 'cancelled'
       and public.appointment_range(a.starts_at, a.duration_minutes) && public.appointment_range(new.starts_at, new.duration_minutes)
     order by a.starts_at limit 1;
    if found then
      select split_part(full_name, ' ', 1) into v_name from public.staff where id = new.therapist_id;
      raise exception 'ל% יש תור ב-% עד %', v_name,
        to_char(o.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
        to_char((o.starts_at + make_interval(mins => o.duration_minutes)) at time zone 'Asia/Jerusalem', 'HH24:MI');
    end if;
  end if;
  return new;
end
$$;

-- ===== API: הודעות התור החדשות לשדה הנכון =====
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
    return private.api_err(422, 'validation', case when v_field in ('phone', 'email') then format('הערך בשדה "%s" לא תקין', v_field) else 'ערך לא תקין' end,
      case when v_field is not null then jsonb_build_array(jsonb_build_object('field', v_field)) end);
  elsif p_state = '23502' then
    return private.api_err(422, 'required', format('השדה "%s" חובה', v_field), jsonb_build_array(jsonb_build_object('field', v_field)));
  elsif p_msg like '%"בוצע" רק אחרי%' then
    return private.api_err(422, 'validation', p_msg, jsonb_build_array(jsonb_build_object('field', 'status')));
  elsif p_msg like 'תאריך התור%' then
    return private.api_err(422, 'validation', p_msg, jsonb_build_array(jsonb_build_object('field', 'starts_at')));
  elsif p_msg like '%מטפלת פעילה%' then
    return private.api_err(422, 'validation', p_msg, jsonb_build_array(jsonb_build_object('field', 'therapist_id')));
  elsif p_msg like 'הטיפול הזה הוצא משימוש%' then
    return private.api_err(422, 'validation', p_msg, jsonb_build_array(jsonb_build_object('field', 'treatment_id')));
  elsif p_msg like 'אין לך הרשאה%' or p_msg like 'מטפלת יכולה%' then
    return private.api_err(403, 'forbidden', p_msg, null);
  elsif p_state = 'P0001' then
    return private.api_err(422, 'validation', p_msg, null);
  else
    -- הודעה טכנית לא נשלחת החוצה
    return private.api_err(422, 'validation', 'השמירה נכשלה: ערך לא תקין', null);
  end if;
end
$$;

-- ===== API: הגבלת קצב גם בלי מפתח תקין (לפי IP) =====
alter table api_logs add column ip text;
create index api_logs_ip_time on api_logs (ip, created_at desc) where key_id is null;

drop function if exists public.api_request(text, text, text, text, jsonb, jsonb);
create or replace function public.api_request(p_key text, p_method text, p_object text, p_id text, p_query jsonb, p_body jsonb, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key public.api_keys; v_res jsonb;
begin
  -- בלי מפתח תקין: עד 20 ניסיונות בדקה מאותה כתובת. מעבר לזה 429, ובלי רישום בלוג (כדי שלא ינפחו אותו)
  if coalesce(btrim(p_key), '') = ''
     or not exists (select 1 from public.api_keys where key_hash = encode(extensions.digest(btrim(p_key), 'sha256'), 'hex') and is_active) then
    if p_ip is not null and (select count(*) from public.api_logs
                              where key_id is null and ip = p_ip and created_at > now() - interval '1 minute') >= 20 then
      return private.api_err(429, 'rate_limited', 'יותר מדי ניסיונות בלי מפתח תקין. נסי שוב בעוד דקה') || jsonb_build_object('skip_log', true);
    end if;
    if coalesce(btrim(p_key), '') = '' then
      return private.api_err(401, 'missing_key', 'חסר מפתח API. שלחי אותו בכותרת Authorization: Bearer <key>');
    end if;
    return private.api_err(401, 'invalid_key', 'מפתח API שגוי או מבוטל');
  end if;
  select * into v_key from public.api_keys where key_hash = encode(extensions.digest(btrim(p_key), 'sha256'), 'hex');

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
revoke execute on function public.api_request(text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.api_request(text, text, text, text, jsonb, jsonb, text) to service_role;
