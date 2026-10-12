-- 0014: תצוגת ברירת המחדל של המשתמשים נקראת "כל המשתמשות" (כמו שם המסך)
update views set name = 'כל המשתמשות'
 where name = 'כל הצוות' and owner_id is null
   and object_id = (select id from view_objects where object_key = 'staff');
