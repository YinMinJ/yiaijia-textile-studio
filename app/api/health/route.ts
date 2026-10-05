import { getSqlite } from "@/lib/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    return Response.json({ status: "ok", app: "yiaijia-web" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
