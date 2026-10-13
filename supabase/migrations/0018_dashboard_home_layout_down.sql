-- ביטול 0018: ווידג'ט הברכה חוזר ללוח "ראשי", והסידור חוזר לזה של 0017 (הברכה בשורה הראשונה)
insert into dashboard_widgets (dashboard_id, title, widget_type, object_name, position_x, position_y, width, height, config)
select id, '', 'text', null, 0, 0, 12, 1, '{"text":"{{greeting}}, {{first_name}}","subtext":"{{today_long}}","size":"title"}'
  from dashboards where name = 'ראשי' and owner_id is null;

update dashboard_widgets w set position_y = w.position_y + 1
  from dashboards d
 where d.id = w.dashboard_id and d.name = 'ראשי' and d.owner_id is null and w.widget_type <> 'text';
