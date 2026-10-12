// הזמנת משתמשת חדשה (מנהלת מערכת בלבד): Supabase Auth שולח לה מייל הזמנה עם קישור,
// ונוצרת לה שורה בטבלת הצוות עם התפקיד והצוות שנבחרו. אם יצירת השורה נכשלה, ההזמנה מבוטלת.
import { requireAdmin, errorResponse, HttpError } from "@/lib/supabaseAdmin";

type Body = { full_name?: string; email?: string; phone?: string; role_id?: string; team_id?: string | null };

export async function POST(req: Request) {
  try {
    const { admin } = await requireAdmin(req);
    const b = (await req.json()) as Body;
    const full_name = b.full_name?.trim() ?? "";
    const email = b.email?.trim().toLowerCase() ?? "";
    const phone = b.phone?.trim() ?? "";
    if (!full_name || !email || !phone || !b.role_id) throw new HttpError(400, "חובה למלא שם, אימייל, טלפון ותפקיד");

    const { data: exists } = await admin.from("staff").select("id").eq("email", email).maybeSingle();
    if (exists) throw new HttpError(409, "כבר יש משתמשת עם האימייל הזה");

    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/accept-invite`,
      data: { full_name },
    });
    if (error || !invited.user) {
      throw new HttpError(400, error?.message?.includes("already") ? "כבר יש משתמשת עם האימייל הזה" : `שליחת ההזמנה נכשלה: ${error?.message ?? ""}`);
    }

    const { error: insErr } = await admin.from("staff").insert({
      id: invited.user.id,
      full_name,
      email,
      phone,
      role_id: b.role_id,
      team_id: b.team_id || null,
      is_active: true,
    });
    if (insErr) {
      await admin.auth.admin.deleteUser(invited.user.id);
      throw new HttpError(400, insErr.message);
    }
    return Response.json({ id: invited.user.id });
  } catch (e) {
    return errorResponse(e);
  }
}
