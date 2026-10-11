"use client";
// מסגרת האפליקציה לפי האפיון:
// מחשב: תפריט צד קבוע בצד ימין. נייד (מתחת ל-768px): סרגל תחתון עם 4 לשוניות.
// כותרת עליונה בכל מסך: חיפוש לפי טלפון ופעמון התראות.
// מסך הכניסה מוצג בלי המסגרת.

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon, { type IconName } from "./Icon";
import { AuthProvider, useAuth } from "./Auth";
import { ToastProvider } from "./Toast";

type NavItem = { label: string; short?: string; href: string; icon: IconName; mobile?: boolean; managerOnly?: boolean };

const NAV: NavItem[] = [
  { label: "ראשי", href: "/", icon: "home", mobile: true },
  { label: "לקוחות", href: "/clients", icon: "users", mobile: true },
  { label: "תורים", href: "/appointments/list", icon: "calendar", mobile: true },
  { label: "קריאות שירות", short: "קריאות", href: "/requests", icon: "ticket", mobile: true },
  { label: "התראות", href: "/notifications", icon: "bell" },
  { label: "ניהול צוות", short: "צוות", href: "/team", icon: "settings", managerOnly: true },
  { label: "מחירון", href: "/treatments", icon: "tag", managerOnly: true },
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

function Shell({ appName, children }: { appName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { ready, userId, me, isManager, signOut } = useAuth();

  if (pathname === "/login") return <>{children}</>;
  if (!ready || !userId) {
    return (
      <div className="shell-loading" aria-busy="true">
        <div className="skeleton" style={{ height: 40, width: 220 }} />
      </div>
    );
  }

  const items = NAV.filter((i) => !i.managerOnly || isManager);
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="תפריט ראשי">
        <div className="brand">{appName}</div>
        <nav>
          {items.map((item) => (
            <NavEntry key={item.href} item={item} />
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted">{me?.full_name ?? "משתמשת לא מזוהה"}</div>
          <button type="button" className="link-btn" onClick={signOut}>יציאה</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <label className="search">
            <Icon name="search" />
            <input type="tel" inputMode="numeric" aria-label="חיפוש לפי טלפון" placeholder="054-1234567" disabled />
          </label>
          <Link className="icon-btn" href="/notifications" aria-label="התראות">
            <Icon name="bell" />
          </Link>
        </header>
        {me && !me.is_active && (
          <div className="banner">החשבון שלך מושבת, ולכן לא יוצגו נתונים. פני למנהלת.</div>
        )}
        {!me && <div className="banner">המשתמשת הזו לא רשומה בצוות, ולכן לא יוצגו נתונים.</div>}
        <main className="content">{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="ניווט">
        {NAV.filter((item) => item.mobile).map((item) => (
          <NavEntry key={item.href} item={item} compact />
        ))}
      </nav>
    </div>
  );
}

export default function AppShell({ appName, children }: { appName: string; children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell appName={appName}>{children}</Shell>
      </ToastProvider>
    </AuthProvider>
  );
}
