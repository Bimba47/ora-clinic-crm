# סכמת בסיס הנתונים: CRM קליניקת אורה

מצב אחרי מיגרציה `0004_views` (11.10.2026). כל הכללים כאן נאכפים במסד.
טבלאות העסק בטבלאות 1 ו-2. טבלאות מנוע התצוגות בטבלה 3.

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

## טבלה 3: מנוע התצוגות (`0004_views`)

טבלאות פנימיות של המערכת, לא של העסק. הן לא נכתבות ליומן הפעילות. RLS פעיל על כולן.

### קשרים
| טבלה | מקושר אל | מיושם כ- | במחיקת ההורה |
|---|---|---|---|
| `object_fields` | view_objects (האובייקט) | `object_fields.object_id` | נמחקים איתו |
| | view_objects (אובייקט מקושר) | `object_fields.ref_object_id` | חסום |
| `views` | view_objects | `views.object_id` | נמחקות איתו |
| | staff (בעלים) | `views.owner_id` | נמחקות איתה |
| | object_fields (שדה הקאנבן) | `views.kanban_field_id` | השדה מתרוקן |
| `view_columns`, `view_filters`, `view_sorts` | views | `view_id` | נמחקים איתה |
| | object_fields | `field_id` | נמחקים איתו |

### view_objects (קטלוג אובייקטים)
| שדה | סוג | חובה | ערכים / כלל |
|---|---|---|---|
| id | uuid | ✓ | אוטומטי |
| object_key | text | ✓ | ייחודי. אחת משש טבלאות העסק (בלי `audit_log`) |
| label, label_plural | text | ✓ | "לקוחה", "לקוחות" |
| display_field | text | ✓ | השדה שמוצג כשהרשומה מקושרת ממקום אחר |
| can_create | boolean | ✓ | ברירת מחדל `true` |
| created_at, updated_at | timestamptz | ✓ | אוטומטי |

### object_fields (קטלוג שדות)
| שדה | סוג | חובה | ערכים / כלל |
|---|---|---|---|
| id | uuid | ✓ | אוטומטי |
| object_id | uuid → view_objects | ✓ | |
| field_key | text | ✓ | ייחודי באובייקט. חייב להיות עמודה אמיתית בטבלה (נבדק בטריגר) |
| label | text | ✓ | התווית בעברית |
| field_type | enum `field_type` | ✓ | `text`, `long_text`, `phone`, `email`, `number`, `money`, `date`, `datetime`, `boolean`, `choice`, `reference` |
| options | jsonb | ב-`choice` וב-`boolean` | מערך `[{"value", "label"}]` |
| ref_object_id | uuid → view_objects | ב-`reference` בלבד | |
| position | int | ✓ | סדר השדות |
| default_visible, is_searchable, is_required, is_editable | boolean | ✓ | |
| created_at, updated_at | timestamptz | ✓ | אוטומטי |

### views (תצוגות)
| שדה | סוג | חובה | ערכים / כלל |
|---|---|---|---|
| id | uuid | ✓ | אוטומטי |
| object_id | uuid → view_objects | ✓ | |
| name | text | ✓ | לא ריק |
| view_type | enum `view_type` | ✓ | `list` רשימה (ברירת מחדל), `kanban` קאנבן |
| owner_id | uuid → staff | | אוטומטי. ריק = תצוגת מערכת, ואז חייבת להיות משותפת |
| is_shared | boolean | ✓ | ברירת מחדל `false` |
| is_default | boolean | ✓ | אחת לכל אובייקט, ורק תצוגה משותפת |
| filter_match | enum `filter_match` | ✓ | `all` וגם (ברירת מחדל), `any` או |
| kanban_field_id | uuid → object_fields | | שדה הקיבוץ בקאנבן |
| created_at, updated_at | timestamptz | ✓ | אוטומטי |

### view_columns, view_filters, view_sorts (הגדרת תצוגה)
| טבלה | שדות מעבר ל-id, view_id, field_id, position ותאריכים | כלל |
|---|---|---|
| `view_columns` | width (60-800, ברירת מחדל 160), is_visible | שדה פעם אחת בתצוגה |
| `view_filters` | operator (enum `filter_operator`), value | האופרטור חייב להתאים לסוג השדה |
| `view_sorts` | direction (enum `sort_direction`: `asc`, `desc`) | |

### פונקציות
- `run_view`, `run_view_groups`: מריצות תצוגה (security invoker, ולכן RLS חל).
- `save_view`, `create_view`, `set_default_view` (מנהלת בלבד): שמירה, יצירה ושכפול, ברירת מחדל.

## מחושב בתצוגה, לא נשמר
- **התור הבא** של לקוחה: התור הקרוב בעתיד שלא בוטל.
- **קריאה ותיקה:** לא נסגרה ונפתחה לפני יותר מ-48 שעות.
- **אחוז המרה** לפי מקור הגעה.

מחיר ומשך בתור נשמרים בכוונה. הם עותק של המחירון ביום הקביעה, כדי ששינוי מחיר לא ישנה תורים קיימים.
