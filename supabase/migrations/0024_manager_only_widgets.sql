-- 0024: בלוח "ראשי", חמישה ווידג'טים מוצגים רק למנהלת (בקשת ענבל): לקוחות חדשות, אחראיות, אחוז המרה,
-- לקוחות לפי מקור הגעה, אחוז המרה לפי מקור הגעה. config.roles = התפקידים שרואים (ריק = כולם).
update dashboard_widgets w
   set config = w.config || jsonb_build_object('roles', jsonb_build_array((select id from roles where name = 'מנהלת')))
  from dashboards d
 where d.id = w.dashboard_id and d.name = 'ראשי'
   and w.title in ('לקוחות חדשות', 'אחראיות', 'אחוז המרה', 'לקוחות לפי מקור הגעה', 'אחוז המרה לפי מקור הגעה');
