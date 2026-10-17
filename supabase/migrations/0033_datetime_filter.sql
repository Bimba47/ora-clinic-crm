-- 0033: סינון של שדה תאריך ושעה גם לפי שעה מדויקת (לשאלה 5 במבחן: "התור הבא" מה-API).
-- עד עכשיו: רק תאריך (YYYY-MM-DD), וההשוואה לפי יום בשעון ישראל. "מעכשיו" נכשל, ותור שעבר הבוקר נחשב עתידי.
-- מעכשיו: תאריך בלבד – כמו קודם (לפי יום). תאריך עם שעה (ISO, למשל 2026-10-17T14:30 או 2026-10-17T14:30:00+03:00)
-- או {{now}} / {{now+2h}} – השוואה מדויקת. בלי אזור זמן = שעון ישראל.
-- הממשק לא משתנה: בוחר התאריכים בתצוגות שולח תאריך בלבד. נגיש דרך ה-API: starts_at[gte]={{now}}.

create or replace function private.filter_sql(p_field public.object_fields, p_op public.filter_operator, p_value text)
 returns text
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  c   text := private.field_expr(p_field);
  cmp text := case p_op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>'
                        when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end;
  v   text;
  ts  timestamptz;
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

  -- תאריך ושעה עם שעה מדויקת: השוואה לרגע עצמו (בלי אזור זמן – שעון ישראל)
  if p_field.field_type = 'datetime' and trim(p_value) ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then
    begin
      if trim(p_value) ~ '(Z|[+-]\d{2}(:?\d{2})?)$' then
        ts := trim(p_value)::timestamptz;
      else
        ts := (trim(p_value)::timestamp) at time zone 'Asia/Jerusalem';
      end if;
    exception when others then
      raise exception 'התאריך והשעה בסינון של "%" לא תקינים. השתמשי בפורמט 2026-10-17T14:30', p_field.label;
    end;
    return format('%s %s %L::timestamptz', c, cmp, ts);
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
$function$;
