"use client";
// מי מחוברת: המשתמשת ב-Supabase Auth והרשומה שלה בטבלת הצוות.
// משתמשת לא מחוברת מופנית למסך הכניסה. אחרי כניסה היא עוברת למסך שבחרה בהעדפות (user_preferences).
// ההרשאות עצמן נאכפות במסד (RLS).

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Me = { id: string; full_name: string; email: string; role: "manager" | "therapist"; is_active: boolean } | null;
type AuthState = {
  ready: boolean;
  userId: string | null;
  me: Me;
  isManager: boolean;
  landingPath: string;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  ready: false, userId: null, me: null, isManager: false, landingPath: "/", signOut: async () => {}, refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [me, setMe] = useState<Me>(null);
  const [landingPath, setLandingPath] = useState("/");

  const load = useCallback(async (uid: string | null, authEmail?: string | null) => {
    setUserId(uid);
    if (uid) {
      const [staff, prefs] = await Promise.all([
        supabase.from("staff").select("id, full_name, email, role, is_active").eq("id", uid).maybeSingle(),
        supabase.from("user_preferences").select("landing_path").eq("staff_id", uid).maybeSingle(),
      ]);
      let row = (staff.data as Me) ?? null;
      // אימייל שהוחלף ב-Auth (אחרי אישור בקישור) מתעדכן גם בטבלת הצוות
      if (row && authEmail && authEmail !== row.email) {
        await supabase.rpc("sync_my_email");
        row = { ...row, email: authEmail };
      }
      setMe(row);
      setLandingPath((prefs.data as { landing_path: string } | null)?.landing_path ?? "/");
    } else {
      setMe(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session?.user.id ?? null, data.session?.user.email));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      load(session?.user.id ?? null, session?.user.email);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  useEffect(() => {
    if (!ready) return;
    if (!userId && pathname !== "/login") router.replace("/login");
    if (userId && pathname === "/login") router.replace(landingPath);
  }, [ready, userId, pathname, router, landingPath]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const refresh = async () => {
    const { data } = await supabase.auth.getSession();
    await load(data.session?.user.id ?? null, data.session?.user.email);
  };

  return (
    <AuthContext.Provider
      value={{ ready, userId, me, isManager: !!me && me.is_active && me.role === "manager", landingPath, signOut, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}
