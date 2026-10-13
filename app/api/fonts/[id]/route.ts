import { owner, db, bucket, errorResponse } from "@/lib/server-store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await owner();
    const { id } = await context.params;
    const row = await db().prepare("SELECT object_key, mime FROM fonts WHERE id = ? AND owner_id = ?")
      .bind(id, uid).first<{ object_key: string; mime: string }>();
    if (!row) return new Response("字体不存在", { status: 404 });
    const object = await bucket().get(row.object_key);
    if (!object) return new Response("字体不存在", { status: 404 });
    return new Response(object.body, { headers: {
      "Content-Type": row.mime,
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
