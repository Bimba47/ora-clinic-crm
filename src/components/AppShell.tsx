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

type NavItem = { label: string; short?: string; href: string; icon: IconName; mobile?: boolean; object?: string };

// ניהול צוות ומחירון נמצאים בתוך "הגדרות" (/settings)
const NAV: NavItem[] = [
  { label: "ראשי", href: "/", icon: "home", mobile: true },
  { label: "לקוחות", href: "/clients", icon: "users", mobile: true, object: "clients" },
  { label: "תורים", href: "/appointments/list", icon: "calendar", mobile: true, object: "appointments" },
  { label: "קריאות שירות", short: "קריאות", href: "/requests", icon: "ticket", mobile: true, object: "service_requests" },
  { label: "משימות", href: "/tasks", icon: "task", object: "tasks" },
  { label: "התראות", href: "/notifications", icon: "bell" },
  { label: "הגדרות", href: "/settings", icon: "settings" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href.split("/").slice(0, 2).join("/"));
}

function NavEntry({ item, compact }: { item: NavItem; compact?: boolean }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link href={item.href} className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      <Icon name={item.icon} />
      <span>{compact && item.short ? item.short : item.label}</span>
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, userId, me, signOut, can } = useAuth();
  // פריט תפריט של אובייקט מוצג רק לתפקיד שיש לו הרשאת צפייה בו
  const nav = NAV.filter((item) => !item.object || can(item.object, "view"));

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
            <NavEntry key={item.href} item={item} />
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
          <label className="search">
            <Icon name="search" />
            <input type="tel" inputMode="numeric" aria-label="חיפוש לפי טלפון" placeholder="054-1234567" disabled />
          </label>
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
      </div>

      <nav className="bottom-nav" aria-label="ניווט">
        {nav.filter((item) => item.mobile).map((item) => (
          <NavEntry key={item.href} item={item} compact />
        ))}
      </nav>
    </div>
  );
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
