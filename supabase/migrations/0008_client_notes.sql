-- 0008: הערות ללקוחה (בקשת ענבל, תוספת לאפיון). טקסט חופשי, לא חובה.
-- מופיע בכרטיס הלקוחה בקבוצת "פרטים אישיים", ובקטלוג כשדה טקסט ארוך שאפשר לחפש בו.

alter table clients add column notes text;

insert into object_fields (object_id, field_key, label, field_type, position, default_visible, is_searchable, is_required, is_editable, is_filterable)
select o.id, 'notes', 'הערות', 'long_text',
       (select coalesce(max(position), 0) + 1 from object_fields f where f.object_id = o.id),
       false, true, false, true, false
  from view_objects o where o.object_key = 'clients';
