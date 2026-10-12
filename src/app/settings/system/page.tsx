"use client";
// פרטי המערכת (מנהלת): שם המערכת ולוגו. נשמרים בטבלת app_settings, והלוגו באחסון Supabase (branding).
// העדכון נאכף גם במסד: רק מנהלת יכולה לשנות הגדרות ולהעלות לוגו.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSettings } from "@/components/Settings";
import { useToast } from "@/components/Toast";
import { errorText } from "@/lib/views";

const MAX_LOGO_BYTES = 1024 * 1024;

async function setSetting(key: string, value: unknown) {
  const { data, error } = await supabase.from("app_settings").update({ value }).eq("key", key).select("key");
  if (error) throw error;
  if (!data.length) throw new Error("אין לך הרשאה לשנות את ההגדרות.");
}

export default function Page() {
  const { appName, logoUrl, reload } = useSettings();
  const toast = useToast();
  const [name, setName] = useState(appName);
  const [nameError, setNameError] = useState("");
  const [busy, setBusy] = useState<"" | "name" | "logo">("");

  useEffect(() => setName(appName), [appName]);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setNameError("חובה למלא שם מערכת");
    setNameError("");
    setBusy("name");
    try {
      await setSetting("app_name", name.trim());
      await reload();
      toast("שם המערכת נשמר");
    } catch (err) {
      toast(errorText(err), "err");
    } finally {
      setBusy("");
    }
  };

  const uploadLogo = async (file: File) => {
    if (file.size > MAX_LOGO_BYTES) return toast("הלוגו גדול מדי. עד 1MB.", "err");
    setBusy("logo");
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `logo-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("branding").upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
      const url = supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
      await setSetting("logo_url", url);
      await reload();
      toast("הלוגו נשמר");
    } catch (err) {
      toast(errorText(err), "err");
    } finally {
      setBusy("");
    }
  };

  const removeLogo = async () => {
    setBusy("logo");
    try {
      await setSetting("logo_url", null);
      await reload();
      toast("הלוגו הוסר");
    } catch (err) {
      toast(errorText(err), "err");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <h1 className="page-title">פרטי המערכת</h1>

      <section className="card settings-card">
        <h2 className="section-title">שם המערכת</h2>
        <p className="muted">מופיע בתפריט, במסך הכניסה ובלשונית הדפדפן.</p>
        <form onSubmit={saveName} className="settings-form" noValidate>
          <label className={`field${nameError ? " has-error" : ""}`}>
            <span>שם *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />
            {nameError && <span className="field-error">{nameError}</span>}
          </label>
          <div>
            <button type="submit" className="btn primary cta" disabled={busy === "name" || name.trim() === appName}>
              {busy === "name" && <span className="spinner" aria-hidden="true" />}
              שמירה
            </button>
          </div>
        </form>
      </section>

      <section className="card settings-card">
        <h2 className="section-title">לוגו</h2>
        <p className="muted">PNG, JPG, WEBP או SVG, עד 1MB. מופיע ליד שם המערכת.</p>
        <div className="logo-row">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="הלוגו הנוכחי" className="logo-preview" />
          ) : (
            <div className="logo-preview empty">אין לוגו</div>
          )}
          <div className="logo-actions">
            <label className="btn outline">
              {busy === "logo" && <span className="spinner" aria-hidden="true" />}
              {logoUrl ? "החלפת לוגו" : "העלאת לוגו"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                disabled={busy === "logo"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadLogo(f);
                }}
              />
            </label>
            {logoUrl && (
              <button type="button" className="btn outline danger" disabled={busy === "logo"} onClick={removeLogo}>הסרת לוגו</button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
