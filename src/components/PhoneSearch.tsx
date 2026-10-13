"use client";
// חיפוש לפי טלפון בכותרת העליונה, בכל מסך: גם חלק מהמספר (או שם). מקפים, רווחים ו-+972 מנורמלים במסד.
// תוצאה אחת או כמה – לחיצה (או Enter) פותחת את כרטיס הלקוחה. בלי תוצאה – "צרי לקוחה חדשה" עם הטלפון כבר ממולא.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Icon from "./Icon";
import { formatPhone } from "@/lib/format";

type Hit = { id: string; full_name: string; phone: string };

export default function PhoneSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const digits = q.replace(/\D/g, "");
  const isPhone = /^[\d\s\-+()]+$/.test(q.trim());
  const ready = isPhone ? digits.length >= 3 : q.trim().length >= 2;

  // חיפוש אחרי הפסקה קצרה בהקלדה
  useEffect(() => {
    if (!ready) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("run_view", {
        p_object: "clients",
        p_def: { columns: ["full_name", "phone"], filters: [], match: "all", sorts: [{ field: "full_name", dir: "asc" }] },
        p_search: q.trim(),
        p_limit: 8,
        p_offset: 0,
      });
      if (cancelled) return;
      setHits(((data as { rows: Hit[] } | null)?.rows ?? []) as Hit[]);
      setActive(0);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, ready]);

  // מעבר מסך סוגר ומנקה את החיפוש
  useEffect(() => {
    setOpen(false);
    setQ("");
  }, [pathname]);

  // לחיצה מחוץ לחיפוש סוגרת את הרשימה
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (h: Hit) => {
    setOpen(false);
    router.push(`/clients/${h.id}`);
  };
  const newHref = isPhone ? `/clients/new?phone=${encodeURIComponent(digits)}` : `/clients/new?full_name=${encodeURIComponent(q.trim())}`;

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!hits) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) go(hits[active]);
      else if (ready) router.push(newHref);
    }
  };

  return (
    <div className="phone-search" ref={boxRef}>
      <label className="search">
        <Icon name="search" />
        <input
          type="search"
          inputMode="tel"
          aria-label="חיפוש לקוחה לפי טלפון"
          placeholder="054-1234567"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded={open && !!hits}
          aria-controls="phone-search-results"
          aria-autocomplete="list"
        />
      </label>
      {open && ready && hits && (
        <div className="search-results card" id="phone-search-results" role="listbox">
          {hits.length === 0 ? (
            <div className="search-empty">
              <p>{isPhone ? "לא נמצאה לקוחה עם הטלפון הזה" : "לא נמצאה לקוחה בשם הזה"}</p>
              <Link href={newHref} className="btn primary">צרי לקוחה חדשה</Link>
            </div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`search-hit${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
              >
                <span className="search-hit-name">{h.full_name}</span>
                <span className="search-hit-phone" dir="ltr">{formatPhone(h.phone)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
