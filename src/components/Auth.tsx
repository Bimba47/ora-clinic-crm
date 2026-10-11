"use client";
// מי מחוברת: המשתמשת ב-Supabase Auth והרשומה שלה בטבלת הצוות.
// משתמשת לא מחוברת מופנית למסך הכניסה. ההרשאות עצמן נאכפות במסד (RLS).

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Me = { id: string; full_name: string; role: "manager" | "therapist"; is_active: boolean } | null;
type AuthState = { ready: boolean; userId: string | null; me: Me; isManager: boolean; signOut: () => Promise<void> };

const AuthContext = createContext<AuthState>({
  ready: false, userId: null, me: null, isManager: false, signOut: async () => {},
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

  useEffect(() => {
    const load = async (uid: string | null) => {
      setUserId(uid);
      if (uid) {
        const { data } = await supabase.from("staff").select("id, full_name, role, is_active").eq("id", uid).maybeSingle();
        setMe((data as Me) ?? null);
      } else {
        setMe(null);
      }
      setReady(true);
    };
    supabase.auth.getSession().then(({ data }) => load(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      load(session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!userId && pathname !== "/login") router.replace("/login");
    if (userId && pathname === "/login") router.replace("/");
  }, [ready, userId, pathname, router]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <AuthContext.Provider
      value={{ ready, userId, me, isManager: !!me && me.is_active && me.role === "manager", signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
