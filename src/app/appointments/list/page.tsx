"use client";
// רשימת התורים: המסך גנרי, התצוגות שלו מוגדרות במסד. מכאן אפשר לעבור ליומן.
import Link from "next/link";
import ObjectViews from "@/components/views/ObjectViews";

export default function Page() {
  return <ObjectViews objectKey="appointments" headerActions={<Link href="/appointments" className="btn outline">יומן</Link>} />;
}
