-- ביטול 0030: הסרת שני הווידג'טים והחזרת השאר 4 שורות למעלה
delete from public.dashboard_widgets w
 using public.dashboards d
 where w.dashboard_id = d.id and d.name = 'ראשי' and w.title in ('סך תורים', 'סך הכנסות');

update public.dashboard_widgets w
   set position_y = w.position_y - 4
  from public.dashboards d
 where w.dashboard_id = d.id and d.name = 'ראשי' and d.is_shared and w.position_y >= 6;
