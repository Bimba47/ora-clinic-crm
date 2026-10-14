-- ביטול 0029
delete from public.dashboard_widgets w
 using public.dashboards d
 where w.dashboard_id = d.id and d.name = 'ראשי' and w.title = 'הכנסות לפי טיפול';

-- הסרת {{month_start}} / {{month_end}}
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.automation_token(text, text, jsonb)'::regprocedure);
  v_def := replace(v_def,
    'if v_tok = ''month_start'' then return date_trunc(''month'', v_today)::date::text; end if;
  if v_tok = ''month_end'' then return (date_trunc(''month'', v_today) + interval ''1 month'' - interval ''1 day'')::date::text; end if;
  ', '');
  execute v_def;
end $$;
