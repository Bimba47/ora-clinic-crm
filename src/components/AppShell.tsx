"use client";
// מסגרת האפליקציה לפי האפיון:
// מחשב: תפריט צד קבוע בצד ימין. נייד (מתחת ל-768px): סרגל תחתון עם 4 לשוניות.
// כותרת עליונה בכל מסך: חזרה, חיפוש לפי טלפון, פעמון התראות (ובנייד גם הגדרות).
// שם המערכת והלוגו נקראים מההגדרות (app_settings). מסך הכניסה מוצג בלי המסגרת.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Icon, { type IconName } from "./Icon";
import { AuthProvider, useAuth } from "./Auth";
import { ToastProvider } from "./Toast";
import { Brand, SettingsProvider } from "./Settings";
import NotificationBell from "./NotificationBell";
import PhoneSearch from "./PhoneSearch";
import QuickAdd from "./QuickAdd";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type NavItem = { label: string; short?: string; href: string; icon: IconName; mobile?: boolean; object?: string };

// ניהול צוות ומחירון נמצאים בתוך "הגדרות" (/settings)
const NAV: NavItem[] = [
  { label: "לוחות בקרה", short: "ראשי", href: "/", icon: "home", mobile: true },
  { label: "לקוחות", href: "/clients", icon: "users", mobile: true, object: "clients" },
  { label: "תורים", href: "/appointments", icon: "calendar", mobile: true, object: "appointments" },
  { label: "קריאות שירות", short: "קריאות", href: "/requests", icon: "ticket", mobile: true, object: "service_requests" },
  { label: "משימות", href: "/tasks", icon: "task", object: "tasks" },
  { label: "התראות", href: "/notifications", icon: "bell" },
  { label: "הגדרות", href: "/settings", icon: "settings" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href.split("/").slice(0, 2).join("/"));
}

function NavEntry({ item, compact, badge }: { item: NavItem; compact?: boolean; badge?: number }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link href={item.href} className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} />
      <span>{compact && item.short ? item.short : item.label}</span>
      {badge ? <span className="nav-badge" aria-label={`${badge} קריאות חדשות שמשויכות אלייך`}>{badge}</span> : null}
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, userId, me, signOut, can } = useAuth();
  // פריט תפריט של אובייקט מוצג רק לתפקיד שיש לו הרשאת צפייה בו
  const nav = NAV.filter((item) => !item.object || can(item.object, "view"));
  const newRequests = useNewRequestsCount(userId, pathname);
  const badgeFor = (item: NavItem) => (item.href === "/requests" ? newRequests : 0);

  if (pathname === "/login" || pathname === "/accept-invite") return <>{children}</>;
  if (!ready || !userId) {
    return (
      <div className="shell-loading" aria-busy="true">
        <div className="skeleton" style={{ height: 40, width: 220 }} />
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="תפריט ראשי">
        <div className="brand"><Brand /></div>
        <nav>
          {nav.map((item) => (
            <NavEntry key={item.href} item={item} badge={badgeFor(item)} />
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link href="/settings/profile" className="muted profile-link">{me?.full_name ?? "משתמשת לא מזוהה"}</Link>
          <button type="button" className="link-btn" onClick={signOut}>יציאה</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          {/* חזרה למסך הקודם, מכל מסך. קישור ולא כפתור, כדי שמסך עם שינויים שלא נשמרו יזהיר לפני היציאה */}
          {pathname !== "/" && (
            <a
              href="#back"
              className="icon-btn back-btn"
              aria-label="חזרה למסך הקודם"
              title="חזרה למסך הקודם"
              onClick={(e) => {
                e.preventDefault();
                if (window.history.length > 1) router.back();
                else router.push("/");
              }}
            >
              <Icon name="back" />
            </a>
          )}
          {can("clients", "view") && <PhoneSearch />}
          <NotificationBell />
          {/* בנייד אין תפריט צד, ולכן ההגדרות והפרופיל זמינים מכאן */}
          <Link className="icon-btn settings-mobile" href="/settings" aria-label="הגדרות">
            <Icon name="settings" />
          </Link>
        </header>
        {me && !me.is_active && (
          <div className="banner">החשבון שלך מושבת, ולכן לא יוצגו נתונים. פני למנהלת.</div>
        )}
        {!me && <div className="banner">המשתמשת הזו לא רשומה בצוות, ולכן לא יוצגו נתונים.</div>}
        <main className="content">{children}</main>
        <QuickAdd />
      </div>

      <nav className="bottom-nav" aria-label="ניווט">
        {nav.filter((item) => item.mobile).map((item) => (
          <NavEntry key={item.href} item={item} compact badge={badgeFor(item)} />
        ))}
      </nav>
    </div>
  );
}

// באדג' "חדש" ליד קריאות: כמה קריאות בסטטוס "חדשה" משויכות אליי. מתעדכן במעבר מסך וכל דקה.
function useNewRequestsCount(userId: string | null, pathname: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      const { count: n } = await supabase
        .from("service_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "new")
        .eq("assigned_to", userId);
      if (alive) setCount(n ?? 0);
    };
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [userId, pathname]);
  return count;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <AuthProvider>
        <ToastProvider>
          <Shell>{children}</Shell>
        </ToastProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
