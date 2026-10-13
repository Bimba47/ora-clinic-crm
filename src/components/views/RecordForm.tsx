"use client";
// טופס גנרי ליצירה ולעריכה בחלון (למשל הוספת תור מתוך כרטיס לקוחה): השדות, הסוגים ושדות החובה מגיעים מהקטלוג.
// בעריכה הערכים נטענים מהמסד, ונשמרים רק השדות שהשתנו.
// הבדיקות האמיתיות (טלפון, שעות פעילות, חפיפה, הרשאות) נעשות במסד. הודעה של שדה מסוים מוצגת ליד השדה, ואחרת ליד הכפתור.
// הרכיבים והפונקציות המשותפים (שדה קלט, המרת ערכים, העתקה משדה מקושר) משמשים גם את מסך הרשומה.

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { Catalog, FieldMeta, ObjectMeta, Row } from "@/lib/views";
import { createRecord, errorField, errorText, loadRecord, updateRecords } from "@/lib/views";
import { formatValue } from "@/lib/format";
import { ValueInput } from "./FilterPanel";

// הודעות השמירה מהאפיון
export const CREATED_TOAST: Record<string, string> = {
  clients: "הלקוחה נשמרה",
  appointments: "התור נקבע",
  service_requests: "הקריאה נפתחה",
};

export function toValue(f: FieldMeta, v: string): unknown {
  if (v === "") return null;
  switch (f.field_type) {
    case "number":
    case "money":
      return Number(v);
    case "boolean":
      return v === "true";
    case "datetime":
      return new Date(v).toISOString(); // השעה שהוזנה היא שעון ישראל של הדפדפן
    default:
      return v;
  }
}

// ערך מהמסד לערך של שדה בטופס
export function toInput(f: FieldMeta, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.field_type === "datetime") {
    const d = new Date(String(v));
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  return String(v);
}

// בחירה בשדה מקושר מעתיקה מהרשומה שנבחרה שדות עם אותו שם שיש גם בטופס.
// למשל בתור: בחירת טיפול ממלאת את המחיר והמשך מהמחירון. אפשר עדיין לשנות אותם ידנית.
export async function copyFromRef(catalog: Catalog, editable: FieldMeta[], f: FieldMeta, id: string) {
  const refObj = catalog.objects.find((o) => o.id === f.ref_object_id);
  if (!id || !refObj) return {};
  const refKeys = new Set(catalog.fields.filter((x) => x.object_id === refObj.id).map((x) => x.field_key));
  const copy = editable.filter((x) => x.field_type !== "reference" && refKeys.has(x.field_key));
  if (copy.length === 0) return {};
  const rec = await loadRecord(refObj.object_key, id, copy.map((x) => x.field_key));
  return Object.fromEntries(copy.map((x) => [x.field_key, toInput(x, rec[x.field_key])])) as Record<string, string>;
}

// ערך התחלתי ברשומה חדשה: בוליאני "כן", ושדה בחירה חובה מתחיל באפשרות הראשונה,
// שהיא ברירת המחדל במסד (סטטוס: עתידי, חדשה, פתוחה – כמו באפיון)
export function newDefault(f: FieldMeta) {
  if (f.field_type === "boolean") return "true";
  if (f.field_type === "choice" && f.is_required) return f.options?.[0]?.value ?? "";
  return "";
}

// שדה קלט אחד לפי סוג השדה בקטלוג
export function FieldInput({
  field: f, catalog, value, onChange, id, invalid,
}: {
  field: FieldMeta;
  catalog: Catalog;
  value: string;
  onChange: (v: string) => void;
  id: string;
  invalid?: boolean;
}) {
  if (f.field_type === "datetime") {
    return (
      <input id={id} type="datetime-local" dir="ltr" required={f.is_required} aria-invalid={invalid} placeholder={f.placeholder ?? undefined}
        value={value} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (f.field_type === "long_text") {
    return (
      <textarea id={id} required={f.is_required} rows={3} aria-invalid={invalid} placeholder={f.placeholder ?? undefined}
        value={value} onChange={(e) => onChange(e.target.value)} />
    );
  }
  return <ValueInput id={id} field={f} catalog={catalog} required={f.is_required} value={value} onChange={onChange} placeholder={f.placeholder ?? undefined} />;
}

export default function RecordForm({
  obj, fields, catalog, row, initial: preset, onClose, onSaved,
}: {
  obj: ObjectMeta;
  fields: FieldMeta[];
  catalog: Catalog;
  row?: Row; // בעריכה: השורה מהרשימה
  initial?: Record<string, string>; // ביצירה: ערכים שכבר ידועים, למשל הלקוחה כשפותחים תור מהכרטיס שלה
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!row;
  const editable = fields.filter((f) => f.is_editable);
  const readOnly = editing ? fields.filter((f) => !f.is_editable && !f.computed && formatValue(f, row)) : [];
  const empty = () => ({
    ...Object.fromEntries(editable.map((f) => [f.field_key, editing ? "" : newDefault(f)])),
    ...(editing ? {} : preset),
  });
  const [initial, setInitial] = useState<Record<string, string> | null>(editing ? null : empty);
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{ key: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    loadRecord(obj.object_key, row.id, editable.map((f) => f.field_key))
      .then((rec) => {
        const v = Object.fromEntries(editable.map((f) => [f.field_key, toInput(f, rec[f.field_key])]));
        setInitial(v);
        setValues(v);
      })
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);

  const setField = (f: FieldMeta, v: string) => {
    setValues((prev) => ({ ...prev, [f.field_key]: v }));
    if (f.field_type === "reference" && v) {
      copyFromRef(catalog, editable, f, v)
        .then((copied) => setValues((prev) => ({ ...prev, ...copied })))
        .catch((e) => setError(errorText(e)));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initial) return;
    setBusy(true);
    setError("");
    setFieldError(null);
    try {
      if (row) {
        const changed = editable.filter((f) => values[f.field_key] !== initial[f.field_key]);
        if (changed.length === 0) {
          onClose();
          return;
        }
        const n = await updateRecords(obj.object_key, [row.id], Object.fromEntries(changed.map((f) => [f.field_key, toValue(f, values[f.field_key])])));
        if (n === 0) throw new Error("אין לך הרשאה לשנות את הרשומה הזו.");
        toast("השינויים נשמרו");
      } else {
        const payload = Object.fromEntries(
          editable.filter((f) => values[f.field_key] !== "").map((f) => [f.field_key, toValue(f, values[f.field_key])]),
        );
        await createRecord(obj.object_key, payload);
        toast(CREATED_TOAST[obj.object_key] ?? "הרשומה נשמרה");
      }
      onSaved();
    } catch (err) {
      const key = errorField(err);
      if (key && editable.some((f) => f.field_key === key)) {
        setFieldError({ key, text: errorText(err) });
        document.getElementById(`rf-${key}`)?.focus();
      } else {
        setError(errorText(err));
        toast(errorText(err), "err");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? `עריכת ${obj.label}` : `הוספת ${obj.label}`} onClose={onClose} wide>
      <form onSubmit={submit} className="record-form" aria-busy={!initial}>
        {readOnly.length > 0 && (
          <dl className="record-meta">
            {readOnly.map((f) => (
              <div key={f.field_key}>
                <dt>{f.label}</dt>
                <dd>{formatValue(f, row!)}</dd>
              </div>
            ))}
          </dl>
        )}
        {!initial && !error
          ? editable.map((f) => <div key={f.field_key} className="skeleton" style={{ height: 68 }} />)
          : editable.map((f) => (
              <label key={f.field_key} className={`field${fieldError?.key === f.field_key ? " has-error" : ""}`} htmlFor={`rf-${f.field_key}`}>
                <span>
                  {f.label}
                  {f.is_required && <span aria-hidden="true"> *</span>}
                </span>
                <FieldInput id={`rf-${f.field_key}`} field={f} catalog={catalog} value={values[f.field_key]} invalid={fieldError?.key === f.field_key} onChange={(v) => { setField(f, v); if (fieldError?.key === f.field_key) setFieldError(null); }} />
                {fieldError?.key === f.field_key && <span className="field-error" role="alert">{fieldError.text}</span>}
              </label>
            ))}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={busy || !initial}>
            {busy && <span className="spinner" aria-hidden="true" />}
            שמירה
          </button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}
