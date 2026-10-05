import Studio from "./studio";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Studio signedIn={true} />;
}
