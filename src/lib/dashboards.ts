// מנוע לוחות הבקרה: טיפוסים, הרצת ווידג'ט (public.run_widget במסד, תחת RLS), שדות נגזרים מהסכמה,
// ותרגום בין הסינון של הווידג'ט (באותו מבנה כמו תנאי האוטומציות) לבין רכיב הסינון של התצוגות.

import { supabase } from "@/lib/supabase";
import {
  loadViews, loadViewState, type Catalog, type FieldMeta, type FilterDef, type ObjectMeta, type ViewState,
} from "@/lib/views";
import { saveListSnapshot } from "@/lib/records";

export type WidgetType = "table" | "bar" | "pie" | "metric" | "list" | "text";
export type DateGroup = "none" | "day" | "week" | "month";
export type Aggregate = "count" | "sum" | "avg" | "min" | "max" | "percent";
export type Rule = { field: string; op: string; value?: string };
export type Conditions = { match: "all" | "any"; rules: Rule[] };

export type WidgetConfig = {
  columns?: string[];          // רשימה וטבלה בלי קיבוץ
  split_by?: string;           // טבלה/עמודות: פיצול לפי שדה שני (טבלת ציר)
  percent_where?: Conditions;  // אחוז: אילו רשומות נספרות במונה
  compare?: { field: string; days: number }; // מספר בודד: השוואה לתקופה קודמת
  suffix?: string;
  hint?: string;
  tone?: "danger";
  inline_status?: string;      // רשימה: שינוי סטטוס בלחיצה
  time_only?: string;          // רשימה: שדה תאריך-שעה שמוצג כשעה בלבד
  whatsapp?: { template: string; phone: string };
  ignore_owner?: boolean;      // לא לדרוס את שדה האחראית בסינון הלוח
  date_field?: string;         // לאיזה שדה תאריך חל טווח התאריכים של הלוח
  empty?: string;
  text?: string;               // ווידג'ט טקסט
  subtext?: string;
  size?: "title" | "normal";
  roles?: string[];            // אילו תפקידים רואים את הווידג'ט (ריק = כולם). מי שעורכת את הלוח רואה הכול
  bar_style?: "gradient";      // עמודות: צבע אחד מדורג, והערך צמוד לסוף העמודה (למשל הכנסות לפי טיפול)
  colors?: Record<string, string>; // טבעת/עמודות: צבע קבוע לערך קבוצה (למשל סטטוס התור בצבע הסטטוס)
  compare_period?: boolean;    // טבעת: השוואת הסה"כ לתקופה הקודמת (חודש קודם, או אותו אורך לפני הטווח)
};

export type Widget = {
  id: string;
  dashboard_id: string;
  title: string;
  widget_type: WidgetType;
  object_name: string | null;
  filters: Conditions;
  group_by: string | null;
  date_group: DateGroup;
  aggregate: Aggregate;
  aggregate_field: string | null;
  sort: string | null;
  limit: number | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  config: WidgetConfig;
};

export type Dashboard = {
  id: string;
  name: string;
  owner_id: string | null;
  is_shared: boolean;
  role_visibility: string[];
  filters: DashFilters;
  position: number;
};
export type DashFilters = { date_from?: string; date_to?: string; owner?: string };

export type Group = { key: string | null; label: string | null; value: number; split?: string | null; split_label?: string | null };
export type WidgetResult =
  | { kind: "metric"; value: number | null; previous?: number; change?: number | null; days?: number } // null = אין נתונים (ממוצע וכו׳)
  | { kind: "groups"; groups: Group[] }
  | { kind: "pivot"; groups: Group[] }
  | { kind: "rows"; rows: (Record<string, unknown> & { id: string; __message?: string; __phone?: string })[]; columns: string[] }
  | Record<string, never>;

export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  metric: "מספר",
  bar: "עמודות",
  pie: "טבעת",
  table: "טבלה",
  list: "רשימה",
  text: "טקסט",
};
export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  count: "ספירה",
  sum: "סכום",
  avg: "ממוצע",
  min: "מינימום",
  max: "מקסימום",
  percent: "אחוז מתוך הכלל",
};
export const DATE_GROUP_LABELS: Record<DateGroup, string> = { none: "בלי", day: "יום", week: "שבוע", month: "חודש" };

// צבעי הגרפים של האפיון, לפי הסדר
export const CHART_COLORS = ["#E3BFA8", "#C99A7A", "#A67C52", "#F1D6D0", "#EADFD2", "#9E5F6A", "#2C2520"];

export const EMPTY_WIDGET: Omit<Widget, "id" | "dashboard_id"> = {
  title: "",
  widget_type: "metric",
  object_name: "service_requests",
  filters: { match: "all", rules: [] },
  group_by: null,
  date_group: "none",
  aggregate: "count",
  aggregate_field: null,
  sort: null,
  limit: null,
  position_x: 0,
  position_y: 0,
  width: 4,
  height: 3,
  config: {},
};

export async function runWidget(w: Partial<Widget>, dash: DashFilters): Promise<WidgetResult> {
  if (w.widget_type === "text") return {};
  const { data, error } = await supabase.rpc("run_widget", { p_widget: w, p_dash: dash });
  if (error) throw error;
  return data as WidgetResult;
}

// שדות של אובייקט לווידג'ט: מהקטלוג (בלי שדות חסומים), ועוד שדות נגזרים "מספר <רשומות מקושרות>",
// שנבנים מהסכמה: לכל שדה מקושר באובייקט אחר שמצביע על האובייקט הזה.
export function widgetFields(catalog: Catalog, objectKey: string): FieldMeta[] {
  const obj = catalog.objects.find((o) => o.object_key === objectKey);
  if (!obj) return [];
  const own = catalog.fields.filter((f) => f.object_id === obj.id);
  const derived: FieldMeta[] = catalog.fields
    .filter((f) => f.field_type === "reference" && f.ref_object_id === obj.id)
    .map((f) => {
      const rel = catalog.objects.find((o) => o.id === f.object_id)!;
      const sameObjCount = catalog.fields.filter((x) => x.object_id === rel.id && x.ref_object_id === obj.id).length;
      return {
        ...f,
        id: `count:${rel.object_key}.${f.field_key}`,
        object_id: obj.id,
        field_key: `count:${rel.object_key}.${f.field_key}`,
        label: `מספר ${rel.label_plural}${sameObjCount > 1 ? ` (${f.label})` : ""}`,
        field_type: "number",
        options: null,
        ref_object_id: null,
        is_filterable: true,
        is_editable: false,
        is_required: false,
        position: 1000 + f.position,
      };
    });
  return [...own, ...derived];
}

export function objectByKey(catalog: Catalog, key: string | null | undefined): ObjectMeta | undefined {
  return catalog.objects.find((o) => o.object_key === key);
}

// בין הסינון של הווידג'ט לבין רכיב הסינון (FilterPanel) של התצוגות
export function toViewState(c: Conditions): ViewState {
  return {
    view_type: "list",
    match: c.match ?? "all",
    kanban_field: null,
    columns: [],
    sorts: [],
    filters: (c.rules ?? []).map((r) => ({ field: r.field, op: r.op as FilterDef["op"], value: r.value ?? "" })),
  };
}
export function fromViewState(s: Pick<ViewState, "match" | "filters">): Conditions {
  return { match: s.match, rules: s.filters.map((f) => ({ field: f.field, op: f.op, value: f.value })) };
}

// תבניות בצד הלקוח (לתצוגה המסוננת ולטקסט): {{today}}, {{today+N}}, {{now-48h}}, {{user}},
// {{week_start}}/{{week_end}} (ראשון–שבת), {{month_start}}/{{month_end}} – כמו automation_token במסד
function israelDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d); // YYYY-MM-DD
}
function israelPeriod(tok: string): string | null {
  const today = israelDate(0);
  const d = new Date(`${today}T12:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (tok === "week_start" || tok === "week_end") {
    d.setUTCDate(d.getUTCDate() - d.getUTCDay() + (tok === "week_end" ? 6 : 0));
    return iso(d);
  }
  if (tok === "month_start") return `${today.slice(0, 8)}01`;
  if (tok === "month_end") return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)));
  return null;
}
export function resolveToken(v: string, userId: string | null): string {
  return v.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, tok: string) => {
    if (tok === "user") return userId ?? "";
    const period = israelPeriod(tok);
    if (period) return period;
    let m = tok.match(/^today([+-]\d+)?$/);
    if (m) return israelDate(Number(m[1] ?? 0));
    m = tok.match(/^now([+-]\d+)h$/);
    if (m) return israelDate(Math.floor(Number(m[1]) / 24)); // התצוגה מסננת לפי יום
    if (tok === "now") return israelDate(0);
    return "";
  });
}

// התקופה של ווידג'ט: טווח התאריכים של הלוח, ואם אין – תנאי "מ"/"עד" של הווידג'ט על שדה התאריך שלו.
// התקופה הקודמת: חודש קלנדרי שלם → החודש שלפניו; אחרת אותו מספר ימים, צמוד לפני הטווח.
export function previousPeriod(
  w: Pick<Widget, "filters" | "config">, dash: DashFilters, dateField: string | undefined, userId: string | null,
): { date_from: string; date_to: string; label: string } | null {
  const rule = (op: string) => (w.filters?.rules ?? []).find((r) => r.field === dateField && r.op === op)?.value;
  const from = dash.date_from || (rule("gte") ? resolveToken(rule("gte")!, userId) : "");
  const to = dash.date_to || (rule("lte") ? resolveToken(rule("lte")!, userId) : "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return null;
  const day = (s: string) => new Date(`${s}T12:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const f = day(from);
  const t = day(to);
  const monthEnd = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0, 12));
  if (f.getUTCDate() === 1 && iso(monthEnd) === to && f.getUTCMonth() === t.getUTCMonth()) {
    const pf = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1, 12));
    const pt = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 0, 12));
    return { date_from: iso(pf), date_to: iso(pt), label: "לעומת החודש הקודם" };
  }
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const pt = new Date(f.getTime() - 86400000);
  const pf = new Date(pt.getTime() - (days - 1) * 86400000);
  return { date_from: iso(pf), date_to: iso(pt), label: days === 1 ? "לעומת היום הקודם" : `לעומת ${days} הימים הקודמים` };
}

// לחיצה על ווידג'ט: פתיחת רשימת האובייקט עם אותן רשומות (ועוד תנאי קבוצה בלחיצה על עמודה).
// המצב נטען כ"חזרה לרשימה", ולכן לא נשמר בתצוגה עצמה.
export async function openFiltered(
  catalog: Catalog,
  objectKey: string,
  conds: Conditions,
  extra: Rule[],
  userId: string | null,
): Promise<string | null> {
  const obj = objectByKey(catalog, objectKey);
  if (!obj) return null;
  const listHref = objectKey === "appointments" ? "/appointments/list" : objectKey === "service_requests" ? "/requests"
    : objectKey === "staff" ? "/settings/team" : objectKey === "treatments" ? "/settings/treatments" : `/${objectKey}`;
  const fields = catalog.fields.filter((f) => f.object_id === obj.id);
  const views = await loadViews(obj.id);
  const view = views.find((v) => v.is_default) ?? views[0];
  if (!view) return listHref;
  const base = await loadViewState(view, fields);
  const known = new Set(fields.filter((f) => f.is_filterable).map((f) => f.field_key));
  // רק תנאים שהתצוגה יודעת להציג (שדות נגזרים לא קיימים ברשימה)
  const rules = [...conds.rules, ...extra].filter((r) => known.has(r.field));
  const state: ViewState = {
    ...base,
    view_type: "list",
    match: extra.length ? "all" : conds.match,
    filters: rules.map((r) => {
      // בתצוגות תאריך מסונן לפי יום, עם "מ" ו"עד" בלבד
      const isDate = ["date", "datetime"].includes(fields.find((f) => f.field_key === r.field)?.field_type ?? "");
      const op = isDate && r.op === "lt" ? "lte" : isDate && r.op === "gt" ? "gte" : r.op;
      return { field: r.field, op: op as FilterDef["op"], value: resolveToken(r.value ?? "", userId) };
    }),
  };
  try {
    localStorage.setItem(`ora:view:${objectKey}`, view.id);
  } catch {}
  saveListSnapshot(objectKey, { viewId: view.id, state, search: "", page: 0, restore: true });
  return listHref;
}

export function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 21 ? "ערב טוב" : "לילה טוב";
}
export function todayLong() {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}

// כותרת ווידג'ט עם מספר התוצאות: {{count}} או {{count:יחיד:רבים}}.
// למשל "{{count:תור אחד:תורים}} מחר" -> "4 תורים מחר" / "תור אחד מחר". עד שהתוצאה נטענת: "תורים מחר".
export function widgetTitle(title: string, count?: number) {
  return title
    .replace(/\{\{count(?::([^:}]*):([^}]*))?\}\}/g, (_m, one?: string, many?: string) => {
      if (count === undefined) return many ?? "";
      if (one !== undefined && count === 1) return one;
      return many !== undefined ? `${count} ${many}` : String(count);
    })
    .replace(/\s+/g, " ")
    .trim();
}
