"use client";
// מסך רשומה בודדת, אחד לכל האובייקטים. המבנה (שדות קריטיים, קבוצות, לשוניות) קבוע ב-src/lib/records.ts
// לפי האפיון. השדות עצמם (סוג, תווית, חובה, עריכה) מגיעים מהקטלוג במסד, והכול נקרא ונשמר בהרשאות המשתמשת (RLS).
//
// מבנה: כותרת עם שם הרשומה והשדות הקריטיים, שדות מחושבים, קבוצות שדות, לשוניות לרשומות המקושרות, ופרטי מעקב בתחתית.
// פעולות: יצירה (/…/new), עריכה ושמירה במקום, ביטול שמחזיר את הערכים, מחיקה עם אישור (חסומה כשיש רשומות בנות),
// שכפול, קודמת/הבאה לפי התצוגה שממנה הגעתי, וחזרה לרשימה עם הסינון, המיון והחיפוש שהיו.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import Modal, { Confirm } from "@/components/Modal";
import RecordForm, { CREATED_TOAST, FieldInput, copyFromRef, newDefault, toInput, toValue } from "@/components/views/RecordForm";
import { type ChildDef, type RecordNav, RECORDS, linkHref, markListRestore, readNav, recordHref, saveNav } from "@/lib/records";
import {
  type Catalog, type FieldMeta, type Row,
  createRecord, deleteRecords, errorField, errorText, loadCatalog, loadRefOptions, updateRecords,
  pickOptions,
} from "@/lib/views";
import { formatDate, formatDateTime, formatHours, formatPhone, formatTime, formatValue, isLtr, whatsappHref } from "@/lib/format";
import { adminApi } from "@/lib/adminApi";

type Rec = Record<string, unknown> & { id: string };
type Dialog =
  | { kind: "delete" }
  | { kind: "blocked"; text: string }
  | { kind: "child"; child: ChildDef; rowId?: string } // הוספה, או עריכה של רשומה בת בלי לצאת מהמסך
  | null;

const LEAVE_MSG = "יש שינויים שלא נשמרו. לצאת בלי לשמור?";
const OLD_REQUEST_MS = 48 * 60 * 60 * 1000;
const TRACKING = ["created_at", "created_by", "updated_at", "updated_by"];

function normalizePhone(p: string) {
  return p.replace(/\D/g, "").replace(/^972/, "0");
}

const ago = (ms: number) => formatHours(Math.floor(ms / 3600000));

export default function RecordPage({ objectKey, id }: { objectKey: string; id: string }) {
  const cfg = RECORDS[objectKey];
  const isNew = id === "new";
  const router = useRouter();
  const { me, userId, isManager, can } = useAuth();
  const toast = useToast();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rec, setRec] = useState<Rec | null | undefined>(undefined); // undefined = טוען, null = לא נמצאה
  const [labels, setLabels] = useState<Map<string, Map<string, string>>>(new Map());
  const [phones, setPhones] = useState<Map<string, string>>(new Map()); // טלפון של רשומה מקושרת (למשל הלקוחה בתור)
  const [children, setChildren] = useState<Record<string, Rec[]>>({});
  const [nav, setNav] = useState<RecordNav | null>(null);
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(isNew);
  const [values, setValues] = useState<Record<string, string>>({});
  const [snapshot, setSnapshot] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const obj = catalog?.objects.find((o) => o.object_key === objectKey);
  const fields = useMemo(
    () => (catalog && obj ? catalog.fields.filter((f) => f.object_id === obj.id && !f.computed) : []),
    [catalog, obj],
  );
  const byKey = useMemo(() => new Map(fields.map((f) => [f.field_key, f])), [fields]);
  const editable = fields.filter((f) => f.is_editable);
  // מה מותר לי, לפי טבלת ההרשאות (המסד אוכף גם את ההיקף: שלי / הצוות שלי)
  const canEdit = can(objectKey, "edit");
  const canCreate = can(objectKey, "create") && !!obj?.can_create;
  const canDelete = can(objectKey, "delete");
  const phoneField = fields.find((f) => f.field_type === "phone");

  useEffect(() => setNav(readNav(objectKey)), [objectKey]);
  // החץ "חזרה" בכותרת העליונה: הרשימה חוזרת עם אותו סינון, מיון, חיפוש ועמוד
  useEffect(() => {
    const onBack = () => markListRestore(objectKey);
    window.addEventListener("ora:back", onBack);
    return () => window.removeEventListener("ora:back", onBack);
  }, [objectKey]);

  // ===== טעינה =====
  const load = useCallback(
    async (cat: Catalog) => {
      const o = cat.objects.find((x) => x.object_key === objectKey)!;
      const fs = cat.fields.filter((f) => f.object_id === o.id && !f.computed);
      const childObjs = cfg.children.map((ch) => cat.objects.find((x) => x.object_key === ch.object)!);

      // שמות לשדות מקושרים, של הרשומה ושל השורות בלשוניות
      const refIds = new Set<string>();
      fs.forEach((f) => f.ref_object_id && refIds.add(f.ref_object_id));
      cfg.children.forEach((ch, i) =>
        cat.fields
          .filter((f) => f.object_id === childObjs[i].id && ch.columns.includes(f.field_key) && f.ref_object_id)
          .forEach((f) => refIds.add(f.ref_object_id!)),
      );
      const lab = new Map<string, Map<string, string>>();
      const ph = new Map<string, string>();
      await Promise.all(
        [...refIds].map(async (rid) => {
          const opts = await loadRefOptions(cat.objects.find((x) => x.id === rid)!, cat);
          lab.set(rid, new Map(opts.map((op) => [op.value, op.label])));
          opts.forEach((op) => op.phone && ph.set(op.value, op.phone));
        }),
      );
      setLabels(lab);
      setPhones(ph);

      if (isNew) {
        // רשומה חדשה: ערכים מהכתובת (למשל ?client_id=…) או משכפול (?from=…)
        const params = new URLSearchParams(window.location.search);
        const editableFs = fs.filter((f) => f.is_editable);
        const v: Record<string, string> = Object.fromEntries(
          editableFs.map((f) => [f.field_key, params.get(f.field_key) ?? newDefault(f)]),
        );
        const from = params.get("from");
        if (from) {
          const { data, error } = await supabase.rpc("get_record", { p_object: objectKey, p_id: from });
          if (error) throw error;
          const src = data as Rec | null;
          if (src) {
            for (const f of editableFs) {
              if (cfg.noCopy?.includes(f.field_key)) continue;
              v[f.field_key] = toInput(f, src[f.field_key]);
            }
            if (cfg.copySuffix && v[cfg.copySuffix]) v[cfg.copySuffix] += " (עותק)";
          }
        }
        setValues(v);
        setSnapshot(v);
        setRec({ id: "" });
        return;
      }

      // דרך get_record: רק אם מותר לי לראות אותה, ובלי שדות שחסומים לתפקיד שלי
      const { data, error } = await supabase.rpc("get_record", { p_object: objectKey, p_id: id });
      if (error) throw error;
      const r = data as Rec | null;
      setRec(r);
      if (!r) return;
      const v = Object.fromEntries(fs.filter((f) => f.is_editable).map((f) => [f.field_key, toInput(f, r[f.field_key])]));
      setValues(v);
      setSnapshot(v);

      const kids: Record<string, Rec[]> = {};
      await Promise.all(
        cfg.children.map(async (ch, i) => {
          const hasStatus = cat.fields.some((f) => f.object_id === childObjs[i].id && f.field_key === "status");
          const cols = [...new Set(["id", ...ch.columns, ...(hasStatus ? ["status"] : []), ch.sort.field])];
          // דרך run_view: אותו היקף שורות ואותה הסתרת שדות כמו ברשימות
          const res = await supabase.rpc("run_view", {
            p_object: ch.object,
            p_def: { columns: cols.filter((c) => c !== "id"), filters: [{ field: ch.fk, op: "eq", value: id }], match: "all", sorts: [{ field: ch.sort.field, dir: ch.sort.asc ? "asc" : "desc" }] },
            p_search: null,
            p_limit: 200,
            p_offset: 0,
          });
          if (res.error) throw res.error;
          kids[`${ch.object}:${ch.fk}`] = (res.data as { rows: Rec[] }).rows;
        }),
      );
      setChildren(kids);

    },
    [objectKey, id, isNew, cfg],
  );

  useEffect(() => {
    if (!me?.is_active) return;
    let cancelled = false;
    loadCatalog()
      .then(async (cat) => {
        if (cancelled) return;
        setCatalog(cat);
        await load(cat);
      })
      .catch((e) => !cancelled && setLoadError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [me?.is_active, load]);

  // ===== שינוי שלא נשמר: אזהרה לפני יציאה =====
  const dirty = editing && Object.keys(values).some((k) => values[k] !== snapshot[k]);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    // קישורים בתוך האפליקציה (תפריט, קישור לרשומה מקושרת)
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || /^(tel|mailto):/.test(a.getAttribute("href") ?? "")) return;
      if (!window.confirm(LEAVE_MSG)) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        dirtyRef.current = false;
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  const leave = (go: () => void) => {
    if (!dirtyRef.current || window.confirm(LEAVE_MSG)) {
      dirtyRef.current = false;
      go();
    }
  };
  // כפתור "אחורה" של הדפדפן: כשיש שינוי שלא נשמר מוסיפים כניסה בהיסטוריה (אותה כתובת),
  // ולחיצה על "אחורה" נתפסת בה ושואלת לפני יציאה. כשהשינוי נשמר או בוטל, הכניסה מוסרת.
  const guardRef = useRef(false);
  const skipPopRef = useRef(false);
  useEffect(() => {
    if (dirty && !guardRef.current) {
      window.history.pushState(window.history.state, "", window.location.href);
      guardRef.current = true;
    } else if (!dirty && guardRef.current) {
      guardRef.current = false;
      skipPopRef.current = true;
      window.history.back();
    }
  }, [dirty]);
  useEffect(() => {
    const onPop = () => {
      if (skipPopRef.current) {
        skipPopRef.current = false;
        return;
      }
      if (!guardRef.current) return;
      if (window.confirm(LEAVE_MSG)) {
        guardRef.current = false;
        dirtyRef.current = false;
        window.history.back();
      } else {
        window.history.pushState(window.history.state, "", window.location.href);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // כניסה לעריכה: הטופס יכול להיות מתחת לקצה המסך (בייחוד בטלפון), ולכן עוברים לשדה ומתמקדים בו.
  // לחיצה על שדה מסוים פותחת את העריכה ישר בו, ו"עריכה" פותחת בשדה הראשון.
  const focusKey = useRef<string | null>(null);
  const canEditField = (f: FieldMeta) => canEdit && f.is_editable && !isNew;
  const startEdit = (key?: string) => {
    focusKey.current = key ?? null;
    setEditing(true);
  };
  useEffect(() => {
    if (!editing || isNew) return;
    const key = focusKey.current ?? fields.find((f) => f.is_editable)?.field_key;
    focusKey.current = null;
    const el = key && document.getElementById(`rp-${key}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // ===== "לקוחה קיימת": בדיקת טלפון כפול בזמן ההקלדה =====
  const phoneValue = phoneField ? values[phoneField.field_key] ?? "" : "";
  useEffect(() => {
    if (!cfg.uniquePhone || !editing || !phoneField || !obj) return;
    const norm = normalizePhone(phoneValue);
    if (norm.length < 9 || norm === normalizePhone(snapshot[phoneField.field_key] ?? "")) {
      setExisting(null);
      return;
    }
    const t = setTimeout(async () => {
      // דרך run_view, כמו כל קריאה: רק רשומות שמותר לי לראות
      const { data } = await supabase.rpc("run_view", {
        p_object: objectKey,
        p_def: { columns: [obj.display_field], filters: [{ field: phoneField.field_key, op: "eq", value: norm }], match: "all", sorts: [] },
        p_search: null,
        p_limit: 2,
        p_offset: 0,
      });
      const found = ((data as { rows: Rec[] } | null)?.rows ?? []).find((r) => r.id !== id) ?? null;
      setExisting(found ? { id: found.id, name: String(found[obj.display_field] ?? "") } : null);
    }, 300);
    return () => clearTimeout(t);
  }, [cfg.uniquePhone, editing, phoneField, obj, phoneValue, snapshot, objectKey, isNew, id]);

  // ===== הצגה =====
  const labelOf = (f: FieldMeta, raw: unknown) => (f.ref_object_id ? labels.get(f.ref_object_id)?.get(String(raw)) ?? "" : "");
  const textOf = (f: FieldMeta, r: Rec) => formatValue(f, { ...r, [`${f.field_key}__label`]: labelOf(f, r[f.field_key]) } as Row);
  // לחיצה על קישור בתוך שדה פותחת את הקישור, ולא את עריכת השדה
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const renderValue = (f: FieldMeta, r: Rec) => {
    const text = textOf(f, r);
    if (!text) return <span className="muted">—</span>;
    const raw = r[f.field_key];
    if (f.field_type === "reference") {
      const href = linkHref(catalog?.objects.find((o) => o.id === f.ref_object_id)?.object_key, raw, isManager);
      return href ? <Link href={href} className="ref-link" onClick={stop}>{text}</Link> : text;
    }
    if (f.field_type === "choice" || f.field_type === "boolean") return <span className={`tag tag-${String(raw)} tag-${f.field_key}-${String(raw)}`}>{text}</span>;
    if (f.field_type === "phone") return <a href={`tel:${raw}`} dir="ltr" className="ref-link" onClick={stop}>{text}</a>;
    if (f.field_type === "email") return <a href={`mailto:${raw}`} dir="ltr" className="ref-link" onClick={stop}>{text}</a>;
    if (f.field_type === "long_text") return <span className="long-text">{text}</span>;
    if (f.field_type === "datetime") {
      return (
        <span className="dt-stack">
          <span dir="ltr">{formatDate(String(raw))}</span>
          <span className="dt-time" dir="ltr">{formatTime(String(raw))}</span>
        </span>
      );
    }
    return <span dir={isLtr(f) ? "ltr" : undefined}>{text}</span>;
  };

  // ===== פעולות =====
  const setField = (f: FieldMeta, v: string) => {
    setValues((p) => ({ ...p, [f.field_key]: v }));
    if (errors[f.field_key] && v) setErrors((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== f.field_key)));
    if (f.field_type === "reference" && v && catalog) {
      copyFromRef(catalog, editable, f, v)
        .then((copied) => setValues((p) => ({ ...p, ...copied })))
        .catch((e) => setFormError(errorText(e)));
    }
  };

  const savingRef = useRef(false); // לחיצה כפולה מהירה או Enter כפול: שמירה אחת בלבד
  const save = async () => {
    if (savingRef.current) return;
    // שדה חובה ריק חוסם שמירה ומסומן בדיוק איפה
    const errs: Record<string, string> = {};
    editable.forEach((f) => {
      if (f.is_required && !values[f.field_key]?.trim()) errs[f.field_key] = `חובה למלא ${f.label}`;
    });
    setErrors(errs);
    setFormError("");
    const first = editable.find((f) => errs[f.field_key]);
    if (first) {
      document.getElementById(`rp-${first.field_key}`)?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (isNew) {
        const payload = Object.fromEntries(
          editable.filter((f) => values[f.field_key] !== "").map((f) => [f.field_key, toValue(f, values[f.field_key])]),
        );
        const newId = await createRecord(objectKey, payload);
        toast(CREATED_TOAST[objectKey] ?? "הרשומה נשמרה");
        dirtyRef.current = false;
        // קודם מסירים את כניסת ההגנה מההיסטוריה, כדי ש"אחורה" מהרשומה החדשה לא יחזיר לטופס הריק
        if (guardRef.current) {
          guardRef.current = false;
          skipPopRef.current = true;
          await new Promise<void>((resolve) => {
            window.addEventListener("popstate", () => resolve(), { once: true });
            window.history.back();
          });
        }
        // נפתחה ממסך אחר שמבקש לחזור אליו (למשל תור חדש מהיומן): חוזרים לשם. אחרת לרשומה החדשה.
        const ret = new URLSearchParams(window.location.search).get("return");
        router.replace(ret && ret.startsWith("/") && !ret.startsWith("//") ? ret : `${cfg.route}${newId}`);
        return;
      }
      const changed = editable.filter((f) => values[f.field_key] !== snapshot[f.field_key]);
      if (changed.length) {
        const n = await updateRecords(objectKey, [id], Object.fromEntries(changed.map((f) => [f.field_key, toValue(f, values[f.field_key])])));
        if (n === 0) throw new Error("אין לך הרשאה לשנות את הרשומה הזו.");
        toast("השינויים נשמרו");
      }
      setEditing(false);
      if (catalog) await load(catalog);
    } catch (e) {
      // שגיאה של שדה מסוים (חפיפה, שעות פעילות, טלפון קיים, אחראית) מוצגת ליד השדה, כמו באפיון
      const key = errorField(e);
      if (key && editable.some((f) => f.field_key === key)) {
        setErrors({ [key]: errorText(e) });
        document.getElementById(`rp-${key}`)?.focus();
      } else {
        setFormError(errorText(e));
        toast(errorText(e), "err");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const backHref = nav?.backHref ?? cfg.listHref;
  const back = () =>
    leave(() => {
      markListRestore(objectKey);
      router.push(backHref);
    });

  const cancel = () => {
    if (isNew) return back();
    setValues(snapshot);
    setErrors({});
    setFormError("");
    setExisting(null);
    setEditing(false);
  };

  const title = rec && obj && !isNew ? textOf(byKey.get(obj.display_field)!, rec) : "";

  const askDelete = async () => {
    if (cfg.noDelete) return setDialog({ kind: "blocked", text: cfg.noDelete });
    try {
      const counts = await Promise.all(
        cfg.children.map(async (ch) => {
          const { count, error } = await supabase.from(ch.object).select("id", { count: "exact", head: true }).eq(ch.fk, id);
          if (error) throw error;
          return { ch, n: count ?? 0 };
        }),
      );
      const blocking = counts.filter((c) => c.n > 0);
      if (blocking.length) {
        setDialog({
          kind: "blocked",
          text: `אי אפשר למחוק את ${title}, כי יש רשומות מקושרות: ${blocking.map((b) => `${b.ch.label} (${b.n})`).join(", ")}. אפשר למחוק רק רשומה בלי רשומות מקושרות.`,
        });
      } else {
        setDialog({ kind: "delete" });
      }
    } catch (e) {
      toast(errorText(e), "err");
    }
  };

  const doDelete = async () => {
    try {
      const n = await deleteRecords(objectKey, [id]);
      if (n === 0) throw new Error("אין לך הרשאה למחוק את הרשומה הזו.");
      toast("הרשומה נמחקה");
      setDialog(null);
      dirtyRef.current = false;
      markListRestore(objectKey);
      router.replace(backHref);
    } catch (e) {
      setDialog(null);
      toast(errorText(e), "err");
    }
  };

  const changeChildStatus = async (key: string, ch: ChildDef, rowId: string, value: string) => {
    const prev = children[key];
    setChildren((c) => ({ ...c, [key]: c[key].map((x) => (x.id === rowId ? { ...x, status: value } : x)) }));
    try {
      const n = await updateRecords(ch.object, [rowId], { status: value });
      if (n === 0) throw new Error("אין לך הרשאה לשנות את הרשומה הזו.");
      toast("הסטטוס עודכן");
    } catch (e) {
      setChildren((c) => ({ ...c, [key]: prev }));
      toast(errorText(e), "err");
    }
  };

  // ===== מצבי טעינה =====
  if (me && !me.is_active) return null;
  if (!cfg) return <div className="card empty"><p>אין מסך רשומה לאובייקט הזה.</p></div>;
  if (loadError) return <div className="card empty"><p>{loadError}</p></div>;
  if (rec === undefined || !catalog || !obj) {
    return (
      <div aria-busy="true">
        <div className="skeleton" style={{ height: 120, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 240 }} />
      </div>
    );
  }
  if (rec === null || (isNew && !canCreate)) {
    return (
      <div className="card empty">
        <p>{rec === null ? `ה${obj.label} לא נמצאה, או שאין לך הרשאה לראות אותה.` : `אין לך הרשאה ליצור ${obj.label}.`}</p>
        <Link href={cfg.listHref} className="btn outline">חזרה ל{obj.label_plural}</Link>
      </div>
    );
  }

  // ===== שדות מחושבים (לקריאה בלבד) =====
  const now = Date.now();
  const computed: { label: string; value: React.ReactNode; tone?: "highlight" | "warn" | "strong" }[] = [];
  const childRows = (object: string, fk: string) => children[`${object}:${fk}`] ?? [];
  const apptFields = catalog.fields.filter((f) => f.object_id === catalog.objects.find((o) => o.object_key === "appointments")?.id);
  const af = (k: string) => apptFields.find((f) => f.field_key === k)!;
  if (!isNew) {
    if (objectKey === "clients") {
      const next = childRows("appointments", "client_id")
        .filter((a) => a.status === "upcoming" && new Date(String(a.starts_at)).getTime() >= now)
        .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0];
      computed.push({
        label: "התור הבא",
        tone: next ? "highlight" : undefined,
        value: next ? (
          <Link
            href={recordHref("appointments", next.id)!}
            className="computed-link"
            onClick={() => saveNav("appointments", { ids: [next.id], backHref: `${cfg.route}${id}`, backLabel: title })}
          >
            <span className="next-date" dir="ltr">{formatDate(String(next.starts_at))}</span>
            <span className="next-time" dir="ltr">{formatTime(String(next.starts_at))}</span>
            <span className="next-meta">{textOf(af("treatment_id"), next)} · {textOf(af("therapist_id"), next)}</span>
          </Link>
        ) : "אין תור עתידי",
      });
      // קריאות פתוחות: קריאה אחת – קישור אליה. כמה – מעבר ללשונית הקריאות בכרטיס.
      const openReqs = childRows("service_requests", "client_id").filter((r) => r.status !== "closed");
      const reqTab = cfg.children.findIndex((c) => c.object === "service_requests");
      computed.push({
        label: "קריאות פתוחות",
        value:
          openReqs.length === 1 ? (
            <Link
              href={recordHref("service_requests", openReqs[0].id)!}
              className="computed-link"
              // "חזרה" מהקריאה מובילה לכרטיס הלקוחה
              onClick={() => saveNav("service_requests", { ids: openReqs.map((r) => r.id), backHref: `${cfg.route}${id}`, backLabel: title })}
            >
              <span className="open-count">1</span>
              <span className="open-meta">{String(openReqs[0].description ?? "")}</span>
            </Link>
          ) : openReqs.length > 1 && reqTab >= 0 ? (
            <button
              type="button"
              className="computed-link link-like"
              onClick={() => {
                setTab(reqTab);
                document.getElementById("record-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span className="open-count">{openReqs.length}</span>
              <span className="open-meta">לרשימת הקריאות</span>
            </button>
          ) : (
            openReqs.length
          ),
      });
    }
    if (objectKey === "service_requests" && rec.status !== "closed") {
      const age = now - new Date(String(rec.created_at)).getTime();
      computed.push({ label: "פתוחה כבר", value: ago(age), tone: age > OLD_REQUEST_MS ? "warn" : "strong" });
    }
    if (objectKey === "staff" || objectKey === "treatments") {
      const fk = objectKey === "staff" ? "therapist_id" : "treatment_id";
      computed.push({
        label: "תורים עתידיים",
        value: childRows("appointments", fk).filter((a) => a.status === "upcoming" && new Date(String(a.starts_at)).getTime() >= now).length,
      });
    }
  }

  // שדות שלא שובצו בקבוצה מופיעים בקבוצה נוספת, כדי ששום שדה לא ייעלם
  const placed = new Set([...cfg.groups.flatMap((g) => g.fields), ...TRACKING]);
  const extra = fields.filter((f) => !placed.has(f.field_key));
  const groups = extra.length ? [...cfg.groups, { title: "שדות נוספים", fields: extra.map((f) => f.field_key) }] : cfg.groups;

  const idx = nav && !isNew ? nav.ids.indexOf(id) : -1;
  const prevId = idx > 0 ? nav!.ids[idx - 1] : null;
  const nextId = idx >= 0 && idx < nav!.ids.length - 1 ? nav!.ids[idx + 1] : null;
  const childMeta = (object: string) => {
    const o = catalog.objects.find((x) => x.object_key === object)!;
    return { obj: o, fields: catalog.fields.filter((f) => f.object_id === o.id) };
  };
  const activeChild = cfg.children[tab];

  return (
    <div className={`record record-${objectKey}`}>
      <div className="record-top">
        {idx >= 0 && (
          <nav className="record-nav" aria-label="מעבר בין רשומות">
            <button type="button" className="btn outline" disabled={!prevId} onClick={() => prevId && leave(() => router.push(`${cfg.route}${prevId}`))}>→ הקודמת</button>
            <span className="muted">{idx + 1} מתוך {nav!.ids.length}</span>
            <button type="button" className="btn outline" disabled={!nextId} onClick={() => nextId && leave(() => router.push(`${cfg.route}${nextId}`))}>הבאה ←</button>
          </nav>
        )}
      </div>

      {/* כותרת: שם הרשומה, השדות הקריטיים והפעולות */}
      <header className={`card record-head record-head-${objectKey}${cfg.stackedHeader ? " stacked" : ""}`}>
        <div className="record-title">
          <span className="muted">{obj.label}</span>
          {isNew ? (
            <h1 className="page-title">הוספת {obj.label}</h1>
          ) : byKey.get(obj.display_field)?.field_type === "datetime" ? (
            // שם שהוא מועד (תור): התאריך, ומתחתיו השעה
            <>
              <h1 className="page-title" dir="ltr">{formatDate(String(rec[obj.display_field]))}</h1>
              <span className="title-sub" dir="ltr">{formatTime(String(rec[obj.display_field]))}</span>
            </>
          ) : (
            <h1 className="page-title">{title}</h1>
          )}
          {!isNew && cfg.subtitle && byKey.get(cfg.subtitle) && rec[cfg.subtitle] ? (
            <span className="title-sub">
              {byKey.get(cfg.subtitle)!.label}:{" "}
              {byKey.get(cfg.subtitle)!.field_type === "datetime" ? (
                // קודם התאריך ואחריו השעה (בסדר הקריאה מימין)
                <><span dir="ltr">{formatDate(String(rec[cfg.subtitle]))}</span><span dir="ltr" className="sub-time">{formatTime(String(rec[cfg.subtitle]))}</span></>
              ) : (
                renderValue(byKey.get(cfg.subtitle)!, rec)
              )}
            </span>
          ) : null}
        </div>
        {!isNew && (
          <dl className="header-fields">
            {cfg.header.map((k) => byKey.get(k)).filter(Boolean).map((f) => (
              <div
                key={f!.field_key}
                className={canEditField(f!) && !editing ? "editable" : undefined}
                title={canEditField(f!) && !editing ? "לחיצה לעריכה" : undefined}
                onClick={canEditField(f!) && !editing ? () => startEdit(f!.field_key) : undefined}
              >
                <dt>{f!.label}</dt>
                <dd>
                  {renderValue(f!, rec)}
                  {/* לקוחה בכותרת (בתור ובקריאה): גם הטלפון שלה, כקישור לחיוג */}
                  {f!.field_type === "reference" &&
                  catalog.objects.find((o) => o.id === f!.ref_object_id)?.object_key === "clients" &&
                  phones.get(String(rec[f!.field_key])) ? (
                    <a
                      href={`tel:${phones.get(String(rec[f!.field_key]))}`}
                      dir="ltr"
                      className="ref-phone"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {formatPhone(phones.get(String(rec[f!.field_key]))!)}
                    </a>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="record-actions">
          {editing ? (
            <>
              {/* key נפרד: אחרת הדפדפן משתמש באותו כפתור, ולחיצת "עריכה" ממשיכה ל"שמירה" ויוצאת מיד מהעריכה */}
              <button key="save" type="submit" form="record-form" className="btn primary cta" disabled={saving}>
                {saving && <span className="spinner" aria-hidden="true" />}
                שמירה
              </button>
              <button type="button" className="btn outline" onClick={cancel}>ביטול</button>
            </>
          ) : (
            <>
              {canEdit && (
                <button
                  key="edit"
                  type="button"
                  className="btn primary cta"
                  onClick={(e) => {
                    e.preventDefault();
                    startEdit();
                  }}
                >
                  עריכה
                </button>
              )}
              {phoneField && rec[phoneField.field_key] ? (
                <a className="btn outline" href={whatsappHref(String(rec[phoneField.field_key]))} target="_blank" rel="noopener noreferrer">וואטסאפ</a>
              ) : null}
              {canCreate && !cfg.noDuplicate && (
                <button type="button" className="btn outline" onClick={() => router.push(`${cfg.route}new?from=${id}`)}>שכפול</button>
              )}
              {objectKey === "staff" && isManager && rec.id !== userId && (
                <StaffStatusButton id={id} active={!!rec.is_active} onDone={() => catalog && load(catalog)} />
              )}
              {canDelete && <button type="button" className="btn outline danger" onClick={askDelete}>מחיקה</button>}
            </>
          )}
        </div>
      </header>

      {/* בעריכה השדות המחושבים מוסתרים, כדי שהטופס יופיע מיד אחרי הכותרת */}
      {computed.length > 0 && !editing && (
        <section className="computed" aria-label="שדות מחושבים">
          {computed.map((c) => (
            <div key={c.label} className={`card computed-item${c.tone ? ` ${c.tone}` : ""}`}>
              <span className="muted">{c.label}</span>
              <div className="computed-value">{c.value}</div>
            </div>
          ))}
        </section>
      )}

      {/* קבוצות השדות. בעריכה הן טופס אחד: Enter שומר */}
      <form
        id="record-form"
        className="record-groups"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (editing) save();
        }}
      >
        {formError && <p className="field-error form-error" role="alert">{formError}</p>}
        {groups.map((g) => {
          const gf = g.fields.map((k) => byKey.get(k)).filter(Boolean) as FieldMeta[];
          if (!gf.length) return null;
          return (
            <section key={g.title} className="card group">
              <h2 className="section-title">{g.title}</h2>
              <div className="group-fields">
                {gf.map((f) =>
                  editing && f.is_editable ? (
                    <label key={f.field_key} className={`field${errors[f.field_key] ? " has-error" : ""}`} htmlFor={`rp-${f.field_key}`}>
                      <span>
                        {f.label}
                        {f.is_required && <span aria-hidden="true"> *</span>}
                      </span>
                      <FieldInput
                        id={`rp-${f.field_key}`}
                        field={f}
                        catalog={catalog}
                        value={values[f.field_key] ?? ""}
                        invalid={!!errors[f.field_key]}
                        onChange={(v) => setField(f, v)}
                      />
                      {errors[f.field_key] && <span className="field-error" role="alert">{errors[f.field_key]}</span>}
                      {f === phoneField && existing && (
                        <span className="exists-hint">
                          {obj.label} קיימת עם הטלפון הזה: <Link href={recordHref(objectKey, existing.id)!} className="ref-link">{existing.name}</Link>
                        </span>
                      )}
                    </label>
                  ) : isNew ? null : (
                    <div
                      key={f.field_key}
                      className={`field-view field-${f.field_key}${canEditField(f) ? " editable" : ""}`}
                      title={canEditField(f) ? "לחיצה לעריכה" : undefined}
                      tabIndex={canEditField(f) ? 0 : undefined}
                      onClick={canEditField(f) ? () => startEdit(f.field_key) : undefined}
                      onKeyDown={canEditField(f) ? (e) => e.key === "Enter" && e.target === e.currentTarget && startEdit(f.field_key) : undefined}
                    >
                      <span className="field-label">{f.label}</span>
                      <div>{renderValue(f, rec)}</div>
                    </div>
                  ),
                )}
              </div>
            </section>
          );
        })}
      </form>

      {/* רשומות מקושרות */}
      {!isNew && cfg.children.length > 0 && activeChild && (
        <section className="card tabs-card" id="record-tabs">
          <div className="tabs-head">
            <div className="segmented" role="tablist" aria-label="רשומות מקושרות">
              {cfg.children.map((ch, i) => (
                <button key={ch.label} type="button" role="tab" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>
                  {ch.label} ({childRows(ch.object, ch.fk).length})
                </button>
              ))}
            </div>
            {can(activeChild.object, "create") && (
              <button type="button" className="btn outline" onClick={() => setDialog({ kind: "child", child: activeChild })}>
                {activeChild.addLabel}
              </button>
            )}
          </div>
          <ChildList
            rows={childRows(activeChild.object, activeChild.fk)}
            child={activeChild}
            fields={childMeta(activeChild.object).fields}
            textOf={textOf}
            canEdit={can(activeChild.object, "edit")}
            onStatus={(rowId, v) => changeChildStatus(`${activeChild.object}:${activeChild.fk}`, activeChild, rowId, v)}
            onEdit={(rowId) => setDialog({ kind: "child", child: activeChild, rowId })}
            onOpenFull={(rowId) => {
              const rows = childRows(activeChild.object, activeChild.fk);
              saveNav(activeChild.object, { ids: rows.map((r) => r.id), backHref: `${cfg.route}${id}`, backLabel: title });
              leave(() => router.push(recordHref(activeChild.object, rowId)!));
            }}
          />
        </section>
      )}

      {/* פרטי מעקב */}
      {!isNew && (
        <footer className="record-footer muted">
          <span>
            {byKey.get("created_at")?.label}: <span dir="ltr">{formatDateTime(String(rec.created_at))}</span>
            {byKey.get("created_by") && rec.created_by ? <> · {textOf(byKey.get("created_by")!, rec)}</> : null}
          </span>
          <span>
            עודכנה לאחרונה: <span dir="ltr">{formatDateTime(String(rec.updated_at))}</span>
            {" · "}
            {rec.updated_by && byKey.get("updated_by") ? textOf(byKey.get("updated_by")!, rec) : "פעולת מערכת"}
          </span>
        </footer>
      )}

      {/* ===== חלונות ===== */}
      {dialog?.kind === "delete" && (
        <Confirm text={`למחוק את ${title}? אי אפשר לבטל.`} confirmLabel="מחיקה" onClose={() => setDialog(null)} onConfirm={doDelete} />
      )}
      {dialog?.kind === "blocked" && (
        <Modal title="אי אפשר למחוק" onClose={() => setDialog(null)}>
          <p>{dialog.text}</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setDialog(null)}>הבנתי</button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "child" && (
        <RecordForm
          key={dialog.rowId ?? "new"}
          obj={childMeta(dialog.child.object).obj}
          fields={childMeta(dialog.child.object).fields}
          catalog={catalog}
          row={dialog.rowId ? ({ id: dialog.rowId } as Row) : undefined}
          initial={dialog.rowId ? undefined : { [dialog.child.fk]: id }}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load(catalog).catch((e) => toast(errorText(e), "err"));
          }}
        />
      )}
    </div>
  );
}

// רשימת הרשומות המקושרות בלשונית: לחיצה פותחת עריכה בחלון (בלי לצאת מהמסך), הסטטוס משתנה במקום,
// ו"למסך המלא" עובר למסך הרשומה הבת
function ChildList({
  rows, child, fields, textOf, canEdit, onStatus, onEdit, onOpenFull,
}: {
  rows: Rec[];
  child: ChildDef;
  fields: FieldMeta[];
  textOf: (f: FieldMeta, r: Rec) => string;
  canEdit: boolean;
  onStatus: (rowId: string, v: string) => void;
  onEdit: (rowId: string) => void;
  onOpenFull: (rowId: string) => void;
}) {
  const open = (rowId: string) => (canEdit ? onEdit(rowId) : onOpenFull(rowId));
  const statusField = fields.find((f) => f.field_key === "status");
  const cols = child.columns.map((k) => fields.find((f) => f.field_key === k)).filter(Boolean) as FieldMeta[];
  if (rows.length === 0) return <div className="empty"><p>אין עדיין {child.label}.</p></div>;
  return (
    <ul className="history">
      {rows.map((r) => (
        <li key={r.id} className="row-link" tabIndex={0} onClick={() => open(r.id)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open(r.id)}>
          <div className="history-main">
            {cols.map((f, i) => {
              const text = textOf(f, r);
              if (!text) return null;
              return i === 0 ? (
                <strong key={f.field_key} dir={isLtr(f) ? "ltr" : undefined}>{text}</strong>
              ) : (
                <span key={f.field_key} className="muted">{f.label}: <span dir={isLtr(f) ? "ltr" : undefined}>{text}</span></span>
              );
            })}
          </div>
          {statusField && (
            canEdit ? (
              <select
                className={`status-select tag tag-${r.status}`}
                aria-label={statusField.label}
                value={String(r.status)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => onStatus(r.id, e.target.value)}
              >
                {pickOptions(statusField.options, r.status).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <span className={`tag tag-${r.status}`}>{textOf(statusField, r)}</span>
            )
          )}
          <button
            type="button"
            className="link-btn full-link"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFull(r.id);
            }}
          >
            למסך המלא ←
          </button>
        </li>
      ))}
    </ul>
  );
}

// השבתה / הפעלה של משתמשת (מנהלת מערכת): לא מוחקים, כדי שכל מה שיצרה יישמר.
// משביתה גם את ההתחברות ב-Supabase Auth, ולכן נעשית בשרת עם מפתח השירות.
function StaffStatusButton({ id, active, onDone }: { id: string; active: boolean; onDone: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await adminApi("/api/users/status", { id, active: !active });
      toast(active ? "המשתמשת הושבתה" : "המשתמשת הופעלה");
      onDone();
    } catch (e) {
      toast(errorText(e), "err");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <>
      <button type="button" className={`btn outline${active ? " danger" : ""}`} disabled={busy} onClick={() => setConfirm(true)}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {active ? "השבתה" : "הפעלה מחדש"}
      </button>
      {confirm && (
        <Confirm
          text={
            active
              ? "להשבית את המשתמשת? היא לא תוכל להיכנס למערכת, אבל כל הרשומות שיצרה יישמרו."
              : "להפעיל מחדש את המשתמשת? היא תוכל להיכנס שוב."
          }
          confirmLabel={active ? "השבתה" : "הפעלה"}
          onClose={() => setConfirm(false)}
          onConfirm={run}
        />
      )}
    </>
  );
}
