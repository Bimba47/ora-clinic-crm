-- 0029: ווידג'ט "הכנסות לפי טיפול" בלוח "ראשי" (עמודות אופקיות), רק למנהלת.
-- 1. ערכים יחסיים {{month_start}} ו-{{month_end}} (החודש הנוכחי, שעון ישראל), לסינון של ווידג'טים ותצוגות.
-- 2. הווידג'ט: תורים שבוצעו החודש, מקובצים לפי טיפול, סכום המחיר. טווח התאריכים של הלוח דורס את "החודש".
--    הכנסה = רק תורים בסטטוס "בוצע" (החלטת ענבל). המחיר הוא זה שנשמר בתור, ולכן שינוי במחירון לא משנה הכנסות עבר.

-- 1. ערכים יחסיים לחודש
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.automation_token(text, text, jsonb)'::regprocedure);
  if position('month_start' in v_def) = 0 then
    v_def := replace(v_def,
      'if v_tok = ''user'' then',
      'if v_tok = ''month_start'' then return date_trunc(''month'', v_today)::date::text; end if;
  if v_tok = ''month_end'' then return (date_trunc(''month'', v_today) + interval ''1 month'' - interval ''1 day'')::date::text; end if;
  if v_tok = ''user'' then');
    if position('month_start' in v_def) = 0 then raise exception 'automation_token: לא נמצא מקום להוספה'; end if;
    execute v_def;
  end if;
end $$;

-- 2. הווידג'ט, מתחת לשאר, לכל הרוחב, רק למנהלת (כמו 0024)
insert into public.dashboard_widgets
  (dashboard_id, title, widget_type, object_name, filters, group_by, date_group, aggregate, aggregate_field, sort, "limit",
   position_x, position_y, width, height, config)
select d.id, 'הכנסות לפי טיפול', 'bar', 'appointments',
       '{"match":"all","rules":[{"field":"status","op":"eq","value":"done"},{"field":"starts_at","op":"gte","value":"{{month_start}}"},{"field":"starts_at","op":"lte","value":"{{month_end}}"}]}',
       'treatment_id', 'none', 'sum', 'price', 'value_desc', 50,
       0, 20, 12, 4,
       jsonb_build_object(
         'date_field', 'starts_at',
         'bar_style', 'gradient',
         'hint', 'תורים שבוצעו החודש, או בטווח התאריכים של הלוח',
         'roles', (select jsonb_agg(r.id) from public.roles r where r.name = 'מנהלת'))
  from public.dashboards d
 where d.name = 'ראשי' and d.is_shared
   and not exists (select 1 from public.dashboard_widgets x where x.dashboard_id = d.id and x.title = 'הכנסות לפי טיפול');
