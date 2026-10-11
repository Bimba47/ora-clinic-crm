# CRM קליניקת אורה

מערכת CRM פנימית לצוות קליניקת אורה (רותם, ליאת ונטע): לקוחות, תורים, קריאות שירות ומסך סיכום.
מקור האמת לדרישות: `exam/q2-prd-final.html`.
טכנולוגיות: Supabase (Postgres, Auth, RLS), Vercel, GitHub, Claude Code.

## מבנה מסד הנתונים (מאושר 11.10.2026)

6 טבלאות. הלקוחה במרכז: תורים וקריאות שירות תמיד מקושרים ללקוחה.
אחוז המרה, "התור הבא" וסימון 48 שעות מחושבים מהנתונים, ואין להם טבלה.

### staff (צוות)
| column | type | notes |
|---|---|---|
| id | uuid, PK | זהה ל-id של המשתמשת ב-Supabase Auth |
| full_name | text | חובה |
| email | text | אימייל ההתחברות |
| role | enum: `manager` / `therapist` | |
| is_active | boolean | מושבתת לא נכנסת ולא מופיעה בשיוך |
| created_at | timestamptz | אוטומטי |

### clients (לקוחות)
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| full_name | text | חובה |
| phone | text | חובה, unique, מנורמל (בלי מקפים ורווחים, `+972` → `0`) |
| source | enum: `instagram` / `facebook` / `website` / `referral` / `other` | |
| created_by | uuid → staff | |
| created_at, updated_at | timestamptz | אוטומטי |

### treatments (מחירון)
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| name | text | חובה |
| price | numeric | |
| duration_minutes | int | |
| is_active | boolean | הוצאה משימוש בלי מחיקה |

### appointments (תורים)
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| client_id | uuid → clients | חובה |
| treatment_id | uuid → treatments | חובה |
| therapist_id | uuid → staff | חובה |
| starts_at | timestamptz | חובה. נשמר עם אזור זמן, מוצג לפי Asia/Jerusalem |
| duration_minutes | int | מועתק מהמחירון בזמן הקביעה |
| price | numeric | מועתק מהמחירון בזמן הקביעה |
| status | enum: `upcoming` / `done` / `cancelled` | ברירת מחדל `upcoming` |
| notes | text | |
| created_by | uuid → staff | |
| created_at, updated_at | timestamptz | אוטומטי |

### service_requests (קריאות שירות)
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| client_id | uuid → clients | חובה |
| description | text | חובה |
| status | enum: `new` / `in_progress` / `closed` | ברירת מחדל `new` |
| assigned_to | uuid → staff | חובה כשהסטטוס `in_progress` |
| created_by | uuid → staff | |
| created_at, updated_at | timestamptz | אוטומטי. `created_at` הוא הבסיס לסימון 48 שעות |
| closed_at | timestamptz | נקבע אוטומטית בסגירה ומתנקה בפתיחה מחדש |

### notifications (התראות שיוך)
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| recipient_id | uuid → staff | למי ההתראה |
| request_id | uuid → service_requests | |
| message | text | |
| is_read | boolean | ברירת מחדל false |
| created_at | timestamptz | אוטומטי |

### קשרים
- לקוחה אחת ← הרבה תורים
- לקוחה אחת ← הרבה קריאות שירות
- טיפול אחד ← הרבה תורים
- מטפלת אחת (staff) ← הרבה תורים
- חברת צוות אחת ← הרבה קריאות שירות (כאחראית)
- קריאה אחת ← הרבה התראות
- חברת צוות אחת ← הרבה התראות


### כללים שנאכפים במסד הנתונים, לא רק בממשק
- **appointments:** אין שני תורים חופפים לאותה מטפלת (לפי `starts_at` + `duration_minutes`, בלי תורים שבוטלו). תור רק בשעות הפעילות: א'-ה' 09:00-19:00, ו' 09:00-13:00, והטיפול מסתיים עד הסגירה. `done` רק אחרי מועד התור.
- **service_requests:** אין `in_progress` בלי `assigned_to`. מטפלת משייכת רק לעצמה, ומנהלת לכל אחת.
- **notifications:** נוצרת אוטומטית (טריגר) כש-`assigned_to` משתנה, ולא כשמשייכים לעצמך. כל אחת רואה רק את ההתראות שלה.
- **clients:** לקוחה עם תורים או קריאות לא נמחקת (foreign key restrict).
- **RLS על כל הטבלאות:** רק משתמשות מחוברות ופעילות. מחיקה, ניהול צוות ועריכת מחירון למנהלת בלבד.

### נקודות רגישות
- **appointments:** מניעת חפיפה ואזור זמן (שעון קיץ).
- **staff:** מחובר ל-Auth, וכל ה-RLS תלוי בו. הזמנת משתמשת דורשת service role key, שנשמר רק במשתני סביבה בצד השרת, לעולם לא בקוד.
- **notifications:** לבנות אחרונה, כי שום דבר אחר לא תלוי בה.
