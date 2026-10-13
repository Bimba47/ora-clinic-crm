"use client";
// לוחות בקרה: המסך הראשי. בחירת לוח, סינון ברמת הלוח (טווח תאריכים ונציגה), גריד של ווידג'טים
// שאפשר לגרור ולשנות את גודלם (נשמר מיד), ותפריט פעולות לכל ווידג'ט. אין מסך דוחות: הכול נבנה מכאן.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import Modal, { Confirm } from "@/components/Modal";
import { errorText, loadCatalog, loadRefOptions, type Catalog, type RefOption } from "@/lib/views";
import type { Dashboard, DashFilters, Widget } from "@/lib/dashboards";
import WidgetView from "./WidgetView";
import WidgetBuilder from "./WidgetBuilder";

const COLS = 12;
const ROW_H = 72;
const GAP = 16;
type Box = Pick<Widget, "position_x" | "position_y" | "width" | "height">;

export default function Dashboards() {
  const { userId, isManager, me } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [boards, setBoards] = useState<Dashboard[] | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [dash, setDash] = useState<DashFilters>({});
  const [staff, setStaff] = useState<RefOption[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [builder, setBuilder] = useState<Widget | "new" | null>(null);
  const [dialog, setDialog] = useState<null | "new" | "settings" | "delete" | "duplicate">(null);
  const [delWidget, setDelWidget] = useState<Widget | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");

  const board = boards?.find((b) => b.id === current) ?? null;
  const canEdit = !!board && (isManager || (board.owner_id === userId && !board.is_shared));

  const loadBoards = useCallback(async () => {
    const { data, error } = await supabase
      .from("dashboards")
      .select("id, name, owner_id, is_shared, role_visibility, filters, position")
      .order("position")
      .order("created_at");
    if (error) throw error;
    return data as Dashboard[];
  }, []);

  // טעינה ראשונה: הקטלוג, הלוחות שגלויים לי, הצוות (לסינון) והתפקידים (לנראות לוח)
  useEffect(() => {
    (async () => {
      try {
        const [cat, list, rl] = await Promise.all([loadCatalog(), loadBoards(), supabase.from("roles").select("id, name").order("name")]);
        setCatalog(cat);
        setBoards(list);
        setRoles((rl.data as { id: string; name: string }[]) ?? []);
        const staffObj = cat.objects.find((o) => o.object_key === "staff");
        if (staffObj) loadRefOptions(staffObj, cat).then((o) => setStaff(o.filter((x) => !x.inactive))).catch(() => {});
        let remembered: string | null = null;
        try { remembered = localStorage.getItem("ora:dashboard"); } catch {}
        const wanted = params.get("d") ?? remembered;
        setCurrent((list.find((b) => b.id === wanted) ?? list[0])?.id ?? null);
      } catch (e) {
        setError(errorText(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // הלוח הנבחר: הווידג'טים שלו והסינון השמור. מטפלת רואה כברירת מחדל את מה ששלה.
  useEffect(() => {
    if (!board) return;
    try { localStorage.setItem("ora:dashboard", board.id); } catch {}
    setEditing(false);
    setDash({ ...board.filters, owner: board.filters.owner ?? (isManager ? "" : userId ?? "") });
    supabase
      .from("dashboard_widgets")
      .select("*")
      .eq("dashboard_id", board.id)
      .order("position_y")
      .order("position_x")
      .then(({ data, error }) => {
        if (error) toast(errorText(error), "err");
        setWidgets((data as Widget[]) ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id]);

  const refreshWidgets = async () => {
    if (!board) return;
    const { data } = await supabase.from("dashboard_widgets").select("*").eq("dashboard_id", board.id);
    setWidgets((data as Widget[]) ?? []);
    setReload((n) => n + 1);
  };
  const nextY = widgets.reduce((m, w) => Math.max(m, w.position_y + w.height), 0);

  // ===== סידור: גרירה ושינוי גודל, ושמירה מיד בשורת הווידג'ט =====
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; box: Box } | null>(null);
  const startDrag = (w: Widget, mode: "move" | "resize", e: React.PointerEvent) => {
    if (!editing || !gridRef.current) return;
    e.preventDefault();
    const colW = (gridRef.current.clientWidth + GAP) / COLS;
    const sx = e.clientX;
    const sy = e.clientY;
    const orig: Box = { position_x: w.position_x, position_y: w.position_y, width: w.width, height: w.height };
    let box = orig;
    const onMove = (ev: PointerEvent) => {
      const dc = Math.round(-(ev.clientX - sx) / colW); // מימין לשמאל: תזוזה שמאלה = עמודה גבוהה יותר
      const dr = Math.round((ev.clientY - sy) / (ROW_H + GAP));
      box = mode === "move"
        ? { ...orig, position_x: clamp(orig.position_x + dc, 0, COLS - orig.width), position_y: Math.max(0, orig.position_y + dr) }
        : { ...orig, width: clamp(orig.width + dc, 1, COLS - orig.position_x), height: clamp(orig.height + dr, 1, 12) };
      setDrag({ id: w.id, box });
    };
    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      const placed = settle(widgets, w.id, box);
      const changed = placed.filter((p) => {
        const old = widgets.find((x) => x.id === p.id)!;
        return old.position_x !== p.position_x || old.position_y !== p.position_y || old.width !== p.width || old.height !== p.height;
      });
      setWidgets(placed);
      const results = await Promise.all(
        changed.map((p) =>
          supabase.from("dashboard_widgets")
            .update({ position_x: p.position_x, position_y: p.position_y, width: p.width, height: p.height })
            .eq("id", p.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed) {
        toast(errorText(failed.error), "err");
        setWidgets(widgets);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const duplicateWidget = async (w: Widget) => {
    const { id: _id, ...rest } = w;
    void _id;
    const { error } = await supabase.from("dashboard_widgets").insert({ ...rest, title: w.title ? `${w.title} (עותק)` : "", position_y: nextY });
    if (error) return toast(errorText(error), "err");
    toast("הווידג'ט שוכפל");
    refreshWidgets();
  };
  const deleteWidget = async (w: Widget) => {
    setDelWidget(null);
    const { error } = await supabase.from("dashboard_widgets").delete().eq("id", w.id);
    if (error) return toast(errorText(error), "err");
    toast("הווידג'ט נמחק");
    setWidgets((ws) => ws.filter((x) => x.id !== w.id));
  };

  const saveDashFilters = async () => {
    if (!board) return;
    const filters = { date_from: dash.date_from || undefined, date_to: dash.date_to || undefined, owner: dash.owner || undefined };
    const { error } = await supabase.from("dashboards").update({ filters }).eq("id", board.id);
    if (error) return toast(errorText(error), "err");
    setBoards((bs) => bs!.map((b) => (b.id === board.id ? { ...b, filters } : b)));
    toast("הסינון נשמר כברירת המחדל של הלוח");
  };

  const pick = (id: string) => {
    setCurrent(id);
    router.replace(`/?d=${id}`);
  };
  const afterBoardChange = async (selectId?: string | null) => {
    const list = await loadBoards();
    setBoards(list);
    setCurrent((selectId && list.find((b) => b.id === selectId)?.id) || list[0]?.id || null);
  };

  const ordered = useMemo(() => [...widgets].sort((a, b) => a.position_y - b.position_y || a.position_x - b.position_x), [widgets]);

  if (error) return <div className="card"><p className="field-error">{error}</p></div>;
  if (!catalog || !boards) return <div className="dash-skeleton" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}</div>;

  return (
    <div className="dashboards">
      <div className="dash-head">
        <div className="dash-pick">
          <h1 className="page-title">{board?.name ?? "לוחות בקרה"}</h1>
          {boards.length > 1 && (
            <select className="compact-select" value={current ?? ""} onChange={(e) => pick(e.target.value)} aria-label="בחירת לוח">
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_shared ? "" : " (פרטי)"}</option>)}
            </select>
          )}
        </div>
        <div className="head-buttons">
          {canEdit && (
            <button type="button" className={`btn outline${editing ? " on" : ""}`} onClick={() => setEditing(!editing)} aria-pressed={editing}>
              {editing ? "סיום סידור" : "סידור הלוח"}
            </button>
          )}
          <details className="menu">
            <summary className="btn outline" aria-label="פעולות לוח">⋯</summary>
            <div className="menu-list card">
              <button type="button" onClick={() => setDialog("new")}>לוח חדש</button>
              {board && <button type="button" onClick={() => setDialog("duplicate")}>שכפול הלוח</button>}
              {canEdit && <button type="button" onClick={() => setDialog("settings")}>הגדרות הלוח</button>}
              {canEdit && <button type="button" className="danger" onClick={() => setDialog("delete")}>מחיקת הלוח</button>}
            </div>
          </details>
          {canEdit && <button type="button" className="btn primary cta" onClick={() => setBuilder("new")}>+ ווידג'ט</button>}
        </div>
      </div>

      {board && (
        <div className="dash-filters card">
          <label className="field">
            <span>מתאריך</span>
            <input type="date" dir="ltr" value={dash.date_from ?? ""} onChange={(e) => setDash({ ...dash, date_from: e.target.value })} />
          </label>
          <label className="field">
            <span>עד תאריך</span>
            <input type="date" dir="ltr" value={dash.date_to ?? ""} onChange={(e) => setDash({ ...dash, date_to: e.target.value })} />
          </label>
          <label className="field">
            <span>של מי</span>
            <select value={dash.owner ?? ""} onChange={(e) => setDash({ ...dash, owner: e.target.value })}>
              <option value="">כל הצוות</option>
              {userId && <option value={userId}>שלי ({me?.full_name})</option>}
              {staff.filter((s) => s.value !== userId).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <div className="dash-filter-actions">
            {(dash.date_from || dash.date_to) && (
              <button type="button" className="link-btn" onClick={() => setDash({ ...dash, date_from: "", date_to: "" })}>ניקוי תאריכים</button>
            )}
            {canEdit && <button type="button" className="link-btn" onClick={saveDashFilters}>שמירה כברירת מחדל</button>}
          </div>
        </div>
      )}

      {!board ? (
        <div className="card empty">
          <p>עוד אין לוחות בקרה</p>
          <button type="button" className="btn primary" onClick={() => setDialog("new")}>צרי לוח ראשון</button>
        </div>
      ) : widgets.length === 0 ? (
        <div className="card empty">
          <p>הלוח ריק</p>
          {canEdit && <button type="button" className="btn primary" onClick={() => setBuilder("new")}>הוסיפי ווידג'ט</button>}
        </div>
      ) : (
        <div ref={gridRef} className={`dash-grid${editing ? " editing" : ""}`} style={{ gridAutoRows: `${ROW_H}px`, gap: GAP }}>
          {ordered.map((w) => {
            const box = drag?.id === w.id ? drag.box : w;
            return (
              <section
                key={w.id}
                className={`card widget widget-${w.widget_type}${drag?.id === w.id ? " dragging" : ""}`}
                style={{ gridColumn: `${box.position_x + 1} / span ${box.width}`, gridRow: `${box.position_y + 1} / span ${box.height}` }}
              >
                {(w.title || canEdit) && (
                  <div
                    className={`widget-head${editing ? " grab" : ""}${w.title ? "" : " floating"}`}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).closest("button, summary, a")) return;
                      startDrag(w, "move", e);
                    }}
                  >
                    {w.title && <h2 className="widget-title">{w.title}</h2>}
                    {canEdit && (
                      <details className="menu widget-menu">
                        <summary className="icon-btn" aria-label={`פעולות: ${w.title || "ווידג'ט"}`}>⋯</summary>
                        <div className="menu-list card">
                          <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setBuilder(w); }}>עריכה</button>
                          <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; duplicateWidget(w); }}>שכפול</button>
                          <button type="button" className="danger" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setDelWidget(w); }}>מחיקה</button>
                        </div>
                      </details>
                    )}
                  </div>
                )}
                <div className="widget-body">
                  <WidgetView widget={w} catalog={catalog} dash={dash} reloadToken={reload} />
                </div>
                {editing && (
                  <span className="widget-resize" aria-hidden="true" onPointerDown={(e) => startDrag(w, "resize", e)} title="שינוי גודל" />
                )}
              </section>
            );
          })}
        </div>
      )}

      {builder && board && (
        <WidgetBuilder
          catalog={catalog}
          dashboardId={board.id}
          widget={builder === "new" ? null : builder}
          nextY={nextY}
          dash={dash}
          onClose={() => setBuilder(null)}
          onSaved={() => { setBuilder(null); refreshWidgets(); }}
        />
      )}
      {delWidget && (
        <Confirm text={`למחוק את הווידג'ט "${delWidget.title || "טקסט"}"?`} confirmLabel="מחיקה" onClose={() => setDelWidget(null)} onConfirm={() => deleteWidget(delWidget)} />
      )}
      {dialog === "new" && (
        <NameDialog title="לוח חדש" initial="" onClose={() => setDialog(null)} onSave={async (name) => {
          const { data, error } = await supabase.from("dashboards").insert({ name, owner_id: userId, is_shared: false, position: boards.length }).select("id").single();
          if (error) throw error;
          toast("הלוח נוצר");
          setDialog(null);
          await afterBoardChange(data.id);
          setEditing(true);
        }} />
      )}
      {dialog === "duplicate" && board && (
        <NameDialog title="שכפול הלוח" initial={`${board.name} (עותק)`} onClose={() => setDialog(null)} onSave={async (name) => {
          const { data, error } = await supabase.rpc("duplicate_dashboard", { p_id: board.id, p_name: name });
          if (error) throw error;
          toast("הלוח שוכפל (כלוח פרטי שלך)");
          setDialog(null);
          await afterBoardChange(data as string);
        }} />
      )}
      {dialog === "settings" && board && (
        <SettingsDialog board={board} roles={roles} isManager={isManager} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await afterBoardChange(board.id); }} />
      )}
      {dialog === "delete" && board && (
        <Confirm text={`למחוק את הלוח "${board.name}" וכל הווידג'טים שבו?`} confirmLabel="מחיקה" onClose={() => setDialog(null)} onConfirm={async () => {
          setDialog(null);
          const { error } = await supabase.from("dashboards").delete().eq("id", board.id);
          if (error) return toast(errorText(error), "err");
          toast("הלוח נמחק");
          await afterBoardChange(null);
        }} />
      )}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const hit = (a: Box, b: Box) =>
  a.position_x < b.position_x + b.width && b.position_x < a.position_x + a.width &&
  a.position_y < b.position_y + b.height && b.position_y < a.position_y + a.height;

// אחרי גרירה או שינוי גודל:
// 1. נחיתה בדיוק על ווידג'ט באותו גודל = החלפת מקומות.
// 2. אחרת הווידג'ט שזז נשאר במקומו, ומי שמתנגש בו יורד מתחתיו.
// 3. בסוף כולם "עולים" למעלה כמה שאפשר, כדי שלא יישארו חורים בלוח.
function settle(ws: Widget[], movedId: string, box: Box): Widget[] {
  const orig = ws.find((w) => w.id === movedId)!;
  const moved = { ...orig, ...box };
  const swapWith = ws.find((w) => w.id !== movedId && w.position_x === box.position_x && w.position_y === box.position_y
    && w.width === box.width && w.height === box.height);
  let list = ws.map((w) =>
    w.id === movedId ? moved
      : swapWith && w.id === swapWith.id ? { ...w, position_x: orig.position_x, position_y: orig.position_y }
      : { ...w });
  if (!swapWith) {
    const others = list.filter((w) => w.id !== movedId).sort((a, b) => a.position_y - b.position_y || a.position_x - b.position_x);
    const placed: Widget[] = [moved];
    for (const cur of others) {
      let blocker = placed.find((p) => hit(cur, p));
      while (blocker) {
        cur.position_y = blocker.position_y + blocker.height;
        blocker = placed.find((p) => hit(cur, p));
      }
      placed.push(cur);
    }
    list = placed;
  }
  // דחיסה למעלה, לפי הסדר מלמעלה למטה
  const sorted = [...list].sort((a, b) => a.position_y - b.position_y || a.position_x - b.position_x);
  const done: Widget[] = [];
  for (const w of sorted) {
    const cur = { ...w };
    while (cur.position_y > 0 && !done.some((d) => hit({ ...cur, position_y: cur.position_y - 1 }, d))) cur.position_y -= 1;
    done.push(cur);
  }
  return done;
}

function NameDialog({ title, initial, onClose, onSave }: { title: string; initial: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="record-form one-col" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError("חובה לתת שם");
        setBusy(true);
        try { await onSave(name.trim()); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
      }}>
        <label className={`field${error ? " has-error" : ""}`}>
          <span>שם הלוח *</span>
          <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        </label>
        {error && <p className="field-error form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={busy}>{busy && <span className="spinner" aria-hidden="true" />}שמירה</button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}

// הגדרות לוח: שם, ושיתוף ונראות לפי תפקיד (מנהלת מערכת)
function SettingsDialog({
  board, roles, isManager, onClose, onSaved,
}: { board: Dashboard; roles: { id: string; name: string }[]; isManager: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(board.name);
  const [shared, setShared] = useState(board.is_shared);
  const [vis, setVis] = useState<string[]>(board.role_visibility ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="הגדרות הלוח" onClose={onClose}>
      <form className="record-form one-col" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError("חובה לתת שם");
        setBusy(true);
        const { error } = await supabase.from("dashboards").update({ name: name.trim(), is_shared: shared, role_visibility: shared ? vis : [] }).eq("id", board.id);
        setBusy(false);
        if (error) return setError(errorText(error));
        toast("הלוח נשמר");
        onSaved();
      }}>
        <label className="field"><span>שם הלוח *</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        {isManager && (
          <>
            <label className="check-field"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /><span>לוח משותף לצוות</span></label>
            {shared && (
              <fieldset className="auto-fieldset">
                <legend>לאילו תפקידים הלוח מוצג (בלי סימון: לכולם)</legend>
                <div className="check-list">
                  {roles.map((r) => (
                    <label key={r.id} className="check-field compact">
                      <input type="checkbox" checked={vis.includes(r.id)} onChange={(e) => setVis(e.target.checked ? [...vis, r.id] : vis.filter((x) => x !== r.id))} />
                      <span>{r.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}
        {error && <p className="field-error form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={busy}>{busy && <span className="spinner" aria-hidden="true" />}שמירה</button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}
