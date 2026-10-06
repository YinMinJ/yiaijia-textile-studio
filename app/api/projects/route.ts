import { z } from "zod";
import { owner, db, errorResponse, checkOrigin } from "@/lib/server-store";
const bounded = z.string().max(200);
const info = z.object({
  brand: bounded,
  name: bounded.min(1),
  subtitle: bounded,
  material: bounded,
  filling: bounded,
  size: bounded,
  weight: bounded,
  colors: bounded,
  care: bounded,
  sellingPoints: z.string().max(600),
  setContents: bounded.optional(),
});
const asset = z.object({
  id: z.string().max(80),
  url: z.string().max(250),
  name: bounded,
  width: z.number().min(1).max(50000),
  height: z.number().min(1).max(50000),
  role: z.enum(["整体", "细节", "颜色", "其他", "叠放", "填充", "工艺", "被套", "床单", "枕套"]),
  generated: z.boolean().optional(),
});
const module = z.object({
  id: z.string().max(40),
  kind: z.enum(["main", "detail"]),
  index: z.number().int().min(1).max(7),
  title: z.string().max(60),
  subtitle: z.string().max(160),
  imageId: z.string().max(80),
  imageId2: z.string().max(80),
  cropX: z.number().min(0).max(100),
  cropY: z.number().min(0).max(100),
  imageZoom: z.number().min(1).max(2).optional(),
  layout: z.number().int().min(0).max(11),
  section: z.enum(["hero", "benefits", "texture", "filling", "pattern", "components", "craft", "scene", "colors", "specs", "care"]).optional(),
  composition: z.enum(["auto", "immersive", "split", "minimal"]).optional(),
  sourceImageId: z.string().max(80).optional(),
  sourceImageId2: z.string().max(80).optional(),
  aiStatus: z.enum(["pending", "succeeded", "failed"]).optional(),
  aiError: z.string().max(400).optional(),
});
const project = z.object({
  id: z.string().uuid(),
  info,
  template: z.enum(["vip", "warm", "clean", "editorial"]),
  category: z.enum(["quilt", "bedding-set"]).optional(),
  assets: z.array(asset).max(70),
  modules: z.array(module).max(12),
  status: z.enum(["draft", "ready"]),
  output: z.enum(["main", "detail"]).optional(),
  generation: z.enum(["template", "ai"]).optional(),
  generationBatch: z.string().uuid().optional(),
  workflow: z.enum(["plan", "preview", "complete"]).optional(),
});
export async function GET() {
  try {
    const uid = await owner();
    const rows = await db()
      .prepare(
        "SELECT data FROM projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100",
      )
      .bind(uid)
      .all<{ data: string }>();
    const all = rows.results.map((r) => JSON.parse(r.data));
    for (const p of all) {
      if (p.generation === "ai") {
        const jobs = await db()
          .prepare(
            "SELECT module_id, status, result, error FROM generation_jobs WHERE owner_id = ? AND project_id = ? AND id LIKE ?",
          )
          .bind(uid, p.id, p.id + ":" + (p.generationBatch || "legacy") + ":%")
          .all<{
            module_id: string;
            status: string;
            result: string;
            error: string;
          }>();
        for (const job of jobs.results) {
          const m = p.modules.find(
            (m: { id: string }) => m.id === job.module_id,
          );
          if (!m) continue;
          if (job.status === "succeeded" && job.result) {
            const a = JSON.parse(job.result);
            if (!p.assets.some((x: { id: string }) => x.id === a.id))
              p.assets.push(a);
            // Older saved projects may predate explicit source references.
            if (!m.sourceImageId && p.assets.some((x: { id: string; generated?: boolean }) => x.id === m.imageId && !x.generated))
              m.sourceImageId = m.imageId;
            m.imageId = a.id;
            m.aiStatus = "succeeded";
          } else if (job.status === "failed") {
            m.aiStatus = "failed";
            m.aiError = job.error;
          } else {
            m.aiStatus = "pending";
          }
        }
      }
    }
    return Response.json({ projects: all });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const uid = await owner();
    const raw = await request.text();
    if (raw.length > 120000)
      return Response.json({ error: "项目信息过大。" }, { status: 413 });
    const parsed = project.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json(
        { error: "请检查商品名称和模块内容。" },
        { status: 400 },
      );
    const p = parsed.data;
    const held = await db()
      .prepare("SELECT owner_id FROM projects WHERE id = ?")
      .bind(p.id)
      .first<{ owner_id: string }>();
    if (held && held.owner_id !== uid)
      return new Response("Forbidden", { status: 403 });
    for (const a of p.assets) {
      if (a.url.startsWith("/samples/")) {
        if (
          !/^\/samples\/(00224|00237|00233|00246|00229|00265-edge|00225|00240)\.jpg$/.test(
            a.url,
          )
        )
          return new Response("Invalid asset", { status: 400 });
      } else {
        const row = await db()
          .prepare("SELECT id FROM assets WHERE id = ? AND owner_id = ?")
          .bind(a.id, uid)
          .first();
        if (!row || a.url !== "/api/assets/" + a.id)
          return new Response("Invalid asset", { status: 400 });
      }
    }
    if (new Set(p.assets.map((a) => a.id)).size !== p.assets.length)
      return Response.json({ error: "素材编号重复，请重新选择素材。" }, { status: 400 });
    for (const m of p.modules) {
      for (const sourceId of [m.sourceImageId, m.sourceImageId2]) {
        if (sourceId && !p.assets.some((a) => a.id === sourceId && !a.generated))
          return Response.json({ error: "原始参考图已缺失，请重新选择实拍素材。" }, { status: 400 });
      }
    }
    const updatedAt = new Date().toISOString();
    const data = JSON.stringify({ ...p, updatedAt });
    await db()
      .prepare(
        "INSERT INTO projects (id, owner_id, name, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at WHERE projects.owner_id = excluded.owner_id",
      )
      .bind(p.id, uid, p.info.name, data, updatedAt)
      .run();
    return Response.json({ project: JSON.parse(data) });
  } catch (e) {
    return errorResponse(e);
  }
}
