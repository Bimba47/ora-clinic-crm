"use client";
// מסגרת למסכים שלפני הכניסה (כניסה, איפוס סיסמה, קבלת הזמנה) – בדיוק כמו העיצוב של ענבל ב-Claude Design
// (צבעים, פונטים וגדלים, בשני הצדדים; בקשת ענבל, v32.2 – חריגה מכוונת מפלטת האפיון במסכים האלה בלבד).
// מימין הטופס, עם הסמל למעלה ושורת תחתית; משמאל פאנל עם קשת, לוגו ו-ORA CLINIC. בנייד הפאנל מוסתר.

import { Assistant, Cormorant_Garamond, Frank_Ruhl_Libre } from "next/font/google";

// הפונטים של העיצוב, רק למסכים האלה (שאר המערכת ב-Heebo של האפיון)
const assistant = Assistant({ subsets: ["hebrew", "latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-assistant" });
const frank = Frank_Ruhl_Libre({ subsets: ["hebrew", "latin"], weight: ["400", "500"], display: "swap", variable: "--font-frank" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["600"], display: "swap", variable: "--font-cormorant" });

// הסמל מהעיצוב, בצבעים המקוריים (הקשתות ברוז, העלה בזהב)
function OraMark({ size, big }: { size: number; big?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path d="M80 26 A40 40 0 1 0 80 94" stroke="#B98276" strokeWidth={big ? 5 : 7} strokeLinecap="round" />
      <path d="M96 30 A36 36 0 1 0 96 90" stroke="#B98276" strokeWidth={big ? 3 : 5} strokeLinecap="round" opacity=".55" />
      <path d="M60 36 C51 43 50 55 60 60 C70 55 69 43 60 36Z" fill="#C8A56A" />
      {big && <path d="M60 41 C55 46 55 53 60 58" stroke="#FBF6F1" strokeWidth="1.2" opacity=".7" />}
      <path d="M60 60 L60 90" stroke="#C8A56A" strokeWidth={big ? 3 : 4} strokeLinecap="round" />
      <path d="M60 80 C52 79 46 73 45 66 C53 67 58 72 60 80Z" fill="#C8A56A" />
      <path d="M60 80 C68 79 74 73 75 66 C67 67 62 72 60 80Z" fill="#C8A56A" />
    </svg>
  );
}

export default function AuthShell({
  eyebrow, title, subtitle, children,
}: { eyebrow?: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className={`auth ${assistant.variable} ${frank.variable} ${cormorant.variable}`}>
      <main className="auth-main">
        <header className="auth-top">
          <div className="auth-brand">
            <OraMark size={36} />
            <span className="auth-brand-name" dir="ltr">ORA CLINIC</span>
          </div>
          <span className="auth-top-meta">CRM</span>
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
          <span>© Ora Clinic</span>
          <span className="auth-secure">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            חיבור מאובטח
          </span>
        </footer>
      </main>

      <aside className="auth-panel" aria-hidden="true">
        <svg className="auth-lines" viewBox="0 0 600 900" preserveAspectRatio="none" fill="none">
          <path d="M-20 120 C120 160 180 260 320 300 S520 380 640 330" stroke="#D9C4B4" strokeWidth="1.2" opacity=".7" />
          <path d="M-20 560 C100 520 220 600 330 640 S520 700 640 640" stroke="#D9C4B4" strokeWidth="1" opacity=".6" />
          <path d="M380 -20 C360 120 420 200 400 330" stroke="#E0CDBF" strokeWidth="1" opacity=".7" />
        </svg>
        <span className="auth-tag">אסתטיקה · טיפוח · רפואה</span>
        <div className="auth-arch">
          <OraMark size={180} big />
          <div className="auth-arch-text">
            <span className="auth-arch-name" dir="ltr">ORA CLINIC</span>
            <p className="auth-arch-line">כל המטופלות, התורים והטיפולים — במקום אחד.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
