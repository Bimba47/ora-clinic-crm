// לקוח Supabase אחד לכל המערכת. כל שאר הקוד מייבא אותו מכאן:
//   import { supabase } from "@/lib/supabase";
// הכתובת והמפתח הציבורי מגיעים ממשתני סביבה בלבד (.env.local במחשב, והגדרות הסביבה ב-Vercel).
// המפתח הציבורי בטוח לדפדפן, כי ההרשאות נאכפות במסד (RLS).
// המפתח הרגיש (SUPABASE_SERVICE_ROLE_KEY) לא נכנס לקובץ הזה, ולא לשום קוד שרץ בדפדפן.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "חסרים משתני הסביבה NEXT_PUBLIC_SUPABASE_URL או NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. יש למלא אותם ב-.env.local וב-Vercel.",
  );
}

export const supabase = createClient(url, publishableKey);
