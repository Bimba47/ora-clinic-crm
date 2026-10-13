-- ביטול 0022
update view_sorts s set direction = 'desc'
  from views v, view_objects o, object_fields f
 where s.view_id = v.id and v.object_id = o.id and o.object_key = 'appointments' and v.name = 'כל התורים' and v.owner_id is null
   and f.id = s.field_id and f.field_key = 'starts_at';
