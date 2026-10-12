"use client";
// משתמשים (מנהלת): רשימת הצוות דרך מנוע התצוגות, ועוד הזמנת משתמשת חדשה במייל.
// ההזמנה רצה בשרת (/api/users/invite), כי היא צריכה את מפתח השירות של Supabase.
import { useEffect, useState } from "react";
import ObjectViews from "@/components/views/ObjectViews";
import Modal from "@/components/Modal";
import { supabase } from "@/lib/supabase";
import { adminApi } from "@/lib/adminApi";
import { useToast } from "@/components/Toast";
import { errorText } from "@/lib/views";

type Option = { id: string; name: string };
type Form = { full_name: string; email: string; phone: string; role_id: string; team_id: string };
const EMPTY: Form = { full_name: "", email: "", phone: "", role_id: "", team_id: "" };

export default function Page() {
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  return (
    <>
      <ObjectViews
        objectKey="staff"
        reloadToken={reload}
        headerActions={<button type="button" className="btn primary" onClick={() => setOpen(true)}>+ הזמנת משתמשת</button>}
      />
      {open && <InviteModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); setReload((n) => n + 1); }} />}
    </>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [roles, setRoles] = useState<Option[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [r, t] = await Promise.all([
        supabase.from("roles").select("id, name").order("name"),
        supabase.from("teams").select("id, name").order("name"),
      ]);
      setRoles((r.data as Option[]) ?? []);
      setTeams((t.data as Option[]) ?? []);
    })();
  }, []);

  const set = (k: keyof Form, v: string) => {
    setForm({ ...form, [k]: v });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!form.full_name.trim()) errs.full_name = "חובה למלא שם מלא";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = "אימייל לא תקין";
    if (!form.phone.trim()) errs.phone = "חובה למלא טלפון";
    if (!form.role_id) errs.role_id = "חובה לבחור תפקיד";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFormError("");
    try {
      await adminApi("/api/users/invite", form);
      toast("ההזמנה נשלחה");
      onDone();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof Form, label: string, input: React.ReactNode) => (
    <label className={`field${errors[k] ? " has-error" : ""}`}>
      <span>{label}</span>
      {input}
      {errors[k] && <span className="field-error">{errors[k]}</span>}
    </label>
  );

  return (
    <Modal title="הזמנת משתמשת" onClose={onClose}>
      <form className="record-form one-col" onSubmit={submit} noValidate>
        <p className="muted">תישלח אליה הזמנה במייל. בקישור היא תבחר סיסמה ותיכנס עם ההרשאות של התפקיד.</p>
        {field("full_name", "שם מלא *", <input autoFocus value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />)}
        {field("email", "אימייל *", <input type="email" dir="ltr" value={form.email} onChange={(e) => set("email", e.target.value)} />)}
        {field("phone", "טלפון *", <input type="tel" inputMode="numeric" dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />)}
        {field("role_id", "תפקיד *", (
          <select value={form.role_id} onChange={(e) => set("role_id", e.target.value)}>
            <option value="">בחרי תפקיד</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        ))}
        {field("team_id", "צוות", (
          <select value={form.team_id} onChange={(e) => set("team_id", e.target.value)}>
            <option value="">בלי צוות</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        ))}
        {formError && <p className="field-error form-error" role="alert">{formError}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            שליחת הזמנה
          </button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}
