"use client";
// מסך רשומה בודדת: /tasks/[id] (או /tasks/new ליצירה). המבנה ב-src/lib/records.ts
import { useParams } from "next/navigation";
import RecordPage from "@/components/RecordPage";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <RecordPage key={id} objectKey="tasks" id={id} />;
}
