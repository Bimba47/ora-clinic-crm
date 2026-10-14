"use client";
// מסגרת למסכים שלפני הכניסה (כניסה, איפוס סיסמה, קבלת הזמנה), לפי העיצוב מ-Claude Design (v32):
// מימין הטופס (צבעי האפיון), עם הסמל למעלה ושורת תחתית; משמאל פאנל עם קשת, לוגו ו-ORA CLINIC – כמו בעיצוב. בנייד הפאנל מוסתר.
// הסמל והשם בטופס מ"פרטי המערכת" (app_settings).

import { Assistant, Cormorant_Garamond, Frank_Ruhl_Libre } from "next/font/google";
import { Brand, useSettings } from "@/components/Settings";

// הפונטים של הפאנל, כמו בעיצוב (רק בפאנל; שאר המסך ב-Heebo של האפיון)
const assistant = Assistant({ subsets: ["hebrew", "latin"], weight: ["600"], display: "swap", variable: "--font-assistant" });
const frank = Frank_Ruhl_Libre({ subsets: ["hebrew", "latin"], weight: ["400"], display: "swap", variable: "--font-frank" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["600"], display: "swap", variable: "--font-cormorant" });

export default function AuthShell({
  eyebrow, title, subtitle, children,
}: { eyebrow?: string; title: string; subtitle?: string; children: React.ReactNode }) {
  const { appName } = useSettings();
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

      {/* הפאנל השמאלי: בדיוק כמו בעיצוב מ-Claude Design – צבעים, פונטים, גדלים והשם באנגלית (בקשת ענבל, v32.1) */}
      <aside className={`auth-panel ${assistant.variable} ${frank.variable} ${cormorant.variable}`} aria-hidden="true">
        <svg className="auth-lines" viewBox="0 0 600 900" preserveAspectRatio="none" fill="none">
          <path d="M-20 120 C120 160 180 260 320 300 S520 380 640 330" stroke="#D9C4B4" strokeWidth="1.2" opacity=".7" />
          <path d="M-20 560 C100 520 220 600 330 640 S520 700 640 640" stroke="#D9C4B4" strokeWidth="1" opacity=".6" />
          <path d="M380 -20 C360 120 420 200 400 330" stroke="#E0CDBF" strokeWidth="1" opacity=".7" />
        </svg>
        <span className="auth-tag">אסתטיקה · טיפוח · רפואה</span>
        <div className="auth-arch">
          <svg width="180" height="180" viewBox="0 0 120 120" fill="none">
            <path d="M80 26 A40 40 0 1 0 80 94" stroke="#B98276" strokeWidth="5" strokeLinecap="round" />
            <path d="M96 30 A36 36 0 1 0 96 90" stroke="#B98276" strokeWidth="3" strokeLinecap="round" opacity=".55" />
            <path d="M60 36 C51 43 50 55 60 60 C70 55 69 43 60 36Z" fill="#C8A56A" />
            <path d="M60 41 C55 46 55 53 60 58" stroke="#FBF6F1" strokeWidth="1.2" opacity=".7" />
            <path d="M60 60 L60 90" stroke="#C8A56A" strokeWidth="3" strokeLinecap="round" />
            <path d="M60 80 C52 79 46 73 45 66 C53 67 58 72 60 80Z" fill="#C8A56A" />
            <path d="M60 80 C68 79 74 73 75 66 C67 67 62 72 60 80Z" fill="#C8A56A" />
          </svg>
          <div className="auth-arch-text">
            <span className="auth-arch-name" dir="ltr">ORA CLINIC</span>
            <p className="auth-arch-line">כל המטופלות, התורים והטיפולים — במקום אחד.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
