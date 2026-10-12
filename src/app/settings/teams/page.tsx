"use client";
// צוותים (מנהלת מערכת): יצירה, עריכה ומחיקה של צוותים, ושיוך משתמשות לצוות.
// לכל משתמשת צוות אחד לכל היותר (staff.team_id). הצוות קובע מה זה "הצוות שלי" בהרשאות.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/components/Auth";
import Modal, { Confirm } from "@/components/Modal";
import { errorText } from "@/lib/views";

type Team = { id: string; name: string; description: string | null };
type Member = { id: string; full_name: string; team_id: string | null; is_active: boolean };

export default function Page() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [staff, setStaff] = useState<Member[]>([]);
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      supabase.from("teams").select("id, name, description").order("name"),
      supabase.from("staff").select("id, full_name, team_id, is_active").order("full_name"),
    ]);
    if (t.error || s.error) toast(errorText(t.error ?? s.error), "err");
    setTeams((t.data as Team[]) ?? []);
    setStaff((s.data as Member[]) ?? []);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const assign = async (memberId: string, teamId: string | null) => {
    const before = staff;
    setStaff(staff.map((m) => (m.id === memberId ? { ...m, team_id: teamId } : m)));
    const { error } = await supabase.from("staff").update({ team_id: teamId }).eq("id", memberId);
    if (error) {
      setStaff(before);
      return toast(errorText(error), "err");
    }
    toast(teamId ? "המשתמשת שויכה לצוות" : "המשתמשת הוצאה מהצוות");
    refresh();
  };

  const deleteTeam = async (team: Team) => {
    setDeleting(null);
    const { error } = await supabase.from("teams").delete().eq("id", team.id);
    if (error) return toast(errorText(error), "err");
    toast("הצוות נמחק");
    load();
    refresh();
  };

  if (!teams) return <div className="skeleton" style={{ height: 320 }} aria-busy="true" />;

  const noTeam = staff.filter((m) => !m.team_id);

  return (
    <>
      <div className="views-head">
        <h1 className="page-title">צוותים</h1>
        <button type="button" className="btn primary" onClick={() => setEditing("new")}>+ צוות חדש</button>
      </div>
      <p className="muted perm-intro">
        הצוות קובע מה זה &quot;הצוות שלי&quot; במסך ההרשאות: תפקיד עם היקף &quot;הצוות שלי&quot; רואה את הרשומות שלה ושל חברות הצוות שלה.
      </p>

      {teams.length === 0 && (
        <div className="card empty">
          <p>עוד אין צוותים</p>
          <button type="button" className="btn primary" onClick={() => setEditing("new")}>צרי צוות ראשון</button>
        </div>
      )}

      <div className="team-grid">
        {teams.map((team) => {
          const members = staff.filter((m) => m.team_id === team.id);
          const others = staff.filter((m) => m.team_id !== team.id && m.is_active);
          return (
            <section key={team.id} className="card team-card">
              <div className="team-head">
                <div>
                  <h2 className="section-title">{team.name}</h2>
                  {team.description && <div className="muted">{team.description}</div>}
                </div>
                <div className="perm-role-actions">
                  <button type="button" className="link-btn" onClick={() => setEditing(team)}>עריכה</button>
                  <button type="button" className="link-btn danger" onClick={() => setDeleting(team)}>מחיקה</button>
                </div>
              </div>
              <ul className="team-members">
                {members.length === 0 && <li className="muted">אין עדיין חברות בצוות</li>}
                {members.map((m) => (
                  <li key={m.id}>
                    <span>
                      {m.full_name}
                      {!m.is_active && <span className="tag tag-cancelled team-tag">מושבתת</span>}
                    </span>
                    <button type="button" className="link-btn" onClick={() => assign(m.id, null)}>הוצאה מהצוות</button>
                  </li>
                ))}
              </ul>
              {others.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && assign(e.target.value, team.id)}
                  aria-label={`הוספת משתמשת לצוות ${team.name}`}
                >
                  <option value="">+ הוספת משתמשת לצוות</option>
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}{m.team_id ? ` (עוברת מ${teams.find((t) => t.id === m.team_id)?.name ?? "צוות אחר"})` : ""}
                    </option>
                  ))}
                </select>
              )}
            </section>
          );
        })}
      </div>

      {noTeam.length > 0 && (
        <section className="card settings-card">
          <h2 className="section-title">בלי צוות</h2>
          <p className="muted">{noTeam.map((m) => m.full_name).join(", ")}</p>
        </section>
      )}

      {editing && <TeamModal team={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); refresh(); }} />}
      {deleting && (
        <Confirm
          text={`למחוק את הצוות "${deleting.name}"? המשתמשות בו יישארו בלי צוות.`}
          confirmLabel="מחיקה"
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteTeam(deleting)}
        />
      )}
    </>
  );
}

function TeamModal({ team, onClose, onDone }: { team: Team | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("חובה למלא שם צוות");
    setBusy(true);
    const values = { name: name.trim(), description: description.trim() || null };
    const { error } = team
      ? await supabase.from("teams").update(values).eq("id", team.id)
      : await supabase.from("teams").insert(values);
    setBusy(false);
    if (error) return setError(errorText(error));
    toast(team ? "הצוות נשמר" : "הצוות נוצר");
    onDone();
  };

  return (
    <Modal title={team ? "עריכת צוות" : "צוות חדש"} onClose={onClose}>
      <form className="record-form one-col" onSubmit={submit} noValidate>
        <label className={`field${error ? " has-error" : ""}`}>
          <span>שם הצוות *</span>
          <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        </label>
        <label className="field">
          <span>תיאור</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
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
