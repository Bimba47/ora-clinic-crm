"use client";
// בחירת סיסמה אחרי כניסה מקישור במייל: קבלת הזמנה (/accept-invite) או איפוס סיסמה (/reset-password).
// Supabase מחבר את המשתמשת לפי הקישור, וכאן היא קובעת סיסמה. מכאן והלאה היא נכנסת רגיל במסך הכניסה.
// באותה מסגרת כמו מסך הכניסה (AuthShell).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/Auth";
import AuthShell from "@/components/AuthShell";

export default function SetPassword({ intro, invalidText }: { intro: (name: string) => string; invalidText: string }) {
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
    if (error) {
      return setError(error.message.includes("different from the old") ? "הסיסמה החדשה צריכה להיות שונה מהקודמת." : "שמירת הסיסמה נכשלה. נסי שוב.");
    }
    router.replace(landingPath);
  };

  return (
    <AuthShell
      title="בחירת סיסמה"
      subtitle={!ready ? undefined : !userId ? invalidText : intro(me?.full_name ?? "")}
    >
      {!ready ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : !userId ? (
        <div className="auth-form">
          <a className="btn block" href="/login">למסך הכניסה</a>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <label className={`field${error ? " has-error" : ""}`}>
            <span>סיסמה חדשה</span>
            <input type="password" dir="ltr" autoComplete="new-password" autoFocus value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label className={`field${error ? " has-error" : ""}`}>
            <span>הקלידי שוב</span>
            <input type="password" dir="ltr" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button type="submit" className="btn primary block auth-submit" disabled={busy || !pw.next}>
            {busy && <span className="spinner" aria-hidden="true" />}
            שמירה וכניסה
          </button>
        </form>
      )}
    </AuthShell>
  );
}
