"use client";
// מי מחוברת, באיזה תפקיד וצוות, ומה מותר לה (get_me, get_my_permissions).
// ההרשאות כאן משמשות רק את הממשק (אילו כפתורים ושדות להציג). האכיפה עצמה במסד (RLS ופונקציות).
// משתמשת לא מחוברת מופנית למסך הכניסה. אחרי כניסה היא עוברת למסך שבחרה בהעדפות.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export type Scope = "none" | "own" | "team" | "all";
export type Action = "view" | "create" | "edit" | "delete";
type Perms = { objects: Record<string, Record<Action, Scope>>; fields: Record<string, "hidden" | "read"> };

type Me = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  address: string | null;
  is_active: boolean;
  role_id: string;
  role_name: string;
  is_admin: boolean;
  team_id: string | null;
  team_name: string | null;
} | null;

type AuthState = {
  ready: boolean;
  userId: string | null;
  me: Me;
  isManager: boolean; // מנהלת מערכת: תפקיד שמסומן is_admin
  perms: Perms;
  can: (object: string, action: Action) => boolean;
  landingPath: string;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const EMPTY: Perms = { objects: {}, fields: {} };

const AuthContext = createContext<AuthState>({
  ready: false, userId: null, me: null, isManager: false, perms: EMPTY, can: () => false,
  landingPath: "/", signOut: async () => {}, refresh: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// מסכים שנפתחים גם בלי משתמשת מחוברת (כניסה, וקבלת הזמנה)
const PUBLIC_PATHS = ["/login", "/accept-invite"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [me, setMe] = useState<Me>(null);
  const [perms, setPerms] = useState<Perms>(EMPTY);
  const [landingPath, setLandingPath] = useState("/");

  const load = useCallback(async (uid: string | null, authEmail?: string | null) => {
    setUserId(uid);
    if (uid) {
      const [meRes, permsRes, prefs] = await Promise.all([
        supabase.rpc("get_me"),
        supabase.rpc("get_my_permissions"),
        supabase.from("user_preferences").select("landing_path").eq("staff_id", uid).maybeSingle(),
      ]);
      let row = (meRes.data as Me) ?? null;
      // אימייל שהוחלף ב-Auth (אחרי אישור בקישור) מתעדכן גם בטבלת הצוות
      if (row && authEmail && authEmail !== row.email) {
        await supabase.rpc("sync_my_email");
        row = { ...row, email: authEmail };
      }
      setMe(row);
      setPerms((permsRes.data as Perms) ?? EMPTY);
      setLandingPath((prefs.data as { landing_path: string } | null)?.landing_path ?? "/");
    } else {
      setMe(null);
      setPerms(EMPTY);
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
    if (!userId && !PUBLIC_PATHS.includes(pathname)) router.replace("/login");
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

  const active = !!me && me.is_active;
  const can = (object: string, action: Action) => active && (perms.objects[object]?.[action] ?? "none") !== "none";

  return (
    <AuthContext.Provider
      value={{ ready, userId, me, isManager: active && !!me?.is_admin, perms, can, landingPath, signOut, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}
