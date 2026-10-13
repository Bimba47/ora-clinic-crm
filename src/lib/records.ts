// מבנה מסך הרשומה הבודדת לכל אובייקט. המבנה קבוע ונגזר מהאפיון, ולא מוגדר על ידי המשתמשת:
// אילו שדות קריטיים ליד הכותרת, איך שאר השדות מקובצים, אילו רשומות מקושרות מוצגות בלשוניות,
// ומה לא מוצע בכלל (מחיקה, שכפול). מי מורשית ליצור, לערוך ולמחוק נקבע בטבלת ההרשאות במסד (role_permissions),
// והשדות עצמם (סוג, תווית, חובה, חסום/קריאה בלבד) מגיעים מהקטלוג ומהרשאות השדה.

export type ChildDef = {
  object: string;      // האובייקט המקושר
  fk: string;          // השדה בו שמצביע על הרשומה הנוכחית
  label: string;       // שם הלשונית
  addLabel: string;    // כפתור הוספת רשומה בת
  columns: string[];   // מה מוצג בכל שורה (בלי הסטטוס, שמוצג בנפרד)
  sort: { field: string; asc: boolean };
};

export type RecordConfig = {
  route: string;                                   // בסיס הכתובת, למשל "/clients/"
  listHref: string;                                // מסך הרשימה
  header: string[];                                // שדות קריטיים ליד הכותרת
  subtitle?: string;                               // שדה שמוצג מתחת לשם (למשל זמן פתיחת קריאה)
  stackedHeader?: boolean;                         // כותרת בטור: שם, מתחתיו השדות, ומתחתם הכפתורים (לשם ארוך)
  groups: { title: string; fields: string[] }[];   // שאר השדות, בקבוצות
  children: ChildDef[];
  noDelete?: string;                               // אם מחיקה לא מוצעת: ההסבר
  noDuplicate?: string;                            // אם שכפול לא מוצע: ההסבר
  noCopy?: string[];                               // שדות שמתרוקנים בשכפול (ייחודיים או תלויי זמן)
  copySuffix?: string;                             // שדה שמקבל " (עותק)" בשכפול (שם ייחודי)
  uniquePhone?: boolean;                           // בדיקת "לקוחה קיימת" בזמן ההקלדה
  managerScreen?: boolean;                         // המסך נמצא באזור ההגדרות של המנהלת (מטפלת לא מקבלת אליו קישור)
};

export const RECORDS: Record<string, RecordConfig> = {
  clients: {
    route: "/clients/",
    listHref: "/clients",
    header: ["phone"],
    groups: [
      { title: "פרטים אישיים", fields: ["full_name", "phone", "notes"] },
      { title: "שיווק", fields: ["source"] },
    ],
    children: [
      {
        object: "appointments", fk: "client_id", label: "תורים", addLabel: "+ תור חדש",
        columns: ["starts_at", "treatment_id", "therapist_id", "price"], sort: { field: "starts_at", asc: true },
      },
      {
        object: "service_requests", fk: "client_id", label: "קריאות שירות", addLabel: "+ קריאה חדשה",
        columns: ["description", "assigned_to", "created_at"], sort: { field: "created_at", asc: false },
      },
    ],
    noCopy: ["phone"],
    uniquePhone: true,
  },
  appointments: {
    route: "/appointments/",
    listHref: "/appointments/list",
    header: ["client_id", "therapist_id"],
    groups: [
      { title: "לקוחה וטיפול", fields: ["client_id", "treatment_id", "therapist_id"] },
      { title: "מועד", fields: ["starts_at", "duration_minutes"] },
      { title: "סטטוס ותשלום", fields: ["status", "price"] },
      { title: "הערות", fields: ["notes"] },
    ],
    children: [],
    noCopy: ["starts_at", "status"],
  },
  service_requests: {
    route: "/requests/",
    listHref: "/requests",
    header: ["status", "assigned_to", "client_id"],
    subtitle: "created_at",
    stackedHeader: true,
    groups: [
      { title: "הקריאה", fields: ["client_id", "description"] },
      { title: "טיפול בקריאה", fields: ["status", "assigned_to", "closed_at"] },
    ],
    children: [],
    noCopy: ["status", "closed_at"],
  },
  staff: {
    route: "/settings/team/",
    listHref: "/settings/team",
    header: ["role_id", "team_id", "is_active"],
    groups: [
      { title: "פרטים", fields: ["full_name", "phone", "email", "address"] },
      { title: "תפקיד וצוות", fields: ["role_id", "team_id", "is_active"] },
    ],
    children: [
      {
        object: "appointments", fk: "therapist_id", label: "תורים", addLabel: "+ תור חדש",
        columns: ["starts_at", "client_id", "treatment_id"], sort: { field: "starts_at", asc: true },
      },
      {
        object: "service_requests", fk: "assigned_to", label: "קריאות באחריותה", addLabel: "+ קריאה חדשה",
        columns: ["description", "client_id", "created_at"], sort: { field: "created_at", asc: false },
      },
    ],
    managerScreen: true,
    noDelete: "אשת צוות לא נמחקת, כי יש לה היסטוריה. כדי להפסיק את הגישה שלה משביתים אותה (סטטוס: מושבתת).",
    noDuplicate: "אשת צוות נוספת מתווספת דרך הזמנה למערכת, לא בשכפול.",
  },
  treatments: {
    route: "/settings/treatments/",
    listHref: "/settings/treatments",
    header: ["price", "duration_minutes", "is_active"],
    groups: [
      { title: "טיפול", fields: ["name", "is_active"] },
      { title: "מחיר ומשך", fields: ["price", "duration_minutes"] },
    ],
    children: [
      {
        object: "appointments", fk: "treatment_id", label: "תורים", addLabel: "+ תור חדש",
        columns: ["starts_at", "client_id", "therapist_id"], sort: { field: "starts_at", asc: true },
      },
    ],
    managerScreen: true,
    copySuffix: "name",
  },
};

// כתובת מסך הרשומה, אם לאובייקט יש מסך כזה
export function recordHref(objectKey: string | undefined, id: unknown): string | null {
  const cfg = objectKey ? RECORDS[objectKey] : undefined;
  return cfg && id ? `${cfg.route}${id}` : null;
}

// קישור לרשומה מקושרת, לפי ההרשאה: מסכי הגדרות (צוות, מחירון) רק למנהלת. למטפלת השם מוצג בלי קישור.
export function linkHref(objectKey: string | undefined, id: unknown, isManager: boolean): string | null {
  if (objectKey && RECORDS[objectKey]?.managerScreen && !isManager) return null;
  return recordHref(objectKey, id);
}

// ===== ניווט בין רשומות =====
// כשפותחים רשומה מרשימה, נשמרים הסדר של הרשומות באותה תצוגה (לקודמת/הבאה) והכתובת לחזרה.
export type RecordNav = { ids: string[]; backHref: string; backLabel: string };

export function saveNav(objectKey: string, nav: RecordNav) {
  try {
    sessionStorage.setItem(`ora:nav:${objectKey}`, JSON.stringify(nav));
  } catch {}
}

export function readNav(objectKey: string): RecordNav | null {
  try {
    const raw = sessionStorage.getItem(`ora:nav:${objectKey}`);
    return raw ? (JSON.parse(raw) as RecordNav) : null;
  } catch {
    return null;
  }
}

// מצב מסך הרשימה (תצוגה, סינון ומיון שלא נשמרו, חיפוש, עמוד), כדי שהחזרה אליה תחזיר אותו
export type ListSnapshot<S> = { viewId: string; state: S; search: string; page: number; restore?: boolean };

export function saveListSnapshot<S>(objectKey: string, snap: ListSnapshot<S>) {
  try {
    sessionStorage.setItem(`ora:list:${objectKey}`, JSON.stringify(snap));
  } catch {}
}

// מסמן שהמעבר הבא למסך הרשימה הוא "חזרה", ושצריך לשחזר את המצב
export function markListRestore(objectKey: string) {
  try {
    const raw = sessionStorage.getItem(`ora:list:${objectKey}`);
    if (raw) sessionStorage.setItem(`ora:list:${objectKey}`, JSON.stringify({ ...JSON.parse(raw), restore: true }));
  } catch {}
}

// מחזיר את המצב פעם אחת בלבד, ורק אם המעבר היה "חזרה"
export function takeListSnapshot<S>(objectKey: string): ListSnapshot<S> | null {
  try {
    const raw = sessionStorage.getItem(`ora:list:${objectKey}`);
    if (!raw) return null;
    const snap = JSON.parse(raw) as ListSnapshot<S>;
    if (!snap.restore) return null;
    sessionStorage.setItem(`ora:list:${objectKey}`, JSON.stringify({ ...snap, restore: false }));
    return snap;
  } catch {
    return null;
  }
}
