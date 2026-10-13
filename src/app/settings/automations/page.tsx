"use client";
// אוטומציות (מנהלת מערכת): רשימת הכללים – שם, אובייקט, טריגר, מתג פעיל, ומתי רץ לאחרונה.
// הכללים רצים במסד (טריגר על כל טבלת אובייקט, ותזמון ב-pg_cron). כאן רק מגדירים אותם.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { Confirm } from "@/components/Modal";
import { errorText } from "@/lib/views";
import { formatDateTime } from "@/lib/format";
import { EVENT_LABELS, STATUS_LABELS, loadSchema, objOf, type AutoEvent, type LogStatus, type Schema } from "@/lib/automations";

type Row = {
  id: string;
  name: string;
  object_name: string;
  trigger_event: AutoEvent;
  is_active: boolean;
  schedule_cron: string | null;
  last_run_at: string | null;
  last_status: LogStatus | null;
  runs_success: number;
  runs_failed: number;
};

export default function Page() {
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const [list, sch] = await Promise.all([supabase.rpc("automation_rule_list"), loadSchema().catch(() => null)]);
    if (list.error) toast(errorText(list.error), "err");
    setRows((list.data as Row[]) ?? []);
    setSchema(sch);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // מתג פעיל: מתעדכן מיד, וחוזר אחורה אם השמירה נכשלה
  const toggle = async (r: Row) => {
    setRows((rs) => rs!.map((x) => (x.id === r.id ? { ...x, is_active: !r.is_active } : x)));
    const { error } = await supabase.from("automation_rules").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) {
      setRows((rs) => rs!.map((x) => (x.id === r.id ? { ...x, is_active: r.is_active } : x)));
      return toast(errorText(error), "err");
    }
    toast(r.is_active ? "הכלל הושבת" : "הכלל הופעל");
  };

  // שכפול: עותק מושבת, ומיד פותחים אותו לעריכה
  const duplicate = async (r: Row) => {
    const { data: src, error } = await supabase
      .from("automation_rules")
      .select("name, object_name, trigger_event, trigger_fields, schedule_cron, conditions, actions")
      .eq("id", r.id)
      .single();
    if (error || !src) return toast(errorText(error), "err");
    const { data: copy, error: e2 } = await supabase
      .from("automation_rules")
      .insert({ ...src, name: `${src.name} (עותק)`, is_active: false })
      .select("id")
      .single();
    if (e2 || !copy) return toast(errorText(e2), "err");
    toast("הכלל שוכפל (מושבת עד שתפעילי אותו)");
    router.push(`/settings/automations/${copy.id}`);
  };

  const remove = async (r: Row) => {
    setDeleting(null);
    const { error } = await supabase.from("automation_rules").delete().eq("id", r.id);
    if (error) return toast(errorText(error), "err");
    toast("הכלל נמחק");
    load();
  };

  if (!rows) return <div className="skeleton" style={{ height: 320 }} aria-busy="true" />;

  return (
    <>
      <div className="views-head">
        <h1 className="page-title">אוטומציות</h1>
        <div className="head-buttons">
          <Link href="/settings/automations/log" className="btn outline">לוג הרצות</Link>
          <Link href="/settings/automations/new" className="btn primary cta">+ כלל חדש</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">
          <p>עוד אין כללי אוטומציה</p>
          <Link href="/settings/automations/new" className="btn primary">צרי כלל ראשון</Link>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table auto-table">
            <thead>
              <tr>
                <th>שם הכלל</th>
                <th>אובייקט</th>
                <th>מתי רץ</th>
                <th className="center">פעיל</th>
                <th>הרצה אחרונה</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.is_active ? undefined : "inactive"}>
                  <td data-label="שם הכלל">
                    <Link href={`/settings/automations/${r.id}`} className="ref-link">{r.name}</Link>
                  </td>
                  <td data-label="אובייקט">{(schema && objOf(schema, r.object_name)?.label_plural) ?? r.object_name}</td>
                  <td data-label="מתי רץ">
                    {EVENT_LABELS[r.trigger_event]}
                    {r.trigger_event === "schedule" && r.schedule_cron && <span className="muted" dir="ltr"> ({r.schedule_cron})</span>}
                  </td>
                  <td data-label="פעיל" className="center">
                    <label className="switch" title={r.is_active ? "פעיל" : "מושבת"}>
                      <input type="checkbox" checked={r.is_active} onChange={() => toggle(r)} aria-label={`הכלל ${r.name} פעיל`} />
                      <span aria-hidden="true" />
                    </label>
                  </td>
                  <td data-label="הרצה אחרונה">
                    {r.last_run_at ? (
                      <span className="last-run">
                        <span dir="ltr">{formatDateTime(r.last_run_at)}</span>
                        {r.last_status && <span className={`tag tag-log-${r.last_status}`}>{STATUS_LABELS[r.last_status]}</span>}
                      </span>
                    ) : (
                      <span className="muted">עוד לא רץ</span>
                    )}
                  </td>
                  <td className="row-actions">
                    <Link href={`/settings/automations/log?rule=${r.id}`} className="link-btn">לוג</Link>
                    <button type="button" className="link-btn" onClick={() => duplicate(r)}>שכפול</button>
                    <button type="button" className="link-btn danger" onClick={() => setDeleting(r)}>מחיקה</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting && (
        <Confirm
          text={`למחוק את הכלל "${deleting.name}"? גם הלוג שלו יימחק. אפשר במקום זה להשבית אותו.`}
          confirmLabel="מחיקה"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}
    </>
  );
}
