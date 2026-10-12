"use client";
// תפקידים והרשאות (מנהלת מערכת): מטריצה של תפקידים (שורות) מול אובייקטים (עמודות).
// בכל תא ארבע פעולות (צפייה, יצירה, עריכה, מחיקה), ולכל אחת היקף: הכול / הצוות שלי / שלי.
// כל שינוי נשמר מיד בטבלת role_permissions, והמסד אוכף אותו ב-RLS. אין כאן קוד לכל תפקיד:
// תפקיד חדש או הרשאה שהשתנתה הם שינוי בנתונים בלבד.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { useAuth, type Action, type Scope } from "@/components/Auth";
import Modal, { Confirm } from "@/components/Modal";
import { errorText } from "@/lib/views";

type Role = { id: string; name: string; description: string | null; is_admin: boolean };
type PermRow = { role_id: string; object_key: string; can_view: Scope; can_create: Scope; can_edit: Scope; can_delete: Scope };
type FieldRow = { role_id: string; object_key: string; field_key: string; access: "hidden" | "read" };
type CatalogField = { object_key: string; field_key: string; label: string; is_required: boolean };

// האובייקטים במטריצה. "שלי" לפי אחריות: לקוחה – מי שיצרה, תור – המטפלת, קריאה – האחראית, צוות – אני עצמי.
const OBJECTS: { key: string; label: string; own?: string }[] = [
  { key: "clients", label: "לקוחות", own: "שיצרתי" },
  { key: "appointments", label: "תורים", own: "שאני המטפלת" },
  { key: "service_requests", label: "קריאות שירות", own: "באחריותי" },
  { key: "treatments", label: "מחירון" },
  { key: "staff", label: "צוות", own: "רק אני" },
];
const ACTIONS: { key: Action; label: string; col: keyof PermRow }[] = [
  { key: "view", label: "צפייה", col: "can_view" },
  { key: "create", label: "יצירה", col: "can_create" },
  { key: "edit", label: "עריכה", col: "can_edit" },
  { key: "delete", label: "מחיקה", col: "can_delete" },
];
const SCOPE_LABELS: Record<Exclude<Scope, "none">, string> = { all: "הכול", team: "הצוות שלי", own: "שלי" };
const SYSTEM_FIELDS = ["created_at", "updated_at", "updated_by"];

export default function Page() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [perms, setPerms] = useState<PermRow[]>([]);
  const [fieldPerms, setFieldPerms] = useState<FieldRow[]>([]);
  const [fields, setFields] = useState<CatalogField[]>([]);
  const [userCount, setUserCount] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [duplicating, setDuplicating] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [fieldsFor, setFieldsFor] = useState<Role | null>(null);

  const load = useCallback(async () => {
    const [r, p, fp, cat, st] = await Promise.all([
      supabase.from("roles").select("id, name, description, is_admin").order("is_admin", { ascending: false }).order("name"),
      supabase.from("role_permissions").select("role_id, object_key, can_view, can_create, can_edit, can_delete"),
      supabase.from("field_permissions").select("role_id, object_key, field_key, access"),
      supabase.from("object_fields").select("field_key, label, is_required, position, view_objects!object_fields_object_id_fkey!inner(object_key)").order("position"),
      supabase.from("staff").select("id, role_id"),
    ]);
    const err = r.error ?? p.error ?? fp.error ?? cat.error ?? st.error;
    if (err) toast(errorText(err), "err");
    setRoles((r.data as Role[]) ?? []);
    setPerms((p.data as PermRow[]) ?? []);
    setFieldPerms((fp.data as FieldRow[]) ?? []);
    type CatRow = { field_key: string; label: string; is_required: boolean; view_objects: { object_key: string } | { object_key: string }[] };
    setFields(
      ((cat.data as CatRow[]) ?? []).map((f) => ({
        field_key: f.field_key, label: f.label, is_required: f.is_required,
        object_key: Array.isArray(f.view_objects) ? f.view_objects[0]?.object_key : f.view_objects.object_key,
      })),
    );
    const counts: Record<string, number> = {};
    for (const s of (st.data as { role_id: string }[]) ?? []) counts[s.role_id] = (counts[s.role_id] ?? 0) + 1;
    setUserCount(counts);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // שינוי היקף של פעולה אחת: מתעדכן מיד במסך, וחוזר אחורה אם השמירה נכשלה
  const setScope = async (roleId: string, objectKey: string, col: keyof PermRow, scope: Scope) => {
    const before = perms;
    setPerms(perms.map((p) => (p.role_id === roleId && p.object_key === objectKey ? { ...p, [col]: scope } : p)));
    const { error } = await supabase.from("role_permissions").update({ [col]: scope }).eq("role_id", roleId).eq("object_key", objectKey);
    if (error) {
      setPerms(before);
      toast(errorText(error), "err");
    } else {
      toast("ההרשאה נשמרה");
      refresh(); // אם שיניתי את התפקיד שלי, הממשק מתעדכן
    }
  };

  const deleteRole = async (role: Role) => {
    setDeleting(null);
    const { error } = await supabase.from("roles").delete().eq("id", role.id);
    if (error) return toast(errorText(error), "err");
    toast("התפקיד נמחק");
    load();
  };

  if (!roles) return <div className="skeleton" style={{ height: 360 }} aria-busy="true" />;

  return (
    <>
      <div className="views-head">
        <h1 className="page-title">תפקידים והרשאות</h1>
        <button type="button" className="btn primary" onClick={() => setEditing("new")}>+ תפקיד חדש</button>
      </div>

      <div className="card perm-card">
        <table className="perm-matrix">
          <thead>
            <tr>
              <th scope="col">תפקיד</th>
              {OBJECTS.map((o) => <th key={o.key} scope="col">{o.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <th scope="row" className="perm-role">
                  <div className="perm-role-name">
                    {role.name}
                    {role.is_admin && <span className="tag tag-admin">מנהלת מערכת</span>}
                  </div>
                  {role.description && <div className="muted">{role.description}</div>}
                  <div className="perm-role-actions stacked">
                    <button type="button" className="link-btn" onClick={() => setFieldsFor(role)}>הרשאות שדות</button>
                    <button type="button" className="link-btn" onClick={() => setEditing(role)}>עריכה</button>
                    <button type="button" className="link-btn" onClick={() => setDuplicating(role)}>שכפול</button>
                    {!role.is_admin && (
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() =>
                          userCount[role.id]
                            ? toast("אי אפשר למחוק תפקיד שיש בו משתמשות. העבירי אותן קודם לתפקיד אחר.", "err")
                            : setDeleting(role)
                        }
                      >
                        מחיקה
                      </button>
                    )}
                  </div>
                </th>
                {OBJECTS.map((o) => {
                  const row = perms.find((p) => p.role_id === role.id && p.object_key === o.key);
                  return (
                    <td key={o.key} data-label={o.label}>
                      {row ? (
                        <div className="perm-cell">
                          {ACTIONS.map((a) => (
                            <ScopeControl
                              key={a.key}
                              label={a.label}
                              value={row[a.col] as Scope}
                              allowOwn={!!o.own}
                              ownHint={o.own}
                              onChange={(s) => setScope(role.id, o.key, a.col, s)}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <RoleModal
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); refresh(); }}
        />
      )}
      {duplicating && (
        <DuplicateModal role={duplicating} onClose={() => setDuplicating(null)} onDone={() => { setDuplicating(null); load(); }} />
      )}
      {deleting && (
        <Confirm
          text={`למחוק את התפקיד "${deleting.name}"? ההרשאות שלו יימחקו איתו.`}
          confirmLabel="מחיקה"
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteRole(deleting)}
        />
      )}
      {fieldsFor && (
        <FieldPermissionsModal
          role={fieldsFor}
          fields={fields}
          current={fieldPerms.filter((f) => f.role_id === fieldsFor.id)}
          onClose={() => setFieldsFor(null)}
          onChanged={() => { load(); refresh(); }}
        />
      )}
    </>
  );
}

// פעולה אחת בתא: תיבת סימון (מותר או לא) ובחירת היקף. במחירון אין היקף, רק מותר או לא.
function ScopeControl({
  label, value, allowOwn, ownHint, onChange,
}: { label: string; value: Scope; allowOwn: boolean; ownHint?: string; onChange: (s: Scope) => void }) {
  const on = value !== "none";
  return (
    <div className={`perm-action${on ? " on" : ""}`}>
      <label className="perm-check">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? "all" : "none")} />
        <span>{label}</span>
      </label>
      {allowOwn && on && (
        <select value={value} onChange={(e) => onChange(e.target.value as Scope)} aria-label={`היקף ${label}`}>
          <option value="all">{SCOPE_LABELS.all}</option>
          <option value="team">{SCOPE_LABELS.team}</option>
          <option value="own" title={ownHint}>{SCOPE_LABELS.own}{ownHint ? ` (${ownHint})` : ""}</option>
        </select>
      )}
    </div>
  );
}

// יצירת תפקיד או עריכת שם ותיאור. תפקיד חדש נוצר בלי הרשאות (הכול "אין"), ומסמנים במטריצה.
function RoleModal({ role, onClose, onDone }: { role: Role | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("חובה למלא שם תפקיד");
    setBusy(true);
    const values = { name: name.trim(), description: description.trim() || null };
    const { error } = role
      ? await supabase.from("roles").update(values).eq("id", role.id)
      : await supabase.from("roles").insert(values);
    setBusy(false);
    if (error) return setError(errorText(error));
    toast(role ? "התפקיד נשמר" : "התפקיד נוצר. סמני לו הרשאות במטריצה.");
    onDone();
  };

  return (
    <Modal title={role ? "עריכת תפקיד" : "תפקיד חדש"} onClose={onClose}>
      <form className="record-form one-col" onSubmit={submit} noValidate>
        <label className={`field${error ? " has-error" : ""}`}>
          <span>שם התפקיד *</span>
          <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        </label>
        <label className="field">
          <span>תיאור</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {!role && <p className="muted">תפקיד חדש נוצר בלי הרשאות. אפשר גם לשכפל תפקיד קיים ולשנות רק את מה שצריך.</p>}
        {error && <p className="field-error form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            שמירה
          </button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}

// שכפול תפקיד: כל ההרשאות והרשאות השדות מועתקות לתפקיד חדש (duplicate_role במסד)
function DuplicateModal({ role, onClose, onDone }: { role: Role; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(`${role.name} (עותק)`);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("חובה למלא שם תפקיד");
    setBusy(true);
    const { error } = await supabase.rpc("duplicate_role", { p_role_id: role.id, p_name: name.trim() });
    setBusy(false);
    if (error) return setError(errorText(error));
    toast("התפקיד שוכפל");
    onDone();
  };

  return (
    <Modal title={`שכפול "${role.name}"`} onClose={onClose}>
      <form className="record-form one-col" onSubmit={submit} noValidate>
        <label className={`field${error ? " has-error" : ""}`}>
          <span>שם התפקיד החדש *</span>
          <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        </label>
        <p className="muted">כל ההרשאות של &quot;{role.name}&quot; יועתקו לתפקיד החדש.</p>
        {error && <p className="field-error form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            שכפול
          </button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}

// הרשאות שדות לתפקיד: מלא (ברירת מחדל), קריאה בלבד, או חסום (לא נשלח בכלל לדפדפן)
function FieldPermissionsModal({
  role, fields, current, onClose, onChanged,
}: { role: Role; fields: CatalogField[]; current: FieldRow[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [objectKey, setObjectKey] = useState(OBJECTS[0].key);
  const [access, setAccess] = useState<Record<string, "full" | "read" | "hidden">>(() =>
    Object.fromEntries(current.map((f) => [`${f.object_key}.${f.field_key}`, f.access])),
  );
  const list = fields.filter((f) => f.object_key === objectKey && !SYSTEM_FIELDS.includes(f.field_key));

  const change = async (f: CatalogField, value: "full" | "read" | "hidden") => {
    const k = `${f.object_key}.${f.field_key}`;
    const before = access[k] ?? "full";
    setAccess({ ...access, [k]: value });
    const { error } =
      value === "full"
        ? await supabase.from("field_permissions").delete().eq("role_id", role.id).eq("object_key", f.object_key).eq("field_key", f.field_key)
        : await supabase.from("field_permissions").upsert({ role_id: role.id, object_key: f.object_key, field_key: f.field_key, access: value });
    if (error) {
      setAccess((a) => ({ ...a, [k]: before }));
      return toast(errorText(error), "err");
    }
    toast("הרשאת השדה נשמרה");
    onChanged();
  };

  return (
    <Modal title={`הרשאות שדות: ${role.name}`} onClose={onClose} wide>
      <div className="tabs" role="tablist">
        {OBJECTS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={objectKey === o.key}
            className={`btn${objectKey === o.key ? " on" : " outline"}`}
            onClick={() => setObjectKey(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="muted">
        &quot;קריאה בלבד&quot; – השדה מוצג אבל לא ניתן לשינוי. &quot;חסום&quot; – השדה לא מוצג ולא נשלח בכלל לדפדפן. שדה חובה אפשר רק לקריאה בלבד.
      </p>
      <ul className="field-perms">
        {list.map((f) => {
          const v = access[`${f.object_key}.${f.field_key}`] ?? "full";
          return (
            <li key={f.field_key}>
              <span>{f.label}{f.is_required && <span className="muted"> (חובה)</span>}</span>
              <select value={v} onChange={(e) => change(f, e.target.value as "full" | "read" | "hidden")} aria-label={`הרשאה לשדה ${f.label}`}>
                <option value="full">מלא</option>
                <option value="read">קריאה בלבד</option>
                {!f.is_required && <option value="hidden">חסום</option>}
              </select>
            </li>
          );
        })}
      </ul>
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>סיום</button>
      </div>
    </Modal>
  );
}
