"use client";
// מסך ההתראות המלא: כל ההיסטוריה דרך מנוע התצוגות, ו"סמני הכול כנקרא".
// לחיצה על התראה מסמנת אותה כנקראה ומובילה לרשומה שלה.
import { useState } from "react";
import ObjectViews from "@/components/views/ObjectViews";
import { useAuth } from "@/components/Auth";
import { useToast } from "@/components/Toast";
import { markAllRead } from "@/components/NotificationBell";
import { errorText } from "@/lib/views";

export default function Page() {
  const { userId } = useAuth();
  const toast = useToast();
  const [reload, setReload] = useState(0);
  return (
    <ObjectViews
      objectKey="notifications"
      reloadToken={reload}
      headerActions={
        <button
          type="button"
          className="btn outline"
          onClick={async () => {
            try {
              if (userId) await markAllRead(userId);
              toast("כל ההתראות סומנו כנקראו");
              setReload((r) => r + 1);
            } catch (e) {
              toast(errorText(e), "err");
            }
          }}
        >
          סמני הכול כנקרא
        </button>
      }
    />
  );
}
