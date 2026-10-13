"use client";
// פעמון ההתראות בכותרת העליונה: מונה של מה שטרם נקרא, ורשימה של ההתראות האחרונות.
// לחיצה על התראה מסמנת אותה כנקראה ומובילה לרשומה שלה. "סמני הכול כנקרא", וקישור למסך המלא.
// המונה מתעדכן בזמן אמת (Supabase Realtime). כל אחת רואה רק את ההתראות שלה, וזה נאכף ב-RLS.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./Auth";
import Icon from "./Icon";
import { recordHref } from "@/lib/records";

export type Notification = {
  id: string;
  message: string;
  kind: "assignment" | "reminder" | "update" | "system";
  object_key: string | null;
  record_id: string | null;
  is_read: boolean;
  created_at: string;
};

export const KIND_LABELS: Record<Notification["kind"], string> = {
  assignment: "שיוך",
  reminder: "תזכורת",
  update: "עדכון",
  system: "מערכת",
};

const SHOWN = 8;

export function timeAgo(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} דק'`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  return d === 1 ? "אתמול" : `לפני ${d} ימים`;
}

// פתיחת התראה: סימון כנקראה ומעבר לרשומה שהיא מקשרת אליה
export async function openNotification(n: Pick<Notification, "id" | "is_read" | "object_key" | "record_id">) {
  if (!n.is_read) await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
  return recordHref(n.object_key ?? undefined, n.record_id) ?? "/notifications";
}

export async function markAllRead(userId: string) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("recipient_id", userId).eq("is_read", false);
  if (error) throw error;
}

export default function NotificationBell() {
  const { userId, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [about, setAbout] = useState<Record<string, string>>({}); // על מה ההתראה: תיאור הקריאה, לפי מזהה
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId || !me?.is_active) return;
    const [list, count] = await Promise.all([
      supabase
        .from("notifications")
        .select("id, message, kind, object_key, record_id, is_read, created_at")
        .order("created_at", { ascending: false })
        .limit(SHOWN),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false),
    ]);
    if (!list.error) {
      const rows = list.data as Notification[];
      setItems(rows);
      // תיאור הקריאה שההתראה מדברת עליה (רק מה שמותר לי לראות, לפי RLS)
      const ids = rows.filter((n) => n.object_key === "service_requests" && n.record_id).map((n) => n.record_id as string);
      if (ids.length) {
        const { data } = await supabase.from("service_requests").select("id, description").in("id", ids);
        setAbout(Object.fromEntries((data ?? []).map((r) => [r.id as string, r.description as string])));
      }
    }
    if (!count.error) setUnread(count.count ?? 0);
  }, [userId, me?.is_active]);

  // טעינה בכל מעבר מסך, ועדכון חי כשנוספת או משתנה התראה שלי
  useEffect(() => {
    load();
  }, [load, pathname]);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  // סגירה בלחיצה מחוץ לרשימה או ב-Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = async (n: Notification) => {
    setOpen(false);
    const href = await openNotification(n);
    load();
    router.push(href);
  };

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className="icon-btn"
        aria-label={unread ? `התראות, ${unread} שלא נקראו` : "התראות"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel card" role="dialog" aria-label="התראות">
          <div className="bell-head">
            <strong>התראות</strong>
            {unread > 0 && (
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  if (userId) await markAllRead(userId);
                  load();
                }}
              >
                סמני הכול כנקרא
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="muted bell-empty">אין התראות.</p>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={n.is_read ? "" : "unread"} onClick={() => choose(n)}>
                    <span className="bell-msg">{n.message}</span>
                    {n.record_id && about[n.record_id] && <span className="bell-about">{about[n.record_id]}</span>}
                    <span className="muted">
                      {KIND_LABELS[n.kind]} · {timeAgo(n.created_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" className="bell-all" onClick={() => setOpen(false)}>לכל ההתראות ←</Link>
        </div>
      )}
    </div>
  );
}
