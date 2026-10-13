"use client";
// מפתחות API (מנהלת מערכת): יצירה, ביטול והפעלה מחדש. כל מפתח פועל בשם תפקיד, וההרשאות של התפקיד חלות עליו.
// המפתח המלא מוצג פעם אחת, ברגע היצירה. במסד נשמר רק ה-hash שלו.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import Modal, { Confirm } from "@/components/Modal";
import { errorText } from "@/lib/views";
import { formatDateTime } from "@/lib/format";

type ApiKey = {
  id: string; name: string; key_prefix: string; role_id: string; rate_limit: number;
  is_active: boolean; last_used_at: string | null; created_by: string | null; created_at: string;
};
type Named = { id: string; name: string };

export default function Page() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [roles, setRoles] = useState<Named[]>([]);
  const [staff, setStaff] = useState<Named[]>([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const load = useCallback(async () => {
    const [k, r, s] = await Promise.all([
      supabase.from("api_keys").select("id, name, key_prefix, role_id, rate_limit, is_active, last_used_at, created_by, created_at").order("created_at", { ascending: false }),
      supabase.from("roles").select("id, name").order("name"),
      supabase.from("staff").select("id, full_name").order("full_name"),
    ]);
    if (k.error) toast(errorText(k.error), "err");
    setKeys((k.data as ApiKey[]) ?? []);
    setRoles((r.data as Named[]) ?? []);
    setStaff(((s.data as { id: string; full_name: string }[]) ?? []).map((x) => ({ id: x.id, name: x.full_name })));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const setActive = async (key: ApiKey, active: boolean) => {
    setRevoking(null);
    const { error } = await supabase.from("api_keys").update({ is_active: active }).eq("id", key.id);
    if (error) return toast(errorText(error), "err");
    toast(active ? "המפתח הופעל מחדש" : "המפתח בוטל. בקשות איתו ייענו 401");
    load();
  };

  const name = (list: Named[], id: string | null) => list.find((x) => x.id === id)?.name ?? "";

  return (
    <>
      <div className="views-head">
        <h1 className="page-title">מפתחות API</h1>
        <div className="head-buttons">
          <Link href="/settings/api/docs" className="btn outline">תיעוד</Link>
          <Link href="/settings/api/log" className="btn outline">לוג בקשות</Link>
          <button type="button" className="btn primary cta" onClick={() => setCreating(true)}>+ מפתח חדש</button>
        </div>
      </div>

      {!keys ? (
        <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : keys.length === 0 ? (
        <div className="card empty">
          <p>עוד אין מפתחות API</p>
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>צרי מפתח ראשון</button>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table log-table">
            <thead>
              <tr>
                <th>שם</th>
                <th>מפתח</th>
                <th>פועל בשם התפקיד</th>
                <th>נוצר</th>
                <th>שימוש אחרון</th>
                <th className="center">סטטוס</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td data-label="שם"><strong>{k.name}</strong></td>
                  <td data-label="מפתח"><code dir="ltr">{k.key_prefix}…</code></td>
                  <td data-label="תפקיד">{name(roles, k.role_id)}</td>
                  <td data-label="נוצר"><span dir="ltr">{formatDateTime(k.created_at)}</span>{k.created_by && <span className="muted"> · {name(staff, k.created_by)}</span>}</td>
                  <td data-label="שימוש אחרון">{k.last_used_at ? <span dir="ltr">{formatDateTime(k.last_used_at)}</span> : <span className="muted">עוד לא</span>}</td>
                  <td data-label="סטטוס" className="center"><span className={`tag ${k.is_active ? "tag-new" : "tag-cancelled"}`}>{k.is_active ? "פעיל" : "בוטל"}</span></td>
                  <td>
                    {k.is_active
                      ? <button type="button" className="link-btn danger" onClick={() => setRevoking(k)}>ביטול</button>
                      : <button type="button" className="link-btn" onClick={() => setActive(k, true)}>הפעלה מחדש</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted api-note">
        מפתח פועל בשם התפקיד שלו: אותן הרשאות צפייה, יצירה, עריכה ומחיקה, ואותן הרשאות שדות. היקף &quot;שלי&quot; או &quot;הצוות שלי&quot;
        לא חל על מפתח (אין לו משתמשת), ולכן רק &quot;הכול&quot; מתיר לו פעולה. עד 60 בקשות בדקה לכל מפתח.
      </p>

      {creating && (
        <CreateDialog
          roles={roles}
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); setCreated(c); load(); }}
        />
      )}
      {created && <ShowKeyDialog created={created} onClose={() => setCreated(null)} />}
      {revoking && (
        <Confirm
          text={`לבטל את המפתח "${revoking.name}"? מערכות שמשתמשות בו יפסיקו לעבוד מיד.`}
          confirmLabel="ביטול המפתח"
          onClose={() => setRevoking(null)}
          onConfirm={() => setActive(revoking, false)}
        />
      )}
    </>
  );
}

function CreateDialog({ roles, onClose, onCreated }: { roles: Named[]; onClose: () => void; onCreated: (c: { name: string; key: string }) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="מפתח API חדש" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError("צריך לתת שם למפתח");
          if (!role) return setError("יש לבחור תפקיד");
          setBusy(true);
          const { data, error } = await supabase.rpc("create_api_key", { p_name: name.trim(), p_role_id: role });
          setBusy(false);
          if (error) return setError(errorText(error));
          onCreated({ name: name.trim(), key: (data as { key: string }).key });
        }}
      >
        <label className="field">
          <span>שם (למה המפתח משמש)</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: סוכן שירות ב-n8n" />
        </label>
        <label className="field">
          <span>פועל בשם התפקיד</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">בחרי…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={busy}>{busy && <span className="spinner" aria-hidden="true" />}יצירה</button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}

function ShowKeyDialog({ created, onClose }: { created: { name: string; key: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={`המפתח "${created.name}" נוצר`} onClose={onClose}>
      <p><strong>זו הפעם היחידה שהמפתח המלא מוצג.</strong> העתיקי אותו עכשיו ושמרי במקום בטוח (למשל ב-Credentials של n8n). אחרי הסגירה אי אפשר לראות אותו שוב.</p>
      <div className="api-key-box">
        <code dir="ltr">{created.key}</code>
        <button
          type="button"
          className="btn outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(created.key);
              setCopied(true);
            } catch {}
          }}
        >
          {copied ? "הועתק" : "העתקה"}
        </button>
      </div>
      <p className="muted">שולחים אותו בכל בקשה בכותרת: <code dir="ltr">Authorization: Bearer {created.key.slice(0, 12)}…</code></p>
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>שמרתי, סגירה</button>
      </div>
    </Modal>
  );
}
