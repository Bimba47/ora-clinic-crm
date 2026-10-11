# CRM קליניקת אורה

מערכת CRM פנימית לצוות קליניקת אורה. כל הכללים, מבנה הנתונים והעיצוב נמצאים ב-[CLAUDE.md](CLAUDE.md).

## הרצה מקומית
1. מעתיקים את `.env.example` ל-`.env.local` וממלאים ערכים.
2. `npm install`
3. `npm run dev` ופותחים את http://localhost:3000

## מבנה
- `src/app`: עמודים (Next.js App Router).
- `src/components`: רכיבי ממשק.
- `src/lib/supabase.ts`: לקוח ה-Supabase היחיד במערכת.
- `supabase/migrations`: שינויי מסד הנתונים, כל אחד עם קובץ ביטול `_down.sql`.
- `versions`, `VERSIONS.md`: יומן גרסאות.
