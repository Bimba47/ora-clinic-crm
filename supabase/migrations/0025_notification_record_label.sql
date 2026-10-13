-- 0025: התראה מראה על מה היא (בקשת ענבל): עמודה "קריאה" עם תיאור הרשומה המקושרת, כקישור אליה.
-- record_label: שדה מחושב (0019) – תיאור הקריאה, שם הלקוחה או מועד התור, רק אם מותר לי לראות את הרשומה.
-- object_key, record_id: נכנסים לקטלוג רק כדי שהרשימה תדע לאן הקישור מוביל. מוסתרים מהעמודות והסינון ("display":"hidden").

insert into object_fields (object_id, field_key, label, field_type, options, position, default_visible,
                           is_searchable, is_required, is_editable, is_filterable, computed)
select o.id, v.field_key, v.label, 'text', v.options::jsonb, v.position, v.visible, false, false, false, false, v.computed
  from (values
    ('record_label', 'קריאה', '{"display":"record_link"}', 2, true,
     'case t.object_key
        when ''service_requests'' then (select r.description from public.service_requests r where r.id = t.record_id and private.can_view_row(''service_requests'', r.assigned_to))
        when ''clients'' then (select c.full_name from public.clients c where c.id = t.record_id and private.can_view_row(''clients'', c.created_by))
        when ''appointments'' then (select to_char(a.starts_at at time zone ''Asia/Jerusalem'', ''DD.MM.YYYY HH24:MI'') from public.appointments a where a.id = t.record_id and private.can_view_row(''appointments'', a.therapist_id))
      end'),
    ('object_key', 'אובייקט מקושר', '{"display":"hidden"}', 90, false, null),
    ('record_id', 'רשומה מקושרת', '{"display":"hidden"}', 91, false, null)
  ) v(field_key, label, options, position, visible, computed)
  join view_objects o on o.object_key = 'notifications';

-- בתצוגת ברירת המחדל: "קריאה" אחרי ההודעה
update view_columns c set position = c.position + 1
  from views v join view_objects o on o.id = v.object_id
 where c.view_id = v.id and o.object_key = 'notifications' and v.owner_id is null
   and c.position > (select c2.position from view_columns c2 join object_fields f on f.id = c2.field_id
                      where c2.view_id = v.id and f.field_key = 'message');
insert into view_columns (view_id, field_id, position, width, is_visible)
select v.id, f.id,
       (select c2.position + 1 from view_columns c2 join object_fields f2 on f2.id = c2.field_id where c2.view_id = v.id and f2.field_key = 'message'),
       280, true
  from views v join view_objects o on o.id = v.object_id
  join object_fields f on f.object_id = o.id and f.field_key = 'record_label'
 where o.object_key = 'notifications' and v.owner_id is null;
