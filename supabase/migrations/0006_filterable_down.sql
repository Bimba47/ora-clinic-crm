-- ביטול 0006: חוזר למצב שאחרי 0005 (כל השדות ניתנים לסינון, תווית "נוצרה", בלי בדיקת תאריך)

update object_fields f set label = 'נוצרה'
  from view_objects o
 where o.id = f.object_id and o.object_key = 'clients' and f.field_key = 'created_at';

create or replace function private.check_view_field()
returns trigger language plpgsql set search_path = '' as $$
declare v_ok boolean; v_type public.field_type;
begin
  select f.object_id = v.object_id, f.field_type into v_ok, v_type
    from public.object_fields f, public.views v
   where f.id = new.field_id and v.id = new.view_id;
  if not coalesce(v_ok, false) then
    raise exception 'השדה לא שייך לאובייקט של התצוגה';
  end if;
  if tg_table_name = 'view_filters' then
    if not private.operator_allowed(v_type, new.operator) then
      raise exception 'האופרטור % לא מתאים לשדה מסוג %', new.operator, v_type;
    end if;
  end if;
  return new;
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
  v_where  text := 'true';
begin
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found then raise exception 'אובייקט לא מוכר או שאין לך הרשאה: %', p_object; end if;

  for f in select x->>'field' as fld, (x->>'op')::public.filter_operator as op, x->>'value' as val
             from jsonb_array_elements(coalesce(p_def->'filters', '[]'::jsonb)) x loop
    select * into v_field from public.object_fields where object_id = v_obj.id and field_key = f.fld;
    if not found then raise exception 'שדה לא מוכר: %', f.fld; end if;
    v_parts := v_parts || private.filter_sql(v_field, f.op, f.val);
  end loop;

  if cardinality(v_parts) > 0 then
    v_where := '(' || array_to_string(v_parts,
                 case when p_def->>'match' = 'any' then ' or ' else ' and ' end) || ')';
  end if;

  if p_search is not null and trim(p_search) <> '' then
    v_digits := regexp_replace(p_search, '\D', '', 'g');
    for v_field in select * from public.object_fields where object_id = v_obj.id and is_searchable loop
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

  return v_where;
end
$$;

create or replace function private.filter_sql(p_field public.object_fields, p_op public.filter_operator, p_value text)
returns text language plpgsql stable set search_path = '' as $$
declare
  c   text := format('t.%I', p_field.field_key);
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
    return format('%s %s %L::date', c, cmp, p_value);
  elsif p_field.field_type = 'datetime' then
    return format('(%s at time zone ''Asia/Jerusalem'')::date %s %L::date', c, cmp, p_value);
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

alter table object_fields drop column if exists is_filterable;
