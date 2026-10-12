"use client";
// מסך כניסה: אימייל וסיסמה דרך Supabase Auth

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Brand } from "@/components/Settings";

export default function LoginPage() {
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

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        {/* שם המערכת והלוגו מההגדרות */}
        <h1 className="page-title"><Brand className="login-brand" /></h1>
        <label className="field">
          <span>אימייל</span>
          <input type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
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
        {error && <p className="field-error">{error}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          כניסה
        </button>
      </form>
    </div>
  );
}
