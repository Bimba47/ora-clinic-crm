-- 0011: פונקציות ההרשאה של 0010 לא זמינות למי שלא מחוברת (anon)
-- ההרשאה להריץ פונקציה ניתנת כברירת מחדל לכולם (PUBLIC), ולכן מבטלים מ-PUBLIC ונותנים רק למחוברות.
-- (הפונקציות עצמן בודקות הרשאות, אבל אין סיבה שיהיו חשופות לפני כניסה.)

revoke execute on function public.get_record(text, uuid) from public, anon;
revoke execute on function public.get_me() from public, anon;
revoke execute on function public.get_my_permissions() from public, anon;
revoke execute on function public.duplicate_role(uuid, text) from public, anon;
revoke execute on function public.run_view(text, jsonb, text, integer, integer) from public, anon;
revoke execute on function public.run_view_groups(text, jsonb, text, text) from public, anon;

grant execute on function public.get_record(text, uuid) to authenticated;
grant execute on function public.get_me() to authenticated;
grant execute on function public.get_my_permissions() to authenticated;
grant execute on function public.duplicate_role(uuid, text) to authenticated;
grant execute on function public.run_view(text, jsonb, text, integer, integer) to authenticated;
grant execute on function public.run_view_groups(text, jsonb, text, text) to authenticated;
