-- 0019: שיפורי רשימות לפי האפיון.
-- 1. שדות מחושבים בקטלוג (object_fields.computed): ביטוי SQL שמוגדר רק במיגרציה (למשתמשות אין הרשאת כתיבה לקטלוג).
--    מוצגים, ממוינים ומסוננים כמו שדה רגיל: "התור הבא" ו"קריאות פתוחות" ללקוחה, "פתוחה כבר" (שעות) לקריאה.
-- 2. ערכים יחסיים בסינון של תצוגה: {{today}}, {{today+N}}, {{week_start}}, {{week_end}}, {{user}}.
-- 3. תצוגות שמורות חדשות: "תורים היום", "תורים השבוע", "הקריאות שלי".
-- 4. תורים: "בוצע" רק אחרי מועד התור, והודעת חפיפה ברורה ("לליאת יש תור ב-11:00 עד 11:45").

alter table object_fields add column computed text;
comment on column object_fields.computed is 'ביטוי SQL (על הכינוי t) לשדה מחושב. מוגדר רק במיגרציה.';

-- ===== תבניות: תחילת השבוע וסופו (השבוע מתחיל ביום ראשון) =====
create or replace function private.automation_token(p_token text, p_object text, p_rec jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_tok text := trim(p_token); v_alt text; v_val text; v_field text; v_sub text; v_ref text; n int; v_today date;
begin
  if position('|' in v_tok) > 0 then
    foreach v_alt in array string_to_array(v_tok, '|') loop
      v_val := private.automation_token(v_alt, p_object, p_rec);
      if coalesce(v_val, '') <> '' then return v_val; end if;
    end loop;
    return null;
  end if;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;
  if v_tok = 'now' then return to_jsonb(now()) #>> '{}'; end if;
  if v_tok ~ '^now[+-][0-9]+h$' then
    n := substring(v_tok from 4 for length(v_tok) - 4)::int;
    return to_jsonb(now() + make_interval(hours => n)) #>> '{}';
  end if;
  if v_tok ~ '^today([+-][0-9]+)?$' then
    n := coalesce(nullif(substring(v_tok from 6), ''), '0')::int;
    return (v_today + n)::text;
  end if;
  if v_tok = 'week_start' then return (v_today - extract(dow from v_today)::int)::text; end if;
  if v_tok = 'week_end' then return (v_today - extract(dow from v_today)::int + 6)::text; end if;
  if v_tok = 'user' then return (select auth.uid())::text; end if;
  if v_tok = 'user_name' then
    return coalesce((select full_name from public.staff where id = (select auth.uid())), 'המערכת');
  end if;
  if v_tok like '%:label' then
    v_field := split_part(v_tok, ':', 1);
    return private.automation_label(p_object, v_field, p_rec ->> v_field);
  end if;
  if v_tok like '%:time' or v_tok like '%:date' then
    v_field := split_part(v_tok, ':', 1);
    v_val := p_rec ->> v_field;
    if v_val is null then return null; end if;
    return to_char(v_val::timestamptz at time zone 'Asia/Jerusalem',
                   case when v_tok like '%:time' then 'HH24:MI' else 'DD.MM.YYYY' end);
  end if;
  if position('.' in v_tok) > 0 then
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

-- ===== מנוע התצוגות: שדות מחושבים וערכים יחסיים =====
create or replace function private.field_expr(p_field public.object_fields)
returns text language sql immutable set search_path = '' as $$
  select case when p_field.computed is not null then '(' || p_field.computed || ')' else format('t.%I', p_field.field_key) end
$$;

create or replace function private.filter_sql(p_field public.object_fields, p_op public.filter_operator, p_value text)
returns text language plpgsql stable set search_path = '' as $$
declare
  c   text := private.field_expr(p_field);
  cmp text := case p_op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>'
                        when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end;
  v   text;
begin
  if not private.operator_allowed(p_field.field_type, p_op) then
    raise exception 'האופרטור % לא מתאים לשדה %', p_op, p_field.label;
  end if;

  if p_op = 'is_empty' then
    return case when p_field.field_type in ('text', 'long_text', 'email', 'phone')
                then format('(%s is null or %s = '''')', c, c) else format('%s is null', c) end;
  elsif p_op = 'is_not_empty' then
    return case when p_field.field_type in ('text', 'long_text', 'email', 'phone')
                then format('(%s is not null and %s <> '''')', c, c) else format('%s is not null', c) end;
  end if;

  if p_value is null or trim(p_value) = '' then
    return 'true';
  end if;

  if p_field.field_type in ('date', 'datetime') and trim(p_value) !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'התאריך בסינון של "%" לא תקין. בחרי תאריך מהלוח.', p_field.label;
  end if;

  if p_field.field_type = 'phone' then
    v := regexp_replace(regexp_replace(p_value, '\D', '', 'g'), '^972', '0');
    return case p_op
      when 'eq'           then format('%s = %L', c, v)
      when 'neq'          then format('%s is distinct from %L', c, v)
      when 'contains'     then format('%s like %L', c, '%' || v || '%')
      when 'not_contains' then format('%s not like %L', c, '%' || v || '%') end;
  elsif p_field.field_type in ('text', 'long_text', 'email') then
    return case p_op
      when 'eq'           then format('lower(%s) = lower(%L)', c, p_value)
      when 'neq'          then format('lower(%s) is distinct from lower(%L)', c, p_value)
      when 'contains'     then format('%s ilike %L', c, '%' || private.like_escape(p_value) || '%')
      when 'not_contains' then format('coalesce(%s, '''') not ilike %L', c, '%' || private.like_escape(p_value) || '%') end;
  elsif p_field.field_type in ('number', 'money') then
    return format('%s %s %L::numeric', c, cmp, p_value);
  elsif p_field.field_type = 'date' then
    return format('%s %s %L::date', c, cmp, trim(p_value));
  elsif p_field.field_type = 'datetime' then
    return format('(%s at time zone ''Asia/Jerusalem'')::date %s %L::date', c, cmp, trim(p_value));
  elsif p_field.field_type = 'boolean' then
    return case p_op when 'eq' then format('%s = %L::boolean', c, p_value)
                     else format('%s is distinct from %L::boolean', c, p_value) end;
  elsif p_field.field_type = 'reference' then
    return case p_op when 'eq' then format('%s = %L::uuid', c, p_value)
                     else format('%s is distinct from %L::uuid', c, p_value) end;
  else
    return case p_op when 'eq' then format('%s::text = %L', c, p_value)
                     else format('%s::text is distinct from %L', c, p_value) end;
  end if;
end
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
    -- ערך יחסי (היום, תחילת השבוע, אני) מחושב ברגע ההרצה
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

-- לוחות הבקרה: שדה מחושב מתנהג כמו שדה רגיל
create or replace function private.widget_field(p_object text, p_field text, out expr text, out ftype text)
language plpgsql stable security definer set search_path = '' as $$
declare v_rel text; v_fk text; v_computed text;
begin
  if p_field like 'count:%.%' then
    v_rel := split_part(substring(p_field from 7), '.', 1);
    v_fk := split_part(substring(p_field from 7), '.', 2);
    if not (v_rel = any(private.automation_objects()))
       or not exists (select 1 from private.automation_field(v_rel, v_fk) f where f.ref_object = p_object) then
      raise exception 'שדה לא תקין: %', p_field;
    end if;
    expr := format('(select count(*) from public.%I r where r.%I = t.id)', v_rel, v_fk);
    ftype := 'number';
    return;
  end if;
  select f.computed, f.field_type::text into v_computed, ftype
    from public.object_fields f join public.view_objects o on o.id = f.object_id
   where o.object_key = p_object and f.field_key = p_field and f.computed is not null;
  if v_computed is not null then
    expr := '(' || v_computed || ')';
    return;
  end if;
  select f.field_type into ftype from private.automation_field(p_object, p_field) f;
  if ftype is null then raise exception 'שדה לא קיים: %', p_field; end if;
  if private.field_hidden(p_object, p_field) then raise exception 'השדה % לא זמין לך', p_field; end if;
  expr := format('t.%I', p_field);
end
$$;

-- שדה מחושב אינו עמודה: הקטלוג מאפשר אותו, ואוטומציות ומסך הרשומה לא משתמשים בו
create or replace function private.check_object_field()
returns trigger language plpgsql set search_path = '' as $$
declare v_table text;
begin
  if new.computed is not null then return new; end if;
  select object_key into v_table from public.view_objects where id = new.object_id;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = v_table and column_name = new.field_key) then
    raise exception 'אין עמודה % בטבלה %', new.field_key, v_table;
  end if;
  return new;
end
$$;

create or replace function private.automation_field(p_object text, p_field text)
returns table(field_type text, label text, options jsonb, ref_object text)
language sql stable security definer set search_path = '' as $$
  select f.field_type::text, f.label, f.options, r.object_key
    from public.object_fields f
    join public.view_objects o on o.id = f.object_id
    left join public.view_objects r on r.id = f.ref_object_id
   where o.object_key = p_object and f.field_key = p_field and f.computed is null
$$;

create or replace function public.automation_schema()
returns jsonb language plpgsql stable set search_path = '' as $$
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
                           where f.object_id = o.id and f.computed is null))
             order by array_position(private.automation_objects(), o.object_key))
        from public.view_objects o where o.object_key = any(private.automation_objects())),
    'ops', (select jsonb_object_agg(t, private.automation_ops(t))
              from unnest(array['text', 'long_text', 'phone', 'email', 'number', 'money', 'date', 'datetime', 'boolean', 'choice', 'reference']) t),
    'change_ops', to_jsonb(private.automation_change_ops())
  );
end
$$;

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
  for f in select * from public.object_fields where object_id = v_obj.id and computed is null and not private.field_hidden(p_object, field_key) loop
    v_out := v_out || jsonb_build_object(f.field_key, v_row -> f.field_key);
    if f.field_type = 'reference' then
      execute format('select %s from public.%I t where t.id = $1', private.ref_label_sql(f.id), p_object) into v_label using p_id;
      v_out := v_out || jsonb_build_object(f.field_key || '__label', v_label);
    end if;
  end loop;
  return v_out;
end
$$;

-- ===== השדות המחושבים =====
insert into object_fields (object_id, field_key, label, field_type, options, position, default_visible,
                           is_searchable, is_required, is_editable, is_filterable, computed)
select o.id, v.field_key, v.label, v.field_type::field_type, v.options::jsonb, v.position, true, false, false, false, true, v.computed
  from (values
    ('clients', 'next_appointment', 'התור הבא', 'datetime', null, 20,
     '(select min(a.starts_at) from public.appointments a where a.client_id = t.id and a.status = ''upcoming'' and a.starts_at >= now() and private.can_view_row(''appointments'', a.therapist_id))'),
    ('clients', 'open_requests', 'קריאות פתוחות', 'number', null, 21,
     '(select count(*) from public.service_requests r where r.client_id = t.id and r.status <> ''closed'' and private.can_view_row(''service_requests'', r.assigned_to))'),
    ('service_requests', 'open_hours', 'פתוחה כבר', 'number', '{"display":"hours_open","warn_over":48}', 20,
     'case when t.status <> ''closed'' then floor(extract(epoch from now() - t.created_at) / 3600)::int end')
  ) v(object_key, field_key, label, field_type, options, position, computed)
  join view_objects o on o.object_key = v.object_key;

-- בתצוגות ברירת המחדל: העמודות החדשות גלויות (לקוחות: אחרי מקור ההגעה; קריאות: אחרי הסטטוס)
update view_columns c set position = c.position + 2
  from views v join view_objects o on o.id = v.object_id
 where c.view_id = v.id and o.object_key = 'clients' and v.name = 'כל הלקוחות' and v.owner_id is null and c.position >= 4;
update view_columns c set position = c.position + 1
  from views v join view_objects o on o.id = v.object_id
 where c.view_id = v.id and o.object_key = 'service_requests' and v.name = 'כל הקריאות' and v.owner_id is null and c.position >= 4;
insert into view_columns (view_id, field_id, position, width, is_visible)
select v.id, f.id, c.pos, c.width, true
  from (values ('clients', 'כל הלקוחות', 'next_appointment', 4, 150), ('clients', 'כל הלקוחות', 'open_requests', 5, 120),
               ('service_requests', 'כל הקריאות', 'open_hours', 4, 120)) c(object_key, view_name, field_key, pos, width)
  join view_objects o on o.object_key = c.object_key
  join views v on v.object_id = o.id and v.name = c.view_name and v.owner_id is null
  join object_fields f on f.object_id = o.id and f.field_key = c.field_key;

-- ===== תצוגות שמורות חדשות: עמודות כמו בתצוגת ברירת המחדל, ועוד סינון =====
do $$
declare
  r record; v_new uuid; v_def uuid; v_obj uuid; flt record;
begin
  for r in select * from (values
      ('appointments', 'תורים היום', '[{"field":"starts_at","op":"eq","value":"{{today}}"}]', 'starts_at', 'asc'),
      ('appointments', 'תורים השבוע', '[{"field":"starts_at","op":"gte","value":"{{week_start}}"},{"field":"starts_at","op":"lte","value":"{{week_end}}"}]', 'starts_at', 'asc'),
      ('service_requests', 'הקריאות שלי', '[{"field":"assigned_to","op":"eq","value":"{{user}}"},{"field":"status","op":"neq","value":"closed"}]', 'created_at', 'asc')
    ) x(object_key, name, filters, sort_field, sort_dir) loop
    select id into v_obj from public.view_objects where object_key = r.object_key;
    select id into v_def from public.views where object_id = v_obj and is_default and owner_id is null limit 1;
    insert into public.views (object_id, name, view_type, owner_id, is_shared, is_default, filter_match)
    values (v_obj, r.name, 'list', null, true, false, 'all') returning id into v_new;
    insert into public.view_columns (view_id, field_id, position, width, is_visible)
    select v_new, field_id, position, width, is_visible from public.view_columns where view_id = v_def;
    for flt in select x2->>'field' fld, x2->>'op' op, x2->>'value' val, n from jsonb_array_elements(r.filters::jsonb) with ordinality t(x2, n) loop
      insert into public.view_filters (view_id, field_id, operator, value, position)
      select v_new, f.id, flt.op::public.filter_operator, flt.val, flt.n from public.object_fields f where f.object_id = v_obj and f.field_key = flt.fld;
    end loop;
    insert into public.view_sorts (view_id, field_id, direction, position)
    select v_new, f.id, r.sort_dir::public.sort_direction, 1 from public.object_fields f where f.object_id = v_obj and f.field_key = r.sort_field;
  end loop;
end $$;

-- ===== תורים: "בוצע" רק אחרי מועד התור, וחפיפה עם הודעה ברורה =====
create or replace function private.check_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o record; v_name text;
begin
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
create trigger appointments_check before insert or update on appointments for each row execute function private.check_appointment();
