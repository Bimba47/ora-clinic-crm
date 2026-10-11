"use client";
// בחירה של רשומה מקושרת לפי השם שלה, לא לפי המזהה

import { useEffect, useState } from "react";
import type { Catalog, FieldMeta } from "@/lib/views";
import { loadRefOptions } from "@/lib/views";

const cache = new Map<string, Promise<{ value: string; label: string; inactive: boolean }[]>>();

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
  const hasIsActive = catalog.fields.some((f) => f.object_id === ref.id && f.field_key === "is_active");
  const [opts, setOpts] = useState<{ value: string; label: string; inactive: boolean }[] | null>(null);

  useEffect(() => {
    if (!cache.has(ref.object_key)) cache.set(ref.object_key, loadRefOptions(ref, hasIsActive));
    cache.get(ref.object_key)!.then(setOpts).catch(() => setOpts([]));
  }, [ref, hasIsActive]);

  return (
    <select id={id} aria-label={field.label} required={required} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{opts ? "בחרי…" : "טוען…"}</option>
      {opts?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.inactive && o.value !== value}>
          {o.label}
          {o.inactive ? " (מושבתת)" : ""}
        </option>
      ))}
    </select>
  );
}
