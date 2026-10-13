-- ביטול 0028
alter table clients drop constraint if exists clients_full_name_len;
alter table clients drop constraint if exists clients_notes_len;
alter table appointments drop constraint if exists appointments_notes_len;
alter table service_requests drop constraint if exists service_requests_description_len;
alter table treatments drop constraint if exists treatments_name_len;
alter table staff drop constraint if exists staff_full_name_len;
alter table staff drop constraint if exists staff_address_len;
alter table staff drop constraint if exists staff_email_len;

create or replace function private.normalize_phone_column()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.phone is not null then
    new.phone := public.normalize_phone(new.phone);
  end if;
  return new;
end
$$;

-- החזרת השורות שהוחלפו בפונקציות הקיימות (אותה שיטה כמו במיגרציה)
do $$
declare v_def text; r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('automation_dispatch', 'automation_run_scheduled') loop
    execute replace(pg_get_functiondef(r.oid), '''failed'', private.friendly_error(sqlstate, sqlerrm))', '''failed'', sqlerrm)');
  end loop;
  v_def := pg_get_functiondef('private.api_dispatch(text, text, text, jsonb, jsonb)'::regprocedure);
  execute replace(v_def,
    '''bad_query'', case when sqlerrm ~ ''[א-ת]'' then sqlerrm else ''ערך לא תקין בסינון: בדקי שהערך מתאים לסוג השדה (מספר, תאריך YYYY-MM-DD, מזהה)'' end)',
    '''bad_query'', sqlerrm)');
  v_def := pg_get_functiondef('public.run_widget(jsonb, jsonb)'::regprocedure);
  execute replace(v_def,
    'return jsonb_build_object(''kind'', ''metric'', ''value'', case when p_widget ->> ''aggregate'' in (''avg'', ''min'', ''max'', ''percent'') then to_jsonb(v_cur) else to_jsonb(coalesce(v_cur, 0)) end);',
    'return jsonb_build_object(''kind'', ''metric'', ''value'', coalesce(v_cur, 0));');
end $$;
-- api_db_error: להריץ שוב את ההגדרה מ-0027_qa_fixes.sql
drop function if exists private.friendly_error(text, text);
