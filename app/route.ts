import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vue owns the workbench UI; Next keeps the authenticated API and local storage. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 307, headers: { Location: "/login", "Cache-Control": "no-store" } });

  try {
    const html = await readFile(path.join(process.cwd(), "public", "workbench", "index.html"), "utf8");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Response("Vue 工作台尚未构建，请先运行 pnpm build。", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    throw error;
  }
}
