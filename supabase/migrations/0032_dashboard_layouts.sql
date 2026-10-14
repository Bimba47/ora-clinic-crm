-- 0032: סידור אישי של לוח בקרה משותף (בקשת ענבל: כל מטפלת מסדרת לעצמה).
-- מי שלא עורכת את הלוח (למשל מטפלת בלוח "ראשי") יכולה לגרור ולשנות גודל, והסידור נשמר רק לה.
-- הלוח המשותף, הווידג'טים והסידור של המנהלת לא משתנים. בלי שורה = הסידור האוטומטי (כמו עד היום).
-- ווידג'ט שנמחק מוחק גם את הסידור האישי שלו.

create table public.dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff(id) on delete cascade,
  widget_id uuid not null references public.dashboard_widgets(id) on delete cascade,
  position_x int not null,
  position_y int not null,
  width int not null,
  height int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  unique (user_id, widget_id),
  constraint dashboard_layouts_box check (
    position_x between 0 and 11 and width between 1 and 12 and position_x + width <= 12
    and position_y between 0 and 500 and height between 1 and 12)
);
comment on table public.dashboard_layouts is 'סידור אישי של ווידג''טים בלוח משותף: מיקום וגודל לכל משתמשת. רק שלי (RLS).';
create index dashboard_layouts_widget_idx on public.dashboard_layouts (widget_id);

create trigger dashboard_layouts_updated_at before update on public.dashboard_layouts
  for each row execute function private.set_updated_at();
create trigger dashboard_layouts_updated_by before insert or update on public.dashboard_layouts
  for each row execute function private.set_updated_by();

alter table public.dashboard_layouts enable row level security;

-- רק שלי, ורק ווידג'ט שאני רואה (RLS של dashboard_widgets חל בתת-השאילתה)
create policy dashboard_layouts_select on public.dashboard_layouts for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_staff()));
create policy dashboard_layouts_insert on public.dashboard_layouts for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_active_staff())
              and exists (select 1 from public.dashboard_widgets w where w.id = widget_id));
create policy dashboard_layouts_update on public.dashboard_layouts for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_staff()))
  with check (user_id = (select auth.uid()));
create policy dashboard_layouts_delete on public.dashboard_layouts for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_staff()));

grant select, insert, update, delete on public.dashboard_layouts to authenticated;
