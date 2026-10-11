// מסגרת האפליקציה לפי האפיון:
// מחשב: תפריט צד קבוע בצד ימין. נייד (מתחת ל-768px): סרגל תחתון עם 4 לשוניות.
// כותרת עליונה בכל מסך: חיפוש לפי טלפון ופעמון התראות.
// בשלב השלד הפריטים עדיין לא מובילים לשום מקום.

import Icon, { type IconName } from "./Icon";

type NavItem = { label: string; icon: IconName; mobile?: boolean; managerOnly?: boolean };

const NAV: NavItem[] = [
  { label: "ראשי", icon: "home", mobile: true },
  { label: "לקוחות", icon: "users", mobile: true },
  { label: "תורים", icon: "calendar", mobile: true },
  { label: "קריאות שירות", icon: "ticket", mobile: true },
  { label: "התראות", icon: "bell" },
  { label: "ניהול צוות", icon: "settings", managerOnly: true },
];

const ACTIVE = "ראשי";

function NavEntry({ item, compact }: { item: NavItem; compact?: boolean }) {
  const active = item.label === ACTIVE;
  return (
    <span
      className={`nav-item${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-disabled={active ? undefined : true}
      title={active ? undefined : "בקרוב"}
    >
      <Icon name={item.icon} />
      <span>{compact && item.label === "קריאות שירות" ? "קריאות" : item.label}</span>
    </span>
  );
}

export default function AppShell({ appName, children }: { appName: string; children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="תפריט ראשי">
        <div className="brand">{appName}</div>
        <nav>
          {NAV.map((item) => (
            <NavEntry key={item.label} item={item} />
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <label className="search">
            <Icon name="search" />
            <input type="tel" inputMode="numeric" aria-label="חיפוש לפי טלפון" placeholder="054-1234567" disabled />
          </label>
          <button className="icon-btn" type="button" aria-label="התראות" disabled>
            <Icon name="bell" />
          </button>
        </header>
        <main className="content">{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="ניווט">
        {NAV.filter((item) => item.mobile).map((item) => (
          <NavEntry key={item.label} item={item} compact />
        ))}
      </nav>
    </div>
  );
}
