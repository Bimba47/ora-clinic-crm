-- ביטול 0014
update views set name = 'כל הצוות'
 where name = 'כל המשתמשות' and owner_id is null
   and object_id = (select id from view_objects where object_key = 'staff');
