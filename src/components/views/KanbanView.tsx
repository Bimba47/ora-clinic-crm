"use client";
// תצוגת קאנבן: עמודה לכל ערך של שדה הבחירה, מונה בכל עמודה, וגרירת כרטיס שמעדכנת את השדה.
// לחיצה על כרטיס פותחת את הרשומה (כרטיס לקוח או חלון עריכה), ושם לקוחה מקשר לכרטיס שלה.
// העדכון מופיע מיד, וחוזר אחורה עם הודעה אם המסד דחה אותו (למשל "בטיפול" בלי אחראית).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import type { FieldMeta, Row, ViewState } from "@/lib/views";
import { errorText, runView, runViewGroups, updateRecords } from "@/lib/views";
import { formatValue, isLtr } from "@/lib/format";

const MAX_CARDS = 500;

export default function KanbanView({
  objectKey, fields, state, search, refreshKey, onOpen, refHref,
}: {
  objectKey: string;
  fields: FieldMeta[];
  state: ViewState;
  search: string;
  refreshKey: number;
  onOpen: (row: Row) => void;
  refHref: (field: FieldMeta, row: Row) => string | null;
}) {
  const toast = useToast();
  const byKey = new Map(fields.map((f) => [f.field_key, f]));
  const group = state.kanban_field ? byKey.get(state.kanban_field) : undefined;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [over, setOver] = useState<string | null>(null);

  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    setRows(null);
    Promise.all([
      runView(objectKey, state, { search, limit: MAX_CARDS, extraFields: [group.field_key] }),
      runViewGroups(objectKey, state, group.field_key, search),
    ])
      .then(([d, c]) => {
        if (cancelled) return;
        setRows(d.rows);
        setCounts(c);
      })
      .catch((e) => !cancelled && toast(errorText(e), "err"));
    return () => {
      cancelled = true;
    };
  }, [objectKey, state, search, group, refreshKey, toast]);

  if (!group) return <div className="card empty"><p>בחרי שדה לקיבוץ.</p></div>;

  const cols = state.columns.filter((c) => c.visible && byKey.has(c.field) && c.field !== group.field_key);
  const lanes = [...(group.options ?? [])];
  if (counts[""]) lanes.push({ value: "", label: "ללא ערך" });
  const valueOf = (r: Row) => (r[group.field_key] === null || r[group.field_key] === undefined ? "" : String(r[group.field_key]));

  const move = async (id: string, to: string) => {
    if (!rows) return;
    const row = rows.find((r) => r.id === id);
    if (!row || valueOf(row) === to) return;
    const from = valueOf(row);
    const typed = group.field_type === "boolean" ? to === "true" : to || null;
    const prev = { rows, counts };
    setRows(rows.map((r) => (r.id === id ? { ...r, [group.field_key]: typed } : r)));
    setCounts({ ...counts, [from]: (counts[from] ?? 1) - 1, [to]: (counts[to] ?? 0) + 1 });
    try {
      const n = await updateRecords(objectKey, [id], { [group.field_key]: typed });
      if (n === 0) throw new Error("אין לך הרשאה לשנות את הרשומה הזו.");
      toast("עודכן");
    } catch (e) {
      setRows(prev.rows);
      setCounts(prev.counts);
      toast(errorText(e), "err");
    }
  };

  return (
    <div className="kanban" aria-busy={rows === null}>
      {lanes.map((lane) => {
        const items = (rows ?? []).filter((r) => valueOf(r) === lane.value);
        return (
          <section
            key={lane.value}
            className={`lane${over === lane.value ? " over" : ""}`}
            aria-label={lane.label}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(lane.value);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              move(e.dataTransfer.getData("text/plain"), lane.value);
            }}
          >
            <header className="lane-head">
              <span className={`tag tag-${lane.value} tag-${group.field_key}-${lane.value}`}>{lane.label}</span>
              <span className="count">{counts[lane.value] ?? 0}</span>
            </header>
            <div className="lane-body">
              {rows === null && <div className="skeleton" style={{ height: 72 }} />}
              {items.map((r) => (
                <article
                  key={r.id}
                  className="kcard row-link"
                  draggable
                  tabIndex={0}
                  onClick={() => onOpen(r)}
                  onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(r)}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
                >
                  {cols.map((c, i) => {
                    const f = byKey.get(c.field)!;
                    const text = formatValue(f, r);
                    if (!text) return null;
                    const href = refHref(f, r);
                    const value = href ? (
                      <Link href={href} className="ref-link" onClick={(e) => e.stopPropagation()}>{text}</Link>
                    ) : (
                      <span dir={isLtr(f) ? "ltr" : undefined}>{text}</span>
                    );
                    return i === 0 ? (
                      <strong key={c.field} className="kcard-title">{value}</strong>
                    ) : (
                      <div key={c.field} className="kcard-line">
                        <span className="muted">{f.label}: </span>
                        {value}
                      </div>
                    );
                  })}
                  {/* בנייד ובמקלדת: העברה בלי גרירה */}
                  <label className="kcard-move" onClick={(e) => e.stopPropagation()}>
                    <span className="sr-only">העברה ל</span>
                    <select value={lane.value} onChange={(e) => move(r.id, e.target.value)} aria-label="העברה לעמודה">
                      {(group.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
              {rows !== null && items.length === 0 && <p className="muted lane-empty">אין רשומות</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
