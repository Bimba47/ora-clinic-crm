# חיבור סוכן השירות ל-CRM דרך n8n (שאלה 5)

שני תהליכי n8n שמחברים את סוכן השירות בקלאודצ'אט (שאלה 4) למערכת ה-CRM (שאלה 3), דרך ה-API של המערכת (`/api/v1`, סעיף 8ו ב-CLAUDE.md).

```
סוכן קלאודצ'אט ──POST──▶ n8n (Webhook) ──API──▶ CRM קליניקת אורה
               ◀──תשובה──             ◀──JSON──
```

הסוכן קורא לתהליך כ-AI Function, מעביר את מה שאסף בשיחה, ומציג ללקוחה רק את מה שהתהליך החזיר.

## 1. פתיחת קריאת שירות – `open-service-request.json`

**כתובת:** `POST https://n8n.srv1957614.hstgr.cloud/webhook/ora-open-ticket`
**גוף הבקשה:** `{ "name": "דנה לוי", "phone": "054-1234567", "description": "מבקשת להזיז את התור" }`

| שלב | מה קורה |
|---|---|
| Validate | בודק שם (2 תווים לפחות), תיאור (3 לפחות) וטלפון. הטלפון מנורמל: בלי מקפים ורווחים, ו-972 הופך ל-0. חסר משהו – מחזיר `invalid_request` עם מה שחסר, ולא ממשיך |
| Find client | `GET /api/v1/clients?phone=…` – חיפוש הלקוחה לפי טלפון |
| Create client | רק אם לא נמצאה: `POST /api/v1/clients` עם שם, טלפון ומקור "אחר" |
| Create ticket | `POST /api/v1/service_requests` עם הלקוחה והתיאור. הקריאה נוצרת בסטטוס "חדשה" |
| Build response | `created` עם מזהה הקריאה **רק** אם ה-CRM החזיר קריאה שנשמרה בסטטוס `new`. בכל מקרה אחר: `error`, "הפנייה לא נפתחה" |

**תשובות אפשריות:**
- `{"response":{"status":"created","created":true,"ticket_id":"…","ticket_ref":"1a2b3c4d","summary":"הפנייה נשמרה במערכת."}}`
- `{"response":{"status":"invalid_request","created":false,"summary":"הפנייה לא נשמרה. חסר או לא תקין: …"}}`
- `{"response":{"status":"error","created":false,"summary":"לא הצלחתי לשמור את הפנייה במערכת. הפנייה לא נפתחה."}}`

כך מתקיימת דרישת המבחן: הסוכן מאשר פתיחת קריאה רק אחרי שמירה מוצלחת, ולא מדווח על רשומה שלא נוצרה.

## 2. התור הבא – `next-appointment.json`

**כתובת:** `POST https://n8n.srv1957614.hstgr.cloud/webhook/ora-next-appointment`
**גוף הבקשה:** `{ "phone": "054-1234567" }`

| שלב | מה קורה |
|---|---|
| Validate | נרמול ובדיקת הטלפון, כמו בתהליך הראשון |
| Find client | `GET /api/v1/clients?phone=…` |
| Get next appointment | `GET /api/v1/appointments?client_id=…&status[neq]=cancelled&starts_at[gte]={{now}}&sort=starts_at&limit=1` – התור הקרוב מעכשיו (לפי שעה מדויקת) שלא בוטל |
| Build response | יום, תאריך, שעה וסוג הטיפול, לפי שעון ישראל |

**תשובות אפשריות:**
- `found`: "התור הבא: יום שלישי 20.10.2026 בשעה 15:30, טיפול פנים קלאסי."
- `no_upcoming`: "אין תור עתידי ברשומות שנבדקו."
- `client_not_found`: לא נמצאה לקוחה עם הטלפון הזה.
- `error`: "לא הצלחתי לבדוק את התור כרגע. אין לנחש תאריך."

## אבטחה

- **הקריאה לתהליך** (מהסוכן): Header Auth על ה-Webhook. בלי ה-header הנכון n8n מחזיר 403.
- **הקריאה ל-CRM** (מהתהליך): מפתח API של המערכת, בכותרת `Authorization: Bearer <key>`. המפתח שמור כ-credential ב-n8n.
- **בקבצים כאן אין מפתחות.** הם יוצאו מ-n8n בלי credentials, בלי מזהי מערכת ובלי נתוני הרצה.

## ייבוא ל-n8n אחר

1. ב-n8n: **Workflows** ← **Import from File**, ובוחרים את קובץ ה-JSON.
2. יוצרים שני credentials מסוג **Header Auth**:
   - לצומת ה-Webhook: שם header וערך משלכם.
   - לצמתי ה-HTTP Request: `Authorization` עם הערך `Bearer <מפתח API>`. את המפתח יוצרים במערכת: **הגדרות** ← **API** (מנהלת מערכת).
3. משייכים את ה-credentials לצמתים ומפעילים את התהליך.

## בשרת n8n של הפרויקט

- התהליכים המקוריים (`oraOpenTicket01`, `oraNextAppt01`) פעילים, ומחוברים לסוכן בקלאודצ'אט.
- לבודק יש עותק של שניהם באזור האישי שלו ב-n8n, בשם "(עותק לבודק)". העותקים כבויים ובלי credentials: הם לצפייה במבנה, והמקוריים הם אלה שרצים. בגרסה החינמית של n8n (Registered Community) אין שיתוף של תהליך קיים בין משתמשים, ולכן זה נעשה בעותק.
