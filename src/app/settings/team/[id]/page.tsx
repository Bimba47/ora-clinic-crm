"use client";
// מסך רשומה בודדת: /settings/team/[id] (או /settings/team/new ליצירה). המבנה ב-src/lib/records.ts
import { useParams } from "next/navigation";
import RecordPage from "@/components/RecordPage";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <RecordPage key={id} objectKey="staff" id={id} />;
}
