"use client";
// חלונית בניית ווידג'ט: אובייקט, סינון (אותו רכיב סינון של התצוגות), קיבוץ, פונקציית סיכום וסוג,
// עם תצוגה מקדימה חיה שמתעדכנת בכל שינוי. השדות נטענים מהקטלוג (ומהשדות הנגזרים שלו), לא מקודדים.

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
const OBJECTS = ["service_requests", "appointments", "clients", "tasks", "treatments", "staff"];
const DEFAULT_SIZE: Record<WidgetType, [number, number]> = { metric: [3, 2], bar: [6, 4], pie: [6, 4], table: [6, 4], list: [6, 4], text: [12, 1] };

export default function WidgetBuilder({
  catalog, dashboardId, widget, nextY, dash, onClose, onSaved,
}: {
  catalog: Catalog;
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

  const fields = useMemo(() => (d.object_name ? widgetFields(catalog, d.object_name) : []), [catalog, d.object_name]);
  const real = fields.filter((f) => !f.field_key.startsWith("count:"));
  const groupable = real.filter((f) => ["choice", "reference", "boolean", "date", "datetime", "text"].includes(f.field_type));
  const numeric = fields.filter((f) => ["number", "money"].includes(f.field_type));
  const dates = real.filter((f) => ["date", "datetime"].includes(f.field_type));
  const choices = real.filter((f) => f.field_type === "choice" && f.is_editable);
  const gf = fields.find((f) => f.field_key === d.group_by);
  const grouped = ["bar", "pie"].includes(d.widget_type) || (d.widget_type === "table" && !!d.group_by);
  const rowsMode = d.widget_type === "list" || (d.widget_type === "table" && !d.group_by);
  const phonePaths = phoneOptions(catalog, real, d.object_name);

  const setType = (t: WidgetType) => {
    const [w, h] = DEFAULT_SIZE[t];
    set({
      widget_type: t,
      width: widget ? d.width : w,
      height: widget ? d.height : h,
      group_by: ["bar", "pie"].includes(t) ? d.group_by ?? groupable[0]?.field_key ?? null : t === "table" ? d.group_by : null,
      object_name: t === "text" ? null : d.object_name ?? "service_requests",
    });
  };
  const setObject = (o: string) =>
    set({ object_name: o, filters: { match: "all", rules: [] }, group_by: ["bar", "pie"].includes(d.widget_type) ? null : null,
          aggregate: "count", aggregate_field: null, sort: null, config: d.widget_type === "text" ? d.config : {} });

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

  return (
    <Modal title={widget ? "עריכת ווידג'ט" : "ווידג'ט חדש"} onClose={onClose} wide>
      <form className="wb" onSubmit={save} noValidate>
        <div className="wb-form">
          <div className="segmented wb-types" role="radiogroup" aria-label="סוג הווידג'ט">
            {(Object.keys(WIDGET_TYPE_LABELS) as WidgetType[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={d.widget_type === t} className={d.widget_type === t ? "on" : ""} onClick={() => setType(t)}>
                {WIDGET_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {d.widget_type === "text" ? (
            <>
              <label className="field"><span>כותרת (לא חובה)</span><input value={d.title} onChange={(e) => set({ title: e.target.value })} /></label>
              <label className="field"><span>טקסט</span><input value={d.config.text ?? ""} onChange={(e) => setCfg({ text: e.target.value })} placeholder="למשל: {{greeting}}, {{first_name}}" /></label>
              <label className="field"><span>טקסט משני</span><input value={d.config.subtext ?? ""} onChange={(e) => setCfg({ subtext: e.target.value })} placeholder="למשל: {{today_long}}" /></label>
              <label className="check-field"><input type="checkbox" checked={d.config.size === "title"} onChange={(e) => setCfg({ size: e.target.checked ? "title" : "normal" })} /><span>כותרת גדולה</span></label>
              <p className="muted">אפשר להשתמש ב-{"{{greeting}}"} (ברכה לפי השעה), {"{{first_name}}"}, {"{{user_name}}"} ו-{"{{today_long}}"}.</p>
            </>
          ) : (
            <>
              <div className="wb-grid">
                <label className="field"><span>כותרת *</span><input value={d.title} onChange={(e) => set({ title: e.target.value })} autoFocus={!widget} /></label>
                <label className="field">
                  <span>אובייקט</span>
                  <select value={d.object_name ?? ""} onChange={(e) => setObject(e.target.value)}>
                    {OBJECTS.map((k) => objectByKey(catalog, k)).filter(Boolean).map((o) => <option key={o!.object_key} value={o!.object_key}>{o!.label_plural}</option>)}
                  </select>
                </label>
              </div>

              <div className="wb-section">
                <h3>אילו רשומות</h3>
                <FilterPanel
                  fields={fields}
                  catalog={catalog}
                  state={toViewState(d.filters)}
                  onChange={(p) => set({ filters: fromViewState({ ...toViewState(d.filters), ...p }) })}
                  allowRelative
                />
              </div>

              {(grouped || d.widget_type === "table") && (
                <div className="wb-grid">
                  <label className="field">
                    <span>קיבוץ לפי</span>
                    <select value={d.group_by ?? ""} onChange={(e) => set({ group_by: e.target.value || null, date_group: "none", config: { ...d.config, split_by: undefined } })}>
                      {d.widget_type === "table" && <option value="">בלי קיבוץ (רשומות)</option>}
                      {groupable.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                    </select>
                  </label>
                  {gf && ["date", "datetime"].includes(gf.field_type) && (
                    <label className="field">
                      <span>קיבוץ תאריכים</span>
                      <select value={d.date_group} onChange={(e) => set({ date_group: e.target.value as DateGroup })}>
                        {(Object.keys(DATE_GROUP_LABELS) as DateGroup[]).map((g) => <option key={g} value={g}>{DATE_GROUP_LABELS[g]}</option>)}
                      </select>
                    </label>
                  )}
                  {d.widget_type === "table" && d.group_by && (
                    <label className="field">
                      <span>פיצול לעמודות לפי</span>
                      <select value={d.config.split_by ?? ""} onChange={(e) => setCfg({ split_by: e.target.value || undefined })}>
                        <option value="">בלי פיצול</option>
                        {groupable.filter((f) => f.field_key !== d.group_by && !["date", "datetime"].includes(f.field_type)).map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {(d.widget_type === "metric" || grouped) && (
                <div className="wb-grid">
                  <label className="field">
                    <span>מה מחשבים</span>
                    <select value={d.aggregate} onChange={(e) => set({ aggregate: e.target.value as Aggregate, aggregate_field: null })}>
                      {(Object.keys(AGGREGATE_LABELS) as Aggregate[]).map((a) => <option key={a} value={a}>{AGGREGATE_LABELS[a]}</option>)}
                    </select>
                  </label>
                  {["sum", "avg", "min", "max"].includes(d.aggregate) && (
                    <label className="field">
                      <span>על איזה שדה</span>
                      <select value={d.aggregate_field ?? ""} onChange={(e) => set({ aggregate_field: e.target.value || null })}>
                        <option value="">בחרי…</option>
                        {numeric.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {d.aggregate === "percent" && (d.widget_type === "metric" || grouped) && (
                <div className="wb-section">
                  <h3>אחוז הרשומות ש…</h3>
                  <FilterPanel
                    fields={fields}
                    catalog={catalog}
                    state={toViewState(d.config.percent_where ?? { match: "all", rules: [] })}
                    onChange={(p) => setCfg({ percent_where: fromViewState({ ...toViewState(d.config.percent_where ?? { match: "all", rules: [] }), ...p }) })}
                    allowRelative
                  />
                </div>
              )}

              {d.widget_type === "metric" && (
                <div className="wb-grid">
                  <label className="field">
                    <span>השוואה לתקופה קודמת לפי</span>
                    <select value={d.config.compare?.field ?? ""} onChange={(e) => setCfg({ compare: e.target.value ? { field: e.target.value, days: d.config.compare?.days ?? 7 } : undefined })}>
                      <option value="">בלי השוואה</option>
                      {dates.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
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
                  <label className="check-field"><input type="checkbox" checked={d.config.tone === "danger"} onChange={(e) => setCfg({ tone: e.target.checked ? "danger" : undefined })} /><span>אדום כשיש ערך</span></label>
                </div>
              )}

              {rowsMode && (
                <div className="wb-section">
                  <h3>שדות להצגה</h3>
                  <div className="check-list">
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
                </div>
              )}

              <div className="wb-grid">
                {rowsMode ? (
                  <label className="field">
                    <span>מיון לפי</span>
                    <select value={d.sort ?? ""} onChange={(e) => set({ sort: e.target.value || null })}>
                      <option value="">תאריך יצירה (החדשות קודם)</option>
                      {real.map((f) => [
                        <option key={f.field_key} value={f.field_key}>{f.label} (עולה)</option>,
                        <option key={`${f.field_key}:desc`} value={`${f.field_key}:desc`}>{f.label} (יורד)</option>,
                      ])}
                    </select>
                  </label>
                ) : grouped ? (
                  <label className="field">
                    <span>מיון</span>
                    <select value={d.sort ?? ""} onChange={(e) => set({ sort: e.target.value || null })}>
                      <option value="">ברירת מחדל</option>
                      <option value="value_desc">מהגדול לקטן</option>
                      <option value="value_asc">מהקטן לגדול</option>
                      <option value="label_asc">לפי הקבוצה</option>
                    </select>
                  </label>
                ) : null}
                {d.widget_type !== "metric" && (
                  <label className="field">
                    <span>כמה להציג</span>
                    <input type="number" min={1} max={500} dir="ltr" value={d.limit ?? ""} onChange={(e) => set({ limit: e.target.value ? Number(e.target.value) : null })} placeholder="50" />
                  </label>
                )}
                {dates.length > 0 && (
                  <label className="field">
                    <span>שדה התאריך לסינון הלוח</span>
                    <select value={d.config.date_field ?? ""} onChange={(e) => setCfg({ date_field: e.target.value || undefined })}>
                      <option value="">ברירת מחדל ({dates[0].label})</option>
                      {dates.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                    </select>
                  </label>
                )}
              </div>

              {d.widget_type === "list" && (
                <div className="wb-grid">
                  {choices.length > 0 && (
                    <label className="field">
                      <span>שינוי בלחיצה בשדה</span>
                      <select value={d.config.inline_status ?? ""} onChange={(e) => setCfg({ inline_status: e.target.value || undefined })}>
                        <option value="">בלי</option>
                        {choices.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                      </select>
                    </label>
                  )}
                  {phonePaths.length > 0 && (
                    <label className="field">
                      <span>כפתור וואטסאפ לטלפון</span>
                      <select value={d.config.whatsapp?.phone ?? ""} onChange={(e) => setCfg({ whatsapp: e.target.value ? { phone: e.target.value, template: d.config.whatsapp?.template ?? "" } : undefined })}>
                        <option value="">בלי</option>
                        {phonePaths.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </label>
                  )}
                  {d.config.whatsapp && (
                    <label className="field wb-full">
                      <span>הודעה מוכנה</span>
                      <input value={d.config.whatsapp.template} onChange={(e) => setCfg({ whatsapp: { ...d.config.whatsapp!, template: e.target.value } })} placeholder="היי {{client_id:label}}, תזכורת לתור שלך ב-{{starts_at:time}}" />
                    </label>
                  )}
                  <label className="field wb-full">
                    <span>טקסט כשאין רשומות</span>
                    <input value={d.config.empty ?? ""} onChange={(e) => setCfg({ empty: e.target.value || undefined })} placeholder="אין רשומות" />
                  </label>
                </div>
              )}
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

// טלפונים לכפתור וואטסאפ: שדה טלפון ברשומה, או בטלפון של רשומה מקושרת (למשל client_id.phone)
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
