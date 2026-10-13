"use client";
// קבלת הזמנה: המשתמשת מגיעה לכאן מהקישור במייל ההזמנה ובוחרת סיסמה.

import SetPassword from "@/components/SetPassword";

export default function AcceptInvitePage() {
  return (
    <SetPassword
      intro={(name) => `ברוכה הבאה${name ? `, ${name}` : ""}! בחרי סיסמה לכניסה למערכת.`}
      invalidText="הקישור לא תקף או שפג תוקפו. בקשי מהמנהלת לשלוח הזמנה חדשה."
    />
  );
}
