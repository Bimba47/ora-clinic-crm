"use client";
// מסך כניסה: אימייל וסיסמה דרך Supabase Auth. המראה לפי העיצוב מ-Claude Design (v32), בצבעי האפיון (AuthShell).
// "שכחת סיסמה?": שליחת קישור איפוס למייל. הקישור מוביל ל-/reset-password, שם בוחרים סיסמה חדשה.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import AuthShell from "@/components/AuthShell";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
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

  const head = mode === "login"
    ? { eyebrow: "ברוכה השבה", title: "כניסה למערכת", subtitle: "התחברי כדי לראות את היומן, הלקוחות והטיפולים של היום." }
    : mode === "forgot"
      ? { title: "שכחת סיסמה?", subtitle: "הקלידי את האימייל שלך, ונשלח אלייך קישור לבחירת סיסמה חדשה." }
      : { title: "בדקי את המייל", subtitle: `אם האימייל ${email.trim()} רשום במערכת, שלחנו אלייך קישור לבחירת סיסמה חדשה. כדאי לבדוק גם בתיקיית הספאם.` };

  return (
    <AuthShell {...head}>
      {mode === "sent" ? (
        <div className="auth-form">
          <button type="button" className="btn block" onClick={back}>חזרה לכניסה</button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={mode === "login" ? submit : sendReset}>
          <label className={`field${error ? " has-error" : ""}`}>
            <span>אימייל</span>
            <input
              type="email"
              dir="ltr"
              autoComplete="email"
              required
              autoFocus
              placeholder="name@ora-clinic.co.il"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {mode === "login" && (
            <div className={`field${error ? " has-error" : ""}`}>
              <div className="auth-pw-head">
                <label htmlFor="login-pw">סיסמה</label>
                <button type="button" className="link-btn" onClick={() => (setMode("forgot"), setError(""))}>שכחת סיסמה?</button>
              </div>
              <div className="auth-pw">
                <input
                  id="login-pw"
                  type={showPw ? "text" : "password"}
                  dir="ltr"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" className="icon-btn auth-eye" aria-label={showPw ? "הסתרת הסיסמה" : "הצגת הסיסמה"} aria-pressed={showPw} onClick={() => setShowPw((s) => !s)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    {showPw && <path d="M4 4l16 16" />}
                  </svg>
                </button>
              </div>
            </div>
          )}

          {error && <p className="field-error" role="alert">{error}</p>}

          <button type="submit" className="btn primary block auth-submit" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {mode === "login" ? "כניסה" : "שליחת קישור"}
            {mode === "login" && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5" />
                <path d="M11 6l-6 6 6 6" />
              </svg>
            )}
          </button>

          {mode === "login" ? (
            <p className="auth-note">אין לך חשבון? <strong>בקשי גישה ממנהלת המערכת</strong></p>
          ) : (
            <button type="button" className="link-btn auth-back" onClick={back}>חזרה לכניסה</button>
          )}
        </form>
      )}
    </AuthShell>
  );
}
