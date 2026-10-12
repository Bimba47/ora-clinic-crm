import { redirect } from "next/navigation";

// המסך עבר לאזור ההגדרות
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/settings/treatments/${id}`);
}
