"use client";
// ניהול צוות ומחירון: שני אובייקטים, כל אחד עם מנוע התצוגות הגנרי
import { useState } from "react";
import ObjectViews from "@/components/views/ObjectViews";

export default function Page() {
  const [tab, setTab] = useState<"staff" | "treatments">("staff");
  return (
    <>
      <div className="segmented tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "staff"} className={tab === "staff" ? "on" : ""} onClick={() => setTab("staff")}>צוות</button>
        <button type="button" role="tab" aria-selected={tab === "treatments"} className={tab === "treatments" ? "on" : ""} onClick={() => setTab("treatments")}>מחירון</button>
      </div>
      <ObjectViews key={tab} objectKey={tab} />
    </>
  );
}
