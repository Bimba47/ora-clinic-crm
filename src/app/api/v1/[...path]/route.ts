// ממשק API כללי: נתיב אחד לכל האובייקטים. /api/v1/{object} ו-/api/v1/{object}/{id}.
// האובייקט נפתר במסד מהקטלוג (view_objects), ולכן אובייקט חדש זמין מיד, בלי קוד.
// כל ההיגיון (מפתח, הגבלת קצב, הרשאות לפי תפקיד המפתח, ולידציה, ביצוע) במסד: public.api_request.
// כאן רק: קריאת המפתח מהכותרת, העברת הבקשה, רישום בלוג עם זמן התגובה, ו-CORS (כדי שמערכת חיצונית תוכל לקרוא).
import { adminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

type Ctx = { params: Promise<{ path: string[] }> };
type ApiResult = { status: number; body: unknown; key_id?: string; key_name?: string; skip_log?: boolean };

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

const errorBody = (status: number, code: string, message: string) => ({ error: { status, code, message } });

async function handle(req: Request, ctx: Ctx) {
  const started = Date.now();
  const url = new URL(req.url);
  const { path } = await ctx.params;
  const [object, id, ...rest] = path ?? [];
  const method = req.method.toUpperCase();
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  // כתובת השולח: להגבלת קצב של בקשות בלי מפתח תקין
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || null;

  let result: ApiResult;
  if (!object || rest.length > 0) {
    result = { status: 404, body: errorBody(404, "not_found", "נתיב לא מוכר. השתמשי ב-/api/v1/{object} או /api/v1/{object}/{id}") };
  } else if (url.searchParams.has("key") || url.searchParams.has("api_key")) {
    // המפתח לא נשלח ב-URL (הוא נשמר בלוגים ובהיסטוריה). רק בכותרת Authorization
    result = { status: 400, body: errorBody(400, "key_in_url", "אל תשלחי את המפתח בכתובת. שלחי אותו בכותרת Authorization: Bearer <key>") };
  } else {
    let body: unknown = null;
    let badJson = false;
    if (method === "POST" || method === "PATCH") {
      const text = await req.text();
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          badJson = true;
        }
      }
    }
    if (badJson) {
      result = { status: 400, body: errorBody(400, "bad_json", "גוף הבקשה אינו JSON תקין") };
    } else {
      const { data, error } = await adminClient().rpc("api_request", {
        p_key: key,
        p_method: method,
        p_object: object,
        p_id: id ?? null,
        p_query: Object.fromEntries(url.searchParams),
        p_body: body,
        p_ip: ip,
      });
      result = error
        ? { status: 500, body: errorBody(500, "server_error", "שגיאה בשרת. נסי שוב") }
        : (data as ApiResult);
    }
  }

  const duration = Date.now() - started;
  // רישום כל בקשה: מפתח, נתיב, קוד תגובה וזמן תגובה (גם 401, בלי מפתח מזוהה)
  const err = (result.body as { error?: { code?: string } } | null)?.error;
  // בקשה שנחסמה בלי מפתח תקין (הצפה) לא נרשמת, כדי שלא תנפח את הלוג
  if (!result.skip_log) await adminClient()
    .from("api_logs")
    .insert({
      key_id: result.key_id ?? null,
      key_name: result.key_name ?? null,
      method,
      path: url.pathname + (url.search ? url.search : ""),
      object_key: object ?? null,
      status: result.status,
      duration_ms: duration,
      error_code: err?.code ?? null,
      ip,
    })
    .then(() => undefined, () => undefined);

  return json(result.status, result.body, result.status === 429 ? { "Retry-After": "60" } : {});
}

// פעולה שלא נתמכת: 405 בפורמט השגיאה של ה-API (ולא גוף ריק)
function notAllowed() {
  return json(405, errorBody(405, "method_not_allowed", "פעולה לא נתמכת. אפשר: GET, POST, PATCH, DELETE"), { Allow: "GET, POST, PATCH, DELETE, OPTIONS" });
}
export const PUT = notAllowed;
export const HEAD = notAllowed;

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
