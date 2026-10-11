"use client";
// בחירת עמודות: אילו מוצגות ובאיזה סדר

import type { FieldMeta, ViewState } from "@/lib/views";

export default function ColumnsPanel({
  fields, state, onChange,
}: {
  fields: FieldMeta[];
  state: ViewState;
  onChange: (patch: Partial<ViewState>) => void;
}) {
  const byKey = new Map(fields.map((f) => [f.field_key, f]));
  const cols = state.columns.filter((c) => byKey.has(c.field));

  const moveBy = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ columns: next });
  };

  return (
    <div className="card panel">
      <ul className="col-list">
        {cols.map((c, i) => (
          <li key={c.field}>
            <label>
              <input
                type="checkbox"
                checked={c.visible}
                onChange={() => onChange({ columns: cols.map((x) => (x.field === c.field ? { ...x, visible: !x.visible } : x)) })}
              />
              {byKey.get(c.field)!.label}
            </label>
            <span className="col-move">
              <button type="button" className="icon-btn" aria-label="הזזה למעלה" disabled={i === 0} onClick={() => moveBy(i, -1)}>↑</button>
              <button type="button" className="icon-btn" aria-label="הזזה למטה" disabled={i === cols.length - 1} onClick={() => moveBy(i, 1)}>↓</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
