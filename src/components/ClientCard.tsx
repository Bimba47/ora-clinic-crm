"use client";
// כרטיס לקוח לפי האפיון: פרטים, התור הבא מודגש, לשונית תורים (מהחדש לישן, כולל שבוטלו)
// ולשונית קריאות שירות. מהכרטיס: עריכת פרטים, וואטסאפ, "תור חדש" ו"קריאה חדשה" כשהלקוחה כבר מסומנת,
// ושינוי סטטוס של תור או קריאה מתוך הלשונית. כל הנתונים נקראים בהרשאות המשתמשת (RLS).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import RecordForm from "@/components/views/RecordForm";
import { type Catalog, type FieldMeta, type Row, errorText, loadCatalog, updateRecords } from "@/lib/views";
import { choiceLabel, formatDateTime, formatMoney, formatPhone, whatsappHref } from "@/lib/format";

type Client = {
  id: string;
  full_name: string;
  phone: string;
  source: string | null;
  created_at: string;
  creator: { full_name: string } | null;
};
type Appt = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  price: number;
  status: string;
  notes: string | null;
  treatment: { name: string } | null;
  therapist: { full_name: string } | null;
};
type Req = {
  id: string;
  description: string;
  status: string;
  created_at: string;
  assigned: { full_name: string } | null;
};
type ObjectKey = "clients" | "appointments" | "service_requests";
type Dialog = { object: ObjectKey; id?: string } | null;

const OLD_REQUEST_MS = 48 * 60 * 60 * 1000;

export default function ClientCard({ id }: { id: string }) {
  const { me } = useAuth();
  const toast = useToast();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [client, setClient] = useState<Client | null | undefined>(undefined); // null = לא נמצאה
  const [appts, setAppts] = useState<Appt[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [tab, setTab] = useState<"appointments" | "requests">("appointments");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [c, a, r] = await Promise.all([
      supabase
        .from("clients")
        .select("id, full_name, phone, source, created_at, creator:staff!clients_created_by_fkey(full_name)")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("appointments")
        .select("id, starts_at, duration_minutes, price, status, notes, treatment:treatments(name), therapist:staff!appointments_therapist_id_fkey(full_name)")
        .eq("client_id", id)
        .order("starts_at", { ascending: false }),
      supabase
        .from("service_requests")
        .select("id, description, status, created_at, assigned:staff!service_requests_assigned_to_fkey(full_name)")
        .eq("client_id", id)
        .order("created_at", { ascending: false }),
    ]);
    const err = c.error ?? a.error ?? r.error;
    if (err) throw err;
    setClient(c.data as unknown as Client | null);
    setAppts(a.data as unknown as Appt[]);
    setReqs(r.data as unknown as Req[]);
  }, [id]);

  useEffect(() => {
    if (!me?.is_active) return;
    loadCatalog().then(setCatalog).catch((e) => setError(errorText(e)));
    load().catch((e) => setError(errorText(e)));
  }, [me?.is_active, load]);

  const fieldsOf = (key: ObjectKey) => {
    const obj = catalog?.objects.find((o) => o.object_key === key);
    return { obj, fields: catalog && obj ? catalog.fields.filter((f) => f.object_id === obj.id) : [] };
  };
  const statusField = (key: ObjectKey) => fieldsOf(key).fields.find((f) => f.field_key === "status");
  const sourceField = fieldsOf("clients").fields.find((f) => f.field_key === "source");

  // שינוי סטטוס מהלשונית: מתעדכן מיד, וחוזר אחורה עם הודעה אם המסד דחה (למשל "בטיפול" בלי אחראית)
  const changeStatus = async <T extends { id: string; status: string }>(
    key: ObjectKey,
    rowId: string,
    value: string,
    list: T[],
    setList: (l: T[]) => void,
  ) => {
    const prev = list;
    setList(list.map((x) => (x.id === rowId ? { ...x, status: value } : x)));
    try {
      const n = await updateRecords(key, [rowId], { status: value });
      if (n === 0) throw new Error("אין לך הרשאה לשנות את הרשומה הזו.");
      toast("הסטטוס עודכן");
    } catch (e) {
      setList(prev);
      toast(errorText(e), "err");
    }
  };

  if (me && !me.is_active) return null;
  if (error) return <div className="card empty"><p>{error}</p></div>;
  if (client === undefined || !catalog) {
    return (
      <div aria-busy="true">
        <div className="skeleton" style={{ height: 36, width: 240, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 120, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }
  if (client === null) {
    return (
      <div className="card empty">
        <p>הלקוחה לא נמצאה.</p>
        <Link href="/clients" className="btn outline">חזרה ללקוחות</Link>
      </div>
    );
  }

  const now = Date.now();
  const next = appts
    .filter((a) => a.status === "upcoming" && new Date(a.starts_at).getTime() >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const apptStatus = statusField("appointments");
  const reqStatus = statusField("service_requests");
  const openReqs = reqs.filter((r) => r.status !== "closed").length;
  const dialogMeta = dialog ? fieldsOf(dialog.object) : null;

  return (
    <div className="client-card">
      <Link href="/clients" className="back-link">→ לקוחות</Link>

      <div className="views-head">
        <h1 className="page-title">{client.full_name}</h1>
        <div className="head-actions">
          <a className="btn outline" href={whatsappHref(client.phone)} target="_blank" rel="noopener noreferrer">וואטסאפ</a>
          <button type="button" className="btn outline" onClick={() => setDialog({ object: "clients", id: client.id })}>עריכת פרטים</button>
        </div>
      </div>

      <div className="card-grid">
        <section className="card" aria-label="פרטים">
          <dl className="details">
            <div>
              <dt>טלפון</dt>
              <dd><a href={`tel:${client.phone}`} dir="ltr">{formatPhone(client.phone)}</a></dd>
            </div>
            <div>
              <dt>מקור הגעה</dt>
              <dd>{client.source && sourceField ? <span className={`tag tag-${client.source}`}>{choiceLabel(sourceField, client.source)}</span> : "—"}</dd>
            </div>
            <div>
              <dt>נוצרה</dt>
              <dd>
                <span dir="ltr">{formatDateTime(client.created_at)}</span>
                {client.creator ? ` · ${client.creator.full_name}` : ""}
              </dd>
            </div>
            <div>
              <dt>קריאות פתוחות</dt>
              <dd>{openReqs}</dd>
            </div>
          </dl>
        </section>

        <section className={`card next-appt${next ? "" : " none"}`} aria-label="התור הבא">
          <h2 className="section-title">התור הבא</h2>
          {next ? (
            <button type="button" className="next-body" onClick={() => setDialog({ object: "appointments", id: next.id })}>
              <span className="kpi" dir="ltr">{formatDateTime(next.starts_at)}</span>
              <span>{next.treatment?.name} · {next.therapist?.full_name} · {formatMoney(next.price)}</span>
            </button>
          ) : (
            <p className="muted">אין תור עתידי.</p>
          )}
        </section>
      </div>

      <section className="card tabs-card">
        <div className="tabs-head">
          <div className="segmented" role="tablist" aria-label="היסטוריה">
            <button type="button" role="tab" aria-selected={tab === "appointments"} className={tab === "appointments" ? "on" : ""} onClick={() => setTab("appointments")}>
              תורים ({appts.length})
            </button>
            <button type="button" role="tab" aria-selected={tab === "requests"} className={tab === "requests" ? "on" : ""} onClick={() => setTab("requests")}>
              קריאות שירות ({reqs.length})
            </button>
          </div>
          <button
            type="button"
            className="btn primary cta"
            onClick={() => setDialog({ object: tab === "appointments" ? "appointments" : "service_requests" })}
          >
            {tab === "appointments" ? "+ תור חדש" : "+ קריאה חדשה"}
          </button>
        </div>

        {tab === "appointments" ? (
          appts.length === 0 ? (
            <div className="empty"><p>עוד אין תורים ללקוחה הזו.</p></div>
          ) : (
            <ul className="history">
              {appts.map((a) => (
                <li
                  key={a.id}
                  className={`row-link${next?.id === a.id ? " is-next" : ""}`}
                  tabIndex={0}
                  onClick={() => setDialog({ object: "appointments", id: a.id })}
                  onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && setDialog({ object: "appointments", id: a.id })}
                >
                  <div className="history-main">
                    <strong dir="ltr">{formatDateTime(a.starts_at)}</strong>
                    <span>{a.treatment?.name}</span>
                    <span className="muted">{a.therapist?.full_name} · {a.duration_minutes} דק' · {formatMoney(a.price)}</span>
                  </div>
                  {apptStatus && (
                    <StatusSelect
                      field={apptStatus}
                      value={a.status}
                      onChange={(v) => changeStatus("appointments", a.id, v, appts, setAppts)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )
        ) : reqs.length === 0 ? (
          <div className="empty"><p>אין קריאות שירות ללקוחה הזו.</p></div>
        ) : (
          <ul className="history">
            {reqs.map((r) => {
              const old = r.status !== "closed" && now - new Date(r.created_at).getTime() > OLD_REQUEST_MS;
              return (
                <li
                  key={r.id}
                  className="row-link"
                  tabIndex={0}
                  onClick={() => setDialog({ object: "service_requests", id: r.id })}
                  onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && setDialog({ object: "service_requests", id: r.id })}
                >
                  <div className="history-main">
                    <strong>{r.description}</strong>
                    <span className="muted">
                      <span dir="ltr">{formatDateTime(r.created_at)}</span> · {r.assigned?.full_name ?? "בלי אחראית"}
                    </span>
                    {old && <span className="overdue">פתוחה יותר מ-48 שעות</span>}
                  </div>
                  {reqStatus && (
                    <StatusSelect
                      field={reqStatus}
                      value={r.status}
                      onChange={(v) => changeStatus("service_requests", r.id, v, reqs, setReqs)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {dialog && dialogMeta?.obj && (
        <RecordForm
          key={`${dialog.object}-${dialog.id ?? "new"}`}
          obj={dialogMeta.obj}
          fields={dialogMeta.fields}
          catalog={catalog}
          row={dialog.id ? ({ id: dialog.id } as Row) : undefined}
          initial={dialog.id ? undefined : { client_id: client.id }}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load().catch((e) => toast(errorText(e), "err"));
          }}
        />
      )}
    </div>
  );
}

// סטטוס כתגית שאפשר לשנות במקום. לחיצה עליו לא פותחת את הרשומה.
function StatusSelect({ field, value, onChange }: { field: FieldMeta; value: string; onChange: (v: string) => void }) {
  return (
    <select
      className={`status-select tag tag-${value}`}
      aria-label={field.label}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    >
      {field.options?.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
