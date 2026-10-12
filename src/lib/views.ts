// מנוע התצוגות: טעינת הקטלוג וההגדרות מהמסד, הרצת תצוגה ושמירה.
// אין כאן שום תצוגה ספציפית. הכול נגזר מהטבלאות view_objects, object_fields, views ומילדיהן.

import { supabase } from "@/lib/supabase";

export type FieldType =
  | "text" | "long_text" | "phone" | "email" | "number" | "money"
  | "date" | "datetime" | "boolean" | "choice" | "reference";

export type FilterOperator =
  | "eq" | "neq" | "contains" | "not_contains" | "gt" | "gte" | "lt" | "lte" | "is_empty" | "is_not_empty";

export type ChoiceOption = { value: string; label: string };

export type ObjectMeta = {
  id: string;
  object_key: string;
  label: string;
  label_plural: string;
  display_field: string;
  can_create: boolean;
};

export type FieldMeta = {
  id: string;
  object_id: string;
  field_key: string;
  label: string;
  field_type: FieldType;
  options: ChoiceOption[] | null;
  ref_object_id: string | null;
  position: number;
  default_visible: boolean;
  is_searchable: boolean;
  is_required: boolean;
  is_editable: boolean;
};

export type ViewRow = {
  id: string;
  object_id: string;
  name: string;
  view_type: "list" | "kanban";
  owner_id: string | null;
  is_shared: boolean;
  is_default: boolean;
  filter_match: "all" | "any";
  kanban_field_id: string | null;
};

export type ColumnDef = { field: string; width: number; visible: boolean };
export type FilterDef = { field: string; op: FilterOperator; value: string };
export type SortDef = { field: string; dir: "asc" | "desc" };

// ההגדרות של תצוגה, כפי שהמסך מחזיק אותן ושולח אותן לשמירה
export type ViewState = {
  view_type: "list" | "kanban";
  match: "all" | "any";
  kanban_field: string | null;
  columns: ColumnDef[];
  filters: FilterDef[];
  sorts: SortDef[];
};

export type Row = Record<string, unknown> & { id: string };

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "שווה ל",
  neq: "שונה מ",
  contains: "מכיל",
  not_contains: "לא מכיל",
  gt: "גדול מ",
  gte: "גדול או שווה ל",
  lt: "קטן מ",
  lte: "קטן או שווה ל",
  is_empty: "ריק",
  is_not_empty: "לא ריק",
};

// אותה טבלה כמו private.operator_allowed במסד, כדי שהממשק יציע רק אופרטורים מתאימים
export function operatorsFor(type: FieldType): FilterOperator[] {
  switch (type) {
    case "text":
    case "long_text":
    case "email":
    case "phone":
      return ["contains", "not_contains", "eq", "neq", "is_empty", "is_not_empty"];
    case "number":
    case "money":
    case "date":
    case "datetime":
      return ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"];
    case "boolean":
      return ["eq", "neq"];
    default:
      return ["eq", "neq", "is_empty", "is_not_empty"];
  }
}

export const DATE_OPERATOR_LABELS: Partial<Record<FilterOperator, string>> = {
  gt: "אחרי",
  gte: "מ-",
  lt: "לפני",
  lte: "עד",
};

export function needsValue(op: FilterOperator) {
  return op !== "is_empty" && op !== "is_not_empty";
}

// ===== קטלוג =====
export type Catalog = { objects: ObjectMeta[]; fields: FieldMeta[] };

export async function loadCatalog(): Promise<Catalog> {
  const [objects, fields] = await Promise.all([
    supabase.from("view_objects").select("id, object_key, label, label_plural, display_field, can_create"),
    supabase.from("object_fields").select("*").order("position"),
  ]);
  if (objects.error) throw objects.error;
  if (fields.error) throw fields.error;
  return { objects: objects.data as ObjectMeta[], fields: fields.data as FieldMeta[] };
}

// ===== תצוגות =====
export async function loadViews(objectId: string): Promise<ViewRow[]> {
  const { data, error } = await supabase
    .from("views")
    .select("id, object_id, name, view_type, owner_id, is_shared, is_default, filter_match, kanban_field_id")
    .eq("object_id", objectId)
    .order("is_default", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return data as ViewRow[];
}

export async function loadViewState(view: ViewRow, fields: FieldMeta[]): Promise<ViewState> {
  const keyOf = new Map(fields.map((f) => [f.id, f.field_key]));
  const [cols, filters, sorts] = await Promise.all([
    supabase.from("view_columns").select("field_id, width, is_visible, position").eq("view_id", view.id).order("position"),
    supabase.from("view_filters").select("field_id, operator, value, position").eq("view_id", view.id).order("position"),
    supabase.from("view_sorts").select("field_id, direction, position").eq("view_id", view.id).order("position"),
  ]);
  if (cols.error) throw cols.error;
  if (filters.error) throw filters.error;
  if (sorts.error) throw sorts.error;

  const columns: ColumnDef[] = cols.data.map((c) => ({
    field: keyOf.get(c.field_id) ?? "",
    width: c.width,
    visible: c.is_visible,
  }));
  // שדה שנוסף לקטלוג אחרי שהתצוגה נוצרה מופיע בסוף, מוסתר
  for (const f of fields) {
    if (!columns.some((c) => c.field === f.field_key)) columns.push({ field: f.field_key, width: 160, visible: false });
  }

  return {
    view_type: view.view_type,
    match: view.filter_match,
    kanban_field: view.kanban_field_id ? keyOf.get(view.kanban_field_id) ?? null : null,
    columns: columns.filter((c) => c.field),
    filters: filters.data.map((f) => ({ field: keyOf.get(f.field_id) ?? "", op: f.operator, value: f.value ?? "" })),
    sorts: sorts.data.map((s) => ({ field: keyOf.get(s.field_id) ?? "", dir: s.direction })),
  };
}

export async function saveViewState(viewId: string, def: Partial<ViewState>) {
  const { error } = await supabase.rpc("save_view", { p_view_id: viewId, p_def: def });
  if (error) throw error;
}

export async function createView(objectKey: string, name: string, viewType: "list" | "kanban", copyFrom?: string) {
  const { data, error } = await supabase.rpc("create_view", {
    p_object: objectKey,
    p_name: name,
    p_view_type: viewType,
    p_copy_from: copyFrom ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function renameView(viewId: string, name: string) {
  const { data, error } = await supabase.from("views").update({ name }).eq("id", viewId).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("אין לך הרשאה לשנות את התצוגה הזו.");
}

export async function setViewShared(viewId: string, isShared: boolean) {
  const { data, error } = await supabase.from("views").update({ is_shared: isShared }).eq("id", viewId).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("אין לך הרשאה לשנות את התצוגה הזו.");
}

export async function deleteView(viewId: string) {
  const { data, error } = await supabase.from("views").delete().eq("id", viewId).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("אין לך הרשאה למחוק את התצוגה הזו.");
}

export async function setDefaultView(viewId: string) {
  const { error } = await supabase.rpc("set_default_view", { p_view_id: viewId });
  if (error) throw error;
}

// ===== הרצת תצוגה (במסד, בהרשאות המשתמשת) =====
function queryDef(state: ViewState, extraFields: string[] = []) {
  const columns = state.columns.filter((c) => c.visible).map((c) => c.field);
  for (const f of extraFields) if (!columns.includes(f)) columns.push(f);
  return { columns, filters: state.filters, match: state.match, sorts: state.sorts };
}

export async function runView(
  objectKey: string,
  state: ViewState,
  opts: { search?: string; limit?: number; offset?: number; extraFields?: string[] } = {},
): Promise<{ total: number; rows: Row[] }> {
  const { data, error } = await supabase.rpc("run_view", {
    p_object: objectKey,
    p_def: queryDef(state, opts.extraFields),
    p_search: opts.search || null,
    p_limit: opts.limit ?? 25,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  return data as { total: number; rows: Row[] };
}

export async function runViewGroups(objectKey: string, state: ViewState, groupField: string, search?: string) {
  const { data, error } = await supabase.rpc("run_view_groups", {
    p_object: objectKey,
    p_def: queryDef(state),
    p_search: search || null,
    p_group_field: groupField,
  });
  if (error) throw error;
  return data as Record<string, number>;
}

// ===== רשומות =====
// כל שינוי ברשומות מנקה את רשימת האפשרויות של האובייקט בשדות מקושרים,
// כדי שלקוחה חדשה (או שם שהשתנה) תופיע מיד בבחירה.

// שינוי שדה בכמה רשומות. מחזיר כמה רשומות באמת השתנו (RLS יכול לחסום חלק).
export async function updateRecords(objectKey: string, ids: string[], values: Record<string, unknown>) {
  const { data, error } = await supabase.from(objectKey).update(values).in("id", ids).select("id");
  if (error) throw error;
  refCache.delete(objectKey);
  return data.length;
}

export async function deleteRecords(objectKey: string, ids: string[]) {
  const { data, error } = await supabase.from(objectKey).delete().in("id", ids).select("id");
  if (error) throw error;
  refCache.delete(objectKey);
  return data.length;
}

// רשומה אחת לעריכה. העמודות נבחרות במפורש (אף פעם לא select *, בגלל עמודות חסומות כמו כתובת הצוות).
export async function loadRecord(objectKey: string, id: string, columns: string[]) {
  const { data, error } = await supabase.from(objectKey).select(["id", ...columns].join(", ")).eq("id", id).single();
  if (error) throw error;
  return data as unknown as Record<string, unknown>;
}

// יצירת רשומה. מחזיר את המזהה החדש (למשל כדי לעבור למסך הרשומה שנוצרה).
export async function createRecord(objectKey: string, values: Record<string, unknown>) {
  const { data, error } = await supabase.from(objectKey).insert(values).select("id").single();
  if (error) throw error;
  refCache.delete(objectKey);
  return String((data as { id: string }).id);
}

// אפשרויות לשדה מקושר: מזהה + שם הרשומה. רשומה לא פעילה מסומנת.
// אם לאובייקט יש שדה טלפון (למשל לקוחה), הטלפון נטען כדי לחפש ולהציג גם לפיו.
export type RefOption = { value: string; label: string; inactive: boolean; phone: string | null };

const refCache = new Map<string, Promise<RefOption[]>>();

export function loadRefOptions(refObject: ObjectMeta, catalog: Catalog): Promise<RefOption[]> {
  const cached = refCache.get(refObject.object_key);
  if (cached) return cached;
  const own = catalog.fields.filter((f) => f.object_id === refObject.id);
  const hasIsActive = own.some((f) => f.field_key === "is_active");
  const phoneKey = own.find((f) => f.field_type === "phone")?.field_key;
  const cols = ["id", refObject.display_field, ...(hasIsActive ? ["is_active"] : []), ...(phoneKey ? [phoneKey] : [])].join(", ");
  const p = (async () => {
    const { data, error } = await supabase.from(refObject.object_key).select(cols).order(refObject.display_field).limit(1000);
    if (error) throw error;
    return (data as unknown as Record<string, unknown>[]).map((r) => ({
      value: String(r.id),
      label: String(r[refObject.display_field] ?? ""),
      inactive: hasIsActive && r.is_active === false,
      phone: phoneKey && r[phoneKey] ? String(r[phoneKey]) : null,
    }));
  })();
  p.catch(() => refCache.delete(refObject.object_key));
  refCache.set(refObject.object_key, p);
  return p;
}

// הודעת שגיאה קריאה מתוך שגיאה של Supabase / Postgres
export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = String((e as { message: unknown }).message);
    if (m.includes("appointments_no_overlap")) return "למטפלת כבר יש תור בשעה הזו.";
    if (m.includes("appointments_opening_hours")) return "התור מחוץ לשעות הפעילות של הקליניקה.";
    if (m.includes("service_requests_assignee_required")) return "קריאה בטיפול חייבת אחראית. שייכי אותה קודם.";
    if (m.includes("duplicate key") && m.includes("phone")) return "כבר יש לקוחה עם הטלפון הזה.";
    if (m.includes("violates foreign key") && m.includes("delete")) return "אי אפשר למחוק רשומה שיש לה רשומות מקושרות.";
    if (m.includes("phone_format") || m.includes("phone_check")) return "מספר הטלפון לא תקין.";
    return m;
  }
  return "משהו השתבש. נסי שוב.";
}
