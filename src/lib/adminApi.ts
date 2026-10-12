// קריאה לפעולות ניהול בצד השרת (הזמנת משתמשת, השבתה). הן רצות עם מפתח השירות של Supabase,
// ולכן נמצאות רק בשרת (src/app/api). הדפדפן שולח את טוקן הכניסה, והשרת בודק שזו מנהלת מערכת פעילה.

import { supabase } from "@/lib/supabase";

export async function adminApi<T = unknown>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "הפעולה נכשלה. נסי שוב.");
  return json as T;
}
