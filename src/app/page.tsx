"use client";
// המסך הראשי: לוחות הבקרה. הדשבורד של האפיון הוא הלוח המשותף "ראשי", בנוי מווידג'טים (supabase/migrations/0017).
import { Suspense } from "react";
import Dashboards from "@/components/dashboard/Dashboards";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 320 }} aria-busy="true" />}>
      <Dashboards />
    </Suspense>
  );
}
