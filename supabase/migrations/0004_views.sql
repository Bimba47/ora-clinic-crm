-- CRM קליניקת אורה · שלב 4: מנוע תצוגות
-- התצוגה היא דאטה, לא קוד. המסכים נבנים גנרית מתוך הטבלאות כאן.
-- 1. קטלוג: אילו אובייקטים ושדות אפשר להציג (view_objects, object_fields).
-- 2. תצוגות: שם, אובייקט, סוג, בעלים, משותפת, ברירת מחדל (views),
--    ועמודות, סינונים ומיון (view_columns, view_filters, view_sorts).
-- 3. פונקציות שמריצות תצוגה בתוך המסד. הן רצות בהרשאות המשתמשת (security invoker),
--    ולכן RLS קובע אילו שורות חוזרות, גם ברשימה וגם בקאנבן.
-- ביטול השלב: 0004_views_down.sql

-- ===== רשימות סגורות =====
create type view_type       as enum ('list', 'kanban');
create type field_type      as enum ('text', 'long_text', 'phone', 'email', 'number', 'money',
                                     'date', 'datetime', 'boolean', 'choice', 'reference');
create type sort_direction  as enum ('asc', 'desc');
create type filter_operator as enum ('eq', 'neq', 'contains', 'not_contains',
                                     'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty');
create type filter_match    as enum ('all', 'any');   -- all = וגם, any = או

-- ===== קטלוג: אובייקטים =====
create table view_objects (
  id             uuid primary key default gen_random_uuid(),
  object_key     text not null unique check (object_key in
                   ('staff', 'clients', 'treatments', 'appointments', 'service_requests', 'notifications')),
  label          text not null,              -- "לקוחה"
  label_plural   text not null,              -- "לקוחות"
  display_field  text not null,              -- השדה שמייצג רשומה כשהיא מקושרת ממקום אחר
  can_create     boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ===== קטלוג: שדות =====
create table object_fields (
  id               uuid primary key default gen_random_uuid(),
  object_id        uuid not null references view_objects (id) on delete cascade,
  field_key        text not null,
  label            text not null,
  field_type       field_type not null,
  options          jsonb,                    -- לשדה בחירה ולשדה כן/לא: [{"value": "...", "label": "..."}]
  ref_object_id    uuid references view_objects (id),
  position         int not null,
  default_visible  boolean not null default false,
  is_searchable    boolean not null default false,
  is_required      boolean not null default false,
  is_editable      boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (object_id, field_key),
  check ((field_type = 'reference') = (ref_object_id is not null)),
  check (field_type not in ('choice', 'boolean') or jsonb_typeof(options) = 'array')
);

-- שדה בקטלוג חייב להיות עמודה אמיתית בטבלה
create or replace function private.check_object_field()
returns trigger language plpgsql set search_path = '' as $$
declare v_table text;
begin
  select object_key into v_table from public.view_objects where id = new.object_id;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = v_table and column_name = new.field_key) then
    raise exception 'אין עמודה % בטבלה %', new.field_key, v_table;
  end if;
  return new;
end
$$;
create trigger object_fields_check before insert or update on object_fields
  for each row execute function private.check_object_field();

-- ===== תצוגות =====
create table views (
  id              uuid primary key default gen_random_uuid(),
  object_id       uuid not null references view_objects (id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  view_type       view_type not null default 'list',
  owner_id        uuid default auth.uid() references staff (id) on delete cascade,  -- ריק = תצוגת מערכת
  is_shared       boolean not null default false,
  is_default      boolean not null default false,
  filter_match    filter_match not null default 'all',
  kanban_field_id uuid references object_fields (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (not is_default or is_shared),        -- ברירת מחדל גלויה לכולן
  check (owner_id is not null or is_shared)   -- תצוגת מערכת תמיד משותפת
);
create unique index views_one_default on views (object_id) where is_default;
create index views_owner_idx on views (owner_id);
create index views_kanban_field_idx on views (kanban_field_id);

create table view_columns (
  id          uuid primary key default gen_random_uuid(),
  view_id     uuid not null references views (id) on delete cascade,
  field_id    uuid not null references object_fields (id) on delete cascade,
  position    int not null,
  width       int not null default 160 check (width between 60 and 800),
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (view_id, field_id)
);

create table view_filters (
  id          uuid primary key default gen_random_uuid(),
  view_id     uuid not null references views (id) on delete cascade,
  field_id    uuid not null references object_fields (id) on delete cascade,
  operator    filter_operator not null,
  value       text,
  position    int not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table view_sorts (
  id          uuid primary key default gen_random_uuid(),
  view_id     uuid not null references views (id) on delete cascade,
  field_id    uuid not null references object_fields (id) on delete cascade,
  direction   sort_direction not null default 'asc',
  position    int not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index object_fields_ref_idx  on object_fields (ref_object_id);
create index view_columns_field_idx on view_columns (field_id);
create index view_filters_view_idx  on view_filters (view_id);
create index view_filters_field_idx on view_filters (field_id);
create index view_sorts_view_idx    on view_sorts (view_id);
create index view_sorts_field_idx   on view_sorts (field_id);

create trigger view_objects_updated_at  before update on view_objects  for each row execute function private.set_updated_at();
create trigger object_fields_updated_at before update on object_fields for each row execute function private.set_updated_at();
create trigger views_updated_at         before update on views         for each row execute function private.set_updated_at();
create trigger view_columns_updated_at  before update on view_columns  for each row execute function private.set_updated_at();
create trigger view_filters_updated_at  before update on view_filters  for each row execute function private.set_updated_at();
create trigger view_sorts_updated_at    before update on view_sorts    for each row execute function private.set_updated_at();

-- ===== כללים =====
-- אילו אופרטורים מתאימים לכל סוג שדה
create or replace function private.operator_allowed(p_type public.field_type, p_op public.filter_operator)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_type in ('text', 'long_text', 'email', 'phone')
      then p_op in ('eq', 'neq', 'contains', 'not_contains', 'is_empty', 'is_not_empty')
    when p_type in ('number', 'money', 'date', 'datetime')
      then p_op in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty')
    when p_type = 'boolean'
      then p_op in ('eq', 'neq')
    else p_op in ('eq', 'neq', 'is_empty', 'is_not_empty')   -- choice, reference
  end
$$;

-- שדה בעמודה, בסינון או במיון חייב להיות של אותו אובייקט כמו התצוגה. אופרטור חייב להתאים לסוג השדה.
create or replace function private.check_view_field()
returns trigger language plpgsql set search_path = '' as $$
declare v_ok boolean; v_type public.field_type;
begin
  select f.object_id = v.object_id, f.field_type into v_ok, v_type
    from public.object_fields f, public.views v
   where f.id = new.field_id and v.id = new.view_id;
  if not coalesce(v_ok, false) then
    raise exception 'השדה לא שייך לאובייקט של התצוגה';
  end if;
  if tg_table_name = 'view_filters' then
    if not private.operator_allowed(v_type, new.operator) then
      raise exception 'האופרטור % לא מתאים לשדה מסוג %', new.operator, v_type;
    end if;
  end if;
  return new;
end
$$;
create trigger view_columns_check before insert or update on view_columns for each row execute function private.check_view_field();
create trigger view_filters_check before insert or update on view_filters for each row execute function private.check_view_field();
create trigger view_sorts_check   before insert or update on view_sorts   for each row execute function private.check_view_field();

-- קאנבן מקבץ רק לפי שדה בחירה או כן/לא של אותו אובייקט. ברירת מחדל נקבעת רק על ידי מנהלת.
create or replace function private.check_view()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kanban_field_id is not null and not exists (
    select 1 from public.object_fields f
     where f.id = new.kanban_field_id and f.object_id = new.object_id and f.field_type in ('choice', 'boolean')) then
    raise exception 'קאנבן מקבץ רק לפי שדה בחירה של אותו אובייקט';
  end if;
  if new.is_default and (tg_op = 'INSERT' or not old.is_default)
     and (select auth.uid()) is not null and not private.is_manager() then
    raise exception 'רק מנהלת קובעת תצוגת ברירת מחדל';
  end if;
  return new;
end
$$;
create trigger views_check before insert or update on views for each row execute function private.check_view();

-- ===== הרשאות =====
create or replace function private.can_see_view(p_view_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_staff() and exists (
    select 1 from public.views v
     where v.id = p_view_id and (v.is_shared or v.owner_id = (select auth.uid())))
$$;

create or replace function private.can_edit_view(p_view_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_staff() and exists (
    select 1 from public.views v
     where v.id = p_view_id and (v.owner_id = (select auth.uid()) or private.is_manager()))
$$;
grant execute on function private.can_see_view(uuid), private.can_edit_view(uuid) to authenticated;

alter table view_objects  enable row level security;
alter table object_fields enable row level security;
alter table views         enable row level security;
alter table view_columns  enable row level security;
alter table view_filters  enable row level security;
alter table view_sorts    enable row level security;

revoke all on view_objects, object_fields, views, view_columns, view_filters, view_sorts from anon;
-- הקטלוג לקריאה בלבד מהממשק. הוא משתנה רק במיגרציה.
revoke insert, update, delete, truncate on view_objects, object_fields from authenticated;

create policy view_objects_select  on view_objects  for select to authenticated using ((select private.is_active_staff()));
create policy object_fields_select on object_fields for select to authenticated using ((select private.is_active_staff()));

-- תצוגה: רואה משותפות ואת שלה. יוצרת רק בשמה. משנה ומוחקת את שלה, ומנהלת את כולן.
create policy views_select on views for select to authenticated
  using ((select private.is_active_staff()) and (is_shared or owner_id = (select auth.uid())));
create policy views_insert on views for insert to authenticated
  with check ((select private.is_active_staff()) and owner_id = (select auth.uid()));
create policy views_update on views for update to authenticated
  using ((select private.is_active_staff()) and (owner_id = (select auth.uid()) or (select private.is_manager())))
  with check ((select private.is_active_staff()) and (owner_id = (select auth.uid()) or (select private.is_manager())));
create policy views_delete on views for delete to authenticated
  using ((select private.is_active_staff()) and (owner_id = (select auth.uid()) or (select private.is_manager())));

create policy view_columns_select on view_columns for select to authenticated using (private.can_see_view(view_id));
create policy view_columns_write  on view_columns for all    to authenticated using (private.can_edit_view(view_id)) with check (private.can_edit_view(view_id));
create policy view_filters_select on view_filters for select to authenticated using (private.can_see_view(view_id));
create policy view_filters_write  on view_filters for all    to authenticated using (private.can_edit_view(view_id)) with check (private.can_edit_view(view_id));
create policy view_sorts_select   on view_sorts   for select to authenticated using (private.can_see_view(view_id));
create policy view_sorts_write    on view_sorts   for all    to authenticated using (private.can_edit_view(view_id)) with check (private.can_edit_view(view_id));

-- ===== הרצת תצוגה =====
-- מילוט תווים מיוחדים בחיפוש חלקי (%, _ ו-\)
create or replace function private.like_escape(p text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- הביטוי שמציג שדה מקושר כשם הרשומה ולא כמזהה
create or replace function private.ref_label_sql(p_field_id uuid)
returns text language sql stable set search_path = '' as $$
  select format('(select r.%I::text from public.%I r where r.id = t.%I)', o.display_field, o.object_key, f.field_key)
    from public.object_fields f join public.view_objects o on o.id = f.ref_object_id
   where f.id = p_field_id
$$;

-- תנאי סינון אחד כ-SQL. הערכים עוברים דרך format(%L), ושמות העמודות מגיעים רק מהקטלוג.
create or replace function private.filter_sql(p_field public.object_fields, p_op public.filter_operator, p_value text)
returns text language plpgsql stable set search_path = '' as $$
declare
  c   text := format('t.%I', p_field.field_key);
  cmp text := case p_op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>'
                        when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end;
  v   text;
begin
  if not private.operator_allowed(p_field.field_type, p_op) then
    raise exception 'האופרטור % לא מתאים לשדה %', p_op, p_field.label;
  end if;

  if p_op = 'is_empty' then
    return case when p_field.field_type in ('text', 'long_text', 'email', 'phone')
                then format('(%s is null or %s = '''')', c, c) else format('%s is null', c) end;
  elsif p_op = 'is_not_empty' then
    return case when p_field.field_type in ('text', 'long_text', 'email', 'phone')
                then format('(%s is not null and %s <> '''')', c, c) else format('%s is not null', c) end;
  end if;

  -- תנאי שעוד לא מולא ערך לא מסנן כלום
  if p_value is null or trim(p_value) = '' then
    return 'true';
  end if;

  if p_field.field_type = 'phone' then
    v := regexp_replace(regexp_replace(p_value, '\D', '', 'g'), '^972', '0');
    return case p_op
      when 'eq'           then format('%s = %L', c, v)
      when 'neq'          then format('%s is distinct from %L', c, v)
      when 'contains'     then format('%s like %L', c, '%' || v || '%')
      when 'not_contains' then format('%s not like %L', c, '%' || v || '%') end;
  elsif p_field.field_type in ('text', 'long_text', 'email') then
    return case p_op
      when 'eq'           then format('lower(%s) = lower(%L)', c, p_value)
      when 'neq'          then format('lower(%s) is distinct from lower(%L)', c, p_value)
      when 'contains'     then format('%s ilike %L', c, '%' || private.like_escape(p_value) || '%')
      when 'not_contains' then format('coalesce(%s, '''') not ilike %L', c, '%' || private.like_escape(p_value) || '%') end;
  elsif p_field.field_type in ('number', 'money') then
    return format('%s %s %L::numeric', c, cmp, p_value);
  elsif p_field.field_type = 'date' then
    return format('%s %s %L::date', c, cmp, p_value);
  elsif p_field.field_type = 'datetime' then
    -- תאריך לפי שעון ישראל, כולל שעון קיץ
    return format('(%s at time zone ''Asia/Jerusalem'')::date %s %L::date', c, cmp, p_value);
  elsif p_field.field_type = 'boolean' then
    return case p_op when 'eq' then format('%s = %L::boolean', c, p_value)
                     else format('%s is distinct from %L::boolean', c, p_value) end;
  elsif p_field.field_type = 'reference' then
    return case p_op when 'eq' then format('%s = %L::uuid', c, p_value)
                     else format('%s is distinct from %L::uuid', c, p_value) end;
  else -- choice
    return case p_op when 'eq' then format('%s::text = %L', c, p_value)
                     else format('%s::text is distinct from %L', c, p_value) end;
  end if;
end
$$;

-- תנאי ה-WHERE של תצוגה: הסינונים (וגם / או) והחיפוש החופשי
-- p_def: {"filters": [{"field","op","value"}], "match": "all" | "any", ...}
create or replace function private.view_where(p_object text, p_def jsonb, p_search text)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_obj    public.view_objects;
  v_field  public.object_fields;
  v_parts  text[] := '{}';
  v_any    text[] := '{}';
  v_digits text;
  f        record;
  v_where  text := 'true';
begin
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found then raise exception 'אובייקט לא מוכר או שאין לך הרשאה: %', p_object; end if;

  for f in select x->>'field' as fld, (x->>'op')::public.filter_operator as op, x->>'value' as val
             from jsonb_array_elements(coalesce(p_def->'filters', '[]'::jsonb)) x loop
    select * into v_field from public.object_fields where object_id = v_obj.id and field_key = f.fld;
    if not found then raise exception 'שדה לא מוכר: %', f.fld; end if;
    v_parts := v_parts || private.filter_sql(v_field, f.op, f.val);
  end loop;

  if cardinality(v_parts) > 0 then
    v_where := '(' || array_to_string(v_parts,
                 case when p_def->>'match' = 'any' then ' or ' else ' and ' end) || ')';
  end if;

  if p_search is not null and trim(p_search) <> '' then
    v_digits := regexp_replace(p_search, '\D', '', 'g');
    for v_field in select * from public.object_fields where object_id = v_obj.id and is_searchable loop
      if v_field.field_type = 'phone' then
        if length(v_digits) >= 2 then
          v_any := v_any || format('t.%I like %L', v_field.field_key,
                                   '%' || regexp_replace(v_digits, '^972', '0') || '%');
        end if;
      elsif v_field.field_type = 'reference' then
        v_any := v_any || format('%s ilike %L', private.ref_label_sql(v_field.id),
                                 '%' || private.like_escape(trim(p_search)) || '%');
      else
        v_any := v_any || format('t.%I::text ilike %L', v_field.field_key,
                                 '%' || private.like_escape(trim(p_search)) || '%');
      end if;
    end loop;
    v_where := v_where || ' and (' || coalesce(nullif(array_to_string(v_any, ' or '), ''), 'false') || ')';
  end if;

  return v_where;
end
$$;

-- מריצה תצוגה ומחזירה {"total": מספר, "rows": [...]}. רצה בהרשאות המשתמשת, ולכן RLS חל.
-- p_def: {"columns": ["field", ...], "filters": [...], "match": "...", "sorts": [{"field","dir"}]}
create or replace function public.run_view(p_object text, p_def jsonb, p_search text default null,
                                           p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_obj    public.view_objects;
  v_field  public.object_fields;
  v_where  text;
  v_cols   text[] := array['t.id'];
  v_order  text[] := '{}';
  v_total  bigint;
  v_rows   jsonb;
  v_expr   text;
  s        record;
begin
  select * into v_obj from public.view_objects where object_key = p_object;
  if not found then raise exception 'אובייקט לא מוכר או שאין לך הרשאה: %', p_object; end if;
  v_where := private.view_where(p_object, p_def, p_search);

  for v_field in
    select f.* from jsonb_array_elements_text(coalesce(p_def->'columns', '[]'::jsonb)) with ordinality c(k, n)
      join public.object_fields f on f.object_id = v_obj.id and f.field_key = c.k
     order by c.n loop
    if v_field.field_key <> 'id' then
      v_cols := v_cols || format('t.%I', v_field.field_key);
    end if;
    if v_field.field_type = 'reference' then
      v_cols := v_cols || format('%s as %I', private.ref_label_sql(v_field.id), v_field.field_key || '__label');
    end if;
  end loop;

  for s in select x->>'field' as fld, x->>'dir' as dir
             from jsonb_array_elements(coalesce(p_def->'sorts', '[]'::jsonb)) x loop
    select * into v_field from public.object_fields where object_id = v_obj.id and field_key = s.fld;
    if not found then raise exception 'שדה מיון לא מוכר: %', s.fld; end if;
    v_expr := case when v_field.field_type = 'reference' then private.ref_label_sql(v_field.id)
                   else format('t.%I', v_field.field_key) end;
    v_order := v_order || format('%s %s nulls last', v_expr, case when s.dir = 'desc' then 'desc' else 'asc' end);
  end loop;
  v_order := v_order || 't.created_at desc'::text || 't.id'::text;

  execute format('select count(*) from public.%I t where %s', p_object, v_where) into v_total;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(q) - ''__n'' order by q.__n), ''[]''::jsonb) from (
       select %s, row_number() over (order by %s) as __n
         from public.%I t where %s order by %s limit %s offset %s) q',
    array_to_string(v_cols, ', '), array_to_string(v_order, ', '),
    p_object, v_where, array_to_string(v_order, ', '),
    greatest(least(coalesce(p_limit, 25), 5000), 1), greatest(coalesce(p_offset, 0), 0))
  into v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end
$$;

-- מונה רשומות לכל ערך של שדה הקיבוץ (עמודות הקאנבן), עם אותם סינונים וחיפוש
create or replace function public.run_view_groups(p_object text, p_def jsonb, p_search text, p_group_field text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb; v_obj_id uuid;
begin
  select id into v_obj_id from public.view_objects where object_key = p_object;
  if not exists (select 1 from public.object_fields
                  where object_id = v_obj_id and field_key = p_group_field and field_type in ('choice', 'boolean')) then
    raise exception 'שדה קיבוץ לא מוכר: %', p_group_field;
  end if;
  execute format('select coalesce(jsonb_object_agg(coalesce(g, ''''), n), ''{}''::jsonb)
                    from (select t.%I::text as g, count(*) as n from public.%I t where %s group by 1) x',
                 p_group_field, p_object, private.view_where(p_object, p_def, p_search))
  into v_result;
  return v_result;
end
$$;

-- שומרת את כל ההגדרות של תצוגה בפעולה אחת. RLS קובע מי רשאית לשנות.
-- p_def: {"view_type", "match", "kanban_field", "columns": [{"field","width","visible"}],
--         "filters": [{"field","op","value"}], "sorts": [{"field","dir"}]}
create or replace function public.save_view(p_view_id uuid, p_def jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_obj uuid;
begin
  update public.views v set
    view_type       = coalesce((p_def->>'view_type')::public.view_type, v.view_type),
    filter_match    = coalesce((p_def->>'match')::public.filter_match, v.filter_match),
    kanban_field_id = case when p_def ? 'kanban_field'
                           then (select f.id from public.object_fields f
                                  where f.object_id = v.object_id and f.field_key = p_def->>'kanban_field')
                           else v.kanban_field_id end
   where v.id = p_view_id
  returning object_id into v_obj;
  if v_obj is null then
    raise exception 'אין לך הרשאה לשנות את התצוגה הזו. שכפלי אותה כדי לשמור תצוגה משלך.';
  end if;

  if p_def ? 'columns' then
    delete from public.view_columns where view_id = p_view_id;
    insert into public.view_columns (view_id, field_id, position, width, is_visible)
    select p_view_id, f.id, c.n, coalesce((c.x->>'width')::int, 160), coalesce((c.x->>'visible')::boolean, true)
      from jsonb_array_elements(p_def->'columns') with ordinality c(x, n)
      join public.object_fields f on f.object_id = v_obj and f.field_key = c.x->>'field';
  end if;
  if p_def ? 'filters' then
    delete from public.view_filters where view_id = p_view_id;
    insert into public.view_filters (view_id, field_id, operator, value, position)
    select p_view_id, f.id, (c.x->>'op')::public.filter_operator, c.x->>'value', c.n
      from jsonb_array_elements(p_def->'filters') with ordinality c(x, n)
      join public.object_fields f on f.object_id = v_obj and f.field_key = c.x->>'field';
  end if;
  if p_def ? 'sorts' then
    delete from public.view_sorts where view_id = p_view_id;
    insert into public.view_sorts (view_id, field_id, direction, position)
    select p_view_id, f.id, coalesce((c.x->>'dir')::public.sort_direction, 'asc'), c.n
      from jsonb_array_elements(p_def->'sorts') with ordinality c(x, n)
      join public.object_fields f on f.object_id = v_obj and f.field_key = c.x->>'field';
  end if;
end
$$;

-- יוצרת תצוגה חדשה של המשתמשת. עם p_copy_from: שכפול של תצוגה קיימת, כולל עמודות, סינונים ומיון.
create or replace function public.create_view(p_object text, p_name text,
                                              p_view_type public.view_type default 'list', p_copy_from uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_obj uuid; v_id uuid; v_src public.views;
begin
  select id into v_obj from public.view_objects where object_key = p_object;
  if v_obj is null then raise exception 'אובייקט לא מוכר או שאין לך הרשאה: %', p_object; end if;

  if p_copy_from is not null then
    select * into v_src from public.views where id = p_copy_from and object_id = v_obj;
    if not found then raise exception 'התצוגה המקורית לא נמצאה'; end if;
    insert into public.views (object_id, name, view_type, owner_id, filter_match, kanban_field_id)
    values (v_obj, p_name, v_src.view_type, (select auth.uid()), v_src.filter_match, v_src.kanban_field_id)
    returning id into v_id;
    insert into public.view_columns (view_id, field_id, position, width, is_visible)
      select v_id, field_id, position, width, is_visible from public.view_columns where view_id = p_copy_from;
    insert into public.view_filters (view_id, field_id, operator, value, position)
      select v_id, field_id, operator, value, position from public.view_filters where view_id = p_copy_from;
    insert into public.view_sorts (view_id, field_id, direction, position)
      select v_id, field_id, direction, position from public.view_sorts where view_id = p_copy_from;
  else
    insert into public.views (object_id, name, view_type, owner_id, kanban_field_id)
    values (v_obj, p_name, p_view_type, (select auth.uid()),
            (select id from public.object_fields where object_id = v_obj and field_type = 'choice' order by position limit 1))
    returning id into v_id;
    insert into public.view_columns (view_id, field_id, position, is_visible)
      select v_id, id, position, default_visible from public.object_fields where object_id = v_obj;
  end if;
  return v_id;
end
$$;

-- קובעת תצוגת ברירת מחדל לאובייקט (מנהלת בלבד). ברירת מחדל תמיד משותפת.
create or replace function public.set_default_view(p_view_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_obj uuid;
begin
  if not private.is_manager() then raise exception 'רק מנהלת קובעת תצוגת ברירת מחדל'; end if;
  select object_id into v_obj from public.views where id = p_view_id;
  if v_obj is null then raise exception 'התצוגה לא נמצאה'; end if;
  update public.views set is_default = false where object_id = v_obj and is_default and id <> p_view_id;
  update public.views set is_default = true, is_shared = true where id = p_view_id;
end
$$;

revoke execute on function public.run_view(text, jsonb, text, int, int), public.run_view_groups(text, jsonb, text, text),
  public.save_view(uuid, jsonb), public.create_view(text, text, public.view_type, uuid), public.set_default_view(uuid)
  from public, anon;
grant execute on function public.run_view(text, jsonb, text, int, int), public.run_view_groups(text, jsonb, text, text),
  public.save_view(uuid, jsonb), public.create_view(text, text, public.view_type, uuid), public.set_default_view(uuid)
  to authenticated;

-- ===== קטלוג: האובייקטים והשדות =====
insert into view_objects (object_key, label, label_plural, display_field, can_create) values
  ('clients',          'לקוחה',      'לקוחות',        'full_name',   true),
  ('appointments',     'תור',        'תורים',         'starts_at',   true),
  ('service_requests', 'קריאה',      'קריאות שירות',  'description', true),
  ('treatments',       'טיפול',      'מחירון',        'name',        true),
  ('staff',            'אשת צוות',   'צוות',          'full_name',   false),  -- מצטרפות בהזמנה, לא בטופס
  ('notifications',    'התראה',      'התראות',        'message',     false);  -- נוצרות אוטומטית

insert into object_fields (object_id, field_key, label, field_type, options, ref_object_id,
                           position, default_visible, is_searchable, is_required, is_editable)
select o.id, f.field_key, f.label, f.field_type::field_type, f.options::jsonb, r.id,
       f.position, f.default_visible, f.is_searchable, f.is_required, f.is_editable
  from (values
  -- object, field, label, type, options, ref, pos, visible, search, required, editable
  ('staff', 'full_name', 'שם מלא', 'text', null, null, 1, true, true, true, true),
  ('staff', 'role', 'תפקיד', 'choice', '[{"value":"manager","label":"מנהלת"},{"value":"therapist","label":"מטפלת"}]', null, 2, true, false, true, true),
  ('staff', 'phone', 'טלפון', 'phone', null, null, 3, true, true, true, true),
  ('staff', 'email', 'אימייל', 'email', null, null, 4, true, true, true, true),
  ('staff', 'is_active', 'סטטוס', 'boolean', '[{"value":"true","label":"פעילה"},{"value":"false","label":"מושבתת"}]', null, 5, true, false, true, true),
  ('staff', 'created_at', 'נוצרה', 'datetime', null, null, 6, false, false, false, false),
  ('staff', 'updated_at', 'עודכנה', 'datetime', null, null, 7, false, false, false, false),

  ('clients', 'full_name', 'שם מלא', 'text', null, null, 1, true, true, true, true),
  ('clients', 'phone', 'טלפון', 'phone', null, null, 2, true, true, true, true),
  ('clients', 'source', 'מקור הגעה', 'choice', '[{"value":"instagram","label":"אינסטגרם"},{"value":"facebook","label":"פייסבוק"},{"value":"website","label":"אתר"},{"value":"referral","label":"המלצה"},{"value":"other","label":"אחר"}]', null, 3, true, false, false, true),
  ('clients', 'created_by', 'נוצרה על ידי', 'reference', null, 'staff', 4, true, false, false, false),
  ('clients', 'created_at', 'נוצרה', 'datetime', null, null, 5, true, false, false, false),
  ('clients', 'updated_at', 'עודכנה', 'datetime', null, null, 6, false, false, false, false),

  ('treatments', 'name', 'טיפול', 'text', null, null, 1, true, true, true, true),
  ('treatments', 'price', 'מחיר', 'money', null, null, 2, true, false, true, true),
  ('treatments', 'duration_minutes', 'משך (דקות)', 'number', null, null, 3, true, false, true, true),
  ('treatments', 'is_active', 'פעיל', 'boolean', '[{"value":"true","label":"פעיל"},{"value":"false","label":"לא פעיל"}]', null, 4, true, false, true, true),
  ('treatments', 'created_at', 'נוצר', 'datetime', null, null, 5, false, false, false, false),
  ('treatments', 'updated_at', 'עודכן', 'datetime', null, null, 6, false, false, false, false),

  ('appointments', 'starts_at', 'תאריך ושעה', 'datetime', null, null, 1, true, false, true, true),
  ('appointments', 'client_id', 'לקוחה', 'reference', null, 'clients', 2, true, true, true, true),
  ('appointments', 'treatment_id', 'טיפול', 'reference', null, 'treatments', 3, true, true, true, true),
  ('appointments', 'therapist_id', 'מטפלת', 'reference', null, 'staff', 4, true, true, true, true),
  ('appointments', 'status', 'סטטוס', 'choice', '[{"value":"upcoming","label":"עתידי"},{"value":"done","label":"בוצע"},{"value":"cancelled","label":"בוטל"}]', null, 5, true, false, true, true),
  ('appointments', 'price', 'מחיר', 'money', null, null, 6, true, false, true, true),
  ('appointments', 'duration_minutes', 'משך (דקות)', 'number', null, null, 7, false, false, true, true),
  ('appointments', 'notes', 'הערות', 'long_text', null, null, 8, false, true, false, true),
  ('appointments', 'created_by', 'נקבע על ידי', 'reference', null, 'staff', 9, false, false, false, false),
  ('appointments', 'created_at', 'נוצר', 'datetime', null, null, 10, false, false, false, false),
  ('appointments', 'updated_at', 'עודכן', 'datetime', null, null, 11, false, false, false, false),

  ('service_requests', 'client_id', 'לקוחה', 'reference', null, 'clients', 1, true, true, true, true),
  ('service_requests', 'description', 'תיאור', 'long_text', null, null, 2, true, true, true, true),
  ('service_requests', 'status', 'סטטוס', 'choice', '[{"value":"new","label":"חדשה"},{"value":"in_progress","label":"בטיפול"},{"value":"closed","label":"נסגרה"}]', null, 3, true, false, true, true),
  ('service_requests', 'assigned_to', 'אחראית', 'reference', null, 'staff', 4, true, true, false, true),
  ('service_requests', 'created_at', 'נפתחה', 'datetime', null, null, 5, true, false, false, false),
  ('service_requests', 'created_by', 'נפתחה על ידי', 'reference', null, 'staff', 6, false, false, false, false),
  ('service_requests', 'closed_at', 'נסגרה', 'datetime', null, null, 7, false, false, false, false),
  ('service_requests', 'updated_at', 'עודכנה', 'datetime', null, null, 8, false, false, false, false),

  ('notifications', 'message', 'הודעה', 'text', null, null, 1, true, true, false, false),
  ('notifications', 'request_id', 'קריאה', 'reference', null, 'service_requests', 2, false, false, false, false),
  ('notifications', 'is_read', 'נקראה', 'boolean', '[{"value":"false","label":"לא נקראה"},{"value":"true","label":"נקראה"}]', null, 3, true, false, false, true),
  ('notifications', 'recipient_id', 'למי', 'reference', null, 'staff', 4, false, false, false, false),
  ('notifications', 'created_at', 'התקבלה', 'datetime', null, null, 5, true, false, false, false),
  ('notifications', 'updated_at', 'עודכנה', 'datetime', null, null, 6, false, false, false, false)
  ) f(object_key, field_key, label, field_type, options, ref_key, position, default_visible, is_searchable, is_required, is_editable)
  join view_objects o on o.object_key = f.object_key
  left join view_objects r on r.object_key = f.ref_key;

-- ===== תצוגות ברירת המחדל: תצוגת מערכת אחת לכל אובייקט =====
insert into views (object_id, name, view_type, owner_id, is_shared, is_default, kanban_field_id)
select o.id, d.name, 'list', null, true, true,
       (select f.id from object_fields f where f.object_id = o.id and f.field_key = d.kanban)
  from (values
    ('clients', 'כל הלקוחות', 'source'),
    ('appointments', 'כל התורים', 'status'),
    ('service_requests', 'כל הקריאות', 'status'),
    ('treatments', 'מחירון', 'is_active'),
    ('staff', 'כל הצוות', 'role'),
    ('notifications', 'ההתראות שלי', 'is_read')
  ) d(object_key, name, kanban)
  join view_objects o on o.object_key = d.object_key;

insert into view_columns (view_id, field_id, position, width, is_visible)
select v.id, f.id, f.position,
       case when f.field_type = 'long_text' then 280 when f.field_type in ('text', 'email') then 200
            when f.field_type in ('reference', 'datetime') then 170 else 130 end,
       f.default_visible
  from views v join object_fields f on f.object_id = v.object_id;

insert into view_sorts (view_id, field_id, direction, position)
select v.id, f.id, d.dir::sort_direction, 1
  from (values
    ('clients', 'created_at', 'desc'),
    ('appointments', 'starts_at', 'desc'),
    ('service_requests', 'created_at', 'desc'),
    ('treatments', 'name', 'asc'),
    ('staff', 'full_name', 'asc'),
    ('notifications', 'created_at', 'desc')
  ) d(object_key, field_key, dir)
  join view_objects o on o.object_key = d.object_key
  join views v on v.object_id = o.id
  join object_fields f on f.object_id = o.id and f.field_key = d.field_key;
