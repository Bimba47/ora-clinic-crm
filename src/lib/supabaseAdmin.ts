// לקוח Supabase עם מפתח השירות. רץ רק בשרת (src/app/api), ולעולם לא מיובא מקוד של הדפדפן.
// המפתח מגיע ממשתנה הסביבה SUPABASE_SERVICE_ROLE_KEY (בלי NEXT_PUBLIC, ולכן Next.js לא שולח אותו לדפדפן).
import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("חסר משתנה הסביבה SUPABASE_SERVICE_ROLE_KEY בשרת");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// בודק שמי ששלחה את הבקשה מחוברת, פעילה, ובתפקיד של מנהלת מערכת. מחזיר את הלקוח ואת המזהה שלה.
export async function requireAdmin(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) throw new HttpError(401, "צריך להתחבר מחדש");
  const admin = adminClient();
  const { data: auth, error } = await admin.auth.getUser(token);
  if (error || !auth.user) throw new HttpError(401, "צריך להתחבר מחדש");
  const { data: me } = await admin
    .from("staff")
    .select("id, is_active, roles(is_admin)")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (me as { roles?: { is_admin: boolean } | null } | null)?.roles;
  if (!me || !me.is_active || !role?.is_admin) throw new HttpError(403, "הפעולה מותרת רק למנהלת מערכת");
  return { admin, callerId: auth.user.id };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : "הפעולה נכשלה";
  return Response.json({ error: msg }, { status: 400 });
}
