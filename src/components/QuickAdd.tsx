"use client";
// כפתור "+" צף בכל מסך: לקוחה, תור או קריאה חדשים. מוצגות רק האפשרויות שמותר לתפקיד ליצור.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./Auth";

const ITEMS = [
  { object: "clients", label: "לקוחה חדשה", href: "/clients/new" },
  { object: "appointments", label: "תור חדש", href: "/appointments/new" },
  { object: "service_requests", label: "קריאה חדשה", href: "/requests/new" },
];

export default function QuickAdd() {
  const { can } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items = ITEMS.filter((i) => can(i.object, "create"));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // במסך יצירה הכפתור רק מסתיר את הטופס
  if (items.length === 0 || pathname.endsWith("/new")) return null;

  return (
    <div className="quick-add" ref={ref}>
      {open && (
        <div className="quick-add-menu" role="menu">
          {items.map((i) => (
            <Link key={i.href} href={i.href} role="menuitem" className="quick-add-item">{i.label}</Link>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`quick-add-btn${open ? " open" : ""}`}
        aria-label={open ? "סגירה" : "יצירה מהירה"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
