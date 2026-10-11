"use client";
// טופס גנרי ליצירה ולעריכה: השדות, הסוגים ושדות החובה מגיעים מהקטלוג.
// בעריכה הערכים נטענים מהמסד, ונשמרים רק השדות שהשתנו.
// הבדיקות האמיתיות (טלפון, שעות פעילות, חפיפה, הרשאות) נעשות במסד, וההודעה שלו מוצגת ליד הכפתור.

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { Catalog, FieldMeta, ObjectMeta, Row } from "@/lib/views";
import { createRecord, errorText, loadRecord, updateRecords } from "@/lib/views";
import { formatValue } from "@/lib/format";
import { ValueInput } from "./FilterPanel";

function toValue(f: FieldMeta, v: string): unknown {
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
function toInput(f: FieldMeta, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.field_type === "datetime") {
    const d = new Date(String(v));
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  return String(v);
}

export default function RecordForm({
  obj, fields, catalog, row, onClose, onSaved,
}: {
  obj: ObjectMeta;
  fields: FieldMeta[];
  catalog: Catalog;
  row?: Row; // בעריכה: השורה מהרשימה
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!row;
  const editable = fields.filter((f) => f.is_editable);
  const readOnly = editing ? fields.filter((f) => !f.is_editable && formatValue(f, row)) : [];
  const empty = () => Object.fromEntries(editable.map((f) => [f.field_key, f.field_type === "boolean" && !editing ? "true" : ""]));
  const [initial, setInitial] = useState<Record<string, string> | null>(editing ? null : empty);
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [error, setError] = useState("");
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initial) return;
    setBusy(true);
    setError("");
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
        toast("הרשומה נשמרה");
      }
      onSaved();
    } catch (err) {
      setError(errorText(err));
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
              <label key={f.field_key} className="field" htmlFor={`rf-${f.field_key}`}>
                <span>
                  {f.label}
                  {f.is_required && <span aria-hidden="true"> *</span>}
                </span>
                {f.field_type === "datetime" ? (
                  <input
                    id={`rf-${f.field_key}`}
                    type="datetime-local"
                    dir="ltr"
                    required={f.is_required}
                    value={values[f.field_key]}
                    onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })}
                  />
                ) : f.field_type === "long_text" ? (
                  <textarea
                    id={`rf-${f.field_key}`}
                    required={f.is_required}
                    rows={3}
                    value={values[f.field_key]}
                    onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })}
                  />
                ) : (
                  <ValueInput
                    id={`rf-${f.field_key}`}
                    field={f}
                    catalog={catalog}
                    required={f.is_required}
                    value={values[f.field_key]}
                    onChange={(v) => setValues({ ...values, [f.field_key]: v })}
                  />
                )}
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
