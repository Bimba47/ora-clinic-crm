-- 0018: הלוח "ראשי" – הברכה עוברת לכותרת המסך (מעל סינון הלוח), ולכן ווידג'ט הטקסט שלה יוצא מהלוח,
-- והסידור חוזר למקורי (בלי שורות ריקות), שורה אחת למעלה במקום הברכה.
delete from dashboard_widgets w using dashboards d
 where d.id = w.dashboard_id and d.name = 'ראשי' and d.owner_id is null
   and w.widget_type = 'text' and w.config ->> 'text' = '{{greeting}}, {{first_name}}';

update dashboard_widgets w set position_x = v.x, position_y = v.y, width = v.w, height = v.h
  from dashboards d, (values
    ('קריאות חדשות', 0, 0, 3, 2), ('קריאות בטיפול', 3, 0, 3, 2), ('פתוחות מעל 48 שעות', 6, 0, 3, 2), ('אחוז המרה', 9, 0, 3, 2),
    ('המשימות שלי', 0, 2, 6, 4), ('אחראיות', 6, 2, 6, 4),
    ('התורים של היום', 0, 6, 6, 4), ('תורים למחר', 6, 6, 6, 4),
    ('הקריאות האחרונות', 0, 10, 6, 4), ('אחוז המרה לפי מקור הגעה', 6, 10, 6, 4),
    ('לקוחות לפי מקור הגעה', 0, 14, 6, 4), ('לקוחות חדשות (7 ימים)', 6, 14, 3, 2)
  ) v(title, x, y, w, h)
 where d.id = w.dashboard_id and d.name = 'ראשי' and d.owner_id is null and w.title = v.title;
