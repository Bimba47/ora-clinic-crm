-- ביטול 0017: מחיקת מנוע לוחות הבקרה. התבניות החדשות ({{now-48h}}, :time, :date) נשארות, כי האוטומציות לא נפגעות מהן.
drop function public.duplicate_dashboard(uuid, text);
drop function public.run_widget(jsonb, jsonb);
drop function private.widget_label_expr(text, text, text);
drop function private.widget_where(text, jsonb, jsonb);
drop function private.widget_condition(text, jsonb, jsonb);
drop function private.widget_field(text, text);
drop table dashboard_widgets;
drop table dashboards;
drop function private.dashboard_visible_id(uuid);
drop function private.dashboard_editable_id(uuid);
drop function private.dashboard_editable(uuid, boolean);
drop function private.dashboard_visible(uuid, boolean, uuid[]);
drop type widget_aggregate;
drop type widget_date_group;
drop type widget_type;
