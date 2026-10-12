"use client";
// אזור ההגדרות: ניווט משנה בצד, ואליו נכנסים כל מסכי הניהול.
// הכניסה מוגבלת לפי הרשאה: מנהלת רואה הכול, מטפלת מגיעה רק לפרופיל האישי.
// (ההרשאות עצמן נאכפות גם במסד: עדכון הגדרות, צוות ומחירון – מנהלת בלבד.)

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/Auth";

type SubItem = { label: string; href: string; managerOnly: boolean };

const SETTINGS_NAV: SubItem[] = [
  { label: "פרטי המערכת", href: "/settings/system", managerOnly: true },
  { label: "ניהול צוות", href: "/settings/team", managerOnly: true },
  { label: "מחירון", href: "/settings/treatments", managerOnly: true },
  { label: "הפרופיל שלי", href: "/settings/profile", managerOnly: false },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, me, isManager } = useAuth();
  const items = SETTINGS_NAV.filter((i) => !i.managerOnly || isManager);
  const current = SETTINGS_NAV.find((i) => pathname.startsWith(i.href));
  const blocked = ready && !!me && !!current?.managerOnly && !isManager;

  // מטפלת שמגיעה למסך של מנהלת עוברת לפרופיל שלה
  useEffect(() => {
    if (blocked) router.replace("/settings/profile");
  }, [blocked, router]);

  return (
    <div className="settings">
      <nav className="settings-nav card" aria-label="הגדרות">
        <h2 className="section-title">הגדרות</h2>
        {items.map((i) => {
          const active = pathname.startsWith(i.href);
          return (
            <Link key={i.href} href={i.href} className={`settings-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
              {i.label}
            </Link>
          );
        })}
      </nav>
      <div className="settings-body">{blocked ? null : children}</div>
    </div>
  );
}
