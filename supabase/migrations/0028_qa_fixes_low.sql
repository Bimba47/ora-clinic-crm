-- 0028: ממצאי בקרת האיכות בחומרה נמוכה (v29).
-- 7.  מגבלת אורך לשדות טקסט: שם/כותרת עד 200 תווים, תיאור והערות עד 2000.
-- 8.  טלפון עם אותיות נחסם (קודם האותיות נמחקו בשקט).
-- 9.  API: שגיאת סינון טכנית לא נשלחת החוצה, אלא הסבר בעברית.
-- 10. לוג אוטומציות: הסבר בעברית, והפרט הטכני בסוגריים (רק המנהלת רואה את הלוג).
-- 11. ממוצע, מינימום, מקסימום ואחוז בלי נתונים: "אין נתונים" (null) ולא 0.
-- שינוי של שורה אחת בפונקציה קיימת נעשה בהחלפת הטקסט שלה כפי שהוא במסד (בלי להעתיק את כל הפונקציה).

-- ===== 7. מגבלות אורך =====
alter table clients add constraint clients_full_name_len check (char_length(full_name) <= 200);
alter table clients add constraint clients_notes_len check (char_length(notes) <= 2000);
alter table appointments add constraint appointments_notes_len check (char_length(notes) <= 2000);
alter table service_requests add constraint service_requests_description_len check (char_length(description) <= 2000);
alter table treatments add constraint treatments_name_len check (char_length(name) <= 200);
alter table staff add constraint staff_full_name_len check (char_length(full_name) <= 200);
alter table staff add constraint staff_address_len check (char_length(address) <= 200);
alter table staff add constraint staff_email_len check (char_length(email) <= 200);

-- ===== 8. טלפון: רק ספרות ותווי עיצוב (רווח, מקף, נקודה, סוגריים, +) =====
create or replace function private.normalize_phone_column()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.phone is not null then
    if new.phone !~ '^[0-9 ()+.\-]*$' then
      raise exception 'מספר הטלפון לא תקין';
    end if;
    new.phone := public.normalize_phone(new.phone);
  end if;
  return new;
end
$$;

-- ===== 10. הודעת כישלון בעברית ללוג האוטומציות =====
create or replace function private.friendly_error(p_state text, p_msg text)
returns text language sql immutable set search_path = '' as $$
  select case
      when p_msg ~ '[א-ת]' then p_msg
      when p_state = '23505' then 'ערך שכבר קיים במערכת (למשל טלפון)'
      when p_state = '23503' then 'רשומה מקושרת חסרה, או שיש רשומות מקושרות'
      when p_state = '23502' then 'חסר ערך בשדה חובה'
      when p_state = '23P01' then 'למטפלת כבר יש תור בשעה הזו'
      when p_state = '23514' and p_msg like '%opening_hours%' then 'הקליניקה סגורה בשעה הזו'
      when p_state = '23514' and p_msg like '%phone%' then 'מספר הטלפון לא תקין'
      when p_state = '23514' and p_msg like '%email%' then 'כתובת האימייל לא תקינה'
      when p_state = '23514' and p_msg like '%assignee_required%' then 'יש לבחור אחראית'
      when p_state = '23514' and p_msg like '%\_len%' then 'הטקסט ארוך מדי'
      when p_state in ('22P02', '22007', '22008', '22003') then 'ערך לא תקין לסוג השדה'
      else 'הפעולה נכשלה'
    end || case when p_msg ~ '[א-ת]' then '' else ' (' || p_msg || ')' end
$$;

do $$
declare
  v_def text;
  r record;
begin
  -- 10. האוטומציות רושמות הסבר בעברית
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('automation_dispatch', 'automation_run_scheduled') loop
    v_def := pg_get_functiondef(r.oid);
    if position('''failed'', sqlerrm)' in v_def) = 0 then raise exception 'automation: expected text not found'; end if;
    execute replace(v_def, '''failed'', sqlerrm)', '''failed'', private.friendly_error(sqlstate, sqlerrm))');
  end loop;

  -- 9. API: שגיאת סינון טכנית לא יוצאת החוצה
  v_def := pg_get_functiondef('private.api_dispatch(text, text, text, jsonb, jsonb)'::regprocedure);
  if position('''bad_query'', sqlerrm)' in v_def) = 0 then raise exception 'api_dispatch: expected text not found'; end if;
  execute replace(v_def, '''bad_query'', sqlerrm)',
    '''bad_query'', case when sqlerrm ~ ''[א-ת]'' then sqlerrm else ''ערך לא תקין בסינון: בדקי שהערך מתאים לסוג השדה (מספר, תאריך YYYY-MM-DD, מזהה)'' end)');

  -- 7-8. API: אורך וטלפון, עם שם השדה
  v_def := pg_get_functiondef('private.api_db_error(text, text, text, text, text)'::regprocedure);
  if position('case when v_field in (''phone'', ''email'')' in v_def) = 0 or position('elsif p_state = ''P0001'' then' in v_def) = 0 then
    raise exception 'api_db_error: expected text not found';
  end if;
  v_def := replace(v_def, 'case when v_field in (''phone'', ''email'')',
                          'case when p_constraint like ''%\_len'' then format(''הטקסט בשדה "%s" ארוך מדי'', v_field) when v_field in (''phone'', ''email'')');
  v_def := replace(v_def, '  elsif p_state = ''P0001'' then',
                          '  elsif p_msg = ''מספר הטלפון לא תקין'' then' || chr(10) ||
                          '    return private.api_err(422, ''validation'', p_msg, jsonb_build_array(jsonb_build_object(''field'', ''phone'')));' || chr(10) ||
                          '  elsif p_state = ''P0001'' then');
  execute v_def;

  -- 11. ממוצע/מינימום/מקסימום/אחוז בלי נתונים: null ("אין נתונים") ולא 0
  v_def := pg_get_functiondef('public.run_widget(jsonb, jsonb)'::regprocedure);
  if position('return jsonb_build_object(''kind'', ''metric'', ''value'', coalesce(v_cur, 0));' in v_def) = 0 then
    raise exception 'run_widget: expected text not found';
  end if;
  execute replace(v_def, 'return jsonb_build_object(''kind'', ''metric'', ''value'', coalesce(v_cur, 0));',
    'return jsonb_build_object(''kind'', ''metric'', ''value'', case when p_widget ->> ''aggregate'' in (''avg'', ''min'', ''max'', ''percent'') then to_jsonb(v_cur) else to_jsonb(coalesce(v_cur, 0)) end);');
end $$;
