import {
  owner,
  db,
  bucket,
  errorResponse,
  checkOrigin,
} from "@/lib/server-store";
import { editProduct } from "@/lib/model-api";
import { IMAGE_JOB_LEASE_MS } from "@/lib/model-connection";
import type { Project, Asset } from "@/lib/design-model";
import { needsAI, referenceAssets, sourceAsset } from "@/lib/design-model";
import { buildProductPrompt, buildPhotographyTestPrompt } from "@/lib/product-photography";

function imageDimensions(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  if (mime === "image/png" && bytes.length >= 24) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 7) break;
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (mime === "image/webp") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const chunk = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + length > bytes.length) break;
      if (chunk === "VP8X" && length >= 10) {
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      } else if (chunk === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
        width = 1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8);
        height = 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0x0f) << 10);
      } else if (chunk === "VP8 " && length >= 10) {
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      }
      if (width && height) break;
      offset = start + length + (length % 2);
    }
  }
  if (!width || !height || width > 50000 || height > 50000)
    throw new Error("生成图片的尺寸信息无效，请检查服务商返回文件。");
  return { width, height };
}
export async function POST(request: Request) {
  let jobId = "";
  let uid = "";
  try {
    checkOrigin(request);
    uid = await owner();
    if (Number(request.headers.get("content-length") || 0) > 25 * 1024 * 1024)
      return Response.json({ error: "输入图片过大。" }, { status: 413 });
    const form = await request.formData();
    const images = form
      .getAll("image")
      .filter((f): f is File => f instanceof File);
    if (
      !images.length ||
      images.length > 3 ||
      images.some(
        (f) =>
          f.size > 8 * 1024 * 1024 ||
          !["image/jpeg", "image/png", "image/webp"].includes(f.type),
      )
    )
      return Response.json(
        { error: "请提供1至3张8MB以内的商品图。" },
        { status: 400 },
      );
    const test = form.get("test") === "true";
    const projectId = String(form.get("projectId") || "");
    const moduleId = String(form.get("moduleId") || "");
    let p: Project | null = null;
    let prompt = buildPhotographyTestPrompt();
    let imageKind: "main" | "detail" = "main";
    if (!test) {
      const row = await db()
        .prepare("SELECT data FROM projects WHERE id = ? AND owner_id = ?")
        .bind(projectId, uid)
        .first<{ data: string }>();
      if (!row)
        return Response.json(
          { error: "请先保存当前商品项目。" },
          { status: 404 },
        );
      p = JSON.parse(row.data);
      const m = p!.modules.find((m) => m.id === moduleId);
      if (!m)
        return Response.json(
          { error: "未找到当前图片模块。" },
          { status: 400 },
        );
      if (!needsAI(p!, m))
        return Response.json(
          { error: "这一模块使用实拍与商品资料排版，请在计划中选择原始素材。" },
          { status: 400 },
        );
      if (!sourceAsset(p!, m))
        return Response.json(
          { error: "原始参考图已缺失，请先重新选择这张图的实拍素材。" },
          { status: 400 },
        );
      prompt = buildProductPrompt(p!, m, referenceAssets(p!, m).slice(0, images.length));
      imageKind = m.kind;
      jobId =
        projectId + ":" + (p!.generationBatch || "legacy") + ":" + moduleId;
      const old = await db()
        .prepare(
          "SELECT status, result, updated_at FROM generation_jobs WHERE id = ? AND owner_id = ?",
        )
        .bind(jobId, uid)
        .first<{ status: string; result: string; updated_at: string }>();
      if (old?.status === "succeeded" && form.get("retry") !== "true")
        return Response.json({ asset: JSON.parse(old.result), reused: true });
      if (
        old?.status === "running" &&
        Date.now() - new Date(old.updated_at).getTime() < IMAGE_JOB_LEASE_MS
      )
        return Response.json(
          { error: "这一张正在处理中，请稍后刷新查看。" },
          { status: 409 },
        );
      const now = new Date().toISOString();
      const lock = await db()
        .prepare(
          "INSERT INTO generation_jobs (id, owner_id, project_id, module_id, status, result, error, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, error = NULL, updated_at = excluded.updated_at WHERE generation_jobs.owner_id = excluded.owner_id AND (generation_jobs.status != ? OR generation_jobs.updated_at < ?)",
        )
        .bind(
          jobId,
          uid,
          projectId,
          moduleId,
          "running",
          now,
          "running",
          new Date(Date.now() - IMAGE_JOB_LEASE_MS).toISOString(),
        )
        .run();
      if (!lock.meta.changes)
        return Response.json({ error: "任务已经在处理中。" }, { status: 409 });
    }
    const usage = await db()
      .prepare(
        "SELECT COALESCE(SUM(bytes),0) AS total FROM assets WHERE owner_id = ?",
      )
      .bind(uid)
      .first<{ total: number }>();
    if ((usage?.total || 0) > 290 * 1024 * 1024)
      throw new Error("试用素材空间已满，请先整理存储再生成。");
    const output = await editProduct(uid, images, prompt, { kind: imageKind });
    const size = imageDimensions(output.bytes, output.mime);
    const id = crypto.randomUUID();
    const key = uid + "/" + id;
    await bucket().put(key, output.bytes, {
      httpMetadata: { contentType: output.mime },
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
          test ? "API试生成" : (p!.info.name + " · AI素材").slice(0, 200),
          output.mime,
          output.bytes.length,
          new Date().toISOString(),
        )
        .run();
    } catch (e) {
      await bucket().delete(key);
      throw e;
    }
    const asset: Asset = {
      id,
      url: "/api/assets/" + id,
      name: test ? "API试生成" : p!.info.name + " · AI素材",
      width: size.width,
      height: size.height,
      role: "整体",
      generated: true,
    };
    if (jobId)
      await db()
        .prepare(
          "UPDATE generation_jobs SET status = ?, result = ?, error = NULL, updated_at = ? WHERE id = ? AND owner_id = ?",
        )
        .bind(
          "succeeded",
          JSON.stringify(asset),
          new Date().toISOString(),
          jobId,
          uid,
        )
        .run();
    return Response.json({ asset, model: output.model });
  } catch (e) {
    const message =
      e instanceof Response
        ? "需要登录后使用图片API。"
        : (e as Error).message || "生成失败，请重试。";
    if (jobId && uid) {
      try {
        await db()
          .prepare(
            "UPDATE generation_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
          )
          .bind(
            "failed",
            message.slice(0, 400),
            new Date().toISOString(),
            jobId,
            uid,
          )
          .run();
      } catch {}
    }
    if (e instanceof Response) return e;
    return Response.json({ error: message }, { status: 502 });
  }
}
