-- ביטול 0025 (עמודות התצוגה של השדות נמחקות איתם)
delete from object_fields f using view_objects o
 where o.id = f.object_id and o.object_key = 'notifications' and f.field_key in ('record_label', 'object_key', 'record_id');
