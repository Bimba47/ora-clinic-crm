"use client";
// תצוגת רשימה: טבלה עם העמודות שנבחרו, מיון בלחיצה על כותרת, שינוי רוחב בגרירה,
// לחיצה על שורה לעריכה, בחירה מרובה בתיבות סימון, מונה תוצאות ועימוד. בנייד השורות הופכות לכרטיסים.

import { useRef } from "react";
import Link from "next/link";
import type { FieldMeta, Row, ViewState } from "@/lib/views";
import { formatValue, isLtr } from "@/lib/format";

// עמודה של תגיות (סטטוס, מקור, נקראה) ממורכזת
const isTag = (f: FieldMeta) => f.field_type === "choice" || f.field_type === "boolean";

type Props = {
  fields: FieldMeta[];
  state: ViewState;
  data: { total: number; rows: Row[] } | null;
  loading: boolean;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  selected: Set<string>;
  onSelect: (s: Set<string>) => void;
  onChange: (patch: Partial<ViewState>, opts?: { debounce?: boolean }) => void;
  onOpen: (row: Row) => void;
  refHref: (field: FieldMeta, row: Row) => string | null;
  emptyAction?: () => void;
  emptyLabel: string;
};

export default function ListView({
  fields, state, data, loading, page, pageSize, onPage, selected, onSelect, onChange, onOpen, refHref, emptyAction, emptyLabel,
}: Props) {
  const byKey = new Map(fields.map((f) => [f.field_key, f]));
  const cols = state.columns.filter((c) => c.visible && byKey.has(c.field));
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  // מיון בלחיצה: עולה, יורד, בלי מיון
  const toggleSort = (field: string) => {
    const cur = state.sorts[0]?.field === field ? state.sorts[0].dir : null;
    const next = cur === null ? [{ field, dir: "asc" as const }] : cur === "asc" ? [{ field, dir: "desc" as const }] : [];
    onChange({ sorts: next });
  };

  // שינוי רוחב בגרירה. בעברית קצה העמודה בצד שמאל, ולכן גרירה שמאלה מרחיבה.
  const drag = useRef<{ field: string; startX: number; startW: number } | null>(null);
  const startResize = (e: React.PointerEvent, field: string, width: number) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { field, startX: e.clientX, startW: width };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      const dir = document.documentElement.dir === "rtl" ? -1 : 1;
      const w = Math.max(60, Math.min(800, drag.current.startW + dir * (ev.clientX - drag.current.startX)));
      onChange(
        { columns: state.columns.map((c) => (c.field === drag.current!.field ? { ...c, width: Math.round(w) } : c)) },
        { debounce: true },
      );
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggleRow = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    onSelect(s);
  };
  const toggleAll = () => {
    const s = new Set(selected);
    rows.forEach((r) => (allOnPage ? s.delete(r.id) : s.add(r.id)));
    onSelect(s);
  };

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="card list-card">
      <div className="table-scroll">
        <table className="data-table">
          <colgroup>
            <col style={{ width: 48 }} />
            {cols.map((c) => (
              <col key={c.field} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="check-col">
                <input type="checkbox" aria-label="בחירת כל השורות בעמוד" checked={allOnPage} onChange={toggleAll} />
              </th>
              {cols.map((c) => {
                const f = byKey.get(c.field)!;
                const sort = state.sorts[0]?.field === c.field ? state.sorts[0].dir : null;
                return (
                  <th key={c.field} className={isTag(f) ? "center" : undefined} aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : "none"}>
                    <button type="button" className="th-btn" onClick={() => toggleSort(c.field)}>
                      {f.label}
                      <span className="sort-mark" aria-hidden="true">{sort === "asc" ? "▲" : sort === "desc" ? "▼" : ""}</span>
                    </button>
                    <span
                      className="resize-handle"
                      role="separator"
                      aria-label={`שינוי רוחב ${f.label}`}
                      onPointerDown={(e) => startResize(e, c.field, c.width)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && !data
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={cols.length + 1}><div className="skeleton" style={{ height: 20 }} /></td>
                  </tr>
                ))
              : rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`row-link${selected.has(r.id) ? " selected" : ""}`}
                    tabIndex={0}
                    onClick={() => onOpen(r)}
                    onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(r)}
                  >
                    {/* תיבת הסימון לבחירה מרובה בלבד: לחיצה עליה לא פותחת את הרשומה */}
                    <td className="check-col" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="בחירת השורה" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                    </td>
                    {cols.map((c) => {
                      const f = byKey.get(c.field)!;
                      const text = formatValue(f, r);
                      const href = text ? refHref(f, r) : null;
                      return (
                        <td key={c.field} className={isTag(f) ? "center" : undefined} data-label={f.label} title={text}>
                          {href ? (
                            <Link href={href} className="ref-link" onClick={(e) => e.stopPropagation()}>{text}</Link>
                          ) : f.field_type === "choice" || f.field_type === "boolean" ? (
                            text && <span className={`tag tag-${String(r[f.field_key])}`}>{text}</span>
                          ) : (
                            <span dir={isLtr(f) ? "ltr" : undefined}>{text}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {!loading && total === 0 && (
        <div className="empty">
          <p>לא נמצאו רשומות.</p>
          {emptyAction && (
            <button type="button" className="btn" onClick={emptyAction}>הוספת {emptyLabel}</button>
          )}
        </div>
      )}

      <div className="pager">
        <span className="muted">{total === 0 ? "0 תוצאות" : `מציג ${from}-${to} מתוך ${total}`}</span>
        <div className="pager-btns">
          <button type="button" className="btn" disabled={page === 0} onClick={() => onPage(page - 1)}>הקודם</button>
          <span className="muted">עמוד {page + 1} מתוך {pages}</span>
          <button type="button" className="btn" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>הבא</button>
        </div>
      </div>
    </div>
  );
}
