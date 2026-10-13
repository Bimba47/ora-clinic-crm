-- 0020: placeholder לכל שדה טקסט בטופס, לפי האפיון ("דוגמה אמיתית בכל שדה": "054-1234567", "למשל: מבקשת להזיז את התור").
-- נשמר בקטלוג (object_fields.placeholder), כמו התווית, ולא בקוד.

alter table object_fields add column placeholder text;
comment on column object_fields.placeholder is 'דוגמה שמוצגת בשדה הריק בטופס';

update object_fields f set placeholder = v.placeholder
  from (values
    ('clients', 'full_name', 'למשל: דנה לוי'),
    ('clients', 'phone', '054-1234567'),
    ('clients', 'notes', 'למשל: מעדיפה תורים בבוקר'),
    ('appointments', 'notes', 'למשל: רגישות בעור, להתחיל בעוצמה נמוכה'),
    ('appointments', 'price', '350'),
    ('appointments', 'duration_minutes', '60'),
    ('service_requests', 'description', 'למשל: מבקשת להזיז את התור'),
    ('tasks', 'title', 'למשל: לחזור ללקוחה עם מועד חלופי'),
    ('tasks', 'notes', 'למשל: להציע את יום ה'' בבוקר'),
    ('treatments', 'name', 'למשל: טיפול פנים קלאסי'),
    ('treatments', 'price', '350'),
    ('treatments', 'duration_minutes', '60'),
    ('staff', 'full_name', 'למשל: נועה כהן'),
    ('staff', 'phone', '054-1234567'),
    ('staff', 'email', 'name@ora-clinic.co.il'),
    ('staff', 'address', 'למשל: סוקולוב 10, הרצליה')
  ) v(object_key, field_key, placeholder), view_objects o
 where o.object_key = v.object_key and f.object_id = o.id and f.field_key = v.field_key;
