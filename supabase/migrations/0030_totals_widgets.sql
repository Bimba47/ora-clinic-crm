-- 0030: שני ווידג'טי טבעת בראש הלוח "ראשי", מתחת למספרים: "סך תורים" (לכולן) ו"סך הכנסות" (רק למנהלת).
-- סך תורים: תורי החודש לפי סטטוס, בצבעי הסטטוס (עתידי / בוצע / בוטל). מטפלת רואה את שלה (סינון "שלי" של הלוח).
-- סך הכנסות: תורים שבוצעו החודש, סכום המחיר לפי מטפלת (החלטת ענבל).
-- בשניהם הסה"כ במרכז עם השוואה לתקופה הקודמת (config.compare_period), וטווח התאריכים של הלוח דורס את "החודש".
-- בלי שינוי במנוע: אלה ווידג'טים רגילים, וההשוואה מחושבת במסך בהרצה נוספת של אותו ווידג'ט על התקופה הקודמת.

-- מפנים שורה: כל מה שמתחת למספרים יורד 4 שורות
update public.dashboard_widgets w
   set position_y = w.position_y + 4
  from public.dashboards d
 where w.dashboard_id = d.id and d.name = 'ראשי' and d.is_shared and w.position_y >= 2
   and not exists (select 1 from public.dashboard_widgets x where x.dashboard_id = d.id and x.title in ('סך תורים', 'סך הכנסות'));

insert into public.dashboard_widgets
  (dashboard_id, title, widget_type, object_name, filters, group_by, date_group, aggregate, aggregate_field, sort, "limit",
   position_x, position_y, width, height, config)
select d.id, v.title, 'pie', 'appointments', v.filters::jsonb, v.group_by, 'none', v.agg::public.widget_aggregate, v.agg_field, 'value_desc', 50,
       v.x, 2, 6, 4, v.config
  from public.dashboards d
 cross join (values
   ('סך תורים',
    '{"match":"all","rules":[{"field":"starts_at","op":"gte","value":"{{month_start}}"},{"field":"starts_at","op":"lte","value":"{{month_end}}"}]}',
    'status', 'count', null::text, 0,
    jsonb_build_object(
      'date_field', 'starts_at',
      'compare_period', true,
      'colors', jsonb_build_object('upcoming', '#E3BFA8', 'done', '#9E5F6A', 'cancelled', '#A39A93'),
      'hint', 'תורי החודש, או בטווח התאריכים של הלוח')),
   ('סך הכנסות',
    '{"match":"all","rules":[{"field":"status","op":"eq","value":"done"},{"field":"starts_at","op":"gte","value":"{{month_start}}"},{"field":"starts_at","op":"lte","value":"{{month_end}}"}]}',
    'therapist_id', 'sum', 'price', 6,
    jsonb_build_object(
      'date_field', 'starts_at',
      'compare_period', true,
      'hint', 'תורים שבוצעו, לפי מטפלת',
      'roles', (select jsonb_agg(r.id) from public.roles r where r.name = 'מנהלת')))
 ) as v(title, filters, group_by, agg, agg_field, x, config)
 where d.name = 'ראשי' and d.is_shared
   and not exists (select 1 from public.dashboard_widgets x where x.dashboard_id = d.id and x.title = v.title);
