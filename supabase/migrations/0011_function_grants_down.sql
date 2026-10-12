-- ביטול 0011: ההרשאה להריץ את הפונקציות חוזרת להיות לכולם (כמו אחרי 0010)

grant execute on function public.get_record(text, uuid) to public;
grant execute on function public.get_me() to public;
grant execute on function public.get_my_permissions() to public;
grant execute on function public.duplicate_role(uuid, text) to public;
grant execute on function public.run_view(text, jsonb, text, integer, integer) to public;
grant execute on function public.run_view_groups(text, jsonb, text, text) to public;
