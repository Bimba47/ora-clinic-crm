"use client";
// גרפים ב-SVG, בלי ספריות. כל הגדלים, הצירים והצבעים נגזרים מהתוצאות (אין ערכים קשיחים בנתונים).
// עמודות אופקיות: התווית מימין והעמודה נמשכת שמאלה, כך שהקריאה מימין לשמאל טבעית בעברית.

import { CHART_COLORS } from "@/lib/dashboards";

export type Datum = { key: string | null; label: string; value: number };

const fmt = (v: number, suffix = "") => `${Number.isInteger(v) ? v.toLocaleString("he-IL") : v.toLocaleString("he-IL", { maximumFractionDigits: 1 })}${suffix}`;

// כל שורה היא כפתור בגובה קבוע (בנייד 44px לפחות, לפי האפיון), כדי שאזור הלחיצה לא יקטן כשהגרף מתכווץ
export function BarChart({ data, suffix, onPick }: { data: Datum[]; suffix?: string; onPick?: (d: Datum) => void }) {
  if (data.length === 0) return <p className="muted widget-empty">אין נתונים</p>;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  return (
    <div className="hbar-chart" role="list" aria-label="גרף עמודות">
      {data.map((d, i) => {
        const pct = d.value > 0 ? Math.max((d.value / max) * 100, 1) : 0;
        const inner = (
          <>
            <span className="hbar-label">{d.label}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
            </span>
            <span className="hbar-value" dir="ltr">{fmt(d.value, suffix)}</span>
          </>
        );
        const title = `${d.label}: ${fmt(d.value, suffix)}`;
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

export function DonutChart({ data, onPick }: { data: Datum[]; onPick?: (d: Datum) => void }) {
  const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0);
  if (data.length === 0 || total === 0) return <p className="muted widget-empty">אין נתונים</p>;
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
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                className={onPick ? "chart-hit" : undefined}
                onClick={onPick ? (e) => { e.stopPropagation(); onPick(d); } : undefined}
              >
                <title>{`${d.label}: ${fmt(d.value)} (${Math.round((d.value / total) * 100)}%)`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
        </g>
        <text x={80} y={76} textAnchor="middle" className="donut-total">{fmt(total)}</text>
        <text x={80} y={96} textAnchor="middle" className="donut-caption">סה״כ</text>
      </svg>
      <ul className="legend">
        {data.map((d, i) => (
          <li key={d.key ?? `null-${i}`}>
            <button type="button" className="legend-item" onClick={onPick ? (e) => { e.stopPropagation(); onPick(d); } : undefined} disabled={!onPick}>
              <span className="legend-dot" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="legend-label">{d.label}</span>
              <span className="legend-pct">{Math.round((d.value / total) * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
