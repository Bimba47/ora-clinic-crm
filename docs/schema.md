# סכמת בסיס הנתונים: CRM קליניקת אורה

מצב אחרי מיגרציה `0003_schema` (11.10.2026). כל הכללים כאן נאכפים במסד.

## טבלה 1: האובייקטים והקשרים

| אובייקט | טבלה | מקושר אל | סוג קשר | מיושם כ- | במחיקת ההורה |
|---|---|---|---|---|---|
| משתמשים (צוות) | `staff` | משתמשת ב-Supabase Auth | 1 ל-1 | `staff.id` = `auth.users.id` | המשתמשת נמחקת |
| לקוחות | `clients` | staff (נוצרה על ידי) | צוות 1 ← רבים | `clients.created_by` | השדה מתרוקן |
| מחירון | `treatments` | (אין) | | | |
| תורים | `appointments` | clients | לקוחה 1 ← רבים | `appointments.client_id` | חסום |
| | | treatments | טיפול 1 ← רבים | `appointments.treatment_id` | חסום |
| | | staff (מטפלת) | מטפלת 1 ← רבים | `appointments.therapist_id` | חסום |
| | | staff (נקבע על ידי) | צוות 1 ← רבים | `appointments.created_by` | השדה מתרוקן |
| קריאות שירות | `service_requests` | clients | לקוחה 1 ← רבים | `service_requests.client_id` | חסום |
| | | staff (אחראית) | צוות 1 ← רבים | `service_requests.assigned_to` | השדה מתרוקן |
| | | staff (נפתחה על ידי) | צוות 1 ← רבים | `service_requests.created_by` | השדה מתרוקן |
| התראות שיוך | `notifications` | service_requests | קריאה 1 ← רבים | `notifications.request_id` | נמחקות איתה |
| | | staff (למי) | צוות 1 ← רבים | `notifications.recipient_id` | נמחקות איתה |
| יומן פעילות | `audit_log` | staff (מי ביצעה) | צוות 1 ← רבים | `audit_log.actor_id` | חסום |

- אין קשרי רבים-לרבים באפיון, ולכן אין טבלאות ביניים.
- `audit_log.record_id` מצביע על רשומה בכל אחת משש הטבלאות, ולכן הוא לא מפתח זר. כך היומן שומר גם רשומות שנמחקו.

## טבלה 2: השדות לכל אובייקט

"חובה" = לא יכול להיות ריק. כל שדה שמסומן "אוטומטי" נקבע במסד.

### staff (משתמשים)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | המזהה של המשתמשת ב-Supabase Auth |
| full_name | שם מלא | text | ✓ | לא ריק |
| phone | טלפון | text | ✓ | מנורמל ל-`0` ועוד 8-9 ספרות |
| email | אימייל | text | ✓ | ייחודי, באותיות קטנות, בפורמט אימייל |
| role | תפקיד | enum `staff_role` | ✓ | `manager` מנהלת, `therapist` מטפלת (ברירת מחדל) |
| address | כתובת מגורים | text | | גלויה רק למנהלת ולעובדת עצמה |
| is_active | סטטוס | boolean | ✓ | `true` פעילה (ברירת מחדל), `false` מושבתת |
| created_at | נוצרה | timestamptz | ✓ | אוטומטי |
| updated_at | עודכנה | timestamptz | ✓ | אוטומטי |

### clients (לקוחות)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | אוטומטי |
| full_name | שם מלא | text | ✓ | לא ריק |
| phone | טלפון | text | ✓ | ייחודי, מנורמל ל-`0` ועוד 8-9 ספרות |
| source | מקור הגעה | enum `client_source` | | `instagram`, `facebook`, `website`, `referral`, `other` |
| created_by | נוצרה על ידי | uuid → staff | | אוטומטי |
| created_at | נוצרה | timestamptz | ✓ | אוטומטי |
| updated_at | עודכנה | timestamptz | ✓ | אוטומטי |

### treatments (מחירון)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | אוטומטי |
| name | טיפול | text | ✓ | ייחודי, לא ריק |
| price | מחיר (₪) | numeric(10,2) | ✓ | 0 ומעלה |
| duration_minutes | משך (דקות) | int | ✓ | גדול מ-0 |
| is_active | פעיל | boolean | ✓ | ברירת מחדל `true` |
| created_at | נוצר | timestamptz | ✓ | אוטומטי |
| updated_at | עודכן | timestamptz | ✓ | אוטומטי |

### appointments (תורים)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | אוטומטי |
| client_id | לקוחה | uuid → clients | ✓ | |
| treatment_id | טיפול | uuid → treatments | ✓ | |
| therapist_id | מטפלת | uuid → staff | ✓ | בלי חפיפה עם תור אחר שלה (תור שבוטל לא נחשב) |
| starts_at | תאריך ושעה | timestamptz | ✓ | בשעות הפעילות לפי שעון ישראל, כולל סיום הטיפול |
| duration_minutes | משך | int | ✓ | גדול מ-0. מועתק מהמחירון |
| price | מחיר | numeric(10,2) | ✓ | 0 ומעלה. מועתק מהמחירון |
| status | סטטוס | enum `appointment_status` | ✓ | `upcoming` עתידי (ברירת מחדל), `done` בוצע, `cancelled` בוטל |
| notes | הערות | text | | |
| created_by | נקבע על ידי | uuid → staff | | אוטומטי |
| created_at | נוצר | timestamptz | ✓ | אוטומטי |
| updated_at | עודכן | timestamptz | ✓ | אוטומטי |

### service_requests (קריאות שירות)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | אוטומטי |
| client_id | לקוחה | uuid → clients | ✓ | |
| description | תיאור | text | ✓ | לא ריק |
| status | סטטוס | enum `request_status` | ✓ | `new` חדשה (ברירת מחדל), `in_progress` בטיפול, `closed` נסגרה |
| assigned_to | אחראית | uuid → staff | כשהסטטוס "בטיפול" | רק אשת צוות פעילה. מטפלת משייכת רק לעצמה |
| created_by | נפתחה על ידי | uuid → staff | | אוטומטי |
| created_at | נפתחה | timestamptz | ✓ | אוטומטי |
| updated_at | עודכנה | timestamptz | ✓ | אוטומטי |
| closed_at | נסגרה | timestamptz | | ייקבע אוטומטית בשלב האוטומציות |

### notifications (התראות שיוך)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | אוטומטי |
| recipient_id | למי | uuid → staff | ✓ | |
| request_id | קריאה | uuid → service_requests | ✓ | |
| message | הודעה | text | ✓ | נוצרת אוטומטית |
| is_read | נקראה | boolean | ✓ | ברירת מחדל `false` |
| created_at | נוצרה | timestamptz | ✓ | אוטומטי |
| updated_at | עודכנה | timestamptz | ✓ | אוטומטי |

### audit_log (יומן פעילות, לקריאה בלבד)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | אוטומטי |
| actor_id | מי ביצעה | uuid → staff | | ריק = פעולת מערכת |
| action | פעולה | enum `audit_action` | ✓ | `create` יצירה, `update` עדכון, `delete` מחיקה |
| table_name | אובייקט | text | ✓ | `staff`, `clients`, `treatments`, `appointments`, `service_requests`, `notifications` |
| record_id | מזהה הרשומה | uuid | ✓ | |
| changed_fields | שדות שהשתנו | text[] | | |
| old_values | ערך לפני | jsonb | | בעדכון ובמחיקה |
| new_values | ערך אחרי | jsonb | | ביצירה ובעדכון |
| created_at | מתי | timestamptz | ✓ | אוטומטי |
| updated_at | | timestamptz | ✓ | זהה ל-created_at |

## מחושב בתצוגה, לא נשמר
- **התור הבא** של לקוחה: התור הקרוב בעתיד שלא בוטל.
- **קריאה ותיקה:** לא נסגרה ונפתחה לפני יותר מ-48 שעות.
- **אחוז המרה** לפי מקור הגעה.

מחיר ומשך בתור נשמרים בכוונה. הם עותק של המחירון ביום הקביעה, כדי ששינוי מחיר לא ישנה תורים קיימים.
