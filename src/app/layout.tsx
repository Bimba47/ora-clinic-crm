import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import AppShell from "@/components/AppShell";
import "./globals.css";

// הפונט לפי האפיון: Heebo
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// שם המערכת לא מקודד כאן: הוא נקרא מההגדרות (app_settings) ומוצב בלשונית הדפדפן בזמן הריצה
export const metadata: Metadata = {
  title: "CRM",
  description: "מערכת CRM פנימית לצוות",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF6F0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className={heebo.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
