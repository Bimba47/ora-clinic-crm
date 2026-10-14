"use client";
// מסגרת למסכים שלפני הכניסה (כניסה, איפוס סיסמה, קבלת הזמנה), לפי העיצוב מ-Claude Design (v32):
// מימין הטופס, עם הסמל למעלה ושורת תחתית; משמאל פאנל עם קשת, הלוגו והשם. בנייד הפאנל מוסתר.
// השם והלוגו מ"פרטי המערכת" (app_settings), בצבעי האפיון.

import { Brand, useSettings } from "@/components/Settings";

export default function AuthShell({
  eyebrow, title, subtitle, children,
}: { eyebrow?: string; title: string; subtitle?: string; children: React.ReactNode }) {
  const { appName, logoUrl } = useSettings();
  return (
    <div className="auth">
      <main className="auth-main">
        <header className="auth-top">
          <Brand className="auth-brand" />
        </header>

        <div className="auth-body">
          <div className="auth-head">
            {eyebrow && <span className="auth-eyebrow">{eyebrow}</span>}
            <h1 className="auth-title">{title}</h1>
            {subtitle && <p className="auth-sub">{subtitle}</p>}
          </div>
          {children}
        </div>

        <footer className="auth-foot">
          <span>© {appName}</span>
          <span className="auth-secure">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            חיבור מאובטח
          </span>
        </footer>
      </main>

      <aside className="auth-panel" aria-hidden="true">
        <svg className="auth-lines" viewBox="0 0 600 900" preserveAspectRatio="none" fill="none">
          <path d="M-20 120 C120 160 180 260 320 300 S520 380 640 330" stroke="#E3BFA8" strokeWidth="1.2" opacity=".7" />
          <path d="M-20 560 C100 520 220 600 330 640 S520 700 640 640" stroke="#E3BFA8" strokeWidth="1" opacity=".6" />
          <path d="M380 -20 C360 120 420 200 400 330" stroke="#EDE5DC" strokeWidth="1" opacity=".9" />
        </svg>
        <span className="auth-tag">טיפולי פנים · אסתטיקה</span>
        <div className="auth-arch">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl && <img src={logoUrl} alt="" className="auth-arch-logo" />}
          <span className="auth-arch-name">{appName}</span>
          <p className="auth-arch-line">כל הלקוחות, התורים והקריאות – במקום אחד.</p>
        </div>
      </aside>
    </div>
  );
}
