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

const appName = process.env.NEXT_PUBLIC_APP_NAME || "קליניקת אורה";

export const metadata: Metadata = {
  title: appName,
  description: "מערכת CRM פנימית לצוות הקליניקה",
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
        <AppShell appName={appName}>{children}</AppShell>
      </body>
    </html>
  );
}
