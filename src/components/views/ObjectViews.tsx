"use client";
// מסך רשימה גנרי לכל אובייקט. כל ההגדרות (תצוגות, עמודות, סינונים, מיון, קאנבן) נקראות מהמסד
// ונשמרות אליו. אין כאן אף תצוגה ספציפית: המסך יודע רק את המפתח של האובייקט.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import Modal, { Confirm } from "@/components/Modal";
import {
  type Catalog, type FieldMeta, type Row, type ViewRow, type ViewState,
  createView, deleteRecords, deleteView, errorText, loadCatalog, loadViewState, loadViews,
  renameView, runView, saveViewState, setDefaultView, setViewShared, updateRecords,
} from "@/lib/views";
import { formatValue } from "@/lib/format";
import ListView from "./ListView";
import KanbanView from "./KanbanView";
import FilterPanel from "./FilterPanel";
import ColumnsPanel from "./ColumnsPanel";
import RecordForm from "./RecordForm";

const PAGE_SIZE = 25;

type Dialog =
  | { kind: "new" }
  | { kind: "duplicate" }
  | { kind: "rename" }
  | { kind: "delete-view" }
  | { kind: "delete-rows" }
  | { kind: "bulk-set" }
  | { kind: "create-record" }
  | null;

function remember(objectKey: string, viewId?: string) {
  try {
    if (viewId) localStorage.setItem(`ora:view:${objectKey}`, viewId);
    return localStorage.getItem(`ora:view:${objectKey}`);
  } catch {
    return null;
  }
}

export default function ObjectViews({ objectKey }: { objectKey: string }) {
  const { userId, isManager, me } = useAuth();
  const toast = useToast();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [views, setViews] = useState<ViewRow[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [state, setState] = useState<ViewState | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Row[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"filters" | "columns" | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const warnedRef = useRef(false);

  const obj = catalog?.objects.find((o) => o.object_key === objectKey) ?? null;
  const fields = useMemo(
    () => (catalog && obj ? catalog.fields.filter((f) => f.object_id === obj.id) : []),
    [catalog, obj],
  );
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.field_key, f])), [fields]);
  const view = views.find((v) => v.id === viewId) ?? null;
  const canEditView = !!view && (isManager || view.owner_id === userId);

  // ===== טעינה =====
  useEffect(() => {
    if (!me?.is_active) return;
    loadCatalog().then(setCatalog).catch((e) => setLoadError(errorText(e)));
  }, [me?.is_active]);

  const reloadViews = useCallback(
    async (prefer?: string) => {
      if (!obj) return;
      const list = await loadViews(obj.id);
      setViews(list);
      const remembered = remember(objectKey);
      const pick =
        list.find((v) => v.id === prefer) ??
        list.find((v) => v.id === remembered) ??
        list.find((v) => v.is_default) ??
        list[0];
      setViewId(pick?.id ?? null);
    },
    [obj, objectKey],
  );

  useEffect(() => {
    reloadViews().catch((e) => setLoadError(errorText(e)));
  }, [reloadViews]);

  useEffect(() => {
    if (!view) return;
    remember(objectKey, view.id);
    flush(); // שינוי שעוד לא נשמר בתצוגה הקודמת נשמר עכשיו
    setState(null);
    setSelected(new Set());
    setPage(0);
    warnedRef.current = false;
    loadViewState(view, fields).then(setState).catch((e) => setLoadError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // ===== הרצת התצוגה (רשימה) =====
  useEffect(() => {
    if (!state || state.view_type !== "list") return;
    let cancelled = false;
    setLoading(true);
    runView(objectKey, state, { search: debounced, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && toast(errorText(e), "err"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [objectKey, state, debounced, page, refreshKey, toast]);

  // ===== שמירת הגדרות =====
  // כל שינוי חל מיד על המסך. אם מותר לשנות את התצוגה, הוא נשמר במסד.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ viewId: string | null; patch: Partial<ViewState> }>({ viewId: null, patch: {} });
  function flush() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const { viewId: id, patch } = pending.current;
    pending.current = { viewId: null, patch: {} };
    if (id && Object.keys(patch).length) saveViewState(id, patch).catch((e) => toast(errorText(e), "err"));
  }
  const update = (patch: Partial<ViewState>, opts: { debounce?: boolean } = {}) => {
    if (!state || !view) return;
    const next = { ...state, ...patch };
    setState(next);
    if ("filters" in patch || "match" in patch) setPage(0);
    if (!canEditView) {
      if (!warnedRef.current) {
        toast("זו תצוגה משותפת, אז השינוי לא נשמר. שכפלי אותה כדי לשמור תצוגה משלך.");
        warnedRef.current = true;
      }
      return;
    }
    // שינויים רצופים מצטברים ונשמרים יחד, כדי ששום שינוי לא ילך לאיבוד
    pending.current = { viewId: view.id, patch: { ...pending.current.patch, ...patch } };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (opts.debounce) saveTimer.current = setTimeout(flush, 500);
    else flush();
  };

  // ===== פעולות על תצוגות =====
  const doCreateView = async (name: string, type: "list" | "kanban", copy: boolean) => {
    try {
      const id = await createView(objectKey, name, type, copy ? view?.id : undefined);
      // שכפול שומר גם שינויים שעדיין לא נשמרו בתצוגה המקורית
      if (copy && state) await saveViewState(id, state);
      await reloadViews(id);
      toast(copy ? "התצוגה שוכפלה" : "התצוגה נוצרה");
      setDialog(null);
    } catch (e) {
      toast(errorText(e), "err");
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string, prefer?: string) => {
    try {
      await fn();
      await reloadViews(prefer);
      toast(ok);
      setDialog(null);
    } catch (e) {
      toast(errorText(e), "err");
    }
  };

  // ===== פעולות על רשומות =====
  const selectedIds = [...selected];

  const doBulkDelete = async () => {
    try {
      const n = await deleteRecords(objectKey, selectedIds);
      if (n < selectedIds.length) {
        toast(n === 0 ? "לא נמחק דבר. מחיקה מותרת רק למנהלת." : `נמחקו ${n} מתוך ${selectedIds.length}.`, "err");
      } else {
        toast(n === 1 ? "הרשומה נמחקה" : `נמחקו ${n} רשומות`);
      }
    } catch (e) {
      toast(errorText(e), "err");
    }
    setSelected(new Set());
    setDialog(null);
    setRefreshKey((k) => k + 1);
  };

  const doBulkSet = async (field: FieldMeta, value: string) => {
    const typed = field.field_type === "boolean" ? value === "true" : value || null;
    try {
      const n = await updateRecords(objectKey, selectedIds, { [field.field_key]: typed });
      if (n < selectedIds.length) toast(`עודכנו ${n} מתוך ${selectedIds.length}. אין לך הרשאה לשאר.`, "err");
      else toast(n === 1 ? "הרשומה עודכנה" : `עודכנו ${n} רשומות`);
    } catch (e) {
      toast(errorText(e), "err");
    }
    setSelected(new Set());
    setDialog(null);
    setRefreshKey((k) => k + 1);
  };

  // ייצוא התוצאות הנוכחיות (כל העמודים, אחרי סינון וחיפוש) לקובץ CSV שנפתח באקסל
  const doExport = async () => {
    if (!state || !obj) return;
    try {
      const { rows } = await runView(objectKey, state, { search: debounced, limit: 5000 });
      const cols = state.columns.filter((c) => c.visible).map((c) => fieldByKey.get(c.field)).filter(Boolean) as FieldMeta[];
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lines = [cols.map((f) => esc(f.label)).join(","), ...rows.map((r) => cols.map((f) => esc(formatValue(f, r))).join(","))];
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${obj.label_plural}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`יוצאו ${rows.length} שורות`);
    } catch (e) {
      toast(errorText(e), "err");
    }
  };

  // ===== תצוגה =====
  if (me && !me.is_active) return null;
  if (loadError) return <div className="card empty"><p>{loadError}</p></div>;
  if (!catalog || !obj || !state || !view) {
    return (
      <div aria-busy="true">
        <div className="skeleton" style={{ height: 36, width: 240, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  const choiceFields = fields.filter((f) => f.field_type === "choice" || f.field_type === "boolean");
  const bulkFields = choiceFields.filter((f) => f.is_editable);
  const activeFilters = state.filters.length;

  return (
    <div className="views">
      <div className="views-head">
        <h1 className="page-title">{obj.label_plural}</h1>
        {obj.can_create && (
          <button type="button" className="btn primary" onClick={() => setDialog({ kind: "create-record" })}>
            + הוספת {obj.label}
          </button>
        )}
      </div>

      {/* שורת התצוגות */}
      <div className="toolbar">
        <label className="select-wrap">
          <span className="sr-only">תצוגה</span>
          <select value={view.id} onChange={(e) => setViewId(e.target.value)} aria-label="בחירת תצוגה">
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.is_default ? " (ברירת מחדל)" : v.is_shared ? " (משותפת)" : ""}
              </option>
            ))}
          </select>
        </label>
        <details className="menu">
          <summary className="btn">פעולות תצוגה</summary>
          <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
            <button type="button" onClick={() => setDialog({ kind: "new" })}>תצוגה חדשה</button>
            <button type="button" onClick={() => setDialog({ kind: "duplicate" })}>שכפול התצוגה</button>
            <button type="button" disabled={!canEditView} onClick={() => setDialog({ kind: "rename" })}>שינוי שם</button>
            {canEditView && !view.is_default && (
              <button type="button" onClick={() => run(() => setViewShared(view.id, !view.is_shared), view.is_shared ? "התצוגה פרטית עכשיו" : "התצוגה משותפת לכולן", view.id)}>
                {view.is_shared ? "הפיכה לפרטית" : "שיתוף עם כל הצוות"}
              </button>
            )}
            {isManager && !view.is_default && (
              <button type="button" onClick={() => run(() => setDefaultView(view.id), "נקבעה תצוגת ברירת מחדל", view.id)}>
                קביעה כברירת מחדל
              </button>
            )}
            <button type="button" className="danger" disabled={!canEditView || view.is_default} onClick={() => setDialog({ kind: "delete-view" })}>
              מחיקת התצוגה
            </button>
          </div>
        </details>

        <div className="segmented" role="tablist" aria-label="סוג תצוגה">
          {(["list", "kanban"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={state.view_type === t}
              className={state.view_type === t ? "on" : ""}
              disabled={t === "kanban" && choiceFields.length === 0}
              onClick={() =>
                update(
                  t === "kanban" && !state.kanban_field
                    ? { view_type: t, kanban_field: choiceFields[0]?.field_key ?? null }
                    : { view_type: t },
                )
              }
            >
              {t === "list" ? "רשימה" : "קאנבן"}
            </button>
          ))}
        </div>

        <label className="search small">
          <span className="sr-only">חיפוש</span>
          <input type="search" placeholder="חיפוש חופשי" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>

        <button type="button" className={`btn${panel === "filters" ? " on" : ""}`} onClick={() => setPanel(panel === "filters" ? null : "filters")}>
          סינון{activeFilters ? ` (${activeFilters})` : ""}
        </button>
        <button type="button" className={`btn${panel === "columns" ? " on" : ""}`} onClick={() => setPanel(panel === "columns" ? null : "columns")}>
          עמודות
        </button>
        <button type="button" className="btn" onClick={doExport}>ייצוא</button>
      </div>

      {panel === "filters" && <FilterPanel fields={fields} catalog={catalog} state={state} onChange={(p) => update(p, { debounce: true })} />}
      {panel === "columns" && <ColumnsPanel fields={fields} state={state} onChange={(p) => update(p)} />}

      {state.view_type === "kanban" && (
        <div className="kanban-pick">
          <label>
            קיבוץ לפי{" "}
            <select value={state.kanban_field ?? ""} onChange={(e) => update({ kanban_field: e.target.value })}>
              {choiceFields.map((f) => (
                <option key={f.field_key} value={f.field_key}>{f.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {selected.size > 0 && state.view_type === "list" && (
        <div className="bulk-bar" role="region" aria-label="פעולות על הנבחרות">
          <strong>נבחרו {selected.size}</strong>
          {bulkFields.length > 0 && (
            <button type="button" className="btn" onClick={() => setDialog({ kind: "bulk-set" })}>שינוי ערך</button>
          )}
          <button type="button" className="btn" onClick={() => setDialog({ kind: "delete-rows" })}>מחיקה</button>
          <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>ניקוי הבחירה</button>
        </div>
      )}

      {state.view_type === "list" ? (
        <ListView
          fields={fields}
          state={state}
          data={data}
          loading={loading}
          page={page}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          selected={selected}
          onSelect={setSelected}
          onChange={update}
          emptyAction={obj.can_create ? () => setDialog({ kind: "create-record" }) : undefined}
          emptyLabel={obj.label}
        />
      ) : (
        <KanbanView
          objectKey={objectKey}
          fields={fields}
          state={state}
          search={debounced}
          refreshKey={refreshKey}
        />
      )}

      {/* ===== חלונות ===== */}
      {(dialog?.kind === "new" || dialog?.kind === "duplicate" || dialog?.kind === "rename") && (
        <NameDialog
          title={dialog.kind === "new" ? "תצוגה חדשה" : dialog.kind === "duplicate" ? "שכפול תצוגה" : "שינוי שם"}
          initial={dialog.kind === "rename" ? view.name : dialog.kind === "duplicate" ? `${view.name} (עותק)` : ""}
          askType={dialog.kind === "new"}
          onClose={() => setDialog(null)}
          onSave={(name, type) =>
            dialog.kind === "rename"
              ? run(() => renameView(view.id, name), "השם עודכן", view.id)
              : doCreateView(name, type, dialog.kind === "duplicate")
          }
        />
      )}
      {dialog?.kind === "delete-view" && (
        <Confirm
          text={`למחוק את התצוגה "${view.name}"? הנתונים עצמם לא יימחקו.`}
          confirmLabel="מחיקה"
          onClose={() => setDialog(null)}
          onConfirm={() => run(() => deleteView(view.id), "התצוגה נמחקה")}
        />
      )}
      {dialog?.kind === "delete-rows" && (
        <Confirm
          text={`למחוק ${selected.size === 1 ? "את הרשומה הנבחרת" : `${selected.size} רשומות`}? אי אפשר לבטל.`}
          confirmLabel="מחיקה"
          onClose={() => setDialog(null)}
          onConfirm={doBulkDelete}
        />
      )}
      {dialog?.kind === "bulk-set" && (
        <BulkSetDialog fields={bulkFields} count={selected.size} onClose={() => setDialog(null)} onSave={doBulkSet} />
      )}
      {dialog?.kind === "create-record" && (
        <RecordForm
          obj={obj}
          fields={fields}
          catalog={catalog}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function NameDialog({
  title, initial, askType, onSave, onClose,
}: {
  title: string;
  initial: string;
  askType: boolean;
  onSave: (name: string, type: "list" | "kanban") => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [type, setType] = useState<"list" | "kanban">("list");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim(), type);
        }}
      >
        <label className="field">
          <span>שם התצוגה</span>
          <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {askType && (
          <label className="field">
            <span>סוג</span>
            <select value={type} onChange={(e) => setType(e.target.value as "list" | "kanban")}>
              <option value="list">רשימה</option>
              <option value="kanban">קאנבן</option>
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button type="submit" className="btn primary">שמירה</button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}

function BulkSetDialog({
  fields, count, onSave, onClose,
}: {
  fields: FieldMeta[];
  count: number;
  onSave: (field: FieldMeta, value: string) => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState(fields[0].field_key);
  const field = fields.find((f) => f.field_key === key)!;
  const [value, setValue] = useState(field.options?.[0]?.value ?? "");
  return (
    <Modal title={`שינוי ערך ב-${count} רשומות`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(field, value);
        }}
      >
        <label className="field">
          <span>שדה</span>
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setValue(fields.find((f) => f.field_key === e.target.value)?.options?.[0]?.value ?? "");
            }}
          >
            {fields.map((f) => (
              <option key={f.field_key} value={f.field_key}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>ערך חדש</span>
          <select value={value} onChange={(e) => setValue(e.target.value)}>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="submit" className="btn primary">עדכון</button>
          <button type="button" className="btn" onClick={onClose}>ביטול</button>
        </div>
      </form>
    </Modal>
  );
}
