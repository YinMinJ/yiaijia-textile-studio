import {
  owner,
  db,
  bucket,
  errorResponse,
  checkOrigin,
} from "@/lib/server-store";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const uid = await owner();
    const limit = 8 * 1024 * 1024;
    if (Number(request.headers.get("content-length") || 0) > limit + 4096)
      return Response.json({ error: "单张图片请小于8MB。" }, { status: 413 });
    const body = await request.formData();
    const file = body.get("file");
    if (
      !(file instanceof File) ||
      file.size > limit ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      return Response.json(
        { error: "请上传8MB以内的JPG、PNG或WebP图片。" },
        { status: 400 },
      );
    const total = await db()
      .prepare(
        "SELECT COALESCE(SUM(bytes), 0) AS total FROM assets WHERE owner_id = ?",
      )
      .bind(uid)
      .first<{ total: number }>();
    if ((total?.total || 0) + file.size > 300 * 1024 * 1024)
      return Response.json(
        { error: "试用素材空间已满，请联系管理员整理素材。" },
        { status: 413 },
      );
    const id = crypto.randomUUID();
    const key = uid + "/" + id;
    await bucket().put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    try {
      await db()
        .prepare(
          "INSERT INTO assets (id, owner_id, object_key, name, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          uid,
          key,
          file.name.slice(0, 200),
          file.type,
          file.size,
          new Date().toISOString(),
        )
        .run();
    } catch (e) {
      await bucket().delete(key);
      throw e;
    }
    return Response.json({ id, url: "/api/assets/" + id, name: file.name });
  } catch (e) {
    return errorResponse(e);
  }
}
