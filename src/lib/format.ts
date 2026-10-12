// הצגת ערך של שדה לפי סוג השדה בקטלוג. תאריכים ושעות לפי שעון ישראל.

import type { FieldMeta, Row } from "@/lib/views";

const TZ = "Asia/Jerusalem";
const dateFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const moneyFmt = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });

export function formatPhone(p: string) {
  if (/^0\d{9}$/.test(p)) return `${p.slice(0, 3)}-${p.slice(3)}`;
  if (/^0\d{8}$/.test(p)) return `${p.slice(0, 2)}-${p.slice(2)}`;
  return p;
}

export function formatDateTime(v: string) {
  return dateTimeFmt.format(new Date(v));
}

const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export function formatDate(v: string) {
  return dateFmt.format(new Date(v));
}

export function formatTime(v: string) {
  return timeFmt.format(new Date(v));
}

export function formatMoney(v: unknown) {
  return moneyFmt.format(Number(v));
}

// קישור לשיחת וואטסאפ: 0541234567 -> https://wa.me/972541234567
export function whatsappHref(phone: string) {
  return `https://wa.me/972${phone.replace(/\D/g, "").replace(/^0/, "")}`;
}

export function choiceLabel(field: FieldMeta, value: unknown) {
  if (value === null || value === undefined) return "";
  return field.options?.find((o) => o.value === String(value))?.label ?? String(value);
}

export function formatValue(field: FieldMeta, row: Row): string {
  const v = row[field.field_key];
  if (field.field_type === "reference") return String(row[`${field.field_key}__label`] ?? "");
  if (v === null || v === undefined || v === "") return "";
  switch (field.field_type) {
    case "choice":
    case "boolean":
      return choiceLabel(field, v);
    case "money":
      return moneyFmt.format(Number(v));
    case "number":
      return String(v);
    case "date":
      return dateFmt.format(new Date(String(v)));
    case "datetime":
      return dateTimeFmt.format(new Date(String(v)));
    case "phone":
      return formatPhone(String(v));
    default:
      return String(v);
  }
}

// טקסט שמופיע בכיוון שמאל-לימין גם בתוך ממשק עברי (טלפון, אימייל, תאריך, סכום)
export function isLtr(field: FieldMeta) {
  return ["phone", "email", "date", "datetime", "money", "number"].includes(field.field_type);
}
