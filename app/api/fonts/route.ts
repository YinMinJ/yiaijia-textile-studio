import { owner, db, bucket, errorResponse, checkOrigin } from "@/lib/server-store";
import { FONT_FILE_LIMIT, FONT_ACCOUNT_LIMIT, FONT_ACCOUNT_COUNT, inspectFontUpload } from "@/lib/font-upload";

export async function GET() {
  try {
    const uid = await owner();
    const rows = await db().prepare("SELECT id, name FROM fonts WHERE owner_id = ? ORDER BY created_at DESC").bind(uid).all<{ id: string; name: string }>();
    return Response.json({ fonts: rows.results.map(font => ({ ...font, url: "/api/fonts/" + font.id })) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const uid = await owner();
    if (Number(request.headers.get("content-length") || 0) > FONT_FILE_LIMIT + 4096)
      return Response.json({ error: "单个字体请小于 20MB。" }, { status: 413 });
    // Bound streamed requests too; Content-Length is not required by HTTP.
    if (!request.body) return Response.json({ error: "请选择字体文件。" }, { status: 400 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > FONT_FILE_LIMIT + 4096) {
          await reader.cancel();
          return Response.json({ error: "单个字体请小于 20MB。" }, { status: 413 });
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const payload = new ArrayBuffer(received);
    const combined = new Uint8Array(payload);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    let body: FormData;
    try { body = await new Response(payload, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); }
    catch { return Response.json({ error: "字体上传格式不正确，请重新选择文件。" }, { status: 400 }); }
    const file = body.get("file");
    if (!(file instanceof File) || !file.size)
      return Response.json({ error: "请选择 TTF、OTF、WOFF 或 WOFF2 字体文件。" }, { status: 400 });
    if (file.size > FONT_FILE_LIMIT)
      return Response.json({ error: "单个字体请小于 20MB。" }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let metadata;
    try { metadata = inspectFontUpload(file.name, bytes); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "字体文件无法读取。" }, { status: 400 }); }
    const id = crypto.randomUUID();
    const key = uid + "/fonts/" + id;
    // Reserve quota atomically so simultaneous uploads cannot bypass either cap.
    const inserted = await db().prepare(`INSERT INTO fonts (id, owner_id, object_key, name, mime, bytes, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM fonts WHERE owner_id = ?) < ? AND
      (SELECT COALESCE(SUM(bytes), 0) FROM fonts WHERE owner_id = ?) + ? <= ?`)
      .bind(id, uid, key, metadata.name, metadata.mime, bytes.length, new Date().toISOString(), uid, FONT_ACCOUNT_COUNT, uid, bytes.length, FONT_ACCOUNT_LIMIT).run();
    if (!inserted.meta.changes)
      return Response.json({ error: "字体空间已满，每个账号最多上传 20 个字体、合计 100MB。" }, { status: 413 });
    try { await bucket().put(key, bytes, { httpMetadata: { contentType: metadata.mime } }); }
    catch (error) {
      await db().prepare("DELETE FROM fonts WHERE id = ? AND owner_id = ?").bind(id, uid).run();
      throw error;
    }
    return Response.json({ font: { id, name: metadata.name, url: "/api/fonts/" + id } }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return errorResponse(error); }
}
