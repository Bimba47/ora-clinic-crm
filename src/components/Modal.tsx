"use client";
// חלון מודאל. Esc סוגר, ולחיצה מחוץ לחלון סוגרת.

import { useEffect } from "react";

export default function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="סגירה" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// שאלת אישור לפני מחיקה או ביטול
export function Confirm({
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="אישור" onClose={onClose}>
      <p>{text}</p>
      <div className="modal-actions">
        <button type="button" className="btn primary" autoFocus onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className="btn" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}
