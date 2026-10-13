"use client";
// לוג הרצות האוטומציות: כל הרצה של כל כלל (הצליח, נכשל, דולג), עם סינון לפי כלל, סטטוס וטווח תאריכים.

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { errorText } from "@/lib/views";
import { formatDateTime } from "@/lib/format";
import { recordHref } from "@/lib/records";
import { STATUS_LABELS, type LogStatus } from "@/lib/automations";

type Log = { id: string; rule_id: string; object_name: string | null; record_id: string | null; status: LogStatus; message: string | null; executed_at: string };
type RuleName = { id: string; name: string };
const PAGE = 50;

export default function Page() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 320 }} aria-busy="true" />}>
      <LogScreen />
    </Suspense>
  );
}

function LogScreen() {
  const params = useSearchParams();
  const toast = useToast();
  const [rules, setRules] = useState<RuleName[]>([]);
  const [filters, setFilters] = useState({ rule: params.get("rule") ?? "", status: "", from: "", to: "" });
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    supabase.from("automation_rules").select("id, name").order("created_at").then(({ data }) => setRules((data as RuleName[]) ?? []));
  }, []);

  const load = useCallback(async () => {
    let q = supabase
      .from("automation_logs")
      .select("id, rule_id, object_name, record_id, status, message, executed_at")
      .order("executed_at", { ascending: false })
      .limit(limit + 1);
    if (filters.rule) q = q.eq("rule_id", filters.rule);
    if (filters.status) q = q.eq("status", filters.status);
    // טווח תאריכים לפי שעון ישראל: מתחילת יום "מ" עד סוף יום "עד"
    if (filters.from) q = q.gte("executed_at", new Date(`${filters.from}T00:00:00`).toISOString());
    if (filters.to) q = q.lt("executed_at", new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86400000).toISOString());
    const { data, error } = await q;
    if (error) return toast(errorText(error), "err");
    const rows = (data as Log[]) ?? [];
    setHasMore(rows.length > limit);
    setLogs(rows.slice(0, limit));
  }, [filters, limit, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: keyof typeof filters, v: string) => {
    setLimit(PAGE);
    setFilters({ ...filters, [k]: v });
  };
  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name ?? "";

  return (
    <>
      <div className="views-head">
        <h1 className="page-title">לוג אוטומציות</h1>
        <Link href="/settings/automations" className="btn outline">לרשימת הכללים</Link>
      </div>

      <section className="card log-filters">
        <label className="field">
          <span>כלל</span>
          <select value={filters.rule} onChange={(e) => set("rule", e.target.value)}>
            <option value="">כל הכללים</option>
            {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>סטטוס</span>
          <select value={filters.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">הכול</option>
            {(Object.keys(STATUS_LABELS) as LogStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>מתאריך</span>
          <input type="date" dir="ltr" value={filters.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="field">
          <span>עד תאריך</span>
          <input type="date" dir="ltr" value={filters.to} onChange={(e) => set("to", e.target.value)} />
        </label>
        {(filters.rule || filters.status || filters.from || filters.to) && (
          <button type="button" className="link-btn" onClick={() => { setLimit(PAGE); setFilters({ rule: "", status: "", from: "", to: "" }); }}>ניקוי סינון</button>
        )}
      </section>

      {!logs ? (
        <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : logs.length === 0 ? (
        <div className="card empty"><p>אין הרצות שמתאימות לסינון</p></div>
      ) : (
        <div className="card table-card">
          <table className="data-table log-table">
            <thead>
              <tr>
                <th>מתי</th>
                <th>כלל</th>
                <th className="center">סטטוס</th>
                <th>רשומה</th>
                <th>פירוט</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const href = l.record_id ? recordHref(l.object_name ?? undefined, l.record_id) : null;
                return (
                  <tr key={l.id}>
                    <td data-label="מתי"><span dir="ltr">{formatDateTime(l.executed_at)}</span></td>
                    <td data-label="כלל"><Link href={`/settings/automations/${l.rule_id}`} className="ref-link">{ruleName(l.rule_id)}</Link></td>
                    <td data-label="סטטוס" className="center"><span className={`tag tag-log-${l.status}`}>{STATUS_LABELS[l.status]}</span></td>
                    <td data-label="רשומה">{href ? <Link href={href} className="ref-link">פתיחה</Link> : <span className="muted">—</span>}</td>
                    <td data-label="פירוט" className="log-message" title={l.message ?? ""}>{l.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasMore && (
            <div className="pager">
              <button type="button" className="btn outline" onClick={() => setLimit(limit + PAGE)}>הצגת עוד</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
