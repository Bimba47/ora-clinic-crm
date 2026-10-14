# סכמת בסיס הנתונים: CRM קליניקת אורה

מצב אחרי מיגרציה `0009_settings_profile_notifications` (12.10.2026). כל הכללים כאן נאכפים במסד.
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
| התראות | `notifications` | כל רשומה (object_key + record_id) | רשומה 1 ← רבים | בלי מפתח זר (מאז 0009) | נשארות (הקישור מוביל ל"לא נמצאה") |
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
| role_id | תפקיד | uuid → roles | ✓ | ההרשאות לפי התפקיד |
| team_id | צוות | uuid → teams | | נמחק צוות → ריק |
| address | כתובת מגורים | text | | חסומה לתפקיד "מטפלת" (הרשאת שדה). כל אחת רואה את שלה ב-`get_me` |
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

### notifications (מרכז התראות)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | אוטומטי |
| recipient_id | למי | uuid → staff | ✓ | |
| kind | סוג | enum `notification_kind` | ✓ | `assignment` שיוך, `reminder` תזכורת, `update` עדכון, `system` מערכת (ברירת מחדל) |
| object_key | אובייקט | text | | `clients`, `appointments`, `service_requests`, `staff`, `treatments`. יחד עם record_id או ששניהם ריקים |
| record_id | מזהה הרשומה | uuid | | הרשומה שההתראה מובילה אליה |
| message | הודעה | text | ✓ | נוצרת אוטומטית. יצירת התראה = הוספת שורה אחת (recipient_id + message חובה, השאר ברירת מחדל) |
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
| field_key | text | ✓ | ייחודי באובייקט. חייב להיות עמודה אמיתית בטבלה (נבדק בטריגר), חוץ משדה מחושב |
| label | text | ✓ | התווית בעברית |
| field_type | enum `field_type` | ✓ | `text`, `long_text`, `phone`, `email`, `number`, `money`, `date`, `datetime`, `boolean`, `choice`, `reference` |
| options | jsonb | ב-`choice` וב-`boolean` | מערך `[{"value", "label"}]` |
| ref_object_id | uuid → view_objects | ב-`reference` בלבד | |
| position | int | ✓ | סדר השדות |
| default_visible, is_searchable, is_required, is_editable | boolean | ✓ | |
| is_filterable | boolean | ✓ | ברירת מחדל `true`. `false` = לא מופיע בסינון ונחסם במסד (0006) |
| placeholder | text | | דוגמה בשדה הריק בטופס (0020) |
| computed | text | | שדה מחושב (0019): ביטוי SQL על הכינוי `t`, מוגדר רק במיגרציה. מוצג, ממוין ומסונן, לא נערך. ב-options אפשר רמז תצוגה (`{"display":"hours_open","warn_over":48}`) |
| created_at, updated_at | timestamptz | ✓ | אוטומטי |

שדות מחושבים (0019): `clients.next_appointment` (התור הבא, datetime), `clients.open_requests` (קריאות פתוחות, number), `service_requests.open_hours` (פתוחה כבר, שעות). התור והקריאות נספרים רק אם מותר לי לראות אותם.

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
- `run_view`, `run_view_groups`: מריצות תצוגה. מאז v13 security definer, עם בדיקת היקף לכל שורה (`can_view_row`) והסתרת שדות חסומים.
- `get_record(object, id)`: רשומה אחת עם תוויות לשדות מקושרים, לפי אותן הרשאות.
- `save_view`, `create_view`, `set_default_view` (מנהלת בלבד): שמירה, יצירה ושכפול, ברירת מחדל.
- ערך סינון עם `{{…}}` (היום, `week_start`, `week_end`, `month_start`, `month_end`, `user`) מחושב ב-`view_where` דרך `automation_render` (0019, החודש מ-0029).
- `private.check_appointment` (טריגר BEFORE על `appointments`, 0019): "בוצע" רק אחרי מועד התור, וחפיפה עם הודעה "ל<שם> יש תור ב-HH:MM עד HH:MM".

## הגדרות, העדפות ולוגו (`0009_settings_profile_notifications`)

### app_settings (הגדרות המערכת, מפתח-ערך)
| שדה | סוג | חובה | ערכים / כלל |
|---|---|---|---|
| key | text, PK | ✓ | אותיות קטנות וקו תחתון. כרגע: `app_name`, `logo_url` |
| value | jsonb | ✓ | הערך (מחרוזת, או null) |
| label | text | ✓ | שם ההגדרה בעברית |
| is_public | boolean | ✓ | `true` = נקרא גם לפני כניסה (שם ולוגו למסך הכניסה) |
| created_at, updated_at | timestamptz | ✓ | אוטומטי |
| updated_by | uuid → staff | | אוטומטי |

- RLS: קריאה – ציבוריות לכולם, השאר לצוות פעיל. עדכון – מנהלת בלבד. הוספה ומחיקה – רק במיגרציה.
- לוגו: אחסון Supabase, bucket `branding` (ציבורי לקריאה, כתיבה למנהלת בלבד, עד 1MB, PNG/JPG/WEBP/SVG).

### user_preferences (העדפות אישיות)
| שדה | סוג | חובה | ערכים / כלל |
|---|---|---|---|
| staff_id | uuid, PK → staff | ✓ | ברירת מחדל: המשתמשת המחוברת. נמחק עם אשת הצוות |
| landing_path | text | ✓ | המסך שנפתח אחרי כניסה: `/`, `/clients`, `/appointments/list`, `/requests`, `/notifications` |
| email_notifications | boolean | ✓ | ברירת מחדל `false` |
| created_at, updated_at | timestamptz | ✓ | אוטומטי |

- RLS: כל אחת קוראת, יוצרת ומעדכנת רק את השורה שלה.

### פונקציות פרופיל
- `update_my_profile(p_full_name, p_phone, p_address)`: מעדכנת רק את השורה של המשתמשת המחוברת, ורק שם, טלפון וכתובת.
- `sync_my_email()`: אחרי החלפת אימייל ב-Supabase Auth, מעדכנת את האימייל בטבלת הצוות.

## עודכנה על ידי (`0005_updated_by`)

בכל שש טבלאות העסק (`staff`, `clients`, `treatments`, `appointments`, `service_requests`, `notifications`):

| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| updated_by | עודכנה על ידי (בתור ובטיפול: עודכן על ידי) | uuid → staff | | אוטומטי בכל יצירה ועדכון: המשתמשת המחוברת. ריק = פעולת מערכת. במחיקת אשת הצוות השדה מתרוקן |

- לא נחשב "שדה שהשתנה" ביומן הפעילות, בדיוק כמו `updated_at`.
- בצוות ההרשאות לפי עמודה, ולכן ניתנה הרשאת קריאה לעמודה הזו.
- בקטלוג מנוע התצוגות: שדה מקושר לצוות, לקריאה בלבד.

## הרשאות (`0010_permissions`, `0011_function_grants`, `0012_permission_guards`)

### roles (תפקידים)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | |
| name | שם | text | ✓ | ייחודי |
| description | תיאור | text | | |
| is_admin | מנהלת מערכת | boolean | ✓ | גישה להגדרות, הרשאות ומשתמשים. תמיד נשארת מנהלת פעילה אחת |
| created_at, updated_at, updated_by | | | | אוטומטי |

תפקיד חדש מקבל אוטומטית שורת `role_permissions` לכל אובייקט, הכול `none`.

### teams (צוותים)
| שדה | תווית | סוג | חובה | ערכים / כלל |
|---|---|---|---|---|
| id | | uuid | ✓ | |
| name | שם | text | ✓ | ייחודי |
| description | תיאור | text | | |
| created_at, updated_at, updated_by | | | | אוטומטי |

### role_permissions (הרשאה לאובייקט)
| שדה | סוג | ערכים / כלל |
|---|---|---|
| role_id | uuid → roles | מפתח (עם object_key). נמחק עם התפקיד |
| object_key | text | `clients`, `appointments`, `service_requests`, `treatments`, `staff` |
| can_view, can_create, can_edit, can_delete | enum `perm_scope` | `none` אין, `own` שלי, `team` הצוות שלי, `all` הכול. במחירון רק `none`/`all` |

"שלי" לפי `view_objects.owner_field`: לקוחה `created_by`, תור `therapist_id`, קריאה `assigned_to`, צוות `id`.

### field_permissions (הרשאה לשדה)
| שדה | סוג | ערכים / כלל |
|---|---|---|
| role_id, object_key, field_key | | מפתח. השדה חייב להיות בקטלוג |
| access | enum `field_access` | `hidden` חסום (לא נשלח לדפדפן), `read` קריאה בלבד. שדה חובה לא יכול להיות חסום |

### פונקציות הרשאה
- `private.row_allowed(object, action, owner)`: לב ה-RLS. קורא את ההיקף מ-`role_permissions`.
- `private.can_view_row`, `private.field_hidden`: לשימוש `run_view` ו-`get_record`.
- `enforce_field_access` (טריגר): חוסם שינוי שדה לקריאה בלבד או מילוי שדה חסום.
- `sync_column_grants` (טריגר על `field_permissions`): שולל SELECT על עמודה חסומה.
- `get_me()`, `get_my_permissions()`, `duplicate_role(role_id, name)` (מנהלת מערכת).

## משימות: הוסר (`0023_remove_tasks`)

אובייקט המשימות נוצר ב-`0015_tasks` והוסר ב-`0023_remove_tasks` (v24): הוא לא באפיון וחפף לקריאות השירות. הטבלה, הקטלוג, ההרשאות ושני כללי האוטומציה שלו נמחקו. גיבוי: `versions/v24-tasks-removal/backup.json`. ביומן הפעילות נשארו שורות עם table_name = tasks, ולכן ה-check constraints מתירים את הערך.

## אוטומציות (`0016_automations`)

### automation_rules (כללים)
| שדה | סוג | חובה | ערכים / כלל |
|---|---|---|---|
| id | uuid | ✓ | |
| name | text | ✓ | לא ריק |
| object_name | text | ✓ | `clients`, `appointments`, `service_requests`, `treatments`, `staff`, `tasks` |
| is_active | boolean | ✓ | ברירת מחדל true |
| trigger_event | enum `automation_event` | ✓ | `create`, `update`, `schedule` |
| trigger_fields | text[] | ✓ | רק לעדכון. ריק = כל שינוי |
| schedule_cron | text | | רק לתזמון (cron, לפי UTC) |
| conditions | jsonb | ✓ | `{"match":"all"/"any","rules":[{"field","op","value"}]}` |
| actions | jsonb | ✓ | מערך פעולות (לפחות אחת): update_field, update_related, create_record, notify |
| created_at, updated_at, updated_by | | | אוטומטי |

### automation_logs (לוג הרצות)
| שדה | סוג | ערכים / כלל |
|---|---|---|
| id | uuid | |
| rule_id | uuid → automation_rules | נמחק כלל → נמחק הלוג שלו |
| object_name, record_id | text, uuid | הרשומה שעליה רץ הכלל (ריק בהרצה מתוזמנת שלא מצאה רשומות) |
| status | enum `automation_log_status` | `success`, `failed`, `skipped` |
| message | text | פירוט הפעולות או הודעת השגיאה |
| executed_at | timestamptz | |

### פונקציות
- `private.automation_dispatch(object, event, new, old)`: המנוע. נקרא מהטריגר `private.automation_on_change` על כל טבלת אובייקט.
- `private.automation_run_scheduled(rule_id)`: הרצה מתוזמנת (pg_cron, משימה `automation_<id>`).
- `private.automation_conditions_met`, `private.automation_execute`, `private.automation_render` (תבניות), `private.automation_validate` (טריגר בדיקה), `private.automation_sync_cron` (טריגר תזמון).
- `public.automation_schema()`: אובייקטים, שדות ואופרטורים לבונה הכללים (מנהלת בלבד).
- `public.automation_rule_list()`: הכללים עם ההרצה האחרונה ומספר ההצלחות והכישלונות.

## לוחות בקרה (`0017_dashboards`)

### dashboards (לוחות)
| שדה | סוג | חובה | ערכים / כלל |
|---|---|---|---|
| id | uuid | ✓ | |
| name | text | ✓ | |
| owner_id | uuid → staff | | ברירת מחדל: מי שיצרה. ריק בלוח מערכת |
| is_shared | boolean | ✓ | משותף לצוות (רק מנהלת מערכת) |
| role_visibility | uuid[] | ✓ | לאילו תפקידים לוח משותף מוצג. ריק = לכולם |
| filters | jsonb | ✓ | סינון ברירת מחדל: `{date_from, date_to, owner}` |
| position | int | ✓ | סדר הלוחות |
| created_at, updated_at, updated_by | | | אוטומטי |

### dashboard_widgets (ווידג'טים)
| שדה | סוג | חובה | ערכים / כלל |
|---|---|---|---|
| id | uuid | ✓ | |
| dashboard_id | uuid → dashboards | ✓ | נמחק לוח → נמחקים הווידג'טים |
| title | text | ✓ | |
| widget_type | enum `widget_type` | ✓ | `table`, `bar`, `pie`, `metric`, `list`, `text` |
| object_name | text | | ריק רק בטקסט |
| filters | jsonb | ✓ | `{"match","rules":[{"field","op","value"}]}` |
| group_by | text | | שדה לקיבוץ |
| date_group | enum `widget_date_group` | ✓ | `none`, `day`, `week` (מיום ראשון), `month` |
| aggregate | enum `widget_aggregate` | ✓ | `count`, `sum`, `avg`, `min`, `max`, `percent` |
| aggregate_field | text | | שדה מספרי (לא בספירה) |
| sort | text | | `value_desc`/`value_asc`/`label_asc`, או שדה (`:desc`) ברשימה |
| limit | int | | 1-500 |
| position_x, position_y, width, height | int | ✓ | גריד של 12 עמודות |
| config | jsonb | ✓ | הגדרות לפי סוג (CLAUDE.md סעיף 8ה) |
| created_at, updated_at, updated_by | | | אוטומטי |

### פונקציות
- `public.run_widget(widget, dash_filters)`: מריצה ווידג'ט (security invoker, RLS חל). מחזירה `{kind: metric|groups|pivot|rows, …}`.
- `private.widget_field`, `private.widget_condition`, `private.widget_where`, `private.widget_label_expr`: בדיקת שדות מול הקטלוג ובניית התנאים עם פרמטרים.
- `public.duplicate_dashboard(id, name)`: שכפול לוח עם הווידג'טים (העותק פרטי).
- תבניות חדשות (גם באוטומציות): `{{now-48h}}`, `{{field:time}}`, `{{field:date}}`.

## מחושב בתצוגה, לא נשמר
- **התור הבא** של לקוחה: התור הקרוב בעתיד שלא בוטל.
- **קריאה ותיקה:** לא נסגרה ונפתחה לפני יותר מ-48 שעות.
- **אחוז המרה** לפי מקור הגעה.

מחיר ומשך בתור נשמרים בכוונה. הם עותק של המחירון ביום הקביעה, כדי ששינוי מחיר לא ישנה תורים קיימים.
