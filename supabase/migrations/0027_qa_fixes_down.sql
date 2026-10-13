-- ביטול 0027: חזרה למדיניות RLS שקוראת ל-row_allowed בכל שורה, ולפונקציות הקודמות.
-- את גוף הפונקציות הקודמות לוקחים מהמיגרציות שיצרו אותן:
--   private.view_where, public.run_view, private.check_appointment → 0019_list_improvements.sql
--   private.api_db_error, public.api_request (6 פרמטרים) → 0026_api.sql
--   private.can_view_row → 0010_permissions.sql
-- ואת השדות המחושבים next_appointment ו-open_requests → 0019 (עם private.can_view_row).

do $$
declare t record; a text; v_sql text;
begin
  for t in select * from (values ('clients', 'created_by'), ('appointments', 'therapist_id'), ('service_requests', 'assigned_to'),
                                 ('treatments', 'null::uuid'), ('staff', 'id')) x(tbl, owner) loop
    foreach a in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t.tbl || '_' || a, t.tbl);
      v_sql := format('private.row_allowed(%L, %L, %s)', t.tbl,
                      case a when 'select' then 'view' when 'insert' then 'create' when 'update' then 'edit' else 'delete' end, t.owner);
      if t.tbl = 'staff' and a = 'select' then v_sql := '(' || v_sql || ' or id = (select auth.uid()))'; end if;
      execute case a
        when 'select' then format('create policy %I on public.%I for select to authenticated using (%s)', t.tbl || '_' || a, t.tbl, v_sql)
        when 'insert' then format('create policy %I on public.%I for insert to authenticated with check (%s)', t.tbl || '_' || a, t.tbl, v_sql)
        when 'update' then format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t.tbl || '_' || a, t.tbl, v_sql, v_sql)
        else format('create policy %I on public.%I for delete to authenticated using (%s)', t.tbl || '_' || a, t.tbl, v_sql)
      end;
    end loop;
  end loop;
end $$;

drop function if exists public.api_request(text, text, text, text, jsonb, jsonb, text);
drop index if exists api_logs_ip_time;
alter table api_logs drop column if exists ip;
-- אחרי שמריצים שוב את הפונקציות מ-0019/0026/0010 (ראו למעלה):
drop function if exists private.view_scope_sql(text, text);
drop function if exists private.my_team_members();
drop function if exists private.owner_ok(public.perm_scope, uuid, uuid, uuid[]);
