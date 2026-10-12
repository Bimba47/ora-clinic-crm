import { redirect } from "next/navigation";

// המסך עבר לאזור ההגדרות
export default function Page() {
  redirect("/settings/treatments");
}
