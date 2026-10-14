"use client";
// גרפים ב-SVG, בלי ספריות. כל הגדלים, הצירים והצבעים נגזרים מהתוצאות (אין ערכים קשיחים בנתונים).
// עמודות אופקיות: התווית מימין והעמודה נמשכת שמאלה, כך שהקריאה מימין לשמאל טבעית בעברית.

import { CHART_COLORS } from "@/lib/dashboards";

export type Datum = { key: string | null; label: string; value: number };

const fmt = (v: number, suffix = "") => `${Number.isInteger(v) ? v.toLocaleString("he-IL") : v.toLocaleString("he-IL", { maximumFractionDigits: 1 })}${suffix}`;

// כל שורה היא כפתור בגובה קבוע (בנייד 44px לפחות, לפי האפיון), כדי שאזור הלחיצה לא יקטן כשהגרף מתכווץ
// variant "gradient": כל העמודות בצבע אחד מדורג, והערך צמוד לסוף העמודה. format: למשל כסף (₪)
export function BarChart({ data, suffix, onPick, variant, format }: {
  data: Datum[]; suffix?: string; onPick?: (d: Datum) => void; variant?: "gradient"; format?: (v: number) => string;
}) {
  if (data.length === 0) return <p className="muted widget-empty">אין נתונים</p>;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const show = (v: number) => (format ? format(v) : fmt(v, suffix));
  const gradient = variant === "gradient";
  return (
    <div className={`hbar-chart${gradient ? " hbar-gradient" : ""}`} role="list" aria-label="גרף עמודות">
      {data.map((d, i) => {
        // בעמודה מדורגת הערך יושב בתוך המסלול, ולכן העמודה הארוכה משאירה לו מקום
        const pct = d.value > 0 ? Math.max((d.value / max) * (gradient ? 82 : 100), 1) : 0;
        const value = <span className="hbar-value" dir="ltr">{show(d.value)}</span>;
        const inner = (
          <>
            <span className="hbar-label">{d.label}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${pct}%`, background: gradient ? undefined : CHART_COLORS[i % CHART_COLORS.length] }} />
              {gradient && value}
            </span>
            {!gradient && value}
          </>
        );
        const title = `${d.label}: ${show(d.value)}`;
        return onPick ? (
          <button key={d.key ?? `null-${i}`} type="button" role="listitem" className="hbar-row chart-hit" title={title} onClick={(e) => { e.stopPropagation(); onPick(d); }}>
            {inner}
          </button>
        ) : (
          <div key={d.key ?? `null-${i}`} role="listitem" className="hbar-row" title={title}>{inner}</div>
        );
      })}
    </div>
  );
}

// טבעת: הסה"כ במרכז (ומתחתיו שינוי לעומת התקופה הקודמת, אם יש), ובמקרא כל קבוצה עם הערך והאחוז.
// colorOf: צבע קבוע לקבוצה (למשל סטטוס), אחרת צבעי הגרפים לפי הסדר. format: למשל כסף (₪)
export function DonutChart({ data, onPick, format, colorOf, change }: {
  data: Datum[];
  onPick?: (d: Datum) => void;
  format?: (v: number) => string;
  colorOf?: (d: Datum) => string | undefined;
  change?: { pct: number | null; label: string };
}) {
  const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0);
  if (data.length === 0 || total === 0) return <p className="muted widget-empty">אין נתונים</p>;
  const show = (v: number) => (format ? format(v) : fmt(v));
  const color = (d: Datum, i: number) => colorOf?.(d) ?? CHART_COLORS[i % CHART_COLORS.length];
  const totalText = show(total);
  const r = 60;
  const stroke = 26;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" className="donut-svg" role="img" aria-label="גרף טבעת">
        <g transform="rotate(-90 80 80)">
          {data.map((d, i) => {
            const len = (Math.max(d.value, 0) / total) * c;
            const seg = (
              <circle
                key={d.key ?? `null-${i}`}
                cx={80} cy={80} r={r} fill="none"
                stroke={color(d, i)}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                className={onPick ? "chart-hit" : undefined}
                onClick={onPick ? (e) => { e.stopPropagation(); onPick(d); } : undefined}
              >
                <title>{`${d.label}: ${show(d.value)} (${Math.round((d.value / total) * 100)}%)`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
        </g>
        <text x={80} y={change ? 74 : 76} textAnchor="middle" className={`donut-total${totalText.length > 7 ? " long" : ""}`}>{totalText}</text>
        {change ? (
          <>
            <text x={80} y={93} textAnchor="middle" className={`donut-change${change.pct === null ? "" : change.pct > 0 ? " up" : change.pct < 0 ? " down" : ""}`}>
              {change.pct === null ? "—" : `${change.pct > 0 ? "▲" : change.pct < 0 ? "▼" : "•"} ${Math.abs(change.pct)}%`}
            </text>
            <text x={80} y={107} textAnchor="middle" className="donut-caption small">{change.label}</text>
          </>
        ) : (
          <text x={80} y={96} textAnchor="middle" className="donut-caption">סה״כ</text>
        )}
      </svg>
      <ul className="legend">
        {data.map((d, i) => (
          <li key={d.key ?? `null-${i}`}>
            <button type="button" className="legend-item" onClick={onPick ? (e) => { e.stopPropagation(); onPick(d); } : undefined} disabled={!onPick}>
              <span className="legend-dot" style={{ background: color(d, i) }} />
              <span className="legend-label">{d.label}</span>
              <span className="legend-value" dir="ltr">{show(d.value)}</span>
              <span className="legend-pct">({Math.round((d.value / total) * 100)}%)</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
