"use client";
// כרטיס לקוח: /clients/[id]
import { useParams } from "next/navigation";
import ClientCard from "@/components/ClientCard";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ClientCard key={id} id={id} />;
}
