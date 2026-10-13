"use client";
// לוג בקשות ה-API: כל בקשה (מפתח, פעולה, נתיב, קוד תגובה, זמן תגובה), עם סינון לפי מפתח ולפי קוד תגובה.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { errorText } from "@/lib/views";
import { formatDateTime } from "@/lib/format";

type Log = { id: string; key_id: string | null; key_name: string | null; method: string; path: string; status: number; duration_ms: number; error_code: string | null; created_at: string };
type Key = { id: string; name: string };
const PAGE = 50;
const STATUS_GROUPS: { value: string; label: string }[] = [
  { value: "2xx", label: "הצלחה (2xx)" },
  { value: "4xx", label: "שגיאת לקוח (4xx)" },
  { value: "5xx", label: "שגיאת שרת (5xx)" },
  ...[200, 201, 400, 401, 403, 404, 409, 422, 429].map((s) => ({ value: String(s), label: String(s) })),
];

export default function Page() {
  const toast = useToast();
  const [keys, setKeys] = useState<Key[]>([]);
  const [filters, setFilters] = useState({ key: "", status: "" });
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    supabase.from("api_keys").select("id, name").order("created_at").then(({ data }) => setKeys((data as Key[]) ?? []));
  }, []);

  const load = useCallback(async () => {
    let q = supabase
      .from("api_logs")
      .select("id, key_id, key_name, method, path, status, duration_ms, error_code, created_at")
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (filters.key === "none") q = q.is("key_id", null);
    else if (filters.key) q = q.eq("key_id", filters.key);
    if (/^\dxx$/.test(filters.status)) {
      const base = Number(filters.status[0]) * 100;
      q = q.gte("status", base).lt("status", base + 100);
    } else if (filters.status) q = q.eq("status", Number(filters.status));
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
  const tone = (s: number) => (s < 300 ? "tag-done" : s === 429 || s >= 500 ? "tag-cancelled" : "tag-in_progress");

  return (
    <>
      <div className="views-head">
        <h1 className="page-title">לוג בקשות API</h1>
        <Link href="/settings/api" className="btn outline">למפתחות</Link>
      </div>

      <section className="card log-filters">
        <label className="field">
          <span>מפתח</span>
          <select value={filters.key} onChange={(e) => set("key", e.target.value)}>
            <option value="">כל המפתחות</option>
            {keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            <option value="none">בלי מפתח מזוהה (401)</option>
          </select>
        </label>
        <label className="field">
          <span>קוד תגובה</span>
          <select value={filters.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">הכול</option>
            {STATUS_GROUPS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <button type="button" className="link-btn" onClick={() => load()}>רענון</button>
        {(filters.key || filters.status) && (
          <button type="button" className="link-btn" onClick={() => { setLimit(PAGE); setFilters({ key: "", status: "" }); }}>ניקוי סינון</button>
        )}
      </section>

      {!logs ? (
        <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : logs.length === 0 ? (
        <div className="card empty"><p>אין בקשות שמתאימות לסינון</p></div>
      ) : (
        <div className="card table-card">
          <table className="data-table log-table">
            <thead>
              <tr>
                <th>מתי</th>
                <th>מפתח</th>
                <th>בקשה</th>
                <th className="center">קוד</th>
                <th>זמן תגובה</th>
                <th>שגיאה</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td data-label="מתי"><span dir="ltr">{formatDateTime(l.created_at)}</span></td>
                  <td data-label="מפתח">{l.key_name ?? <span className="muted">—</span>}</td>
                  <td data-label="בקשה" className="log-message" title={`${l.method} ${l.path}`}><code dir="ltr">{l.method} {l.path}</code></td>
                  <td data-label="קוד" className="center"><span className={`tag ${tone(l.status)}`}>{l.status}</span></td>
                  <td data-label="זמן תגובה"><span dir="ltr">{l.duration_ms} ms</span></td>
                  <td data-label="שגיאה">{l.error_code ? <code dir="ltr">{l.error_code}</code> : <span className="muted">—</span>}</td>
                </tr>
              ))}
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
