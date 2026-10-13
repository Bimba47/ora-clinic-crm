-- ביטול 0023: החזרת אובייקט המשימות.
-- 1. מריצים שוב את supabase/migrations/0015_tasks.sql (טבלה, הרשאות, קטלוג, תצוגה, והפונקציות עם 'tasks').
-- 2. מריצים את הקטע הזה: placeholders, שם הווידג'ט, ושני כללי האוטומציה.
-- 3. את המשימה שהייתה במסד אפשר להחזיר מ-versions/v24-tasks-removal/backup.json.

update object_fields f set placeholder = v.placeholder
  from (values ('title', 'למשל: לחזור ללקוחה עם מועד חלופי'), ('notes', 'למשל: להציע את יום ה'' בבוקר')) v(field_key, placeholder),
       view_objects o
 where o.object_key = 'tasks' and f.object_id = o.id and f.field_key = v.field_key;

update dashboard_widgets set title = 'המשימות שלי' where title = 'הקריאות שלי';

insert into automation_rules (id, name, object_name, trigger_event, trigger_fields, is_active, conditions, actions) values
  ('3d80323f-c954-4f71-9c3e-f36105933e0d', 'משימת מעקב לקריאה חדשה', 'service_requests', 'create', '{}', true,
   '{"match": "all", "rules": []}',
   '[{"type": "create_record", "object": "tasks", "values": {"notes": "{{description}}", "title": "מעקב: {{client_id:label}}", "due_date": "{{today+1}}", "client_id": "{{client_id}}", "assigned_to": "{{assigned_to|user}}"}, "link_field": "request_id"}]'),
  ('e6696507-c534-4bf7-a4dd-59b5822a30e8', 'סגירת משימות פתוחות כשקריאה נסגרת', 'service_requests', 'update', '{status}', true,
   '{"match": "all", "rules": [{"op": "changed_to", "field": "status", "value": "closed"}]}',
   '[{"type": "update_related", "field": "status", "value": "done", "object": "tasks", "match_field": "request_id"}]');
