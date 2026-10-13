"use client";
// תיעוד ה-API, שנבנה מהקטלוג (view_objects + object_fields): אילו אובייקטים זמינים, אילו שדות, סוג, חובה וערכים חוקיים,
// ודוגמאות curl לחמש הפעולות. אובייקט או שדה חדש בקטלוג מופיע כאן מיד, בלי קוד.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Obj = { id: string; object_key: string; label: string; label_plural: string; api_access: "none" | "read" | "full" };
type Field = {
  object_id: string; field_key: string; label: string; field_type: string; options: unknown; ref_object_id: string | null;
  is_required: boolean; is_editable: boolean; is_filterable: boolean; computed: string | null; placeholder: string | null; display_hidden: boolean; position: number;
};

const TYPE_LABELS: Record<string, string> = {
  text: "טקסט", long_text: "טקסט ארוך", phone: "טלפון (טקסט)", email: "אימייל (טקסט)", number: "מספר", money: "סכום (מספר)",
  date: "תאריך YYYY-MM-DD", datetime: "תאריך ושעה ISO 8601", boolean: "true / false", choice: "בחירה (רשימה סגורה)", reference: "מזהה (uuid)",
};
const CODES: [number, string][] = [
  [200, "הצלחה (קריאה, עדכון, מחיקה)"], [201, "נוצר"], [400, "קלט שגוי: JSON לא תקין, שדה שלא קיים או לקריאה בלבד, פרמטר לא מוכר"],
  [401, "מפתח חסר, שגוי או מבוטל"], [403, "אין הרשאה לתפקיד של המפתח (לאובייקט, לרשומה או לשדה)"], [404, "אובייקט או רשומה לא נמצאו"],
  [409, "התנגשות: ערך ייחודי כפול (טלפון), תור חופף, מחיקה של רשומה עם רשומות מקושרות"], [422, "ולידציה נכשלה: סוג, חובה, ערך לא חוקי ברשימה, שעות פעילות"],
  [429, "יותר מדי בקשות (מגבלה לכל מפתח, בדקה)"],
];

function sample(f: Field, objects: Obj[]): unknown {
  const opts = Array.isArray(f.options) ? (f.options as { value: string }[]) : [];
  switch (f.field_type) {
    case "phone": return "0541234567";
    case "email": return "name@example.com";
    case "number": return Number(f.placeholder) || 60;
    case "money": return Number(f.placeholder) || 350;
    case "date": return "2026-11-02";
    case "datetime": return "2026-11-02T10:00:00+02:00";
    case "boolean": return true;
    case "choice": return opts[0]?.value ?? "";
    case "reference": return `<${objects.find((o) => o.id === f.ref_object_id)?.object_key ?? "record"}_id>`;
    default: return f.placeholder?.replace(/^למשל:\s*/, "") ?? "דוגמה";
  }
}

export default function Page() {
  const [objects, setObjects] = useState<Obj[] | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [pick, setPick] = useState("clients");
  const [origin, setOrigin] = useState("https://ora-clinic-crm-liart.vercel.app");

  useEffect(() => {
    setOrigin(window.location.origin);
    Promise.all([
      supabase.from("view_objects").select("id, object_key, label, label_plural, api_access").neq("api_access", "none").order("object_key"),
      supabase.from("object_fields").select("object_id, field_key, label, field_type, options, ref_object_id, is_required, is_editable, is_filterable, computed, placeholder, display_hidden, position").order("position"),
    ]).then(([o, f]) => {
      setObjects((o.data as Obj[]) ?? []);
      setFields(((f.data as Field[]) ?? []).filter((x) => !x.display_hidden));
    });
  }, []);

  const obj = objects?.find((o) => o.object_key === pick) ?? objects?.[0];
  const own = useMemo(() => fields.filter((f) => f.object_id === obj?.id), [fields, obj]);
  if (!objects || !obj) return <div className="skeleton" style={{ height: 320 }} aria-busy="true" />;

  const writable = own.filter((f) => f.is_editable && !f.computed);
  const createBody = Object.fromEntries(writable.filter((f) => f.is_required && f.field_key !== "status").map((f) => [f.field_key, sample(f, objects)]));
  const patchField = writable.find((f) => !f.is_required && f.field_type !== "reference") ?? writable[0];
  const patchBody = patchField ? { [patchField.field_key]: sample(patchField, objects) } : {};
  const filterField = own.find((f) => f.is_filterable && f.field_type === "choice") ?? own.find((f) => f.is_filterable);
  const base = `${origin}/api/v1/${obj.object_key}`;
  const key = '-H "Authorization: Bearer $ORA_API_KEY"';
  const examples: [string, string][] = [
    ["רשימה (סינון, מיון ועימוד)", `curl "${base}?${filterField ? `${filterField.field_key}=${encodeURIComponent(String(sample(filterField, objects)))}&` : ""}sort=-created_at&limit=10&page=1" \\\n  ${key}`],
    ["רשומה אחת", `curl "${base}/<id>" \\\n  ${key}`],
    ...(obj.api_access === "full" ? ([
      ["יצירה", `curl -X POST "${base}" \\\n  ${key} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(createBody)}'`],
      ["עדכון חלקי", `curl -X PATCH "${base}/<id>" \\\n  ${key} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(patchBody)}'`],
      ["מחיקה", `curl -X DELETE "${base}/<id>" \\\n  ${key}`],
    ] as [string, string][]) : []),
  ];

  return (
    <>
      <div className="views-head">
        <h1 className="page-title">תיעוד API</h1>
        <Link href="/settings/api" className="btn outline">למפתחות</Link>
      </div>

      <section className="card api-doc">
        <h2 className="section-title">איך זה עובד</h2>
        <ul>
          <li>כתובת בסיס: <code dir="ltr">{origin}/api/v1</code></li>
          <li>המפתח נשלח בכל בקשה בכותרת <code dir="ltr">Authorization: Bearer &lt;key&gt;</code>, לא בכתובת. יוצרים מפתח במסך <Link href="/settings/api" className="ref-link">מפתחות API</Link>.</li>
          <li>המפתח פועל בשם תפקיד, וההרשאות של התפקיד חלות עליו (אובייקטים, רשומות ושדות). היקף &quot;שלי&quot; לא חל על מפתח.</li>
          <li>חמש פעולות לכל אובייקט: <code dir="ltr">GET /{"{object}"}</code>, <code dir="ltr">GET /{"{object}"}/{"{id}"}</code>, <code dir="ltr">POST /{"{object}"}</code>, <code dir="ltr">PATCH /{"{object}"}/{"{id}"}</code>, <code dir="ltr">DELETE /{"{object}"}/{"{id}"}</code>.</li>
          <li>רשימה: <code dir="ltr">limit</code> (1–100, ברירת מחדל 25), <code dir="ltr">page</code> או <code dir="ltr">offset</code>, <code dir="ltr">sort=field</code> או <code dir="ltr">sort=-field</code>, <code dir="ltr">search</code>, <code dir="ltr">fields=a,b</code>. סינון: <code dir="ltr">field=value</code> או <code dir="ltr">field[op]=value</code>, כש-op אחד מ: <code dir="ltr">eq, neq, contains, not_contains, gt, gte, lt, lte, is_empty, is_not_empty</code>. תאריכים יחסיים: <code dir="ltr">{"{{today}}"}</code>, <code dir="ltr">{"{{today+1}}"}</code>.</li>
          <li>תשובה: <code dir="ltr">{"{ data, total, limit, offset }"}</code> ברשימה, <code dir="ltr">{"{ data }"}</code> ברשומה. שגיאה: <code dir="ltr">{"{ error: { status, code, message, details: [{ field, code, message }] } }"}</code>.</li>
          <li>האוטומציות רצות גם על שינויים מה-API (הן במסד). &quot;נוצרה על ידי&quot; ריק = פעולת מערכת. כל בקשה נרשמת ב<Link href="/settings/api/log" className="ref-link">לוג הבקשות</Link>.</li>
        </ul>
      </section>

      <section className="card api-doc">
        <h2 className="section-title">קודי תגובה</h2>
        <table className="data-table log-table">
          <tbody>
            {CODES.map(([c, t]) => <tr key={c}><td data-label="קוד"><code dir="ltr">{c}</code></td><td data-label="מתי">{t}</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="card api-doc">
        <div className="api-doc-head">
          <h2 className="section-title">אובייקטים ושדות</h2>
          <div className="segmented" role="tablist" aria-label="אובייקט">
            {objects.map((o) => (
              <button key={o.object_key} type="button" role="tab" aria-selected={o.object_key === obj.object_key} className={o.object_key === obj.object_key ? "on" : ""} onClick={() => setPick(o.object_key)}>
                {o.label_plural}
              </button>
            ))}
          </div>
        </div>
        <p>
          <code dir="ltr">/api/v1/{obj.object_key}</code> · {obj.api_access === "full" ? "כל הפעולות" : "קריאה בלבד"}
        </p>
        <div className="table-scroll">
          <table className="data-table log-table api-fields">
            <thead>
              <tr><th>שדה</th><th>תווית</th><th>סוג</th><th>חובה</th><th>כתיבה</th><th>ערכים חוקיים</th></tr>
            </thead>
            <tbody>
              {own.map((f) => {
                const opts = Array.isArray(f.options) ? (f.options as { value: string; label: string }[]) : [];
                const ref = objects.find((o) => o.id === f.ref_object_id);
                return (
                  <tr key={f.field_key}>
                    <td data-label="שדה"><code dir="ltr">{f.field_key}</code></td>
                    <td data-label="תווית">{f.label}</td>
                    <td data-label="סוג">{TYPE_LABELS[f.field_type] ?? f.field_type}</td>
                    <td data-label="חובה">{f.is_required ? "כן" : ""}</td>
                    <td data-label="כתיבה">{f.is_editable && !f.computed ? "כן" : <span className="muted">קריאה בלבד</span>}</td>
                    <td data-label="ערכים">
                      {opts.length > 0 ? opts.map((o) => <span key={o.value} className="api-val"><code dir="ltr">{o.value}</code> {o.label}</span>)
                        : ref ? <>מזהה של <code dir="ltr">{ref.object_key}</code></> : f.placeholder ? <span className="muted">{f.placeholder}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">שדה חובה שיש לו ברירת מחדל במסד (למשל סטטוס) אפשר לא לשלוח ביצירה. שדות &quot;__label&quot; בתשובה הם השם של רשומה מקושרת.</p>
      </section>

      <section className="card api-doc">
        <h2 className="section-title">דוגמאות curl: {obj.label_plural}</h2>
        <p className="muted">קודם: <code dir="ltr">export ORA_API_KEY=&quot;ora_…&quot;</code></p>
        {examples.map(([title, cmd]) => (
          <div key={title} className="api-example">
            <h3>{title}</h3>
            <pre dir="ltr">{cmd}</pre>
          </div>
        ))}
      </section>
    </>
  );
}
