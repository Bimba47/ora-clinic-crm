-- ביטול שלב 4: מוחק את מנוע התצוגות ואת כל התצוגות השמורות. הדאטה של העסק לא נפגע.
drop function if exists public.set_default_view(uuid);
drop function if exists public.create_view(text, text, public.view_type, uuid);
drop function if exists public.save_view(uuid, jsonb);
drop function if exists public.run_view_groups(text, jsonb, text, text);
drop function if exists public.run_view(text, jsonb, text, int, int);
drop function if exists private.view_where(text, jsonb, text);
drop function if exists private.filter_sql(public.object_fields, public.filter_operator, text);
drop function if exists private.ref_label_sql(uuid);
drop function if exists private.like_escape(text);

drop table if exists view_sorts;
drop table if exists view_filters;
drop table if exists view_columns;
drop table if exists views;
drop table if exists object_fields;
drop table if exists view_objects;

drop function if exists private.can_see_view(uuid);
drop function if exists private.can_edit_view(uuid);
drop function if exists private.check_view();
drop function if exists private.check_view_field();
drop function if exists private.check_object_field();
drop function if exists private.operator_allowed(public.field_type, public.filter_operator);

drop type if exists filter_match;
drop type if exists filter_operator;
drop type if exists sort_direction;
drop type if exists field_type;
drop type if exists view_type;
