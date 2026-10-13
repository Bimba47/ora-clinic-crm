"use client";
// מסך כניסה: אימייל וסיסמה דרך Supabase Auth.
// "שכחתי סיסמה": שליחת קישור איפוס למייל. הקישור מוביל ל-/reset-password, שם בוחרים סיסמה חדשה.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Brand } from "@/components/Settings";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError("האימייל או הסיסמה לא נכונים. נסי שוב.");
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // לא מגלים אם האימייל רשום במערכת. רק עומס בקשות מקבל הודעה משלו.
    if (error && error.status === 429) return setError("נשלחו יותר מדי בקשות. נסי שוב בעוד כמה דקות.");
    setMode("sent");
  };

  const back = () => {
    setMode("login");
    setError("");
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={mode === "login" ? submit : sendReset}>
        {/* שם המערכת והלוגו מההגדרות */}
        <h1 className="page-title"><Brand className="login-brand" /></h1>

        {mode === "sent" ? (
          <>
            <p>אם האימייל {email.trim()} רשום במערכת, שלחנו אלייך קישור לבחירת סיסמה חדשה. כדאי לבדוק גם בתיקיית הספאם.</p>
            <button type="button" className="btn block" onClick={back}>חזרה לכניסה</button>
          </>
        ) : (
          <>
            {mode === "forgot" && <p>הקלידי את האימייל שלך, ונשלח אלייך קישור לבחירת סיסמה חדשה.</p>}
            <label className="field">
              <span>אימייל</span>
              <input type="email" dir="ltr" autoComplete="email" required autoFocus={mode === "forgot"} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {mode === "login" && (
              <label className="field">
                <span>סיסמה</span>
                <input
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {error && <p className="field-error">{error}</p>}
            <button type="submit" className="btn primary block" disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {mode === "login" ? "כניסה" : "שליחת קישור"}
            </button>
            <button type="button" className="link-btn login-switch" onClick={() => (mode === "login" ? (setMode("forgot"), setError("")) : back())}>
              {mode === "login" ? "שכחתי סיסמה" : "חזרה לכניסה"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
