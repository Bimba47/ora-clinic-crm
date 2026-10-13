"use client";
// יומן תורים ויזואלי (מודול 6 באפיון): תצוגה שבועית במחשב ויומית בנייד, לפי שעות, בשעות הפעילות בלבד.
// כל תור הוא בלוק בצבע של המטפלת. לחיצה על משבצת ריקה פותחת תור חדש בשעה הזו, ולחיצה על תור פותחת אותו.
// התורים נטענים דרך run_view, ולכן חלות אותן הרשאות כמו בכל מקום (RLS והיקף השורות של התפקיד).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import { errorText, loadCatalog, loadRefOptions, type Catalog, type RefOption } from "@/lib/views";
import { saveNav } from "@/lib/records";

// שעות הפעילות – אותן שעות שהמסד אוכף (within_opening_hours ב-0001): א'-ה' 09:00-19:00, ו' 09:00-13:00, שבת סגור
const OPEN = 9 * 60;
const CLOSE: Record<number, number> = { 0: 19 * 60, 1: 19 * 60, 2: 19 * 60, 3: 19 * 60, 4: 19 * 60, 5: 13 * 60 };
const SLOT = 30;          // משבצת ללחיצה: חצי שעה
const PX_PER_MIN = 1.2;   // גובה דקה בפיקסלים
const PX_PER_MIN_MOBILE = 1.6; // בנייד: חצי שעה = 48px, אזור מגע של 44px לפחות (האפיון)
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const TZ = "Asia/Jerusalem";

type Appt = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  client_id: string;
  client_id__label: string;
  treatment_id: string;
  treatment_id__label: string;
  therapist_id: string;
  therapist_id__label: string;
};

// תאריך (YYYY-MM-DD) ושעה בדקות לפי שעון ישראל
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
function minutesOf(iso: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === "hour")!.value) % 24 * 60 + Number(p.find((x) => x.type === "minute")!.value);
}
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dayLabel = (date: string) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric" }).format(new Date(`${date}T12:00:00Z`));

// צבע לכל מטפלת, מצבעי הסטטוסים של האפיון: גוונים שונים בבירור זה מזה
const THERAPIST_COLORS = ["#E3BFA8", "#9E5F6A", "#A39A93", "#C99A7A", "#A67C52", "#F1D6D0"]; // ורוד בהיר, ורוד כהה, אפור – כמו הסטטוסים
const DARK_COLORS = ["#9E5F6A", "#A39A93", "#A67C52"]; // עליהם הטקסט לבן

export default function AppointmentsCalendar() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [therapists, setTherapists] = useState<RefOption[]>([]);
  const [treatments, setTreatments] = useState<RefOption[]>([]);
  const [anchor, setAnchor] = useState(() => ymd(new Date()));
  // ?date=YYYY-MM-DD: חזרה ליום שבו נקבע תור חדש
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setAnchor(d);
  }, []);
  const [mode, setMode] = useState<"week" | "day">("week");
  const [narrow, setNarrow] = useState(false);
  const [filterTherapist, setFilterTherapist] = useState("");
  const [filterTreatment, setFilterTreatment] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [appts, setAppts] = useState<Appt[] | null>(null);

  // בנייד (מתחת ל-768px) נפתחת תצוגה יומית
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      setMode(mq.matches ? "day" : "week");
      setNarrow(mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    loadCatalog().then(async (cat) => {
      setCatalog(cat);
      const staff = cat.objects.find((o) => o.object_key === "staff");
      const tr = cat.objects.find((o) => o.object_key === "treatments");
      if (staff) setTherapists((await loadRefOptions(staff, cat)).filter((o) => !o.inactive));
      if (tr) setTreatments(await loadRefOptions(tr, cat));
    }).catch((e) => toast(errorText(e), "err"));
  }, [toast]);

  // הימים בתצוגה: שבוע מיום ראשון עד שישי, או יום אחד
  const days = useMemo(() => {
    if (mode === "day") return [anchor];
    const start = addDays(anchor, -dow(anchor));
    return [0, 1, 2, 3, 4, 5].map((i) => addDays(start, i));
  }, [anchor, mode]);

  useEffect(() => {
    let cancelled = false;
    setAppts(null);
    const filters = [
      { field: "starts_at", op: "gte", value: days[0] },
      { field: "starts_at", op: "lte", value: days[days.length - 1] },
      ...(filterTherapist ? [{ field: "therapist_id", op: "eq", value: filterTherapist }] : []),
      ...(filterTreatment ? [{ field: "treatment_id", op: "eq", value: filterTreatment }] : []),
      ...(showCancelled ? [] : [{ field: "status", op: "neq", value: "cancelled" }]),
    ];
    supabase
      .rpc("run_view", {
        p_object: "appointments",
        p_def: {
          columns: ["starts_at", "duration_minutes", "status", "client_id", "treatment_id", "therapist_id"],
          filters, match: "all", sorts: [{ field: "starts_at", dir: "asc" }],
        },
        p_search: null,
        p_limit: 500,
        p_offset: 0,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast(errorText(error), "err");
          setAppts([]);
        } else setAppts(((data as { rows: Appt[] }).rows ?? []) as Appt[]);
      });
    return () => {
      cancelled = true;
    };
  }, [days, filterTherapist, filterTreatment, showCancelled, toast]);

  // צבע לכל מטפלת לפי הסדר ברשימה (צבעי הגרפים של האפיון)
  const colorOf = (id: string) => {
    const i = therapists.findIndex((t) => t.value === id);
    return THERAPIST_COLORS[(i < 0 ? therapists.length : i) % THERAPIST_COLORS.length];
  };
  const dark = (c: string) => DARK_COLORS.includes(c);

  const pxPerMin = narrow ? PX_PER_MIN_MOBILE : PX_PER_MIN;
  const today = ymd(new Date());
  const maxClose = Math.max(...days.map((d) => CLOSE[dow(d)] ?? OPEN));
  const height = (maxClose - OPEN) * pxPerMin;
  const hours: number[] = [];
  for (let m = OPEN; m <= maxClose; m += 60) hours.push(m);

  // החצים בלבד (בלי "היום" ובלי כותרת תאריך, לבקשת ענבל): התאריכים מופיעים בכותרות הימים
  const step = (n: number) => setAnchor(addDays(anchor, n * (mode === "week" ? 7 : 1)));

  const openAppt = (a: Appt) => {
    const ids = (appts ?? []).map((x) => x.id);
    saveNav("appointments", { ids, backHref: "/appointments", backLabel: "יומן תורים" });
    router.push(`/appointments/${a.id}`);
  };
  const newAt = (date: string, minute: number) => {
    if (!can("appointments", "create")) return;
    // אחרי השמירה חוזרים ליומן, לאותו יום
    const q = new URLSearchParams({ starts_at: `${date}T${hhmm(minute)}`, return: `/appointments?date=${date}` });
    if (filterTherapist) q.set("therapist_id", filterTherapist);
    router.push(`/appointments/new?${q}`);
  };

  return (
    <div className="calendar">
      <div className="views-head">
        <h1 className="page-title">תורים</h1>
        {can("appointments", "create") && <Link href={`/appointments/new?return=${encodeURIComponent(`/appointments?date=${anchor}`)}`} className="btn primary cta">+ תור חדש</Link>}
      </div>

      <div className="cal-bar card">
        {/* סדר הכפתורים: יומן/רשימה, יום/שבוע, ואז החצים */}
        <div className="cal-controls">
          <div className="segmented" role="tablist" aria-label="תצוגה">
            <button type="button" role="tab" aria-selected className="on">יומן</button>
            <Link href="/appointments/list" role="tab" aria-selected={false} className="seg-link">רשימה</Link>
          </div>
          <div className="segmented small-seg" role="radiogroup" aria-label="יום או שבוע">
            <button type="button" role="radio" aria-checked={mode === "day"} className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>יום</button>
            <button type="button" role="radio" aria-checked={mode === "week"} className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>שבוע</button>
          </div>
          <div className="cal-nav">
            <button type="button" className="icon-btn" aria-label={mode === "week" ? "השבוע הקודם" : "היום הקודם"} onClick={() => step(-1)}>→</button>
            <button type="button" className="icon-btn" aria-label={mode === "week" ? "השבוע הבא" : "היום הבא"} onClick={() => step(1)}>←</button>
          </div>
        </div>
        <div className="cal-filters">
          <select value={filterTherapist} onChange={(e) => setFilterTherapist(e.target.value)} aria-label="סינון לפי מטפלת">
            <option value="">כל המטפלות</option>
            {therapists.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={filterTreatment} onChange={(e) => setFilterTreatment(e.target.value)} aria-label="סינון לפי טיפול">
            <option value="">כל הטיפולים</option>
            {treatments.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label className="check-field compact"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /><span>גם תורים שבוטלו</span></label>
        </div>
        {therapists.length > 0 && (
          <div className="cal-legend" aria-label="מקרא מטפלות">
            {therapists.map((t) => (
              <span key={t.value} className="legend-item static"><span className="legend-dot" style={{ background: colorOf(t.value) }} />{t.label}</span>
            ))}
          </div>
        )}
      </div>

      {!catalog || !appts ? (
        <div className="skeleton cal-skeleton" aria-busy="true" />
      ) : (
        <div className={`card cal-grid cal-${mode}`} style={{ ["--days" as string]: days.length }}>
          {/* כותרות הימים */}
          <div className="cal-corner" />
          {days.map((d) => (
            <button
              key={d}
              type="button"
              className={`cal-dayhead${d === today ? " today" : ""}`}
              onClick={() => { setAnchor(d); setMode("day"); }}
              title="לתצוגת היום"
            >
              <span>{DAY_NAMES[dow(d)]}</span>
              <span className="cal-date">{dayLabel(d)}</span>
            </button>
          ))}

          {/* עמודת השעות */}
          <div className="cal-hours" style={{ height }}>
            {hours.map((m) => (
              <span key={m} className="cal-hour" style={{ top: (m - OPEN) * pxPerMin }} dir="ltr">{hhmm(m)}</span>
            ))}
          </div>

          {days.map((d) => {
            const close = CLOSE[dow(d)] ?? OPEN;
            const slots: number[] = [];
            for (let m = OPEN; m < close; m += SLOT) slots.push(m);
            const dayAppts = (appts ?? []).filter((a) => ymd(new Date(a.starts_at)) === d);
            const lanes = layoutLanes(dayAppts);
            return (
              <div key={d} className={`cal-day${d === today ? " today" : ""}`} style={{ height }}>
                {slots.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`cal-slot${m % 60 === 0 ? " hour" : ""}`}
                    style={{ top: (m - OPEN) * pxPerMin, height: SLOT * pxPerMin }}
                    aria-label={`תור חדש ביום ${DAY_NAMES[dow(d)]} ${dayLabel(d)} בשעה ${hhmm(m)}`}
                    onClick={() => newAt(d, m)}
                  />
                ))}
                {close < maxClose && (
                  <div className="cal-closed" style={{ top: (close - OPEN) * pxPerMin, height: (maxClose - close) * pxPerMin }}>סגור</div>
                )}
                {dayAppts.map((a) => {
                  const start = minutesOf(a.starts_at);
                  const { lane, of } = lanes.get(a.id)!;
                  const bg = colorOf(a.therapist_id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`cal-appt${a.status === "cancelled" ? " cancelled" : ""}${a.status === "done" ? " done" : ""}`}
                      style={{
                        top: (start - OPEN) * pxPerMin,
                        height: Math.max(a.duration_minutes * pxPerMin - 2, narrow ? 44 : 18),
                        insetInlineStart: `calc(${(lane / of) * 100}% + 2px)`,
                        width: `calc(${100 / of}% - 4px)`,
                        background: bg,
                        color: dark(bg) ? "#FFFFFF" : "#2C2520",
                      }}
                      onClick={() => openAppt(a)}
                      title={`${hhmm(start)}–${hhmm(start + a.duration_minutes)} · ${a.client_id__label} · ${a.treatment_id__label} · ${a.therapist_id__label}`}
                    >
                      <span className="cal-appt-time" dir="ltr">{hhmm(start)}</span>
                      <span className="cal-appt-client">{a.client_id__label}</span>
                      {a.duration_minutes >= 40 && <span className="cal-appt-meta">{a.treatment_id__label}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {appts && appts.length === 0 && (
        <p className="muted cal-empty">{mode === "week" ? "אין תורים בשבוע הזה." : "אין תורים ביום הזה."} לחיצה על משבצת פנויה קובעת תור.</p>
      )}
    </div>
  );
}

// תורים שחופפים בזמן (של מטפלות שונות) מוצגים זה לצד זה
function layoutLanes(list: Appt[]) {
  const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const res = new Map<string, { lane: number; of: number }>();
  let group: Appt[] = [];
  let groupEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const of = Math.max(1, ...group.map((g) => res.get(g.id)!.lane + 1));
    group.forEach((g) => res.set(g.id, { lane: res.get(g.id)!.lane, of }));
    group = [];
    laneEnds.length = 0;
  };
  for (const a of sorted) {
    const s = minutesOf(a.starts_at);
    const e = s + a.duration_minutes;
    if (group.length && s >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = e;
    res.set(a.id, { lane, of: 1 });
    group.push(a);
    groupEnd = Math.max(groupEnd, e);
  }
  if (group.length) flush();
  return res;
}
