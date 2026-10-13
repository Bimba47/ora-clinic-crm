"use client";
// ווידג'ט אחד בלוח: מריץ את ההגדרה שלו (run_widget, תחת RLS) ומציג לפי הסוג.
// לחיצה על ווידג'ט פותחת את הרשימה המסוננת עם אותן רשומות, ולחיצה על עמודה מסננת לפי אותה קבוצה.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import { errorText, pickOptions, type Catalog, type FieldMeta } from "@/lib/views";
import { formatTime, formatValue, isLtr, whatsappHref } from "@/lib/format";
import { recordHref } from "@/lib/records";
import {
  greeting, objectByKey, openFiltered, runWidget, todayLong, widgetFields,
  type DashFilters, type Group, type Rule, type Widget, type WidgetResult,
} from "@/lib/dashboards";
import { BarChart, DonutChart, type Datum } from "./Charts";

export default function WidgetView({
  widget: w, catalog, dash, reloadToken = 0, preview, onCount,
}: {
  widget: Omit<Widget, "id" | "dashboard_id"> & { id?: string }; catalog: Catalog; dash: DashFilters; reloadToken?: number; preview?: boolean;
  onCount?: (n: number) => void; // כמה רשומות בתוצאה (לכותרת עם {{count}}, למשל "4 תורים מחר")
}) {
  const { userId, me } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [res, setRes] = useState<WidgetResult | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([w.widget_type, w.object_name, w.filters, w.group_by, w.date_group, w.aggregate, w.aggregate_field, w.sort, w.limit, w.config, dash]);

  useEffect(() => {
    let cancelled = false;
    setError("");
    const t = setTimeout(() => {
      runWidget(w, dash)
        .then((r) => {
          if (cancelled) return;
          setRes(r);
          if (r.kind === "rows") onCount?.(r.rows.length);
          else if (r.kind === "metric") onCount?.(Number(r.value));
        })
        .catch((e) => !cancelled && (setError(errorText(e)), setRes(null)));
    }, preview ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadToken, tick]);

  const fields = w.object_name ? widgetFields(catalog, w.object_name) : [];
  const fieldOf = (k: string | null | undefined) => fields.find((f) => f.field_key === k);
  const cfg = w.config ?? {};

  // לחיצה: הרשימה המסוננת (בתצוגה מקדימה לא עוברים מסך)
  const drill = async (extra: Rule[] = []) => {
    if (preview || !w.object_name) return;
    const href = await openFiltered(catalog, w.object_name, w.filters, extra, userId);
    if (href) router.push(href);
  };
  const groupRule = (d: Datum): Rule[] => {
    const gf = fieldOf(w.group_by);
    if (!gf || d.key === null) return [{ field: w.group_by!, op: "is_empty" }];
    if ((gf.field_type === "date" || gf.field_type === "datetime") && w.date_group !== "none") {
      const from = d.key;
      const end = new Date(`${from}T00:00:00Z`);
      if (w.date_group === "day") end.setUTCDate(end.getUTCDate());
      if (w.date_group === "week") end.setUTCDate(end.getUTCDate() + 6);
      if (w.date_group === "month") { end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(end.getUTCDate() - 1); }
      return [{ field: gf.field_key, op: "gte", value: from }, { field: gf.field_key, op: "lte", value: end.toISOString().slice(0, 10) }];
    }
    return [{ field: gf.field_key, op: "eq", value: d.key }];
  };

  // תווית של ערך קבוצה: שם רשומה מקושרת, תווית של ערך בחירה, או תאריך
  const groupLabel = (f: FieldMeta | undefined, key: string | null, label: string | null) => {
    if (key === null) return "ללא";
    if (!f) return label ?? key;
    if (f.field_type === "choice" || f.field_type === "boolean") return f.options?.find((o) => o.value === key)?.label ?? key;
    if ((f.field_type === "date" || f.field_type === "datetime") && w.date_group !== "none") {
      const d = new Date(`${key}T12:00:00Z`);
      return w.date_group === "month"
        ? new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d)
        : new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" }).format(d);
    }
    return label ?? key;
  };

  if (w.widget_type === "text") {
    const fill = (s?: string) =>
      (s ?? "")
        .replace(/\{\{\s*greeting\s*\}\}/g, greeting())
        .replace(/\{\{\s*first_name\s*\}\}/g, (me?.full_name ?? "").split(" ")[0])
        .replace(/\{\{\s*user_name\s*\}\}/g, me?.full_name ?? "")
        .replace(/\{\{\s*today_long\s*\}\}/g, todayLong());
    return (
      <div className={`widget-text${cfg.size === "title" ? " title" : ""}`}>
        <div className="widget-text-main">{fill(cfg.text) || <span className="muted">טקסט ריק</span>}</div>
        {cfg.subtext && <div className="widget-text-sub">{fill(cfg.subtext)}</div>}
      </div>
    );
  }

  if (error) return <p className="field-error widget-error">{error}</p>;
  if (!res) return <div className="skeleton widget-skeleton" aria-busy="true" />;

  if (res.kind === "metric") {
    const up = res.change !== undefined && res.change !== null && res.change > 0;
    const down = res.change !== undefined && res.change !== null && res.change < 0;
    return (
      <button type="button" className={`widget-metric${cfg.tone === "danger" && (res.value ?? 0) > 0 ? " danger" : ""}`} onClick={() => drill()} disabled={preview}>
        {/* ממוצע / מינימום / מקסימום / אחוז בלי נתונים: "—" ולא 0 */}
        {res.value === null || res.value === undefined
          ? <span className="metric-value metric-empty" title="אין נתונים">—</span>
          : <span className="metric-value" dir="ltr">{Number(res.value).toLocaleString("he-IL", { maximumFractionDigits: 1 })}{cfg.suffix ?? ""}</span>}
        {res.change !== undefined && (
          <span className={`metric-change${up ? " up" : down ? " down" : ""}`}>
            {res.change === null ? "אין נתונים לתקופה הקודמת" : `${up ? "▲" : down ? "▼" : "•"} ${Math.abs(res.change)}% לעומת ${res.days} הימים הקודמים`}
          </span>
        )}
        {cfg.hint && <span className="metric-hint">{cfg.hint}</span>}
      </button>
    );
  }

  if (res.kind === "groups") {
    const gf = fieldOf(w.group_by);
    const data: Datum[] = res.groups.map((g) => ({ key: g.key, label: groupLabel(gf, g.key, g.label), value: Number(g.value) }));
    if (w.widget_type === "pie") return <DonutChart data={data} onPick={preview ? undefined : (d) => drill(groupRule(d))} />;
    if (w.widget_type === "bar") return <BarChart data={data} suffix={cfg.suffix} onPick={preview ? undefined : (d) => drill(groupRule(d))} />;
    return (
      <table className="widget-table">
        <thead><tr><th>{gf?.label ?? ""}</th><th className="num">{valueTitle(w)}</th></tr></thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={d.key ?? `n${i}`} className="clickable" onClick={() => drill(groupRule(d))}>
              <td>{d.label}</td><td className="num" dir="ltr">{d.value.toLocaleString("he-IL")}{cfg.suffix ?? ""}</td>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={2} className="muted">אין נתונים</td></tr>}
        </tbody>
      </table>
    );
  }

  if (res.kind === "pivot") {
    const gf = fieldOf(w.group_by);
    const sf = fieldOf(cfg.split_by);
    const rows = uniq(res.groups.map((g) => g.key));
    const cols = uniq(res.groups.map((g) => g.split ?? null));
    // סדר העמודות לפי סדר האפשרויות בשדה (למשל חדשה, בטיפול)
    if (sf?.options) cols.sort((a, b) => sf.options!.findIndex((o) => o.value === a) - sf.options!.findIndex((o) => o.value === b));
    const cell = (r: string | null, c: string | null) => res.groups.find((g) => g.key === r && (g.split ?? null) === c)?.value ?? 0;
    const rowLabel = (r: string | null) => groupLabel(gf, r, res.groups.find((g) => g.key === r)?.label ?? null);
    const colLabel = (c: string | null) => groupLabel(sf, c, res.groups.find((g) => (g.split ?? null) === c)?.split_label ?? null);
    return (
      <table className="widget-table">
        <thead>
          <tr>
            <th>{gf?.label ?? ""}</th>
            {cols.map((c) => <th key={c ?? "n"} className="num">{colLabel(c)}</th>)}
            <th className="num">סה״כ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r ?? "n"} className="clickable" onClick={() => drill(groupRule({ key: r, label: "", value: 0 }))}>
              <td>{rowLabel(r)}</td>
              {cols.map((c) => (
                <td key={c ?? "n"} className="num">
                  <button
                    type="button"
                    className="cell-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      drill([...groupRule({ key: r, label: "", value: 0 }), c === null ? { field: cfg.split_by!, op: "is_empty" } : { field: cfg.split_by!, op: "eq", value: c }]);
                    }}
                  >
                    {Number(cell(r, c)).toLocaleString("he-IL")}
                  </button>
                </td>
              ))}
              <td className="num strong">{cols.reduce((s, c) => s + Number(cell(r, c)), 0).toLocaleString("he-IL")}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length + 2} className="muted">אין נתונים</td></tr>}
        </tbody>
      </table>
    );
  }

  if (res.kind === "rows") {
    const cols = res.columns.map((c) => fieldOf(c)).filter(Boolean) as FieldMeta[];
    const show = (f: FieldMeta, row: Record<string, unknown>) =>
      f.field_key === cfg.time_only && row[f.field_key] ? formatTime(String(row[f.field_key])) : formatValue(f, row as never);
    const statusField = fieldOf(cfg.inline_status);
    const setStatus = async (id: string, value: string) => {
      const { error } = await supabase.from(w.object_name!).update({ [cfg.inline_status!]: value }).eq("id", id);
      if (error) toast(errorText(error), "err");
      else {
        toast("הסטטוס עודכן");
        setTick((t) => t + 1);
      }
    };
    if (res.rows.length === 0) return <p className="muted widget-empty">{cfg.empty ?? "אין רשומות"}</p>;

    if (w.widget_type === "table") {
      return (
        <table className="widget-table">
          <thead><tr>{cols.map((f) => <th key={f.field_key}>{f.label}</th>)}</tr></thead>
          <tbody>
            {res.rows.map((row) => (
              <tr key={row.id} className="clickable" onClick={() => !preview && router.push(recordHref(w.object_name!, row.id) ?? "#")}>
                {cols.map((f) => <td key={f.field_key} dir={isLtr(f) ? "ltr" : undefined}>{show(f, row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    // רשימה קומפקטית: השדה הראשון מודגש, השאר בשורה משנית
    const [first, ...rest] = cols.filter((f) => f.field_key !== cfg.inline_status);
    return (
      <ul className="widget-list">
        {res.rows.map((row) => {
          const href = recordHref(w.object_name!, row.id);
          return (
            <li key={row.id}>
              <button type="button" className="widget-list-main" onClick={() => !preview && href && router.push(href)}>
                <span className="widget-list-title" dir={first && isLtr(first) ? "ltr" : undefined}>{first ? show(first, row) : ""}</span>
                <span className="widget-list-meta">
                  {rest.map((f) => show(f, row)).filter(Boolean).join(" · ")}
                </span>
              </button>
              {statusField && (
                <select
                  className={`status-select tag tag-${String(row[statusField.field_key])}`}
                  value={String(row[statusField.field_key] ?? "")}
                  onChange={(e) => setStatus(row.id, e.target.value)}
                  aria-label={statusField.label}
                  disabled={preview}
                >
                  {pickOptions(statusField.options, row[statusField.field_key]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {cfg.whatsapp && row.__phone && (
                <a
                  className="btn outline wa-btn"
                  href={`${whatsappHref(String(row.__phone))}?text=${encodeURIComponent(String(row.__message ?? ""))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  וואטסאפ
                </a>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return null;
}

function uniq<T>(xs: T[]): T[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}

function valueTitle(w: Omit<Widget, "id" | "dashboard_id">) {
  return w.aggregate === "count" ? "כמות" : w.aggregate === "percent" ? "אחוז" : w.aggregate === "sum" ? "סכום" : w.aggregate === "avg" ? "ממוצע" : w.aggregate === "min" ? "מינימום" : "מקסימום";
}

export type { Group };
export { objectByKey };
