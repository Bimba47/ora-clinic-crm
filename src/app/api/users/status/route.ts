// השבתה והפעלה מחדש של משתמשת (מנהלת מערכת בלבד), בלי מחיקה: כל הרשומות שלה נשמרות.
// מושבתת לא רואה נתונים (RLS בודק is_active), וגם לא יכולה להתחבר (חסימה ב-Supabase Auth).
import { requireAdmin, errorResponse, HttpError } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const { admin, callerId } = await requireAdmin(req);
    const { id, active } = (await req.json()) as { id?: string; active?: boolean };
    if (!id || typeof active !== "boolean") throw new HttpError(400, "בקשה לא תקינה");
    if (id === callerId && !active) throw new HttpError(400, "אי אפשר להשבית את עצמך");

    // קודם המסד: אם זו המנהלת הפעילה האחרונה, הטריגר במסד יחסום ושום דבר לא ישתנה
    const { error } = await admin.from("staff").update({ is_active: active }).eq("id", id);
    if (error) throw new HttpError(400, error.message);

    const { error: authErr } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
    if (authErr) {
      await admin.from("staff").update({ is_active: !active }).eq("id", id);
      throw new HttpError(400, authErr.message);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
