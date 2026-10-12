-- ביטול 0008: מחיקת שדה ההערות של הלקוחה (כולל התוכן שנכתב בו)

delete from object_fields f using view_objects o
 where o.id = f.object_id and o.object_key = 'clients' and f.field_key = 'notes';

alter table clients drop column if exists notes;
