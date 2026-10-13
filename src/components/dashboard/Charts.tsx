"use client";
// גרפים ב-SVG, בלי ספריות. כל הגדלים, הצירים והצבעים נגזרים מהתוצאות (אין ערכים קשיחים בנתונים).
// עמודות אופקיות: התווית מימין והעמודה נמשכת שמאלה, כך שהקריאה מימין לשמאל טבעית בעברית.

import { CHART_COLORS } from "@/lib/dashboards";

export type Datum = { key: string | null; label: string; value: number };

const fmt = (v: number, suffix = "") => `${Number.isInteger(v) ? v.toLocaleString("he-IL") : v.toLocaleString("he-IL", { maximumFractionDigits: 1 })}${suffix}`;

export function BarChart({ data, suffix, onPick }: { data: Datum[]; suffix?: string; onPick?: (d: Datum) => void }) {
  if (data.length === 0) return <p className="muted widget-empty">אין נתונים</p>;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const rowH = 32;
  const labelW = 120;
  const valueW = 56;
  const width = 400;
  const barMax = width - labelW - valueW;
  const height = data.length * rowH;
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="גרף עמודות" preserveAspectRatio="xMidYMin meet">
      {data.map((d, i) => {
        const w = Math.max((d.value / max) * barMax, d.value > 0 ? 2 : 0);
        const y = i * rowH;
        return (
          <g
            key={d.key ?? `null-${i}`}
            className={onPick ? "chart-hit" : undefined}
            onClick={onPick ? (e) => { e.stopPropagation(); onPick(d); } : undefined}
            role={onPick ? "button" : undefined}
            tabIndex={onPick ? 0 : undefined}
            onKeyDown={onPick ? (e) => e.key === "Enter" && onPick(d) : undefined}
          >
            <title>{`${d.label}: ${fmt(d.value, suffix)}`}</title>
            {/* רקע השורה לאזור לחיצה נוח */}
            <rect x={0} y={y} width={width} height={rowH} fill="transparent" />
            <text x={width - 4} y={y + rowH / 2} textAnchor="start" dominantBaseline="middle" className="chart-label" direction="rtl">
              {d.label.length > 16 ? `${d.label.slice(0, 15)}…` : d.label}
            </text>
            <rect x={width - labelW - w} y={y + 7} width={w} height={rowH - 14} rx={(rowH - 14) / 2} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            <text x={width - labelW - w - 6} y={y + rowH / 2} textAnchor="end" dominantBaseline="middle" className="chart-value" direction="ltr">
              {fmt(d.value, suffix)}
            </text>
          </g>
        );
      })}
    </svg>
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
