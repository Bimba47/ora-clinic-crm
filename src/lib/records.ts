// מבנה מסך הרשומה הבודדת לכל אובייקט. המבנה קבוע ונגזר מהאפיון, ולא מוגדר על ידי המשתמשת:
// אילו שדות קריטיים ליד הכותרת, איך שאר השדות מקובצים, אילו רשומות מקושרות מוצגות בלשוניות,
// ומה מותר (עריכה, מחיקה, שכפול). השדות עצמם (סוג, תווית, חובה) מגיעים מהקטלוג במסד.

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
  groups: { title: string; fields: string[] }[];   // שאר השדות, בקבוצות
  children: ChildDef[];
  editRole: "all" | "manager";                     // מי יכולה ליצור ולערוך (נאכף גם ב-RLS)
  noDelete?: string;                               // אם מחיקה לא מוצעת: ההסבר
  noDuplicate?: string;                            // אם שכפול לא מוצע: ההסבר
  noCopy?: string[];                               // שדות שמתרוקנים בשכפול (ייחודיים או תלויי זמן)
  copySuffix?: string;                             // שדה שמקבל " (עותק)" בשכפול (שם ייחודי)
  uniquePhone?: boolean;                           // בדיקת "לקוחה קיימת" בזמן ההקלדה
};

export const RECORDS: Record<string, RecordConfig> = {
  clients: {
    route: "/clients/",
    listHref: "/clients",
    header: ["phone", "source"],
    groups: [
      { title: "פרטים אישיים", fields: ["full_name", "phone"] },
      { title: "שיווק", fields: ["source"] },
    ],
    children: [
      {
        object: "appointments", fk: "client_id", label: "תורים", addLabel: "+ תור חדש",
        columns: ["starts_at", "treatment_id", "therapist_id", "price"], sort: { field: "starts_at", asc: false },
      },
      {
        object: "service_requests", fk: "client_id", label: "קריאות שירות", addLabel: "+ קריאה חדשה",
        columns: ["description", "assigned_to", "created_at"], sort: { field: "created_at", asc: false },
      },
    ],
    editRole: "all",
    noCopy: ["phone"],
    uniquePhone: true,
  },
  appointments: {
    route: "/appointments/",
    listHref: "/appointments/list",
    header: ["status", "client_id", "therapist_id"],
    groups: [
      { title: "לקוחה וטיפול", fields: ["client_id", "treatment_id", "therapist_id"] },
      { title: "מועד", fields: ["starts_at", "duration_minutes"] },
      { title: "סטטוס ותשלום", fields: ["status", "price"] },
      { title: "הערות", fields: ["notes"] },
    ],
    children: [],
    editRole: "all",
    noCopy: ["starts_at", "status"],
  },
  service_requests: {
    route: "/requests/",
    listHref: "/requests",
    header: ["status", "assigned_to", "client_id"],
    groups: [
      { title: "הקריאה", fields: ["client_id", "description"] },
      { title: "טיפול בקריאה", fields: ["status", "assigned_to", "closed_at"] },
    ],
    children: [],
    editRole: "all",
    noCopy: ["status", "closed_at"],
  },
  staff: {
    route: "/team/",
    listHref: "/team",
    header: ["role", "is_active"],
    groups: [
      { title: "פרטים", fields: ["full_name", "phone", "email"] },
      { title: "תפקיד וגישה", fields: ["role", "is_active"] },
    ],
    children: [
      {
        object: "appointments", fk: "therapist_id", label: "תורים", addLabel: "+ תור חדש",
        columns: ["starts_at", "client_id", "treatment_id"], sort: { field: "starts_at", asc: false },
      },
      {
        object: "service_requests", fk: "assigned_to", label: "קריאות באחריותה", addLabel: "+ קריאה חדשה",
        columns: ["description", "client_id", "created_at"], sort: { field: "created_at", asc: false },
      },
    ],
    editRole: "manager",
    noDelete: "אשת צוות לא נמחקת, כי יש לה היסטוריה. כדי להפסיק את הגישה שלה משביתים אותה (סטטוס: מושבתת).",
    noDuplicate: "אשת צוות נוספת מתווספת דרך הזמנה למערכת, לא בשכפול.",
  },
  treatments: {
    route: "/treatments/",
    listHref: "/treatments",
    header: ["price", "duration_minutes", "is_active"],
    groups: [
      { title: "טיפול", fields: ["name", "is_active"] },
      { title: "מחיר ומשך", fields: ["price", "duration_minutes"] },
    ],
    children: [
      {
        object: "appointments", fk: "treatment_id", label: "תורים", addLabel: "+ תור חדש",
        columns: ["starts_at", "client_id", "therapist_id"], sort: { field: "starts_at", asc: false },
      },
    ],
    editRole: "manager",
    copySuffix: "name",
  },
};

// כתובת מסך הרשומה, אם לאובייקט יש מסך כזה
export function recordHref(objectKey: string | undefined, id: unknown): string | null {
  const cfg = objectKey ? RECORDS[objectKey] : undefined;
  return cfg && id ? `${cfg.route}${id}` : null;
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
