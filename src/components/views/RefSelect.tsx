"use client";
// בחירה של רשומה מקושרת לפי השם שלה, לא לפי המזהה.
// שדה חיפוש: מקלידים חלק מהשם (או מהטלפון, באובייקט שיש לו טלפון) והרשימה מסתננת.
// מקלדת: חיצים למעלה ולמטה, Enter בוחר, Esc סוגר את הרשימה בלי לסגור את החלון.

import { useEffect, useState } from "react";
import type { Catalog, FieldMeta, RefOption } from "@/lib/views";
import { loadRefOptions } from "@/lib/views";
import { formatPhone } from "@/lib/format";

const MAX_SHOWN = 50;

export default function RefSelect({
  field, catalog, value, onChange, required, id,
}: {
  field: FieldMeta;
  catalog: Catalog;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  id?: string;
}) {
  const ref = catalog.objects.find((o) => o.id === field.ref_object_id)!;
  const [opts, setOpts] = useState<RefOption[] | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = `${id ?? field.field_key}-options`;

  useEffect(() => {
    loadRefOptions(ref, catalog).then(setOpts).catch(() => setOpts([]));
  }, [ref, catalog]);

  // כשלא מקלידים, בשדה מופיע השם של הרשומה שנבחרה
  const selected = opts?.find((o) => o.value === value);
  useEffect(() => {
    if (!open) setText(selected?.label ?? "");
  }, [open, selected?.label]);

  const q = text.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const matches = (opts ?? [])
    .filter((o) => !q || o.label.toLowerCase().includes(q) || (digits.length >= 2 && !!o.phone?.includes(digits)))
    .slice(0, MAX_SHOWN);

  const pick = (o: RefOption) => {
    if (o.inactive && o.value !== value) return;
    onChange(o.value);
    setText(o.label);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault(); // בוחר מהרשימה במקום לשלוח את הטופס
      pick(matches[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation(); // סוגר רק את הרשימה, לא את החלון
      setOpen(false);
    }
  };

  return (
    <div className="combo">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={field.label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        required={required}
        placeholder={opts ? "הקלידי לחיפוש…" : "טוען…"}
        value={text}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (!e.target.value) onChange(""); // מחיקת הטקסט מנקה את הבחירה
        }}
        onKeyDown={onKeyDown}
      />
      {open && opts && (
        <ul id={listId} role="listbox" className="combo-list">
          {matches.length === 0 ? (
            <li className="combo-empty">לא נמצאו תוצאות</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.inactive && o.value !== value}
                className={i === active ? "active" : undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // השדה נשאר בפוקוס עד שהבחירה נקלטת
                  pick(o);
                }}
              >
                <span>
                  {o.label}
                  {o.inactive ? " (מושבתת)" : ""}
                </span>
                {o.phone && <span className="muted" dir="ltr">{formatPhone(o.phone)}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
