"use client";
// כניסה להגדרות: מנהלת מגיעה לפרטי המערכת, מטפלת לפרופיל האישי
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/Auth";

export default function Page() {
  const router = useRouter();
  const { ready, isManager } = useAuth();
  useEffect(() => {
    if (ready) router.replace(isManager ? "/settings/system" : "/settings/profile");
  }, [ready, isManager, router]);
  return <div className="skeleton" style={{ height: 240 }} aria-busy="true" />;
}
