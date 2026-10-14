"use client";
// חלונית בניית ווידג'ט, בשלבים לפי הסדר שבו חושבים עליו:
// 1. מה זה (סוג, כותרת, על אילו נתונים)  2. אילו רשומות (אותו רכיב סינון של התצוגות)
// 3. מה מחשבים / מה מציגים (לפי הסוג)  4. סדר וכמות  5. הגדרות נוספות (מקופל)
// לצדה תצוגה מקדימה חיה. השדות נטענים מהקטלוג (ומהשדות הנגזרים שלו), לא מקודדים.

import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import FilterPanel from "@/components/views/FilterPanel";
import { useToast } from "@/components/Toast";
import { supabase } from "@/lib/supabase";
import { errorText, type Catalog, type FieldMeta } from "@/lib/views";
import {
  AGGREGATE_LABELS, DATE_GROUP_LABELS, EMPTY_WIDGET, WIDGET_TYPE_LABELS, fromViewState, objectByKey, toViewState, widgetFields,
  type Aggregate, type DashFilters, type DateGroup, type Widget, type WidgetConfig, type WidgetType,
} from "@/lib/dashboards";
import WidgetView from "./WidgetView";

type Draft = Omit<Widget, "id" | "dashboard_id">;
const OBJECTS = ["service_requests", "appointments", "clients", "treatments", "staff"];
const DEFAULT_SIZE: Record<WidgetType, [number, number]> = { metric: [3, 2], bar: [6, 4], pie: [6, 4], table: [6, 4], list: [6, 4], text: [12, 1] };
// שדות מערכת שלא מועילים בבניית ווידג'ט ורק מאריכים את הרשימות
const SYSTEM = ["updated_at", "updated_by"];

export default function WidgetBuilder({
  catalog, dashboardId, widget, nextY, dash, roles = [], onClose, onSaved,
}: {
  catalog: Catalog;
  roles?: { id: string; name: string }[];
  dashboardId: string;
  widget: Widget | null;
  nextY: number;
  dash: DashFilters;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => (widget ? strip(widget) : { ...EMPTY_WIDGET, position_y: nextY }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setCfg = (p: Partial<WidgetConfig>) => setD((x) => ({ ...x, config: { ...x.config, ...p } }));

  const fields = useMemo(
    () => (d.object_name ? widgetFields(catalog, d.object_name).filter((f) => !SYSTEM.includes(f.field_key)) : []),
    [catalog, d.object_name],
  );
  const real = fields.filter((f) => !f.field_key.startsWith("count:"));
  const groupable = real.filter((f) => ["choice", "reference", "boolean", "date", "datetime"].includes(f.field_type));
  const numeric = fields.filter((f) => ["number", "money"].includes(f.field_type));
  const dates = real.filter((f) => ["date", "datetime"].includes(f.field_type));
  const choices = real.filter((f) => f.field_type === "choice" && f.is_editable);
  const gf = fields.find((f) => f.field_key === d.group_by);
  const grouped = ["bar", "pie"].includes(d.widget_type) || (d.widget_type === "table" && !!d.group_by);
  const rowsMode = d.widget_type === "list" || (d.widget_type === "table" && !d.group_by);
  const phonePaths = phoneOptions(catalog, real, d.object_name);
  const objLabel = objectByKey(catalog, d.object_name)?.label_plural ?? "";

  // מיון ברשימה: שדה + כיוון (במקום כל שדה פעמיים)
  const sortField = rowsMode && d.sort && !d.sort.startsWith("value_") && !d.sort.startsWith("label_") ? d.sort.replace(/:desc$/, "") : "";
  const sortDesc = !!d.sort?.endsWith(":desc");

  const setType = (t: WidgetType) => {
    const [w, h] = DEFAULT_SIZE[t];
    set({
      widget_type: t,
      width: widget ? d.width : w,
      height: widget ? d.height : h,
      group_by: ["bar", "pie"].includes(t) ? d.group_by ?? groupable[0]?.field_key ?? null : t === "table" ? d.group_by : null,
      object_name: t === "text" ? null : d.object_name ?? "service_requests",
      sort: null,
    });
  };
  const setObject = (o: string) =>
    set({ object_name: o, filters: { match: "all", rules: [] }, group_by: null, aggregate: "count", aggregate_field: null, sort: null, config: {} });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (d.widget_type !== "text" && !d.title.trim()) return setError("תני לווידג'ט כותרת");
    if (["bar", "pie"].includes(d.widget_type) && !d.group_by) return setError("בעמודות ובטבעת צריך לבחור לפי מה לקבץ");
    if (["sum", "avg", "min", "max"].includes(d.aggregate) && !d.aggregate_field) return setError("בחרי על איזה שדה לחשב");
    setError("");
    setBusy(true);
    const config: WidgetConfig = { ...d.config, suffix: d.aggregate === "percent" ? "%" : d.config.suffix === "%" ? undefined : d.config.suffix };
    const payload = { ...d, title: d.title.trim(), config, limit: d.limit || null };
    const { error } = widget
      ? await supabase.from("dashboard_widgets").update(payload).eq("id", widget.id)
      : await supabase.from("dashboard_widgets").insert({ ...payload, dashboard_id: dashboardId });
    setBusy(false);
    if (error) return setError(errorText(error));
    toast(widget ? "הווידג'ט נשמר" : "הווידג'ט נוסף ללוח");
    onSaved();
  };

  const aggregateFields = (
    <>
      <label className="field">
        <span>מה מחשבים</span>
        <select value={d.aggregate} onChange={(e) => set({ aggregate: e.target.value as Aggregate, aggregate_field: null })}>
          {(Object.keys(AGGREGATE_LABELS) as Aggregate[]).map((a) => <option key={a} value={a}>{AGGREGATE_LABELS[a]}</option>)}
        </select>
      </label>
      {["sum", "avg", "min", "max"].includes(d.aggregate) && (
        <label className="field">
          <span>של השדה</span>
          <select value={d.aggregate_field ?? ""} onChange={(e) => set({ aggregate_field: e.target.value || null })}>
            <option value="">בחרי שדה…</option>
            {numeric.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
          </select>
        </label>
      )}
    </>
  );

  return (
    <Modal title={widget ? "עריכת ווידג'ט" : "ווידג'ט חדש"} onClose={onClose} wide>
      <form className="wb" onSubmit={save} noValidate>
        <div className="wb-form">
          {/* 1. מה זה */}
          <section className="wb-step">
            <h3><span className="wb-num">1</span>סוג וכותרת</h3>
            <div className="segmented wb-types" role="radiogroup" aria-label="סוג הווידג'ט">
              {(Object.keys(WIDGET_TYPE_LABELS) as WidgetType[]).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={d.widget_type === t} className={d.widget_type === t ? "on" : ""} onClick={() => setType(t)}>
                  {WIDGET_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="wb-grid">
              <label className="field">
                <span>{d.widget_type === "text" ? "כותרת (לא חובה)" : "כותרת *"}</span>
                <input value={d.title} onChange={(e) => set({ title: e.target.value })} autoFocus={!widget} />
              </label>
              {d.widget_type !== "text" && (
                <label className="field">
                  <span>על אילו נתונים</span>
                  <select value={d.object_name ?? ""} onChange={(e) => setObject(e.target.value)}>
                    {OBJECTS.map((k) => objectByKey(catalog, k)).filter(Boolean).map((o) => <option key={o!.object_key} value={o!.object_key}>{o!.label_plural}</option>)}
                  </select>
                </label>
              )}
            </div>
          </section>

          {d.widget_type === "text" ? (
            <section className="wb-step">
              <h3><span className="wb-num">2</span>הטקסט</h3>
              <label className="field"><span>טקסט</span><input value={d.config.text ?? ""} onChange={(e) => setCfg({ text: e.target.value })} placeholder="למשל: יעדי החודש" /></label>
              <label className="field"><span>טקסט משני</span><input value={d.config.subtext ?? ""} onChange={(e) => setCfg({ subtext: e.target.value })} /></label>
              <label className="check-field"><input type="checkbox" checked={d.config.size === "title"} onChange={(e) => setCfg({ size: e.target.checked ? "title" : "normal" })} /><span>כותרת גדולה</span></label>
              <p className="muted">אפשר להשתמש ב-{"{{first_name}}"}, {"{{user_name}}"} ו-{"{{today_long}}"}.</p>
            </section>
          ) : (
            <>
              {/* 2. אילו רשומות */}
              <section className="wb-step">
                <h3><span className="wb-num">2</span>אילו {objLabel}</h3>
                <FilterPanel
                  fields={fields}
                  catalog={catalog}
                  state={toViewState(d.filters)}
                  onChange={(p) => set({ filters: fromViewState({ ...toViewState(d.filters), ...p }) })}
                  allowRelative
                />
              </section>

              {/* 3. מה מחשבים / מה מציגים */}
              <section className="wb-step">
                <h3><span className="wb-num">3</span>{rowsMode ? "אילו שדות להציג" : "מה מחשבים"}</h3>
                {d.widget_type === "metric" && <div className="wb-grid">{aggregateFields}</div>}

                {(["bar", "pie", "table"] as WidgetType[]).includes(d.widget_type) && (
                  <div className="wb-grid">
                    <label className="field">
                      <span>{d.widget_type === "table" ? "קיבוץ" : "לפי מה מחלקים"}</span>
                      <select value={d.group_by ?? ""} onChange={(e) => {
                        const nf = fields.find((f) => f.field_key === e.target.value);
                        const isDate = !!nf && ["date", "datetime"].includes(nf.field_type);
                        set({ group_by: e.target.value || null, date_group: isDate ? "day" : "none", sort: null, config: { ...d.config, split_by: undefined } });
                      }}>
                        {d.widget_type === "table" && <option value="">בלי קיבוץ – רשימת רשומות</option>}
                        {groupable.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                      </select>
                    </label>
                    {gf && ["date", "datetime"].includes(gf.field_type) && (
                      <label className="field">
                        <span>לפי</span>
                        <select value={d.date_group === "none" ? "day" : d.date_group} onChange={(e) => set({ date_group: e.target.value as DateGroup })}>
                          {(Object.keys(DATE_GROUP_LABELS) as DateGroup[]).filter((g) => g !== "none").map((g) => <option key={g} value={g}>{DATE_GROUP_LABELS[g]}</option>)}
                        </select>
                      </label>
                    )}
                    {grouped && aggregateFields}
                    {d.widget_type === "table" && d.group_by && (
                      <label className="field">
                        <span>עמודות לפי (לא חובה)</span>
                        <select value={d.config.split_by ?? ""} onChange={(e) => setCfg({ split_by: e.target.value || undefined })}>
                          <option value="">בלי – עמודה אחת</option>
                          {groupable.filter((f) => f.field_key !== d.group_by && !["date", "datetime"].includes(f.field_type)).map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                )}

                {d.aggregate === "percent" && (d.widget_type === "metric" || grouped) && (
                  <div className="wb-sub">
                    <p className="wb-hint">האחוז מתוך הכלל של הרשומות ש…</p>
                    <FilterPanel
                      fields={fields}
                      catalog={catalog}
                      state={toViewState(d.config.percent_where ?? { match: "all", rules: [] })}
                      onChange={(p) => setCfg({ percent_where: fromViewState({ ...toViewState(d.config.percent_where ?? { match: "all", rules: [] }), ...p }) })}
                      allowRelative
                    />
                  </div>
                )}

                {rowsMode && (
                  <div className="check-list wb-columns">
                    {fields.map((f) => (
                      <label key={f.field_key} className="check-field compact">
                        <input
                          type="checkbox"
                          checked={(d.config.columns ?? []).includes(f.field_key)}
                          onChange={(e) => setCfg({ columns: e.target.checked ? [...(d.config.columns ?? []), f.field_key] : (d.config.columns ?? []).filter((c) => c !== f.field_key) })}
                        />
                        <span>{f.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {/* 4. סדר וכמות */}
              {d.widget_type !== "metric" && (
                <section className="wb-step">
                  <h3><span className="wb-num">4</span>סדר וכמות</h3>
                  <div className="wb-grid">
                    {rowsMode ? (
                      <>
                        <label className="field">
                          <span>מיון לפי</span>
                          <select value={sortField} onChange={(e) => set({ sort: e.target.value ? `${e.target.value}${sortDesc ? ":desc" : ""}` : null })}>
                            <option value="">החדשות קודם</option>
                            {real.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                          </select>
                        </label>
                        {sortField && (
                          <label className="field">
                            <span>כיוון</span>
                            <select value={sortDesc ? "desc" : "asc"} onChange={(e) => set({ sort: `${sortField}${e.target.value === "desc" ? ":desc" : ""}` })}>
                              <option value="asc">מהקטן לגדול / מהמוקדם למאוחר</option>
                              <option value="desc">מהגדול לקטן / מהמאוחר למוקדם</option>
                            </select>
                          </label>
                        )}
                      </>
                    ) : (
                      <label className="field">
                        <span>סדר הקבוצות</span>
                        <select value={d.sort ?? (d.date_group !== "none" ? "label_asc" : "value_desc")} onChange={(e) => set({ sort: e.target.value })}>
                          <option value="value_desc">מהגדול לקטן</option>
                          <option value="value_asc">מהקטן לגדול</option>
                          <option value="label_asc">לפי סדר הקבוצות</option>
                        </select>
                      </label>
                    )}
                    <label className="field">
                      <span>כמה להציג (עד)</span>
                      <input type="number" min={1} max={500} dir="ltr" value={d.limit ?? ""} onChange={(e) => set({ limit: e.target.value ? Number(e.target.value) : null })} placeholder="50" />
                    </label>
                  </div>
                </section>
              )}

              {/* 5. הגדרות נוספות – מקופל, כדי שהחלונית תישאר פשוטה */}
              <details className="wb-step wb-more">
                <summary>הגדרות נוספות</summary>
                <div className="wb-grid">
                  {roles.length > 0 && (
                    <fieldset className="field wb-roles">
                      <span>מוצג לתפקידים (בלי סימון = לכולם)</span>
                      {roles.map((r) => {
                        const on = (d.config.roles ?? []).includes(r.id);
                        return (
                          <label key={r.id} className="check-field compact">
                            <input type="checkbox" checked={on} onChange={() => {
                              const cur = d.config.roles ?? [];
                              const next = on ? cur.filter((x) => x !== r.id) : [...cur, r.id];
                              setCfg({ roles: next.length ? next : undefined });
                            }} />
                            <span>{r.name}</span>
                          </label>
                        );
                      })}
                    </fieldset>
                  )}
                  {dates.length > 0 && (
                    <label className="field">
                      <span>טווח התאריכים של הלוח חל על</span>
                      <select value={d.config.date_field ?? dates[0].field_key} onChange={(e) => setCfg({ date_field: e.target.value })}>
                        {dates.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                      </select>
                    </label>
                  )}
                  {d.widget_type === "metric" && (
                    <>
                      <label className="field">
                        <span>השוואה לתקופה קודמת</span>
                        <select value={d.config.compare?.field ?? ""} onChange={(e) => setCfg({ compare: e.target.value ? { field: e.target.value, days: d.config.compare?.days ?? 7 } : undefined })}>
                          <option value="">בלי השוואה</option>
                          {dates.map((f) => <option key={f.field_key} value={f.field_key}>לפי {f.label}</option>)}
                        </select>
                      </label>
                      {d.config.compare && (
                        <label className="field">
                          <span>תקופה</span>
                          <select value={d.config.compare.days} onChange={(e) => setCfg({ compare: { ...d.config.compare!, days: Number(e.target.value) } })}>
                            <option value={1}>יום</option>
                            <option value={7}>7 ימים</option>
                            <option value={30}>30 יום</option>
                            <option value={90}>90 יום</option>
                          </select>
                        </label>
                      )}
                      <label className="check-field"><input type="checkbox" checked={d.config.tone === "danger"} onChange={(e) => setCfg({ tone: e.target.checked ? "danger" : undefined })} /><span>המספר באדום כשהוא גדול מ-0</span></label>
                    </>
                  )}
                  {d.widget_type === "bar" && (
                    <label className="check-field"><input type="checkbox" checked={d.config.bar_style === "gradient"} onChange={(e) => setCfg({ bar_style: e.target.checked ? "gradient" : undefined })} /><span>עמודות בצבע אחד מדורג, והערך בסוף העמודה</span></label>
                  )}
                  {(d.widget_type === "bar" || d.widget_type === "metric") && (
                    <label className="field wb-full">
                      <span>הסבר מתחת לווידג'ט</span>
                      <input value={d.config.hint ?? ""} onChange={(e) => setCfg({ hint: e.target.value || undefined })} placeholder="למשל: תורים שבוצעו החודש" />
                    </label>
                  )}
                  {d.widget_type === "list" && choices.length > 0 && (
                    <label className="field">
                      <span>שינוי בלחיצה ברשימה</span>
                      <select value={d.config.inline_status ?? ""} onChange={(e) => setCfg({ inline_status: e.target.value || undefined })}>
                        <option value="">בלי</option>
                        {choices.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                      </select>
                    </label>
                  )}
                  {d.widget_type === "list" && phonePaths.length > 0 && (
                    <label className="field">
                      <span>כפתור וואטסאפ</span>
                      <select value={d.config.whatsapp?.phone ?? ""} onChange={(e) => setCfg({ whatsapp: e.target.value ? { phone: e.target.value, template: d.config.whatsapp?.template ?? "" } : undefined })}>
                        <option value="">בלי</option>
                        {phonePaths.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </label>
                  )}
                  {d.widget_type === "list" && d.config.whatsapp && (
                    <label className="field wb-full">
                      <span>הודעה מוכנה</span>
                      <input value={d.config.whatsapp.template} onChange={(e) => setCfg({ whatsapp: { ...d.config.whatsapp!, template: e.target.value } })} placeholder="היי {{client_id:label}}, תזכורת לתור שלך ב-{{starts_at:time}}" />
                    </label>
                  )}
                  {rowsMode && (
                    <label className="field wb-full">
                      <span>טקסט כשאין רשומות</span>
                      <input value={d.config.empty ?? ""} onChange={(e) => setCfg({ empty: e.target.value || undefined })} placeholder="אין רשומות" />
                    </label>
                  )}
                </div>
              </details>
            </>
          )}
          {error && <p className="field-error form-error" role="alert">{error}</p>}
        </div>

        <div className="wb-preview">
          <h3>תצוגה מקדימה</h3>
          <div className="card widget wb-preview-card">
            {d.title && d.widget_type !== "text" && <div className="widget-head"><h2 className="widget-title">{d.title}</h2></div>}
            <div className="widget-body">
              <WidgetView widget={d} catalog={catalog} dash={dash} preview />
            </div>
          </div>
        </div>

        <div className="modal-actions wb-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {widget ? "שמירה" : "הוספה ללוח"}
          </button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}

function strip(w: Widget): Draft {
  const { id: _id, dashboard_id: _d, ...rest } = w;
  void _id;
  void _d;
  return { ...rest, config: rest.config ?? {}, filters: rest.filters ?? { match: "all", rules: [] } };
}

// טלפונים לכפתור וואטסאפ: שדה טלפון ברשומה, או הטלפון של רשומה מקושרת (למשל client_id.phone)
function phoneOptions(catalog: Catalog, fields: FieldMeta[], objectKey: string | null) {
  if (!objectKey) return [];
  const out: { value: string; label: string }[] = [];
  for (const f of fields) {
    if (f.field_type === "phone") out.push({ value: f.field_key, label: f.label });
    if (f.field_type === "reference") {
      for (const p of catalog.fields.filter((x) => x.object_id === f.ref_object_id && x.field_type === "phone")) {
        out.push({ value: `${f.field_key}.${p.field_key}`, label: `${p.label} של ${f.label}` });
      }
    }
  }
  return out;
}
