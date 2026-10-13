"use client";
// בניית סינון: שדה, אופרטור שמתאים לסוג השדה, וערך. כמה תנאים יחד, עם "וגם" או "או".

import type { Catalog, FieldMeta, FilterDef, FilterOperator, ViewState } from "@/lib/views";
import { DATE_OPERATOR_LABELS, OPERATOR_LABELS, needsValue, operatorsFor, pickOptions } from "@/lib/views";
import RefSelect from "./RefSelect";

// allowRelative: ערכים יחסיים (היום, תחילת השבוע, "אני"), שמחושבים במסד ברגע ההרצה. בלוחות הבקרה ובתצוגות.
// relativeTimes: גם "לפני 48 שעות" (רק בלוחות הבקרה. בתצוגה הסינון לפי יום).
export default function FilterPanel({
  fields, catalog, state, onChange, allowRelative, relativeTimes = true,
}: {
  fields: FieldMeta[];
  catalog: Catalog;
  state: Pick<ViewState, "match" | "filters">;
  onChange: (patch: Partial<ViewState>) => void;
  allowRelative?: boolean;
  relativeTimes?: boolean;
}) {
  // רק שדות שמותר לסנן לפיהם (is_filterable בקטלוג, נאכף גם במסד)
  const filterable = fields.filter((f) => f.is_filterable);
  const byKey = new Map(filterable.map((f) => [f.field_key, f]));
  const set = (filters: FilterDef[]) => onChange({ filters });
  const patch = (i: number, p: Partial<FilterDef>) => set(state.filters.map((f, j) => (j === i ? { ...f, ...p } : f)));

  const add = () => {
    const f = filterable[0];
    set([...state.filters, { field: f.field_key, op: operatorsFor(f.field_type)[0], value: "" }]);
  };

  return (
    <div className="card panel">
      {state.filters.length > 1 && (
        <div className="segmented small" role="radiogroup" aria-label="הקשר בין התנאים">
          <button type="button" className={state.match === "all" ? "on" : ""} onClick={() => onChange({ match: "all" })}>
            כל התנאים (וגם)
          </button>
          <button type="button" className={state.match === "any" ? "on" : ""} onClick={() => onChange({ match: "any" })}>
            אחד מהתנאים (או)
          </button>
        </div>
      )}

      {state.filters.length === 0 && <p className="muted">אין סינון. כל הרשומות מוצגות.</p>}

      {state.filters.map((flt, i) => {
        const field = byKey.get(flt.field) ?? filterable[0];
        const ops = operatorsFor(field.field_type);
        const isDate = field.field_type === "date" || field.field_type === "datetime";
        return (
          <div key={i} className="filter-row">
            <select
              aria-label="שדה"
              value={field.field_key}
              onChange={(e) => {
                const nf = byKey.get(e.target.value)!;
                patch(i, { field: nf.field_key, op: operatorsFor(nf.field_type)[0], value: "" });
              }}
            >
              {filterable.map((f) => (
                <option key={f.field_key} value={f.field_key}>{f.label}</option>
              ))}
            </select>
            <select aria-label="אופרטור" value={flt.op} onChange={(e) => patch(i, { op: e.target.value as FilterOperator })}>
              {ops.map((op) => (
                <option key={op} value={op}>{(isDate && DATE_OPERATOR_LABELS[op]) || OPERATOR_LABELS[op]}</option>
              ))}
            </select>
            {needsValue(flt.op) && (
              <ValueInput field={field} catalog={catalog} value={flt.value} onChange={(value) => patch(i, { value })} allowRelative={allowRelative} relativeTimes={relativeTimes} />
            )}
            <button type="button" className="icon-btn" aria-label="הסרת התנאי" onClick={() => set(state.filters.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        );
      })}

      <div className="panel-actions">
        <button type="button" className="btn" onClick={add}>+ תנאי</button>
        {state.filters.length > 0 && (
          <button type="button" className="link-btn" onClick={() => set([])}>ניקוי הסינון</button>
        )}
      </div>
    </div>
  );
}

const RELATIVE_DATES = [
  { value: "{{today}}", label: "היום" },
  { value: "{{today+1}}", label: "מחר" },
  { value: "{{today-1}}", label: "אתמול" },
  { value: "{{week_start}}", label: "תחילת השבוע (ראשון)" },
  { value: "{{week_end}}", label: "סוף השבוע (שבת)" },
  { value: "{{today-7}}", label: "לפני 7 ימים" },
  { value: "{{today-30}}", label: "לפני 30 יום" },
];
const RELATIVE_TIMES = [
  { value: "{{now-48h}}", label: "לפני 48 שעות" },
  { value: "{{now-24h}}", label: "לפני 24 שעות" },
];

export function ValueInput({
  field, catalog, value, onChange, required, id, allowRelative, relativeTimes = true, placeholder,
}: {
  field: FieldMeta;
  catalog: Catalog;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  id?: string;
  allowRelative?: boolean;
  relativeTimes?: boolean;
  placeholder?: string;
}) {
  // ערך יחסי: תאריך (היום, מחר...) או "אני" בשדה של אשת צוות
  if (allowRelative && (field.field_type === "date" || field.field_type === "datetime")) {
    const options = field.field_type === "datetime" && relativeTimes ? [...RELATIVE_DATES, ...RELATIVE_TIMES] : RELATIVE_DATES;
    const rel = options.some((o) => o.value === value);
    return (
      <span className="relative-value">
        <select aria-label={`סוג ערך: ${field.label}`} value={rel ? value : ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">תאריך מסוים</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {!rel && <input type="date" dir="ltr" aria-label={field.label} value={value} onChange={(e) => onChange(e.target.value)} />}
      </span>
    );
  }
  if (allowRelative && field.field_type === "reference" && catalog.objects.find((o) => o.id === field.ref_object_id)?.object_key === "staff") {
    const me = value === "{{user}}";
    return (
      <span className="relative-value">
        <select aria-label={`סוג ערך: ${field.label}`} value={me ? "me" : "other"} onChange={(e) => onChange(e.target.value === "me" ? "{{user}}" : "")}>
          <option value="me">אני (המשתמשת המחוברת)</option>
          <option value="other">אשת צוות מסוימת</option>
        </select>
        {!me && <RefSelect field={field} catalog={catalog} value={value} onChange={onChange} id={id} />}
      </span>
    );
  }
  const common = { id, required, placeholder, "aria-label": field.label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  switch (field.field_type) {
    case "choice":
    case "boolean":
      return (
        <select {...common}>
          <option value="">בחרי…</option>
          {pickOptions(field.options, value).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case "reference":
      return <RefSelect field={field} catalog={catalog} value={value} onChange={onChange} required={required} id={id} />;
    case "number":
    case "money":
      return <input type="number" inputMode="decimal" step={field.field_type === "money" ? "0.01" : "1"} dir="ltr" {...common} />;
    case "date":
    case "datetime": // בסינון משווים לפי יום, ולכן בוחרים תאריך בלבד
      return <input type="date" dir="ltr" {...common} />;
    case "phone":
      return <input type="tel" inputMode="numeric" dir="ltr" {...common} />;
    case "email":
      return <input type="email" dir="ltr" maxLength={200} {...common} />;
    default:
      return <input type="text" maxLength={200} {...common} />;
  }
}
