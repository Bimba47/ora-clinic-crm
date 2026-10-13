// מנוע האוטומציות: טיפוסים, תוויות בעברית וטעינת הסכמה.
// הכללים נשמרים בטבלה automation_rules ורצים במסד (private.automation_dispatch, 0016).
// רשימת האובייקטים, השדות והאופרטורים נטענת מהמסד (automation_schema), ולא מקודדת כאן.

import { supabase } from "@/lib/supabase";

export type AutoEvent = "create" | "update" | "schedule";
export type LogStatus = "success" | "failed" | "skipped";

export type SchemaField = {
  key: string;
  label: string;
  type: string;
  options: { value: string; label: string }[] | null;
  ref_object: string | null;
  required: boolean;
  editable: boolean;
};
export type SchemaObject = {
  key: string;
  label: string;
  label_plural: string;
  owner_field: string | null;
  display_field: string;
  fields: SchemaField[];
};
export type Schema = { objects: SchemaObject[]; ops: Record<string, string[]>; change_ops: string[] };

export type Condition = { field: string; op: string; value?: unknown };
export type Conditions = { match: "all" | "any"; rules: Condition[] };
export type Action =
  | { type: "update_field"; field: string; value: unknown }
  | { type: "update_related"; object: string; match_field: string; field: string; value: unknown }
  | { type: "create_record"; object: string; values: Record<string, unknown>; link_field?: string }
  | { type: "notify"; to: string; message: string; kind?: string };

export type Rule = {
  id?: string;
  name: string;
  object_name: string;
  is_active: boolean;
  trigger_event: AutoEvent;
  trigger_fields: string[];
  schedule_cron: string | null;
  conditions: Conditions;
  actions: Action[];
};

export const EVENT_LABELS: Record<AutoEvent, string> = {
  create: "ביצירת רשומה",
  update: "בעדכון רשומה",
  schedule: "בתזמון קבוע",
};

export const OP_LABELS: Record<string, string> = {
  eq: "שווה ל",
  neq: "שונה מ",
  contains: "מכיל",
  is_empty: "ריק",
  is_not_empty: "לא ריק",
  gt: "גדול מ",
  gte: "גדול או שווה ל",
  lt: "קטן מ",
  lte: "קטן או שווה ל",
  in: "אחד מ",
  not_in: "לא אחד מ",
  is_true: "כן",
  is_false: "לא",
  changed: "השתנה",
  changed_to: "השתנה ל",
  changed_from: "השתנה מ",
};
// אופרטורים בלי ערך להשוואה
export const NO_VALUE_OPS = ["is_empty", "is_not_empty", "is_true", "is_false", "changed"];
export const MULTI_VALUE_OPS = ["in", "not_in"];

export const ACTION_LABELS: Record<Action["type"], string> = {
  update_field: "עדכון שדה ברשומה",
  update_related: "עדכון רשומות מקושרות",
  create_record: "יצירת רשומה חדשה",
  notify: "שליחת התראה",
};

export const STATUS_LABELS: Record<LogStatus, string> = { success: "הצליח", failed: "נכשל", skipped: "דולג" };

export const KIND_OPTIONS = [
  { value: "system", label: "מערכת" },
  { value: "assignment", label: "שיוך" },
  { value: "reminder", label: "תזכורת" },
  { value: "update", label: "עדכון" },
];

// תזמונים נפוצים. pg_cron עובד לפי UTC: ישראל היא UTC+2 בחורף ו-UTC+3 בקיץ.
export const CRON_PRESETS = [
  { value: "0 5 * * *", label: "כל יום ב-08:00 (בקיץ; 07:00 בחורף)" },
  { value: "0 15 * * 0-4", label: "א'-ה' ב-18:00 (בקיץ; 17:00 בחורף)" },
  { value: "0 * * * *", label: "כל שעה עגולה" },
  { value: "*/15 * * * *", label: "כל רבע שעה" },
  { value: "0 6 * * 0", label: "כל יום א' ב-09:00 (בקיץ; 08:00 בחורף)" },
];

export const SYSTEM_FIELDS = ["created_at", "updated_at", "updated_by", "created_by"];

export const EMPTY_RULE: Rule = {
  name: "",
  object_name: "service_requests",
  is_active: true,
  trigger_event: "create",
  trigger_fields: [],
  schedule_cron: null,
  conditions: { match: "all", rules: [] },
  actions: [],
};

let schemaCache: Promise<Schema> | null = null;
export function loadSchema(): Promise<Schema> {
  if (!schemaCache) {
    schemaCache = (async () => {
      const { data, error } = await supabase.rpc("automation_schema");
      if (error) {
        schemaCache = null;
        throw error;
      }
      return data as Schema;
    })();
  }
  return schemaCache;
}

export function objOf(schema: Schema, key: string) {
  return schema.objects.find((o) => o.key === key);
}

export function fieldOf(schema: Schema, objectKey: string, fieldKey: string) {
  return objOf(schema, objectKey)?.fields.find((f) => f.key === fieldKey);
}

// אופרטורים לשדה, לפי הסכמה מהמסד. "השתנה" רק בכלל של עדכון.
export function opsFor(schema: Schema, field: SchemaField | undefined, event: AutoEvent) {
  if (!field) return [];
  const ops = schema.ops[field.type] ?? [];
  return event === "update" ? [...ops, ...schema.change_ops] : ops;
}
