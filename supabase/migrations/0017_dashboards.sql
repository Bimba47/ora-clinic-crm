-- 0017: מנוע לוחות בקרה. הווידג'ט הוא היחידה: כל מה שהוא צריך יושב בשורה שלו (אין טבלת דוחות).
-- השאילתה נבנית בצד השרת (public.run_widget) מהגדרת הווידג'ט: שמות שדות ואופרטורים נבדקים מול הקטלוג,
-- ערכים עוברים תמיד כפרמטר ($1), והפונקציה רצה בהקשר המשתמשת המחוברת (security invoker), כך ש-RLS חל.

create type widget_type as enum ('table', 'bar', 'pie', 'metric', 'list', 'text');
create type widget_date_group as enum ('none', 'day', 'week', 'month');
create type widget_aggregate as enum ('count', 'sum', 'avg', 'min', 'max', 'percent');

-- ===== טבלאות =====
create table dashboards (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  owner_id        uuid default auth.uid() references staff (id) on delete set null,
  is_shared       boolean not null default false,
  role_visibility uuid[] not null default '{}',     -- לוח משותף: לאילו תפקידים הוא מוצג. ריק = לכולם
  filters         jsonb not null default '{}',     -- סינון ברמת הלוח שנשמר: {date_from, date_to, owner}
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references staff (id) on delete set null
);
create index dashboards_owner_idx on dashboards (owner_id);
create index dashboards_updated_by_idx on dashboards (updated_by);

create table dashboard_widgets (
  id              uuid primary key default gen_random_uuid(),
  dashboard_id    uuid not null references dashboards (id) on delete cascade,
  title           text not null default '',
  widget_type     widget_type not null,
  object_name     text,                              -- ריק רק בווידג'ט טקסט
  filters         jsonb not null default '{"match":"all","rules":[]}',  -- כמו התנאים של האוטומציות
  group_by        text,
  date_group      widget_date_group not null default 'none',
  aggregate       widget_aggregate not null default 'count',
  aggregate_field text,
  sort            text,                              -- value_desc / value_asc / label_asc / שדה[:desc]
  "limit"         int check ("limit" is null or "limit" between 1 and 500),
  position_x      int not null default 0 check (position_x between 0 and 11),
  position_y      int not null default 0 check (position_y >= 0),
  width           int not null default 4 check (width between 1 and 12),
  height          int not null default 3 check (height between 1 and 12),
  config          jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references staff (id) on delete set null
);
create index dashboard_widgets_dashboard_idx on dashboard_widgets (dashboard_id);
create index dashboard_widgets_updated_by_idx on dashboard_widgets (updated_by);

create trigger dashboards_updated_at before update on dashboards for each row execute function private.set_updated_at();
create trigger dashboards_updated_by before insert or update on dashboards for each row execute function private.set_updated_by();
create trigger dashboard_widgets_updated_at before update on dashboard_widgets for each row execute function private.set_updated_at();
create trigger dashboard_widgets_updated_by before insert or update on dashboard_widgets for each row execute function private.set_updated_by();

-- ===== הרשאות =====
-- רואה: את הלוחות שלי, לוח משותף לתפקיד שלי (או לכולם), ומנהלת מערכת – הכול.
-- עורכת: לוח שלי, ולוח משותף – רק מנהלת מערכת. כל אחת יכולה ליצור לעצמה לוח פרטי.
create or replace function private.dashboard_visible(p_owner uuid, p_shared boolean, p_roles uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_staff() and (
    p_owner = (select auth.uid()) or private.is_manager()
    or (p_shared and (cardinality(p_roles) = 0 or private.my_role_id() = any(p_roles))))
$$;

create or replace function private.dashboard_editable(p_owner uuid, p_shared boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_staff() and (
    (p_owner = (select auth.uid()) and not p_shared) or private.is_manager())
$$;

create or replace function private.dashboard_editable_id(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dashboards d where d.id = p_id and private.dashboard_editable(d.owner_id, d.is_shared))
$$;

create or replace function private.dashboard_visible_id(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dashboards d where d.id = p_id and private.dashboard_visible(d.owner_id, d.is_shared, d.role_visibility))
$$;

alter table dashboards enable row level security;
alter table dashboard_widgets enable row level security;
create policy dashboards_select on dashboards for select to authenticated
  using (private.dashboard_visible(owner_id, is_shared, role_visibility));
create policy dashboards_insert on dashboards for insert to authenticated
  with check (private.is_active_staff() and (owner_id = (select auth.uid()) or private.is_manager()) and (not is_shared or private.is_manager()));
create policy dashboards_update on dashboards for update to authenticated
  using (private.dashboard_editable(owner_id, is_shared))
  with check (private.dashboard_editable(owner_id, is_shared));
create policy dashboards_delete on dashboards for delete to authenticated using (private.dashboard_editable(owner_id, is_shared));
create policy dashboard_widgets_select on dashboard_widgets for select to authenticated using (private.dashboard_visible_id(dashboard_id));
create policy dashboard_widgets_write on dashboard_widgets for all to authenticated
  using (private.dashboard_editable_id(dashboard_id)) with check (private.dashboard_editable_id(dashboard_id));
revoke all on dashboards, dashboard_widgets from anon;
grant select, insert, update, delete on dashboards, dashboard_widgets to authenticated;

-- ===== תבניות נוספות: {{now-48h}} (שעות), {{starts_at:time}}, {{starts_at:date}} =====
create or replace function private.automation_token(p_token text, p_object text, p_rec jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_tok text := trim(p_token); v_alt text; v_val text; v_field text; v_sub text; v_ref text; n int;
begin
  if position('|' in v_tok) > 0 then
    foreach v_alt in array string_to_array(v_tok, '|') loop
      v_val := private.automation_token(v_alt, p_object, p_rec);
      if coalesce(v_val, '') <> '' then return v_val; end if;
    end loop;
    return null;
  end if;
  if v_tok = 'now' then return to_jsonb(now()) #>> '{}'; end if;
  if v_tok ~ '^now[+-][0-9]+h$' then
    n := substring(v_tok from 4 for length(v_tok) - 4)::int;
    return to_jsonb(now() + make_interval(hours => n)) #>> '{}';
  end if;
  if v_tok ~ '^today([+-][0-9]+)?$' then
    n := coalesce(nullif(substring(v_tok from 6), ''), '0')::int;
    return ((now() at time zone 'Asia/Jerusalem')::date + n)::text;
  end if;
  if v_tok = 'user' then return (select auth.uid())::text; end if;
  if v_tok = 'user_name' then
    return coalesce((select full_name from public.staff where id = (select auth.uid())), 'המערכת');
  end if;
  if v_tok like '%:label' then
    v_field := split_part(v_tok, ':', 1);
    return private.automation_label(p_object, v_field, p_rec ->> v_field);
  end if;
  if v_tok like '%:time' or v_tok like '%:date' then
    v_field := split_part(v_tok, ':', 1);
    v_val := p_rec ->> v_field;
    if v_val is null then return null; end if;
    return to_char(v_val::timestamptz at time zone 'Asia/Jerusalem',
                   case when v_tok like '%:time' then 'HH24:MI' else 'DD.MM.YYYY' end);
  end if;
  if position('.' in v_tok) > 0 then
    v_field := split_part(v_tok, '.', 1);
    v_sub := split_part(v_tok, '.', 2);
    select ref_object into v_ref from private.automation_field(p_object, v_field);
    if v_ref is null or p_rec ->> v_field is null then return null; end if;
    if v_sub <> 'id' and not exists (select 1 from private.automation_field(v_ref, v_sub)) then return null; end if;
    execute format('select to_jsonb(t) ->> %L from public.%I t where t.id = $1', v_sub, v_ref)
      into v_val using (p_rec ->> v_field)::uuid;
    return v_val;
  end if;
  return p_rec ->> v_tok;
end
$$;

-- ===== בניית השאילתה =====
-- שדה בווידג'ט: שדה מהקטלוג (ונבדק שהוא לא חסום לי), או שדה נגזר "count:<אובייקט>.<שדה מקושר>" –
-- מספר הרשומות המקושרות (למשל מספר התורים של לקוחה). מחזיר ביטוי SQL בטוח וסוג.
create or replace function private.widget_field(p_object text, p_field text, out expr text, out ftype text)
language plpgsql stable security definer set search_path = '' as $$
declare v_rel text; v_fk text;
begin
  if p_field like 'count:%.%' then
    v_rel := split_part(substring(p_field from 7), '.', 1);
    v_fk := split_part(substring(p_field from 7), '.', 2);
    if not (v_rel = any(private.automation_objects()))
       or not exists (select 1 from private.automation_field(v_rel, v_fk) f where f.ref_object = p_object) then
      raise exception 'שדה לא תקין: %', p_field;
    end if;
    expr := format('(select count(*) from public.%I r where r.%I = t.id)', v_rel, v_fk);
    ftype := 'number';
    return;
  end if;
  select f.field_type into ftype from private.automation_field(p_object, p_field) f;
  if ftype is null then raise exception 'שדה לא קיים: %', p_field; end if;
  if private.field_hidden(p_object, p_field) then raise exception 'השדה % לא זמין לך', p_field; end if;
  expr := format('t.%I', p_field);
end
$$;

-- תנאי אחד → SQL. הערך נכנס למערך הפרמטרים (p_params) ומופיע בשאילתה רק כ-($1->>n).
create or replace function private.widget_condition(p_object text, r jsonb, inout p_params jsonb, out sql text)
language plpgsql stable security definer set search_path = '' as $$
declare f record; op text := r ->> 'op'; v text; p text; is_day boolean;
begin
  select * into f from private.widget_field(p_object, r ->> 'field');
  if not (op = any(array['eq', 'neq', 'contains', 'not_contains', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'])) then
    raise exception 'אופרטור לא מוכר: %', op;
  end if;
  if op in ('contains', 'not_contains') and f.ftype not in ('text', 'long_text', 'phone', 'email') then
    raise exception 'האופרטור % לא מתאים לשדה %', op, r ->> 'field';
  end if;
  if op in ('gt', 'gte', 'lt', 'lte') and f.ftype not in ('number', 'money', 'date', 'datetime') then
    raise exception 'האופרטור % לא מתאים לשדה %', op, r ->> 'field';
  end if;
  if op = 'is_empty' then sql := format('(%s is null or %s::text = '''')', f.expr, f.expr); return; end if;
  if op = 'is_not_empty' then sql := format('(%s is not null and %s::text <> '''')', f.expr, f.expr); return; end if;

  v := private.automation_value(r -> 'value', p_object, '{}'::jsonb);   -- תבניות: {{today}}, {{user}}, {{now-48h}}
  p_params := p_params || to_jsonb(v);
  p := format('($1->>%s)', jsonb_array_length(p_params) - 1);
  if v is null then sql := 'false'; return; end if;

  if op in ('contains', 'not_contains') then
    sql := format('%s(%s::text ilike ''%%'' || private.like_escape(%s) || ''%%'')',
                  case when op = 'not_contains' then 'not ' else '' end, f.expr, p);
    return;
  end if;
  op := case op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' else '<=' end;
  if f.ftype in ('number', 'money') then
    sql := format('%s %s %s::numeric', f.expr, op, p);
  elsif f.ftype = 'date' then
    sql := format('%s %s %s::date', f.expr, op, p);
  elsif f.ftype = 'datetime' then
    is_day := v ~ '^\d{4}-\d{2}-\d{2}$';   -- תאריך בלי שעה: השוואה ליום, לפי שעון ישראל
    sql := case when is_day then format('(%s at time zone ''Asia/Jerusalem'')::date %s %s::date', f.expr, op, p)
                else format('%s %s %s::timestamptz', f.expr, op, p) end;
  else
    sql := format('%s::text %s %s', f.expr, op, p);
  end if;
  if op = '<>' then sql := format('(%s is null or %s)', f.expr, sql); end if;
end
$$;

create or replace function private.widget_where(p_object text, p_cond jsonb, inout p_params jsonb, out sql text)
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; c record; parts text[] := '{}';
begin
  for r in select * from jsonb_array_elements(coalesce(p_cond -> 'rules', '[]')) loop
    select * into c from private.widget_condition(p_object, r, p_params);
    p_params := c.p_params;
    parts := parts || c.sql;
  end loop;
  sql := case when cardinality(parts) = 0 then 'true'
              else '(' || array_to_string(parts, case when p_cond ->> 'match' = 'any' then ' or ' else ' and ' end) || ')' end;
end
$$;

-- שם להצגה של ערך: שדה מקושר → שם הרשומה (תחת RLS של המשתמשת)
create or replace function private.widget_label_expr(p_object text, p_field text, p_expr text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_ref text; v_disp text;
begin
  select ref_object into v_ref from private.automation_field(p_object, p_field);
  if v_ref is null then return p_expr || '::text'; end if;
  select display_field into v_disp from public.view_objects where object_key = v_ref;
  return format('(select x.%I::text from public.%I x where x.id = %s)', v_disp, v_ref, p_expr);
end
$$;

create or replace function public.run_widget(p_widget jsonb, p_dash jsonb default '{}')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_obj text := p_widget ->> 'object_name';
  v_type text := p_widget ->> 'widget_type';
  v_cfg jsonb := coalesce(p_widget -> 'config', '{}');
  v_cond jsonb := coalesce(p_widget -> 'filters', '{"match":"all","rules":[]}');
  v_params jsonb := '[]';
  w record; v_where text; v_owner text; v_datef text; v_rules jsonb;
  v_agg text; v_aggf record; g record; s record; v_key text; v_label text; v_split text; v_slabel text;
  v_dg text := coalesce(p_widget ->> 'date_group', 'none');
  v_limit int := least(coalesce((p_widget ->> 'limit')::int, 50), 500);
  v_order text; v_sql text; v_res jsonb; v_cols text[]; c text; fr record; v_sel text[] := '{}';
  v_cmp_field text; v_days int; v_cur numeric; v_prev numeric; pw record; v_rec text[] := array['''id''', 't.id'];
begin
  if not private.is_active_staff() then raise exception 'אין הרשאה'; end if;
  if v_type = 'text' then return '{}'; end if;
  if not (v_obj = any(private.automation_objects())) then raise exception 'אובייקט לא נתמך: %', v_obj; end if;

  -- סינון ברמת הלוח דורס את הסינון של הווידג'ט על אותו שדה: טווח תאריכים ונציגה
  select owner_field into v_owner from public.view_objects where object_key = v_obj;
  v_datef := coalesce(nullif(v_cfg ->> 'date_field', ''),
                      (select f.field_key from public.object_fields f join public.view_objects o on o.id = f.object_id
                        where o.object_key = v_obj and f.field_type in ('date', 'datetime') order by f.position limit 1));
  v_rules := coalesce(v_cond -> 'rules', '[]');
  if coalesce(p_dash ->> 'date_from', '') <> '' or coalesce(p_dash ->> 'date_to', '') <> '' then
    select coalesce(jsonb_agg(x), '[]') into v_rules from jsonb_array_elements(v_rules) x where x ->> 'field' <> v_datef;
    if coalesce(p_dash ->> 'date_from', '') <> '' then
      v_rules := v_rules || jsonb_build_array(jsonb_build_object('field', v_datef, 'op', 'gte', 'value', p_dash ->> 'date_from'));
    end if;
    if coalesce(p_dash ->> 'date_to', '') <> '' then
      v_rules := v_rules || jsonb_build_array(jsonb_build_object('field', v_datef, 'op', 'lte', 'value', p_dash ->> 'date_to'));
    end if;
  end if;
  if coalesce(p_dash ->> 'owner', '') <> '' and v_owner is not null and coalesce((v_cfg ->> 'ignore_owner')::boolean, false) = false then
    select coalesce(jsonb_agg(x), '[]') into v_rules from jsonb_array_elements(v_rules) x where x ->> 'field' <> v_owner;
    v_rules := v_rules || jsonb_build_array(jsonb_build_object('field', v_owner, 'op', 'eq', 'value', p_dash ->> 'owner'));
  end if;
  -- כשיש סינון לוח, "וגם" בין כל התנאים (כדי שהדריסה תחול על הכול)
  v_cond := jsonb_build_object('match', case when v_rules = (v_cond -> 'rules') then coalesce(v_cond ->> 'match', 'all') else 'all' end, 'rules', v_rules);
  select * into w from private.widget_where(v_obj, v_cond, v_params);
  v_params := w.p_params;
  v_where := w.sql;

  -- פונקציית הסיכום
  if p_widget ->> 'aggregate' in ('sum', 'avg', 'min', 'max') then
    select * into v_aggf from private.widget_field(v_obj, p_widget ->> 'aggregate_field');
    if v_aggf.ftype not in ('number', 'money') then raise exception 'סיכום אפשרי רק על שדה מספרי'; end if;
    v_agg := format('round(%s(%s)::numeric, 2)', p_widget ->> 'aggregate', v_aggf.expr);
  elsif p_widget ->> 'aggregate' = 'percent' then
    select * into pw from private.widget_where(v_obj, coalesce(v_cfg -> 'percent_where', '{"rules":[]}'), v_params);
    v_params := pw.p_params;
    v_agg := format('round(100.0 * count(*) filter (where %s) / nullif(count(*), 0), 1)', pw.sql);
  else
    v_agg := 'count(*)';
  end if;

  -- מספר בודד, עם השוואה לתקופה קודמת (config.compare: {field, days})
  if v_type = 'metric' then
    v_cmp_field := v_cfg -> 'compare' ->> 'field';
    if coalesce(v_cmp_field, '') <> '' then
      select * into fr from private.widget_field(v_obj, v_cmp_field);
      if fr.ftype not in ('date', 'datetime') then raise exception 'השוואה לתקופה קודמת צריכה שדה תאריך'; end if;
      v_days := greatest(coalesce((v_cfg -> 'compare' ->> 'days')::int, 7), 1);
      execute format('select %s from public.%I t where %s and %s >= now() - make_interval(days => %s) and %s < now()',
                     v_agg, v_obj, v_where, fr.expr, v_days, fr.expr) into v_cur using v_params;
      execute format('select %s from public.%I t where %s and %s >= now() - make_interval(days => %s) and %s < now() - make_interval(days => %s)',
                     v_agg, v_obj, v_where, fr.expr, v_days * 2, fr.expr, v_days) into v_prev using v_params;
      return jsonb_build_object('kind', 'metric', 'value', coalesce(v_cur, 0), 'previous', coalesce(v_prev, 0), 'days', v_days,
                                'change', case when coalesce(v_prev, 0) = 0 then null else round(100.0 * (coalesce(v_cur, 0) - v_prev) / abs(v_prev), 1) end);
    end if;
    execute format('select %s from public.%I t where %s', v_agg, v_obj, v_where) into v_cur using v_params;
    return jsonb_build_object('kind', 'metric', 'value', coalesce(v_cur, 0));
  end if;

  -- קיבוץ (עמודות, טבעת, וטבלה מקובצת), אופציונלית עם פיצול לפי שדה שני (config.split_by) – טבלת ציר
  if coalesce(p_widget ->> 'group_by', '') <> '' and v_type in ('bar', 'pie', 'table') then
    select * into g from private.widget_field(v_obj, p_widget ->> 'group_by');
    if p_widget ->> 'group_by' like 'count:%' then raise exception 'אי אפשר לקבץ לפי שדה נגזר'; end if;
    if g.ftype in ('date', 'datetime') and v_dg <> 'none' then
      v_key := case v_dg
        when 'day' then format('((%s)%s)::date', g.expr, case when g.ftype = 'datetime' then ' at time zone ''Asia/Jerusalem''' else '' end)
        when 'week' then format('(((%1$s)%2$s)::date - extract(dow from ((%1$s)%2$s))::int)', g.expr, case when g.ftype = 'datetime' then ' at time zone ''Asia/Jerusalem''' else '' end)   -- השבוע מתחיל ביום ראשון
        else format('date_trunc(''month'', (%s)%s)::date', g.expr, case when g.ftype = 'datetime' then ' at time zone ''Asia/Jerusalem''' else '' end) end;
      v_label := v_key || '::text';
      v_key := v_key || '::text';
    else
      v_label := private.widget_label_expr(v_obj, p_widget ->> 'group_by', g.expr);
      v_key := g.expr || '::text';
    end if;
    if coalesce(v_cfg ->> 'split_by', '') <> '' and v_type <> 'pie' then
      select * into s from private.widget_field(v_obj, v_cfg ->> 'split_by');
      v_split := s.expr || '::text';
      v_slabel := private.widget_label_expr(v_obj, v_cfg ->> 'split_by', s.expr);
    end if;
    v_order := case coalesce(p_widget ->> 'sort', case when v_dg <> 'none' then 'label_asc' else 'value_desc' end)
                 when 'value_asc' then 'value asc' when 'label_asc' then 'key asc nulls last' when 'label_desc' then 'key desc nulls last'
                 else 'value desc' end;
    if v_split is null then
      v_sql := format('select coalesce(jsonb_agg(x order by %s), ''[]'') from (select %s as key, %s as label, %s as value from public.%I t where %s group by 1, 2 order by %s limit %s) x',
                      replace(v_order, 'value', 'x.value'), v_key, v_label, v_agg, v_obj, v_where, v_order, v_limit);
    else
      v_sql := format('select coalesce(jsonb_agg(x), ''[]'') from (select %s as key, %s as label, %s as split, %s as split_label, %s as value from public.%I t where %s group by 1, 2, 3, 4 order by 1 limit 2000) x',
                      v_key, v_label, v_split, v_slabel, v_agg, v_obj, v_where);
    end if;
    execute v_sql into v_res using v_params;
    return jsonb_build_object('kind', case when v_split is null then 'groups' else 'pivot' end, 'groups', v_res);
  end if;

  -- רשומות (רשימה, או טבלה בלי קיבוץ): העמודות מ-config.columns, נבדקות מול הקטלוג
  select coalesce(array_agg(x), '{}') into v_cols from jsonb_array_elements_text(coalesce(v_cfg -> 'columns', '[]')) x;
  if cardinality(v_cols) = 0 then
    v_cols := array[(select display_field from public.view_objects where object_key = v_obj)];
  end if;
  foreach c in array v_cols loop
    select * into fr from private.widget_field(v_obj, c);
    v_sel := v_sel || format('%s as %I', fr.expr, c);
    v_rec := v_rec || format('%L', c) || fr.expr;
    if not (c like 'count:%') then
      v_sel := v_sel || format('%s as %I', private.widget_label_expr(v_obj, c, fr.expr), c || '__label');
    end if;
  end loop;
  v_order := 't.created_at desc';
  if coalesce(p_widget ->> 'sort', '') <> '' and p_widget ->> 'sort' not in ('value_desc', 'value_asc', 'label_asc', 'label_desc') then
    select * into fr from private.widget_field(v_obj, split_part(p_widget ->> 'sort', ':', 1));
    v_order := fr.expr || case when p_widget ->> 'sort' like '%:desc' then ' desc nulls last' else ' asc nulls last' end;
  end if;
  v_sql := format('select coalesce(jsonb_agg(x), ''[]'') from (select t.id, %s, jsonb_build_object(%s) as __rec from public.%I t where %s order by %s limit %s) x',
                  array_to_string(v_sel, ', '), array_to_string(v_rec, ', '), v_obj, v_where, v_order, v_limit);
  execute v_sql into v_res using v_params;
  -- הודעת וואטסאפ מוכנה (config.whatsapp: {template, phone}) נבנית מהרשומה, ואז הרשומה המלאה לא נשלחת
  select coalesce(jsonb_agg(
           (r - '__rec') || case when coalesce(v_cfg -> 'whatsapp' ->> 'template', '') <> '' then
             jsonb_build_object('__message', private.automation_render(v_cfg -> 'whatsapp' ->> 'template', v_obj, r -> '__rec'),
                                '__phone', private.automation_render('{{' || coalesce(v_cfg -> 'whatsapp' ->> 'phone', 'phone') || '}}', v_obj, r -> '__rec'))
           else '{}'::jsonb end), '[]')
    into v_res from jsonb_array_elements(v_res) r;
  return jsonb_build_object('kind', 'rows', 'rows', v_res, 'columns', to_jsonb(v_cols));
end
$$;
revoke execute on function public.run_widget(jsonb, jsonb) from public, anon;
grant execute on function public.run_widget(jsonb, jsonb) to authenticated;

-- שכפול לוח עם כל הווידג'טים שלו (העותק פרטי, שלי)
create or replace function public.duplicate_dashboard(p_id uuid, p_name text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_new uuid;
begin
  if not private.dashboard_visible_id(p_id) then raise exception 'הלוח לא נמצא'; end if;
  insert into public.dashboards (name, owner_id, is_shared, role_visibility, filters)
  select p_name, (select auth.uid()), false, '{}', filters from public.dashboards where id = p_id
  returning id into v_new;
  insert into public.dashboard_widgets (dashboard_id, title, widget_type, object_name, filters, group_by, date_group, aggregate,
                                        aggregate_field, sort, "limit", position_x, position_y, width, height, config)
  select v_new, title, widget_type, object_name, filters, group_by, date_group, aggregate,
         aggregate_field, sort, "limit", position_x, position_y, width, height, config
    from public.dashboard_widgets where dashboard_id = p_id;
  return v_new;
end
$$;
revoke execute on function public.duplicate_dashboard(uuid, text) from public, anon;
grant execute on function public.duplicate_dashboard(uuid, text) to authenticated;

-- ===== הלוח "ראשי": הדשבורד של האפיון, בנוי מווידג'טים רגילים (אפשר לערוך כל אחד מהם מהלוח) =====
with d as (
  insert into dashboards (name, owner_id, is_shared, position) values ('ראשי', null, true, 0) returning id
)
insert into dashboard_widgets (dashboard_id, title, widget_type, object_name, filters, group_by, date_group, aggregate,
                               aggregate_field, sort, "limit", position_x, position_y, width, height, config)
select d.id, w.title, w.widget_type::widget_type, w.object_name, w.filters::jsonb, w.group_by, 'none', w.aggregate::widget_aggregate,
       null, w.sort, w.lim, w.x, w.y, w.w, w.h, w.config::jsonb
  from d, (values
  ('', 'text', null, '{"match":"all","rules":[]}', null, 'count', null, null, 0, 0, 12, 1,
   '{"text":"{{greeting}}, {{first_name}}","subtext":"{{today_long}}","size":"title"}'),
  ('קריאות חדשות', 'metric', 'service_requests', '{"match":"all","rules":[{"field":"status","op":"eq","value":"new"}]}', null, 'count', null, null, 0, 1, 3, 2,
   '{}'),
  ('קריאות בטיפול', 'metric', 'service_requests', '{"match":"all","rules":[{"field":"status","op":"eq","value":"in_progress"}]}', null, 'count', null, null, 3, 1, 3, 2,
   '{}'),
  ('פתוחות מעל 48 שעות', 'metric', 'service_requests', '{"match":"all","rules":[{"field":"status","op":"neq","value":"closed"},{"field":"created_at","op":"lt","value":"{{now-48h}}"}]}', null, 'count', null, null, 6, 1, 3, 2,
   '{"tone":"danger"}'),
  ('אחוז המרה', 'metric', 'clients', '{"match":"all","rules":[]}', null, 'percent', null, null, 9, 1, 3, 2,
   '{"suffix":"%","percent_where":{"match":"all","rules":[{"field":"count:appointments.client_id","op":"gt","value":"0"}]},"hint":"לקוחות שקבעו לפחות תור אחד"}'),
  ('המשימות שלי', 'list', 'service_requests', '{"match":"all","rules":[{"field":"assigned_to","op":"eq","value":"{{user}}"},{"field":"status","op":"neq","value":"closed"}]}', null, 'count', 'created_at', 20, 0, 3, 6, 4,
   '{"columns":["description","client_id","status","created_at"],"inline_status":"status","ignore_owner":true,"empty":"אין קריאות פתוחות שמשויכות אלייך"}'),
  ('אחראיות', 'table', 'service_requests', '{"match":"all","rules":[{"field":"status","op":"neq","value":"closed"}]}', 'assigned_to', 'count', 'label_asc', 50, 6, 3, 6, 4,
   '{"split_by":"status"}'),
  ('התורים של היום', 'list', 'appointments', '{"match":"all","rules":[{"field":"starts_at","op":"eq","value":"{{today}}"},{"field":"status","op":"neq","value":"cancelled"}]}', null, 'count', 'starts_at', 30, 0, 7, 6, 4,
   '{"columns":["starts_at","client_id","treatment_id","therapist_id"],"time_only":"starts_at","empty":"אין תורים היום"}'),
  ('תורים למחר', 'list', 'appointments', '{"match":"all","rules":[{"field":"starts_at","op":"eq","value":"{{today+1}}"},{"field":"status","op":"eq","value":"upcoming"}]}', null, 'count', 'starts_at', 30, 6, 7, 6, 4,
   '{"columns":["starts_at","client_id","treatment_id"],"time_only":"starts_at","empty":"אין תורים מחר","whatsapp":{"phone":"client_id.phone","template":"היי {{client_id:label}}, תזכורת לתור שלך מחר ב-{{starts_at:time}} בקליניקת אורה, סוקולוב 48 הרצליה. נשמח לאישור"}}'),
  ('הקריאות האחרונות', 'list', 'service_requests', '{"match":"all","rules":[{"field":"status","op":"neq","value":"closed"}]}', null, 'count', 'created_at:desc', 5, 0, 11, 6, 4,
   '{"columns":["description","client_id","assigned_to","created_at"],"empty":"אין קריאות פתוחות"}'),
  ('אחוז המרה לפי מקור הגעה', 'bar', 'clients', '{"match":"all","rules":[]}', 'source', 'percent', 'value_desc', 10, 6, 11, 6, 4,
   '{"suffix":"%","percent_where":{"match":"all","rules":[{"field":"count:appointments.client_id","op":"gt","value":"0"}]}}'),
  ('לקוחות לפי מקור הגעה', 'pie', 'clients', '{"match":"all","rules":[]}', 'source', 'count', 'value_desc', 10, 0, 15, 6, 4,
   '{}'),
  ('לקוחות חדשות (7 ימים)', 'metric', 'clients', '{"match":"all","rules":[]}', null, 'count', null, null, 6, 15, 3, 2,
   '{"compare":{"field":"created_at","days":7}}')
  ) w(title, widget_type, object_name, filters, group_by, aggregate, sort, lim, x, y, w, h, config);
