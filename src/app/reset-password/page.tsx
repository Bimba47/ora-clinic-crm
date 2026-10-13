"use client";
// איפוס סיסמה: המשתמשת מגיעה לכאן מהקישור במייל ("שכחתי סיסמה" במסך הכניסה) ובוחרת סיסמה חדשה.

import SetPassword from "@/components/SetPassword";

export default function ResetPasswordPage() {
  return (
    <SetPassword
      intro={(name) => `${name ? `${name}, ` : ""}בחרי סיסמה חדשה לכניסה למערכת.`}
      invalidText={'הקישור לא תקף או שפג תוקפו. אפשר לבקש קישור חדש ב"שכחתי סיסמה" במסך הכניסה.'}
    />
  );
}
