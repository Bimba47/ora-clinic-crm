"use client";
// מסך רשימה גנרי לכל אובייקט. כל ההגדרות (תצוגות, עמודות, סינונים, מיון, קאנבן) נקראות מהמסד
// ונשמרות אליו. אין כאן אף תצוגה ספציפית: המסך יודע רק את המפתח של האובייקט.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import Modal, { Confirm } from "@/components/Modal";
import Icon from "@/components/Icon";
import {
  type Catalog, type FieldMeta, type Row, type ViewRow, type ViewState,
  createView, deleteRecords, deleteView, errorText, loadCatalog, loadRecord, loadViewState, loadViews,
  renameView, runView, saveViewState, setDefaultView, setViewShared, updateRecords,
} from "@/lib/views";
import { RECORDS, linkHref, recordHref, saveListSnapshot, saveNav, takeListSnapshot } from "@/lib/records";
import { openNotification } from "@/components/NotificationBell";
import { formatTime, formatValue } from "@/lib/format";
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
  | { kind: "edit-record"; row: Row }
  | { kind: "cancel-row"; row: Row; value: string }
  | null;

function remember(objectKey: string, viewId?: string) {
  try {
    if (viewId) localStorage.setItem(`ora:view:${objectKey}`, viewId);
    return localStorage.getItem(`ora:view:${objectKey}`);
  } catch {
    return null;
  }
}

// headerActions: כפתורים נוספים בכותרת (למשל "סמני הכול כנקרא"). reloadToken: שינוי שלו טוען את הרשימה מחדש.
export default function ObjectViews({
  objectKey, headerActions, reloadToken = 0,
}: {
  objectKey: string;
  headerActions?: React.ReactNode;
  reloadToken?: number;
}) {
  const { userId, isManager, me, can } = useAuth();
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
  // הוספה ומחיקה לפי טבלת ההרשאות (המסד אוכף את אותו הדבר)
  const canCreate = !!obj?.can_create && can(objectKey, "create");
  const canDelete = can(objectKey, "delete");
  const router = useRouter();
  const pathname = usePathname();
  const lastSearch = useRef("");

  // לחיצה על רשומה פותחת את מסך הרשומה. לפני כן נשמרים סדר הרשומות בתצוגה (לקודמת/הבאה)
  // ומצב הרשימה (תצוגה, סינון, מיון, חיפוש, עמוד), כדי שהחזרה תחזיר אותו.
  // התראה: מסומנת כנקראה ופותחת את הקריאה שלה (לפי האפיון).
  const openRow = async (row: Row) => {
    try {
      if (objectKey === "notifications") {
        // התראה: מסומנת כנקראה ומובילה לרשומה שהיא מקשרת אליה (לפי האפיון)
        const n = await loadRecord("notifications", row.id, ["object_key", "record_id", "is_read"]);
        router.push(await openNotification({ id: row.id, is_read: !!n.is_read, object_key: (n.object_key as string) ?? null, record_id: (n.record_id as string) ?? null }));
        setRefreshKey((k) => k + 1);
        return;
      }
      const href = recordHref(objectKey, row.id);
      if (!href) return setDialog({ kind: "edit-record", row });
      if (state && view && obj) {
        saveListSnapshot(objectKey, { viewId: view.id, state, search, page });
        let ids = (data?.rows ?? [row]).map((r) => r.id);
        try {
          ids = (await runView(objectKey, state, { search: debounced, limit: 2000 })).rows.map((r) => r.id);
        } catch {}
        saveNav(objectKey, { ids, backHref: pathname, backLabel: obj.label_plural });
      }
      router.push(href);
    } catch (e) {
      toast(errorText(e), "err");
    }
  };
  // שדה מקושר (למשל "לקוחה" בתור) מוצג כקישור למסך הרשומה שלו
  const refHref = (f: FieldMeta, row: Row) =>
    f.field_type === "reference"
      ? linkHref(catalog?.objects.find((o) => o.id === f.ref_object_id)?.object_key, row[f.field_key], isManager)
      : null;
  // הוספה: אובייקט עם מסך רשומה נפתח במסך "חדש", אחרת בחלון
  const createNew = () => {
    const cfg = RECORDS[objectKey];
    if (cfg) router.push(`${cfg.route}new`);
    else setDialog({ kind: "create-record" });
  };

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
    loadViewState(view, fields)
      .then((s) => {
        // חזרה ממסך רשומה: אותו סינון, מיון, חיפוש ועמוד שהיו (גם אם לא נשמרו בתצוגה)
        const snap = takeListSnapshot<ViewState>(objectKey);
        if (snap && snap.viewId === view.id) {
          lastSearch.current = snap.search;
          setSearch(snap.search);
          setDebounced(snap.search);
          setState(snap.state);
          setPage(snap.page);
        } else {
          setState(s);
        }
      })
      .catch((e) => setLoadError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (lastSearch.current === search) return; // בלי שינוי אמיתי בחיפוש, העמוד נשאר
      lastSearch.current = search;
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
  }, [objectKey, state, debounced, page, refreshKey, reloadToken, toast]);

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

  // ייצוא התוצאות הנוכחיות (כל העמודים, אחרי סינון וחיפוש) לקובץ CSV שנפתח באקסל.
  // כשמועברות שורות מסומנות, מיוצאות רק הן.
  const doExport = async (only?: Set<string>) => {
    if (!state || !obj) return;
    try {
      const all = (await runView(objectKey, state, { search: debounced, limit: 5000 })).rows;
      const rows = only ? all.filter((r) => only.has(r.id)) : all;
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

  // ===== שינוי סטטוס בשורה (Optimistic: מתעדכן מיד, וחוזר אחורה אם השמירה נכשלה) =====
  const sf = fieldByKey.get("status");
  const statusField = sf && sf.field_type === "choice" && sf.is_editable && can(objectKey, "edit") ? sf : undefined;
  const applyStatus = async (row: Row, value: string) => {
    const prev = row.status;
    const patchRows = (v: unknown) =>
      setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, status: v } : r)) } : d));
    patchRows(value);
    try {
      const n = await updateRecords(objectKey, [row.id], { status: value });
      if (n === 0) throw new Error("אין לך הרשאה לשנות את הרשומה הזו.");
      toast(objectKey === "appointments" ? "התור עודכן" : objectKey === "service_requests" ? "הקריאה עודכנה" : "הסטטוס עודכן");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      patchRows(prev);
      toast(errorText(e), "err");
    }
  };
  const changeStatus = (row: Row, value: string) => {
    if (value === "cancelled") setDialog({ kind: "cancel-row", row, value });
    else applyStatus(row, value);
  };
  // "לבטל את התור של דנה לוי ביום ג׳ 14.10 ב-09:30?"
  const cancelText = (row: Row) => {
    const who = Object.entries(row).find(([k, v]) => k.endsWith("__label") && k.startsWith("client") && v)?.[1];
    const when = typeof row.starts_at === "string" ? new Date(row.starts_at) : null;
    const day = when
      ? ` ב${new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(when)} ${new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }).format(when)} ב-${formatTime(row.starts_at as string)}`
      : "";
    return `לבטל את ה${obj.label}${who ? ` של ${who}` : ""}${day}?`;
  };

  return (
    <div className="views">
      <div className="views-head">
        <h1 className="page-title">{obj.label_plural}</h1>
        {headerActions && <div className="head-extra">{headerActions}</div>}
        {canCreate && (
          <button type="button" className="btn primary cta" onClick={createNew}>
            + הוספת {obj.label}
          </button>
        )}
      </div>

      {/* שורת התצוגה: איזו תצוגה ואיך מוצג המידע */}
      <div className="view-bar">
        <div className="btn-group" role="group" aria-label="תצוגה">
          <select value={view.id} onChange={(e) => setViewId(e.target.value)} aria-label="בחירת תצוגה">
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.is_default ? " (ברירת מחדל)" : v.is_shared ? " (משותפת)" : ""}
              </option>
            ))}
          </select>
          <details className="menu">
            <summary className="group-btn" aria-label="פעולות תצוגה" title="פעולות תצוגה">⋯</summary>
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
        </div>

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

        {state.view_type === "kanban" && (
          <label className="kanban-pick">
            קיבוץ לפי
            <select value={state.kanban_field ?? ""} onChange={(e) => update({ kanban_field: e.target.value })}>
              {choiceFields.map((f) => (
                <option key={f.field_key} value={f.field_key}>{f.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* שורת הטבלה: חיפוש וכלים. כשיש שורות מסומנות היא מתחלפת בפעולות על הנבחרות */}
      {selected.size > 0 && state.view_type === "list" ? (
        <div className="table-bar bulk" role="region" aria-label="פעולות על הנבחרות">
          <strong>נבחרו {selected.size}</strong>
          <div className="table-tools">
            {bulkFields.length > 0 && (
              <button type="button" className="btn outline" onClick={() => setDialog({ kind: "bulk-set" })}>שינוי ערך</button>
            )}
            <button type="button" className="btn outline" onClick={() => doExport(selected)}>ייצוא הנבחרות</button>
            {canDelete && <button type="button" className="btn outline danger" onClick={() => setDialog({ kind: "delete-rows" })}>מחיקה</button>}
            <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>ניקוי הבחירה</button>
          </div>
        </div>
      ) : (
        <div className="table-bar">
          <label className="search">
            <Icon name="search" />
            <span className="sr-only">חיפוש</span>
            <input type="search" placeholder={`חיפוש ב${obj.label_plural}`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="table-tools">
            <button type="button" className={`btn outline${panel === "filters" || activeFilters ? " on" : ""}`} aria-pressed={panel === "filters"} onClick={() => setPanel(panel === "filters" ? null : "filters")}>
              סינון{activeFilters ? ` (${activeFilters})` : ""}
            </button>
            <button type="button" className={`btn outline${panel === "columns" ? " on" : ""}`} aria-pressed={panel === "columns"} onClick={() => setPanel(panel === "columns" ? null : "columns")}>
              עמודות
            </button>
            <button type="button" className="btn outline" onClick={() => doExport()}>ייצוא</button>
          </div>
        </div>
      )}

      {panel === "filters" && <FilterPanel fields={fields} catalog={catalog} state={state} onChange={(p) => update(p, { debounce: true })} allowRelative relativeTimes={false} />}
      {panel === "columns" && <ColumnsPanel fields={fields} state={state} onChange={(p) => update(p)} />}

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
          onOpen={openRow}
          refHref={refHref}
          emptyAction={canCreate ? createNew : undefined}
          emptyLabel={obj.label}
          statusField={statusField}
          onStatus={statusField ? changeStatus : undefined}
        />
      ) : (
        <KanbanView
          objectKey={objectKey}
          fields={fields}
          state={state}
          search={debounced}
          refreshKey={refreshKey + reloadToken}
          onOpen={openRow}
          refHref={refHref}
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
      {dialog?.kind === "cancel-row" && (
        <Confirm
          text={cancelText(dialog.row)}
          confirmLabel={`כן, לבטל`}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            applyStatus(dialog.row, dialog.value);
          }}
        />
      )}
      {dialog?.kind === "bulk-set" && (
        <BulkSetDialog fields={bulkFields} count={selected.size} onClose={() => setDialog(null)} onSave={doBulkSet} />
      )}
      {(dialog?.kind === "create-record" || dialog?.kind === "edit-record") && (
        <RecordForm
          key={dialog.kind === "edit-record" ? dialog.row.id : "new"}
          obj={obj}
          fields={fields}
          catalog={catalog}
          row={dialog.kind === "edit-record" ? dialog.row : undefined}
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
