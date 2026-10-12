"use client";
// קבלת הזמנה: המשתמשת מגיעה לכאן מהקישור במייל ההזמנה. Supabase מחבר אותה לפי הקישור,
// והיא בוחרת סיסמה. מכאן והלאה היא נכנסת רגיל במסך הכניסה.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Brand } from "@/components/Settings";
import { useAuth } from "@/components/Auth";

export default function AcceptInvitePage() {
  const router = useRouter();
  const { ready, userId, me, landingPath } = useAuth();
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 8) return setError("הסיסמה צריכה להיות באורך 8 תווים לפחות");
    if (pw.next !== pw.confirm) return setError("שתי הסיסמאות לא זהות");
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setBusy(false);
    if (error) return setError("שמירת הסיסמה נכשלה. נסי שוב.");
    router.replace(landingPath);
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit} noValidate>
        <h1 className="page-title"><Brand className="login-brand" /></h1>
        {!ready ? (
          <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
        ) : !userId ? (
          <>
            <p>הקישור לא תקף או שפג תוקפו. בקשי מהמנהלת לשלוח הזמנה חדשה.</p>
            <a className="btn block" href="/login">למסך הכניסה</a>
          </>
        ) : (
          <>
            <p>ברוכה הבאה{me?.full_name ? `, ${me.full_name}` : ""}! בחרי סיסמה לכניסה למערכת.</p>
            <label className={`field${error ? " has-error" : ""}`}>
              <span>סיסמה</span>
              <input type="password" dir="ltr" autoComplete="new-password" autoFocus value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </label>
            <label className={`field${error ? " has-error" : ""}`}>
              <span>הקלידי שוב</span>
              <input type="password" dir="ltr" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </label>
            {error && <p className="field-error">{error}</p>}
            <button type="submit" className="btn primary block" disabled={busy || !pw.next}>
              {busy && <span className="spinner" aria-hidden="true" />}
              שמירה וכניסה
            </button>
          </>
        )}
      </form>
    </div>
  );
}
