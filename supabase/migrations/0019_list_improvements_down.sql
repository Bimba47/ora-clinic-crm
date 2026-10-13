-- ביטול 0019: מחזיר את הפונקציות לגרסה הקודמת (0016/0017/0006) ומסיר את השדות המחושבים והתצוגות החדשות.
-- את גוף הפונקציות הקודמות לוקחים מהמיגרציות שיצרו אותן: automation_token, widget_field (0017),
-- filter_sql, view_where, run_view, get_record (0010), automation_field, automation_schema (0016), check_object_field (0004).

drop trigger if exists appointments_check on appointments;
drop function if exists private.check_appointment();

delete from views v using view_objects o
 where o.id = v.object_id and v.owner_id is null
   and ((o.object_key = 'appointments' and v.name in ('תורים היום', 'תורים השבוע'))
     or (o.object_key = 'service_requests' and v.name = 'הקריאות שלי'));

-- עמודות, סינונים ומיונים של השדות המחושבים נמחקים יחד איתם (on delete cascade)
delete from object_fields where computed is not null;

update view_columns c set position = c.position - 2
  from views v join view_objects o on o.id = v.object_id
 where c.view_id = v.id and o.object_key = 'clients' and v.name = 'כל הלקוחות' and v.owner_id is null and c.position >= 6;
update view_columns c set position = c.position - 1
  from views v join view_objects o on o.id = v.object_id
 where c.view_id = v.id and o.object_key = 'service_requests' and v.name = 'כל הקריאות' and v.owner_id is null and c.position >= 5;

-- כאן מריצים מחדש את הגדרות הפונקציות מהמיגרציות הקודמות (ראו למעלה), ואז:
drop function if exists private.field_expr(public.object_fields);
alter table object_fields drop column computed;
