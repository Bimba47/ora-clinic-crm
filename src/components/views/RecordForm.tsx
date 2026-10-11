"use client";
// טופס יצירה גנרי: השדות, הסוגים ושדות החובה מגיעים מהקטלוג.
// הבדיקות האמיתיות (טלפון, שעות פעילות, חפיפה) נעשות במסד, וההודעה שלו מוצגת ליד הכפתור.

import { useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { Catalog, FieldMeta, ObjectMeta } from "@/lib/views";
import { createRecord, errorText } from "@/lib/views";
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

export default function RecordForm({
  obj, fields, catalog, onClose, onSaved,
}: {
  obj: ObjectMeta;
  fields: FieldMeta[];
  catalog: Catalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editable = fields.filter((f) => f.is_editable);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((f) => [f.field_key, f.field_type === "boolean" ? "true" : ""])),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = Object.fromEntries(
        editable.filter((f) => values[f.field_key] !== "").map((f) => [f.field_key, toValue(f, values[f.field_key])]),
      );
      await createRecord(obj.object_key, payload);
      toast("הרשומה נשמרה");
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`הוספת ${obj.label}`} onClose={onClose} wide>
      <form onSubmit={submit} className="record-form">
        {editable.map((f) => (
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
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            שמירה
          </button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}
