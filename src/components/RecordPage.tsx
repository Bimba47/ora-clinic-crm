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
import RecordForm, { CREATED_TOAST, FieldInput, copyFromRef, toInput, toValue } from "@/components/views/RecordForm";
import { type ChildDef, type RecordNav, RECORDS, markListRestore, readNav, recordHref, saveNav } from "@/lib/records";
import {
  type Catalog, type FieldMeta, type Row,
  createRecord, deleteRecords, errorText, loadCatalog, loadRefOptions, updateRecords,
} from "@/lib/views";
import { formatDate, formatDateTime, formatTime, formatValue, isLtr, whatsappHref } from "@/lib/format";

type Rec = Record<string, unknown> & { id: string };
type Dialog =
  | { kind: "delete" }
  | { kind: "blocked"; text: string }
  | { kind: "child"; child: ChildDef }
  | null;

const LEAVE_MSG = "יש שינויים שלא נשמרו. לצאת בלי לשמור?";
const OLD_REQUEST_MS = 48 * 60 * 60 * 1000;
const TRACKING = ["created_at", "created_by", "updated_at", "updated_by"];

function normalizePhone(p: string) {
  return p.replace(/\D/g, "").replace(/^972/, "0");
}

function ago(ms: number) {
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d === 0) return h <= 1 ? "פחות משעתיים" : `${h} שעות`;
  return h % 24 ? `${d} ימים ו-${h % 24} שעות` : `${d} ימים`;
}

export default function RecordPage({ objectKey, id }: { objectKey: string; id: string }) {
  const cfg = RECORDS[objectKey];
  const isNew = id === "new";
  const router = useRouter();
  const { me, userId, isManager } = useAuth();
  const toast = useToast();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rec, setRec] = useState<Rec | null | undefined>(undefined); // undefined = טוען, null = לא נמצאה
  const [labels, setLabels] = useState<Map<string, Map<string, string>>>(new Map());
  const [children, setChildren] = useState<Record<string, Rec[]>>({});
  const [address, setAddress] = useState<string | null | undefined>(undefined); // undefined = אין הרשאה
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
    () => (catalog && obj ? catalog.fields.filter((f) => f.object_id === obj.id) : []),
    [catalog, obj],
  );
  const byKey = useMemo(() => new Map(fields.map((f) => [f.field_key, f])), [fields]);
  const editable = fields.filter((f) => f.is_editable);
  const canEdit = cfg.editRole === "all" || isManager;
  const canCreate = canEdit && !!obj?.can_create;
  const phoneField = fields.find((f) => f.field_type === "phone");

  useEffect(() => setNav(readNav(objectKey)), [objectKey]);

  // ===== טעינה =====
  const load = useCallback(
    async (cat: Catalog) => {
      const o = cat.objects.find((x) => x.object_key === objectKey)!;
      const fs = cat.fields.filter((f) => f.object_id === o.id);
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
      await Promise.all(
        [...refIds].map(async (rid) => {
          const opts = await loadRefOptions(cat.objects.find((x) => x.id === rid)!, cat);
          lab.set(rid, new Map(opts.map((op) => [op.value, op.label])));
        }),
      );
      setLabels(lab);

      if (isNew) {
        // רשומה חדשה: ערכים מהכתובת (למשל ?client_id=…) או משכפול (?from=…)
        const params = new URLSearchParams(window.location.search);
        const editableFs = fs.filter((f) => f.is_editable);
        const v: Record<string, string> = Object.fromEntries(
          editableFs.map((f) => [f.field_key, f.field_type === "boolean" ? "true" : params.get(f.field_key) ?? ""]),
        );
        const from = params.get("from");
        if (from) {
          const { data, error } = await supabase.from(objectKey).select(["id", ...editableFs.map((f) => f.field_key)].join(", ")).eq("id", from).maybeSingle();
          if (error) throw error;
          const src = data as unknown as Rec | null;
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

      const { data, error } = await supabase.from(objectKey).select(["id", ...fs.map((f) => f.field_key)].join(", ")).eq("id", id).maybeSingle();
      if (error) throw error;
      const r = data as unknown as Rec | null;
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
          const res = await supabase.from(ch.object).select(cols.join(", ")).eq(ch.fk, id).order(ch.sort.field, { ascending: ch.sort.asc }).limit(200);
          if (res.error) throw res.error;
          kids[`${ch.object}:${ch.fk}`] = res.data as unknown as Rec[];
        }),
      );
      setChildren(kids);

      // כתובת מגורים של אשת צוות: רק למנהלת ולעובדת עצמה. לאחרות השדה לא מופיע בכלל.
      if (objectKey === "staff" && (isManager || userId === id)) {
        const res = await supabase.rpc("get_staff_address", { p_staff_id: id });
        setAddress(res.error ? undefined : ((res.data as string | null) ?? null));
      }
    },
    [objectKey, id, isNew, cfg, isManager, userId],
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

  // כניסה לעריכה: הטופס יכול להיות מתחת לקצה המסך (בייחוד בטלפון), ולכן עוברים לשדה הראשון ומתמקדים בו
  useEffect(() => {
    if (!editing || isNew) return;
    const first = fields.find((f) => f.is_editable);
    const el = first && document.getElementById(`rp-${first.field_key}`);
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
      const { data } = await supabase.from(objectKey).select(`id, ${obj.display_field}`).eq(phoneField.field_key, norm).neq("id", isNew ? "00000000-0000-0000-0000-000000000000" : id).maybeSingle();
      const found = data as unknown as Rec | null;
      setExisting(found ? { id: found.id, name: String(found[obj.display_field] ?? "") } : null);
    }, 300);
    return () => clearTimeout(t);
  }, [cfg.uniquePhone, editing, phoneField, obj, phoneValue, snapshot, objectKey, isNew, id]);

  // ===== הצגה =====
  const labelOf = (f: FieldMeta, raw: unknown) => (f.ref_object_id ? labels.get(f.ref_object_id)?.get(String(raw)) ?? "" : "");
  const textOf = (f: FieldMeta, r: Rec) => formatValue(f, { ...r, [`${f.field_key}__label`]: labelOf(f, r[f.field_key]) } as Row);
  const renderValue = (f: FieldMeta, r: Rec) => {
    const text = textOf(f, r);
    if (!text) return <span className="muted">—</span>;
    const raw = r[f.field_key];
    if (f.field_type === "reference") {
      const href = recordHref(catalog?.objects.find((o) => o.id === f.ref_object_id)?.object_key, raw);
      return href ? <Link href={href} className="ref-link">{text}</Link> : text;
    }
    if (f.field_type === "choice" || f.field_type === "boolean") return <span className={`tag tag-${String(raw)}`}>{text}</span>;
    if (f.field_type === "phone") return <a href={`tel:${raw}`} dir="ltr" className="ref-link">{text}</a>;
    if (f.field_type === "email") return <a href={`mailto:${raw}`} dir="ltr" className="ref-link">{text}</a>;
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

  const save = async () => {
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
    setSaving(true);
    try {
      if (isNew) {
        const payload = Object.fromEntries(
          editable.filter((f) => values[f.field_key] !== "").map((f) => [f.field_key, toValue(f, values[f.field_key])]),
        );
        const newId = await createRecord(objectKey, payload);
        toast(CREATED_TOAST[objectKey] ?? "הרשומה נשמרה");
        dirtyRef.current = false;
        router.replace(`${cfg.route}${newId}`);
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
      setFormError(errorText(e));
    } finally {
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
  const computed: { label: string; value: React.ReactNode; tone?: "highlight" | "warn" }[] = [];
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
          <Link href={recordHref("appointments", next.id)!} className="computed-link">
            <span className="next-date" dir="ltr">{formatDate(String(next.starts_at))}</span>
            <span className="next-time" dir="ltr">{formatTime(String(next.starts_at))}</span>
            <span className="next-meta">{textOf(af("treatment_id"), next)} · {textOf(af("therapist_id"), next)}</span>
          </Link>
        ) : "אין תור עתידי",
      });
      computed.push({ label: "קריאות פתוחות", value: childRows("service_requests", "client_id").filter((r) => r.status !== "closed").length });
    }
    if (objectKey === "appointments" && rec.starts_at) {
      const end = new Date(new Date(String(rec.starts_at)).getTime() + Number(rec.duration_minutes) * 60000);
      computed.push({ label: "שעת סיום", value: <span dir="ltr">{formatDateTime(end.toISOString())}</span> });
    }
    if (objectKey === "service_requests" && rec.status !== "closed") {
      const age = now - new Date(String(rec.created_at)).getTime();
      computed.push({ label: "פתוחה כבר", value: ago(age), tone: age > OLD_REQUEST_MS ? "warn" : undefined });
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
    <div className="record">
      <div className="record-top">
        <button type="button" className="back-link" onClick={back}>→ {nav?.backLabel ?? obj.label_plural}</button>
        {idx >= 0 && (
          <nav className="record-nav" aria-label="מעבר בין רשומות">
            <button type="button" className="btn outline" disabled={!prevId} onClick={() => prevId && leave(() => router.push(`${cfg.route}${prevId}`))}>→ הקודמת</button>
            <span className="muted">{idx + 1} מתוך {nav!.ids.length}</span>
            <button type="button" className="btn outline" disabled={!nextId} onClick={() => nextId && leave(() => router.push(`${cfg.route}${nextId}`))}>הבאה ←</button>
          </nav>
        )}
      </div>

      {/* כותרת: שם הרשומה, השדות הקריטיים והפעולות */}
      <header className="card record-head">
        <div className="record-title">
          <span className="muted">{obj.label}</span>
          <h1 className="page-title">{isNew ? `הוספת ${obj.label}` : title}</h1>
        </div>
        {!isNew && (
          <dl className="header-fields">
            {cfg.header.map((k) => byKey.get(k)).filter(Boolean).map((f) => (
              <div key={f!.field_key}>
                <dt>{f!.label}</dt>
                <dd>{renderValue(f!, rec)}</dd>
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
                    setEditing(true);
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
              {isManager && <button type="button" className="btn outline danger" onClick={askDelete}>מחיקה</button>}
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
          const showAddress = objectKey === "staff" && g === cfg.groups[0] && address !== undefined && !isNew;
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
                    <div key={f.field_key} className="field-view">
                      <span className="field-label">{f.label}</span>
                      <div>{renderValue(f, rec)}</div>
                    </div>
                  ),
                )}
                {showAddress && (
                  <div className="field-view">
                    <span className="field-label">כתובת מגורים</span>
                    <div>{address || <span className="muted">—</span>}</div>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </form>

      {/* רשומות מקושרות */}
      {!isNew && cfg.children.length > 0 && activeChild && (
        <section className="card tabs-card">
          <div className="tabs-head">
            <div className="segmented" role="tablist" aria-label="רשומות מקושרות">
              {cfg.children.map((ch, i) => (
                <button key={ch.label} type="button" role="tab" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>
                  {ch.label} ({childRows(ch.object, ch.fk).length})
                </button>
              ))}
            </div>
            {RECORDS[activeChild.object] && (RECORDS[activeChild.object].editRole === "all" || isManager) && (
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
            canEdit={RECORDS[activeChild.object]?.editRole === "all" || isManager}
            onStatus={(rowId, v) => changeChildStatus(`${activeChild.object}:${activeChild.fk}`, activeChild, rowId, v)}
            onOpen={(rowId) => {
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
          obj={childMeta(dialog.child.object).obj}
          fields={childMeta(dialog.child.object).fields}
          catalog={catalog}
          initial={{ [dialog.child.fk]: id }}
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

// רשימת הרשומות המקושרות בלשונית: לחיצה פותחת את הרשומה, והסטטוס משתנה במקום
function ChildList({
  rows, child, fields, textOf, canEdit, onStatus, onOpen,
}: {
  rows: Rec[];
  child: ChildDef;
  fields: FieldMeta[];
  textOf: (f: FieldMeta, r: Rec) => string;
  canEdit: boolean;
  onStatus: (rowId: string, v: string) => void;
  onOpen: (rowId: string) => void;
}) {
  const statusField = fields.find((f) => f.field_key === "status");
  const cols = child.columns.map((k) => fields.find((f) => f.field_key === k)).filter(Boolean) as FieldMeta[];
  if (rows.length === 0) return <div className="empty"><p>אין עדיין {child.label}.</p></div>;
  return (
    <ul className="history">
      {rows.map((r) => (
        <li key={r.id} className="row-link" tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(r.id)}>
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
                {statusField.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <span className={`tag tag-${r.status}`}>{textOf(statusField, r)}</span>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
