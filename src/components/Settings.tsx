"use client";
// הגדרות המערכת (שם, לוגו) נקראות מהטבלה app_settings. אין שם או לוגו בקוד.
// ההגדרות הציבוריות נקראות גם לפני כניסה, כדי שמסך הכניסה יציג אותן.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SettingsState = {
  ready: boolean;
  appName: string;
  logoUrl: string | null;
  reload: () => Promise<void>;
};

const SettingsContext = createContext<SettingsState>({ ready: false, appName: "", logoUrl: null, reload: async () => {} });

export function useSettings() {
  return useContext(SettingsContext);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});

  const reload = useCallback(async () => {
    const { data } = await supabase.from("app_settings").select("key, value");
    setValues(Object.fromEntries((data ?? []).map((r) => [r.key, r.value])));
    setReady(true);
  }, []);

  useEffect(() => {
    reload();
    // אחרי כניסה או יציאה ההרשאות משתנות, ולכן קוראים שוב
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      reload();
    });
    return () => sub.subscription.unsubscribe();
  }, [reload]);

  const appName = typeof values.app_name === "string" ? values.app_name : "";
  const logoUrl = typeof values.logo_url === "string" && values.logo_url ? values.logo_url : null;

  // שם הלשונית בדפדפן לפי שם המערכת (גם אחרי כל מעבר מסך)
  const pathname = usePathname();
  useEffect(() => {
    if (appName) document.title = appName;
  }, [appName, pathname]);

  return <SettingsContext.Provider value={{ ready, appName, logoUrl, reload }}>{children}</SettingsContext.Provider>;
}

// סמל המערכת: הלוגו אם הועלה, אחרת השם
export function Brand({ className }: { className?: string }) {
  const { appName, logoUrl } = useSettings();
  return (
    <span className={`brand-mark${className ? ` ${className}` : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logoUrl && <img src={logoUrl} alt="" className="brand-logo" />}
      <span>{appName}</span>
    </span>
  );
}
