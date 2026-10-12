"use client";
// הפרופיל האישי: הפרטים שלי מטבלת הצוות (שם, טלפון, אימייל, כתובת), התפקיד לקריאה בלבד,
// החלפת סיסמה ואימייל דרך Supabase Auth, והעדפות אישיות (מסך פתיחה, התראות במייל).
// העדכון נעשה דרך update_my_profile: רק השורה שלי, ורק השדות האלה.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import { errorText } from "@/lib/views";

const LANDING_OPTIONS = [
  { value: "/", label: "ראשי" },
  { value: "/clients", label: "לקוחות" },
  { value: "/appointments/list", label: "תורים" },
  { value: "/requests", label: "קריאות שירות" },
  { value: "/notifications", label: "התראות" },
];

type Details = { full_name: string; phone: string; email: string; address: string };

export default function Page() {
  const { me, userId, refresh } = useAuth();
  const toast = useToast();
  const [details, setDetails] = useState<Details | null>(null);
  const [saved, setSaved] = useState<Details | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({});
  const [emailNote, setEmailNote] = useState("");
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [pwError, setPwError] = useState("");
  const [prefs, setPrefs] = useState({ landing_path: "/", email_notifications: false });
  const [busy, setBusy] = useState<"" | "details" | "password" | "prefs">("");

  useEffect(() => {
    if (!userId) return;
    (async () => {
      // הפרטים שלי דרך get_me (כולל הכתובת שלי, גם אם היא חסומה לתפקיד שלי במסכי הצוות)
      const [mine, pref] = await Promise.all([
        supabase.rpc("get_me"),
        supabase.from("user_preferences").select("landing_path, email_notifications").eq("staff_id", userId).maybeSingle(),
      ]);
      const m = mine.data as { full_name: string; phone: string; email: string; address: string | null } | null;
      if (m) {
        const d = { full_name: m.full_name, phone: m.phone, email: m.email, address: m.address ?? "" };
        setDetails(d);
        setSaved(d);
      }
      if (pref.data) setPrefs(pref.data as typeof prefs);
    })();
  }, [userId]);

  if (!me || !details || !saved) return <div className="skeleton" style={{ height: 320 }} aria-busy="true" />;

  const set = (k: keyof Details, v: string) => {
    setDetails({ ...details, [k]: v });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!details.full_name.trim()) errs.full_name = "חובה למלא שם מלא";
    if (!details.phone.trim()) errs.phone = "חובה למלא טלפון";
    if (!details.email.trim()) errs.email = "חובה למלא אימייל";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy("details");
    setEmailNote("");
    try {
      const { error } = await supabase.rpc("update_my_profile", {
        p_full_name: details.full_name.trim(),
        p_phone: details.phone,
        p_address: details.address,
      });
      if (error) throw error;
      // אימייל הוא גם שם המשתמש לכניסה, ולכן מוחלף דרך Supabase Auth, עם אישור בקישור שנשלח לכתובת החדשה
      if (details.email.trim().toLowerCase() !== saved.email) {
        const res = await supabase.auth.updateUser({ email: details.email.trim().toLowerCase() });
        if (res.error) throw res.error;
        setEmailNote("שלחנו קישור אישור לכתובת החדשה. האימייל יתעדכן אחרי שתלחצי עליו.");
      }
      setSaved({ ...details, email: saved.email });
      setDetails({ ...details, email: saved.email });
      await refresh();
      toast("הפרטים נשמרו");
    } catch (err) {
      toast(errorText(err), "err");
    } finally {
      setBusy("");
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 8) return setPwError("הסיסמה צריכה להיות באורך 8 תווים לפחות");
    if (pw.next !== pw.confirm) return setPwError("שתי הסיסמאות לא זהות");
    setPwError("");
    setBusy("password");
    try {
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) throw error;
      setPw({ next: "", confirm: "" });
      toast("הסיסמה הוחלפה");
    } catch (err) {
      toast(errorText(err), "err");
    } finally {
      setBusy("");
    }
  };

  const savePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("prefs");
    try {
      const { error } = await supabase.from("user_preferences").upsert({ staff_id: userId, ...prefs });
      if (error) throw error;
      await refresh();
      toast("ההעדפות נשמרו");
    } catch (err) {
      toast(errorText(err), "err");
    } finally {
      setBusy("");
    }
  };

  const changed = (Object.keys(details) as (keyof Details)[]).some((k) => details[k] !== saved[k]);

  return (
    <>
      <h1 className="page-title">הפרופיל שלי</h1>

      <section className="card settings-card">
        <h2 className="section-title">הפרטים שלי</h2>
        <form onSubmit={saveDetails} className="settings-form two-col" noValidate>
          <label className={`field${errors.full_name ? " has-error" : ""}`}>
            <span>שם מלא *</span>
            <input value={details.full_name} onChange={(e) => set("full_name", e.target.value)} autoComplete="name" />
            {errors.full_name && <span className="field-error">{errors.full_name}</span>}
          </label>
          <label className={`field${errors.phone ? " has-error" : ""}`}>
            <span>טלפון *</span>
            <input type="tel" inputMode="numeric" dir="ltr" value={details.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
            {errors.phone && <span className="field-error">{errors.phone}</span>}
          </label>
          <label className={`field${errors.email ? " has-error" : ""}`}>
            <span>אימייל (גם לכניסה) *</span>
            <input type="email" dir="ltr" value={details.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
            {errors.email && <span className="field-error">{errors.email}</span>}
            {emailNote && <span className="muted">{emailNote}</span>}
          </label>
          <label className="field">
            <span>כתובת מגורים</span>
            <input value={details.address} onChange={(e) => set("address", e.target.value)} autoComplete="street-address" />
          </label>
          <div className="field">
            <span>תפקיד וצוות</span>
            <div>
              <span className="tag">{me.role_name}</span> {me.team_name && <span className="tag">{me.team_name}</span>}{" "}
              <span className="muted">(רק מנהלת מערכת יכולה לשנות)</span>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn primary cta" disabled={busy === "details" || !changed}>
              {busy === "details" && <span className="spinner" aria-hidden="true" />}
              שמירת הפרטים
            </button>
            {changed && <button type="button" className="btn outline" onClick={() => { setDetails(saved); setErrors({}); }}>ביטול</button>}
          </div>
        </form>
      </section>

      <section className="card settings-card">
        <h2 className="section-title">החלפת סיסמה</h2>
        <form onSubmit={changePassword} className="settings-form two-col" noValidate>
          <label className={`field${pwError ? " has-error" : ""}`}>
            <span>סיסמה חדשה</span>
            <input type="password" dir="ltr" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label className={`field${pwError ? " has-error" : ""}`}>
            <span>הקלידי שוב</span>
            <input type="password" dir="ltr" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </label>
          {pwError && <p className="field-error form-error">{pwError}</p>}
          <div className="form-actions">
            <button type="submit" className="btn outline" disabled={busy === "password" || !pw.next}>
              {busy === "password" && <span className="spinner" aria-hidden="true" />}
              החלפת סיסמה
            </button>
          </div>
        </form>
      </section>

      <section className="card settings-card">
        <h2 className="section-title">העדפות</h2>
        <form onSubmit={savePrefs} className="settings-form" noValidate>
          <label className="field">
            <span>המסך שנפתח אחרי כניסה</span>
            <select value={prefs.landing_path} onChange={(e) => setPrefs({ ...prefs, landing_path: e.target.value })}>
              {LANDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="check-field">
            <input type="checkbox" checked={prefs.email_notifications} onChange={(e) => setPrefs({ ...prefs, email_notifications: e.target.checked })} />
            <span>לקבל התראות גם במייל</span>
          </label>
          <p className="muted">שליחת התראות במייל תופעל בשלב האוטומציות. הבחירה נשמרת כבר עכשיו.</p>
          <div className="form-actions">
            <button type="submit" className="btn outline" disabled={busy === "prefs"}>
              {busy === "prefs" && <span className="spinner" aria-hidden="true" />}
              שמירת ההעדפות
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
