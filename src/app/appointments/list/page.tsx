"use client";
// רשימת התורים: המסך גנרי, התצוגות שלו מוגדרות במסד. כפתור "יומן" בולט בשורת התצוגה, ליד רשימה/קאנבן.
import Link from "next/link";
import Icon from "@/components/Icon";
import ObjectViews from "@/components/views/ObjectViews";

export default function Page() {
  return (
    <ObjectViews
      objectKey="appointments"
      viewBarActions={<Link href="/appointments" className="btn calendar-btn"><Icon name="calendar" />יומן</Link>}
    />
  );
}
