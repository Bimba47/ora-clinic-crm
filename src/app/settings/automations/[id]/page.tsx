"use client";
// בונה כלל אוטומציה: אובייקט וטריגר, ואז תנאים ופעולות בטפסים.
// השדות, הסוגים והאופרטורים נטענים מהמסד (automation_schema), כך ששדה חדש בקטלוג מופיע כאן בלי שינוי קוד.
// המסד בודק את הכלל שוב לפני שמירה (private.automation_validate) ומחזיר הודעה בעברית.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { errorText, loadCatalog, loadRefOptions, type Catalog, type RefOption } from "@/lib/views";
import {
  ACTION_LABELS, CRON_PRESETS, EMPTY_RULE, EVENT_LABELS, KIND_OPTIONS, MULTI_VALUE_OPS, NO_VALUE_OPS, OP_LABELS,
  SYSTEM_FIELDS, fieldOf, loadSchema, objOf, opsFor,
  type Action, type AutoEvent, type Condition, type Rule, type Schema, type SchemaField,
} from "@/lib/automations";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const toast = useToast();
  const [schema, setSchema] = useState<Schema | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rule, setRule] = useState<Rule | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [sch, cat] = await Promise.all([loadSchema(), loadCatalog()]);
        setSchema(sch);
        setCatalog(cat);
        if (isNew) {
          setRule({ ...EMPTY_RULE, conditions: { match: "all", rules: [] }, actions: [] });
        } else {
          const { data, error } = await supabase
            .from("automation_rules")
            .select("id, name, object_name, is_active, trigger_event, trigger_fields, schedule_cron, conditions, actions")
            .eq("id", id)
            .single();
          if (error) throw error;
          setRule(data as Rule);
        }
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, [id, isNew]);

  if (error && !rule) return <div className="card"><p className="field-error">{error}</p></div>;
  if (!schema || !catalog || !rule) return <div className="skeleton" style={{ height: 480 }} aria-busy="true" />;

  const obj = objOf(schema, rule.object_name)!;
  const set = (patch: Partial<Rule>) => setRule({ ...rule, ...patch });

  const setObject = (key: string) =>
    set({ object_name: key, trigger_fields: [], conditions: { ...rule.conditions, rules: [] }, actions: [] });

  const setEvent = (ev: AutoEvent) =>
    set({
      trigger_event: ev,
      trigger_fields: ev === "update" ? rule.trigger_fields : [],
      schedule_cron: ev === "schedule" ? rule.schedule_cron ?? CRON_PRESETS[0].value : null,
      // "השתנה" קיים רק בעדכון
      conditions: {
        ...rule.conditions,
        rules: ev === "update" ? rule.conditions.rules : rule.conditions.rules.filter((c) => !schema.change_ops.includes(c.op)),
      },
    });

  const setCond = (i: number, c: Condition) =>
    set({ conditions: { ...rule.conditions, rules: rule.conditions.rules.map((x, j) => (j === i ? c : x)) } });
  const setAction = (i: number, a: Action) => set({ actions: rule.actions.map((x, j) => (j === i ? a : x)) });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rule.name.trim()) return setError("חובה לתת לכלל שם");
    if (rule.actions.length === 0) return setError("הוסיפי לפחות פעולה אחת");
    setError("");
    setBusy(true);
    const payload = {
      name: rule.name.trim(),
      object_name: rule.object_name,
      is_active: rule.is_active,
      trigger_event: rule.trigger_event,
      trigger_fields: rule.trigger_fields,
      schedule_cron: rule.trigger_event === "schedule" ? rule.schedule_cron : null,
      conditions: rule.conditions,
      actions: rule.actions,
    };
    const { error } = isNew
      ? await supabase.from("automation_rules").insert(payload)
      : await supabase.from("automation_rules").update(payload).eq("id", id);
    setBusy(false);
    if (error) return setError(errorText(error));
    toast(isNew ? "הכלל נוצר" : "הכלל נשמר");
    router.push("/settings/automations");
  };

  const ctx = { schema, catalog, source: rule.object_name };

  return (
    <form onSubmit={save} className="auto-builder" noValidate>
      <div className="views-head">
        <h1 className="page-title">{isNew ? "כלל חדש" : "עריכת כלל"}</h1>
        <div className="head-buttons">
          {!isNew && <Link href={`/settings/automations/log?rule=${id}`} className="btn outline">לוג הכלל</Link>}
          <Link href="/settings/automations" className="btn outline">ביטול</Link>
          <button type="submit" className="btn primary cta" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            שמירה
          </button>
        </div>
      </div>
      {error && <p className="field-error form-error" role="alert">{error}</p>}

      {/* 1. מה ומתי */}
      <section className="card settings-card">
        <h2 className="section-title">הכלל</h2>
        <div className="auto-grid">
          <label className="field">
            <span>שם הכלל *</span>
            <input value={rule.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
          </label>
          <label className="check-field">
            <input type="checkbox" checked={rule.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
            <span>פעיל</span>
          </label>
          <label className="field">
            <span>אובייקט</span>
            <select value={rule.object_name} onChange={(e) => setObject(e.target.value)}>
              {schema.objects.map((o) => <option key={o.key} value={o.key}>{o.label_plural}</option>)}
            </select>
          </label>
          <label className="field">
            <span>מתי הכלל רץ</span>
            <select value={rule.trigger_event} onChange={(e) => setEvent(e.target.value as AutoEvent)}>
              {(Object.keys(EVENT_LABELS) as AutoEvent[]).map((ev) => <option key={ev} value={ev}>{EVENT_LABELS[ev]}</option>)}
            </select>
          </label>
        </div>

        {rule.trigger_event === "update" && (
          <fieldset className="auto-fieldset">
            <legend>רק כשאחד מהשדות האלה משתנה (בלי סימון: כל שינוי)</legend>
            <div className="check-list">
              {obj.fields.filter((f) => !["updated_at", "updated_by"].includes(f.key)).map((f) => (
                <label key={f.key} className="check-field compact">
                  <input
                    type="checkbox"
                    checked={rule.trigger_fields.includes(f.key)}
                    onChange={(e) =>
                      set({
                        trigger_fields: e.target.checked
                          ? [...rule.trigger_fields, f.key]
                          : rule.trigger_fields.filter((k) => k !== f.key),
                      })
                    }
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {rule.trigger_event === "schedule" && (
          <div className="auto-grid">
            <label className="field">
              <span>תזמון</span>
              <select
                value={CRON_PRESETS.some((p) => p.value === rule.schedule_cron) ? rule.schedule_cron! : "custom"}
                onChange={(e) => e.target.value !== "custom" && set({ schedule_cron: e.target.value })}
              >
                {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                <option value="custom">מותאם (ביטוי cron)</option>
              </select>
            </label>
            <label className="field">
              <span>ביטוי cron (לפי UTC)</span>
              <input dir="ltr" value={rule.schedule_cron ?? ""} onChange={(e) => set({ schedule_cron: e.target.value })} placeholder="0 5 * * *" />
            </label>
            <p className="muted grid-full">בכל הרצה הכלל עובר על כל הרשומות של האובייקט, ומבצע את הפעולות לכל רשומה שעומדת בתנאים.</p>
          </div>
        )}
      </section>

      {/* 2. תנאים */}
      <section className="card settings-card">
        <div className="section-head">
          <h2 className="section-title">תנאים</h2>
          {rule.conditions.rules.length > 1 && (
            <select
              className="compact-select"
              value={rule.conditions.match}
              onChange={(e) => set({ conditions: { ...rule.conditions, match: e.target.value as "all" | "any" } })}
              aria-label="התאמת תנאים"
            >
              <option value="all">כל התנאים מתקיימים</option>
              <option value="any">לפחות תנאי אחד</option>
            </select>
          )}
        </div>
        {rule.conditions.rules.length === 0 && <p className="muted">בלי תנאים: הכלל רץ בכל פעם.</p>}
        {rule.conditions.rules.map((c, i) => {
          const f = fieldOf(schema, rule.object_name, c.field);
          const ops = opsFor(schema, f, rule.trigger_event);
          return (
            <div key={i} className="auto-row">
              <select value={c.field} onChange={(e) => {
                const nf = fieldOf(schema, rule.object_name, e.target.value);
                setCond(i, { field: e.target.value, op: opsFor(schema, nf, rule.trigger_event)[0] ?? "eq", value: "" });
              }} aria-label="שדה">
                {obj.fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              <select value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value, value: MULTI_VALUE_OPS.includes(e.target.value) ? [] : "" })} aria-label="תנאי">
                {ops.map((op) => <option key={op} value={op}>{OP_LABELS[op] ?? op}</option>)}
              </select>
              {!NO_VALUE_OPS.includes(c.op) ? (
                <ValueEditor ctx={ctx} field={f} value={c.value} multi={MULTI_VALUE_OPS.includes(c.op)} onChange={(v) => setCond(i, { ...c, value: v })} />
              ) : <span />}
              <button type="button" className="icon-btn" aria-label="הסרת התנאי" onClick={() => set({ conditions: { ...rule.conditions, rules: rule.conditions.rules.filter((_, j) => j !== i) } })}>✕</button>
            </div>
          );
        })}
        <div>
          <button type="button" className="btn outline" onClick={() => {
            const f = obj.fields[0];
            set({ conditions: { ...rule.conditions, rules: [...rule.conditions.rules, { field: f.key, op: opsFor(schema, f, rule.trigger_event)[0] ?? "eq", value: "" }] } });
          }}>+ תנאי</button>
        </div>
      </section>

      {/* 3. פעולות */}
      <section className="card settings-card">
        <h2 className="section-title">פעולות</h2>
        {rule.actions.length === 0 && <p className="muted">הוסיפי פעולה: מה יקרה כשהכלל רץ.</p>}
        {rule.actions.map((a, i) => (
          <div key={i} className="auto-action">
            <div className="auto-action-head">
              <span className="auto-step">{i + 1}</span>
              <strong>{ACTION_LABELS[a.type]}</strong>
              <button type="button" className="icon-btn" aria-label="הסרת הפעולה" onClick={() => set({ actions: rule.actions.filter((_, j) => j !== i) })}>✕</button>
            </div>
            <ActionEditor ctx={ctx} action={a} onChange={(x) => setAction(i, x)} />
          </div>
        ))}
        <div className="auto-add">
          <select value="" onChange={(e) => {
            if (!e.target.value) return;
            set({ actions: [...rule.actions, newAction(e.target.value as Action["type"], schema, rule.object_name)] });
          }} aria-label="הוספת פעולה">
            <option value="">+ הוספת פעולה</option>
            {(Object.keys(ACTION_LABELS) as Action["type"][]).map((t) => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
          </select>
        </div>
      </section>

      {/* עזרה: תבניות */}
      <details className="card settings-card auto-help">
        <summary>ערכים דינמיים (תבניות)</summary>
        <ul>
          <li><code dir="ltr">{"{{שם_שדה}}"}</code> – הערך מהרשומה, למשל <code dir="ltr">{"{{client_id}}"}</code>. בשדה מקושר או בחירה: <code dir="ltr">{"{{client_id:label}}"}</code> לשם.</li>
          <li><code dir="ltr">{"{{treatment_id.price}}"}</code> – שדה ברשומה המקושרת.</li>
          <li><code dir="ltr">{"{{today}}"}</code>, <code dir="ltr">{"{{today+1}}"}</code>, <code dir="ltr">{"{{now}}"}</code> – התאריך היום, מחר, ועכשיו.</li>
          <li><code dir="ltr">{"{{user}}"}</code> / <code dir="ltr">{"{{user_name}}"}</code> – מי שביצעה את השינוי.</li>
          <li><code dir="ltr">{"{{assigned_to|user}}"}</code> – הראשון שיש לו ערך.</li>
        </ul>
        <p className="muted">שדות ב{obj.label_plural}: {obj.fields.map((f) => `${f.label} (${f.key})`).join(" · ")}</p>
      </details>
    </form>
  );
}

type Ctx = { schema: Schema; catalog: Catalog; source: string };

function newAction(type: Action["type"], schema: Schema, source: string): Action {
  const obj = objOf(schema, source)!;
  if (type === "update_field") {
    const f = obj.fields.find((x) => !SYSTEM_FIELDS.includes(x.key))!;
    return { type, field: f.key, value: "" };
  }
  if (type === "update_related") {
    const rel = relatedObjects(schema, source)[0];
    const target = rel ? objOf(schema, rel.object)! : obj;
    return { type, object: rel?.object ?? "", match_field: rel?.fields[0]?.key ?? "", field: target.fields.find((x) => !SYSTEM_FIELDS.includes(x.key))?.key ?? "", value: "" };
  }
  // ברירת מחדל: אובייקט שמקושר לאובייקט של הכלל (למשל קריאה חדשה מלקוחה), ואחרת אובייקט אחר
  if (type === "create_record") {
    const target = relatedObjects(schema, source)[0]?.object ?? schema.objects.find((o) => o.key !== source)?.key ?? source;
    return createRecordFor(schema, target, source);
  }
  return { type: "notify", to: obj.owner_field ? "record_owner" : "{{user}}", message: "", kind: "system" };
}

function createRecordFor(schema: Schema, target: string, source: string): Action {
  const t = objOf(schema, target)!;
  const values: Record<string, unknown> = {};
  t.fields.filter((f) => f.required && f.editable).forEach((f) => (values[f.key] = ""));
  const link = t.fields.find((f) => f.type === "reference" && f.ref_object === source);
  return { type: "create_record", object: target, values, link_field: link?.key ?? "" };
}

// אובייקטים שיש בהם שדה מקושר לאובייקט של הכלל (למשל קריאות → לקוחה)
function relatedObjects(schema: Schema, source: string) {
  return schema.objects
    .map((o) => ({ object: o.key, label: o.label_plural, fields: o.fields.filter((f) => f.type === "reference" && f.ref_object === source) }))
    .filter((o) => o.fields.length > 0);
}

function ActionEditor({ ctx, action: a, onChange }: { ctx: Ctx; action: Action; onChange: (a: Action) => void }) {
  const { schema, source } = ctx;
  const src = objOf(schema, source)!;
  const writable = (objKey: string) => objOf(schema, objKey)!.fields.filter((f) => !SYSTEM_FIELDS.includes(f.key));

  if (a.type === "update_field") {
    const f = fieldOf(schema, source, a.field);
    return (
      <div className="auto-row two">
        <select value={a.field} onChange={(e) => onChange({ ...a, field: e.target.value, value: "" })} aria-label="שדה לעדכון">
          {writable(source).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <ValueEditor ctx={ctx} field={f} value={a.value} onChange={(v) => onChange({ ...a, value: v })} allowClear />
      </div>
    );
  }

  if (a.type === "update_related") {
    const rels = relatedObjects(schema, source);
    const rel = rels.find((r) => r.object === a.object);
    const f = a.object ? fieldOf(schema, a.object, a.field) : undefined;
    if (rels.length === 0) return <p className="muted">אין אובייקט שמקושר ל{src.label_plural}.</p>;
    return (
      <div className="auto-stack">
        <div className="auto-row two">
          <label className="field">
            <span>אילו רשומות</span>
            <select value={a.object} onChange={(e) => {
              const r = rels.find((x) => x.object === e.target.value)!;
              onChange({ ...a, object: r.object, match_field: r.fields[0].key, field: writable(r.object)[0].key, value: "" });
            }}>
              {rels.map((r) => <option key={r.object} value={r.object}>{r.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>שמקושרות דרך השדה</span>
            <select value={a.match_field} onChange={(e) => onChange({ ...a, match_field: e.target.value })}>
              {rel?.fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
        </div>
        <div className="auto-row two">
          <select value={a.field} onChange={(e) => onChange({ ...a, field: e.target.value, value: "" })} aria-label="שדה לעדכון">
            {a.object && writable(a.object).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <ValueEditor ctx={ctx} field={f} value={a.value} onChange={(v) => onChange({ ...a, value: v })} allowClear />
        </div>
        <p className="muted">רק רשומות שעוד אין בהן הערך הזה מתעדכנות.</p>
      </div>
    );
  }

  if (a.type === "create_record") {
    const target = objOf(schema, a.object)!;
    const links = target.fields.filter((f) => f.type === "reference" && f.ref_object === source);
    // השדות לפי הסדר שלהם בקטלוג (המסד שומר את המפתחות בסדר אחר)
    const order = (k: string) => target.fields.findIndex((f) => f.key === k);
    const used = Object.keys(a.values).sort((x, y) => order(x) - order(y));
    const free = target.fields.filter((f) => !SYSTEM_FIELDS.includes(f.key) && !used.includes(f.key) && f.key !== a.link_field);
    return (
      <div className="auto-stack">
        <div className="auto-row two">
          <label className="field">
            <span>ליצור ב</span>
            <select value={a.object} onChange={(e) => onChange(createRecordFor(schema, e.target.value, source))}>
              {schema.objects.map((o) => <option key={o.key} value={o.key}>{o.label_plural}</option>)}
            </select>
          </label>
          <label className="field">
            <span>לקשר לרשומה הנוכחית דרך</span>
            <select value={a.link_field ?? ""} onChange={(e) => onChange({ ...a, link_field: e.target.value })}>
              <option value="">בלי קישור</option>
              {links.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
        </div>
        {used.map((k) => {
          const f = fieldOf(schema, a.object, k);
          return (
            <div key={k} className="auto-row two with-remove">
              <span className="auto-label">{f?.label ?? k}{f?.required ? " *" : ""}</span>
              <ValueEditor ctx={ctx} field={f} value={a.values[k]} onChange={(v) => onChange({ ...a, values: { ...a.values, [k]: v } })} />
              <button type="button" className="icon-btn" aria-label={`הסרת ${f?.label ?? k}`} onClick={() => {
                const rest = { ...a.values };
                delete rest[k];
                onChange({ ...a, values: rest });
              }}>✕</button>
            </div>
          );
        })}
        {free.length > 0 && (
          <select value="" onChange={(e) => e.target.value && onChange({ ...a, values: { ...a.values, [e.target.value]: "" } })} aria-label="הוספת שדה" className="compact-select">
            <option value="">+ שדה</option>
            {free.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        )}
      </div>
    );
  }

  // notify
  const staffFields = src.fields.filter((f) => f.type === "reference" && f.ref_object === "staff");
  const ownerLabel = src.owner_field ? fieldOf(schema, source, src.owner_field)?.label : null;
  return (
    <div className="auto-stack">
      <div className="auto-row two">
        <label className="field">
          <span>למי</span>
          <RefValue
            ctx={ctx}
            refObject="staff"
            value={a.to}
            onChange={(v) => onChange({ ...a, to: v })}
            extra={[
              ...(ownerLabel ? [{ value: "record_owner", label: `האחראית על הרשומה (${ownerLabel})` }] : []),
              ...staffFields.filter((f) => f.key !== src.owner_field).map((f) => ({ value: `{{${f.key}}}`, label: `${f.label} של הרשומה` })),
              { value: "{{user}}", label: "מי שביצעה את השינוי" },
            ]}
          />
        </label>
        <label className="field">
          <span>סוג</span>
          <select value={a.kind ?? "system"} onChange={(e) => onChange({ ...a, kind: e.target.value })}>
            {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>הודעה</span>
        <TemplateInput ctx={ctx} value={String(a.message ?? "")} onChange={(v) => onChange({ ...a, message: v })} placeholder="למשל: {{user_name}} שייכה אלייך קריאה: {{client_id:label}}" />
      </label>
    </div>
  );
}

// ערך לשדה לפי סוגו. תמיד אפשר גם תבנית ({{…}}).
function ValueEditor({
  ctx, field: f, value, onChange, multi, allowClear,
}: { ctx: Ctx; field: SchemaField | undefined; value: unknown; onChange: (v: unknown) => void; multi?: boolean; allowClear?: boolean }) {
  const { schema, source } = ctx;
  const v = value === undefined || value === null ? "" : value;
  if (!f) return <TemplateInput ctx={ctx} value={String(v)} onChange={onChange} />;

  if (multi) {
    const arr = Array.isArray(v) ? (v as string[]) : String(v).split(",").filter(Boolean);
    if (f.type === "choice" && f.options) {
      return (
        <div className="check-list">
          {f.options.map((o) => (
            <label key={o.value} className="check-field compact">
              <input type="checkbox" checked={arr.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }
    return <input dir="ltr" value={arr.join(",")} onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="ערכים מופרדים בפסיק" />;
  }

  if (f.type === "boolean" || f.type === "choice") {
    return (
      <select value={String(v)} onChange={(e) => onChange(e.target.value)} aria-label={f.label}>
        <option value="">{allowClear ? "ריק (לנקות)" : "בחרי…"}</option>
        {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.type === "reference" && f.ref_object) {
    const sameRef = objOf(schema, source)!.fields.filter((x) => x.type === "reference" && x.ref_object === f.ref_object);
    return (
      <RefValue
        ctx={ctx}
        refObject={f.ref_object}
        value={String(v)}
        onChange={onChange}
        extra={[
          ...(allowClear ? [{ value: "", label: "ריק (לנקות)" }] : []),
          ...(f.ref_object === source ? [{ value: "{{id}}", label: "הרשומה הנוכחית" }] : []),
          ...sameRef.map((x) => ({ value: `{{${x.key}}}`, label: `${x.label} של הרשומה` })),
          ...(f.ref_object === "staff" ? [{ value: "{{user}}", label: "מי שביצעה את השינוי" }] : []),
        ]}
      />
    );
  }
  const suggestions =
    f.type === "date" ? ["{{today}}", "{{today+1}}", "{{today+7}}"] : f.type === "datetime" ? ["{{now}}", "{{today}}"] : [];
  return (
    <TemplateInput
      ctx={ctx}
      value={String(v)}
      onChange={onChange}
      suggestions={suggestions}
      ltr={["number", "money", "date", "datetime", "phone", "email"].includes(f.type)}
      placeholder={
        f.type === "date" ? "2026-10-20 או {{today+1}}" : f.type === "datetime" ? "{{now}}" : allowClear ? "ריק = לנקות את השדה" : ""
      }
    />
  );
}

// בחירת רשומה מקושרת (מהרשימה), או ערך דינמי
function RefValue({
  ctx, refObject, value, onChange, extra,
}: { ctx: Ctx; refObject: string; value: string; onChange: (v: string) => void; extra: { value: string; label: string }[] }) {
  const [options, setOptions] = useState<RefOption[]>([]);
  const meta = ctx.catalog.objects.find((o) => o.object_key === refObject);
  useEffect(() => {
    if (meta) loadRefOptions(meta, ctx.catalog).then(setOptions).catch(() => setOptions([]));
  }, [meta, ctx.catalog]);
  const known = value === "" || extra.some((x) => x.value === value) || options.some((o) => o.value === value);
  return (
    <select value={known ? value : "__other"} onChange={(e) => onChange(e.target.value)}>
      {!extra.some((x) => x.value === "") && <option value="">בחרי…</option>}
      {extra.length > 0 && (
        <optgroup label="דינמי">
          {extra.map((x) => <option key={x.value || "empty"} value={x.value}>{x.label}</option>)}
        </optgroup>
      )}
      <optgroup label={meta?.label_plural ?? refObject}>
        {options.filter((o) => !o.inactive).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </optgroup>
      {!known && <option value="__other">{value}</option>}
    </select>
  );
}

// שדה טקסט עם הוספת שדה מהרשומה כתבנית
function TemplateInput({
  ctx, value, onChange, suggestions = [], ltr, placeholder,
}: { ctx: Ctx; value: string; onChange: (v: string) => void; suggestions?: string[]; ltr?: boolean; placeholder?: string }) {
  const src = objOf(ctx.schema, ctx.source)!;
  const listId = useMemo(() => `sugg-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className="template-input">
      <input dir={ltr ? "ltr" : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} list={suggestions.length ? listId : undefined} />
      {suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      )}
      <select
        value=""
        className="compact-select"
        aria-label="הוספת ערך מהרשומה"
        onChange={(e) => e.target.value && onChange(`${value}${e.target.value}`)}
      >
        <option value="">+ ערך</option>
        {src.fields.map((f) => (
          <option key={f.key} value={f.type === "reference" || f.type === "choice" || f.type === "boolean" ? `{{${f.key}:label}}` : `{{${f.key}}}`}>
            {f.label}
          </option>
        ))}
        <option value="{{today}}">התאריך היום</option>
        <option value="{{now}}">עכשיו</option>
        <option value="{{user_name}}">שם מי שביצעה את השינוי</option>
      </select>
    </div>
  );
}
