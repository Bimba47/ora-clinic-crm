-- ביטול 0024
update dashboard_widgets w set config = w.config - 'roles'
  from dashboards d
 where d.id = w.dashboard_id and d.name = 'ראשי'
   and w.title in ('לקוחות חדשות', 'אחראיות', 'אחוז המרה', 'לקוחות לפי מקור הגעה', 'אחוז המרה לפי מקור הגעה');
