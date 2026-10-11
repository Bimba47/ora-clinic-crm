import { redirect } from "next/navigation";

// היומן הוויזואלי ייבנה בשלב נפרד. עד אז "תורים" פותח את רשימת התורים.
export default function Page() {
  redirect("/appointments/list");
}
