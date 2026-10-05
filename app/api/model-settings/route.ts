import { z } from "zod";
import { owner, db, errorResponse, checkOrigin } from "@/lib/server-store";
import {
  encryptSecret,
  settingsFor,
  normalizeModelBase,
} from "@/lib/model-api";
import { defaultTextModel } from "@/lib/model-connection";
const schema = z.object({
  protocol: z.literal("custom").default("custom"),
  baseUrl: z.string().trim().url().max(500),
  model: z.string().trim().min(1).max(100),
  textModel: z.string().trim().max(100).optional(),
  apiKey: z.string().trim().max(1024),
});
export async function GET() {
  try {
    const uid = await owner();
    const s = await settingsFor(uid);
    return Response.json(
      s
        ? {
            configured: true,
            protocol: s.protocol,
            baseUrl: s.baseUrl,
            model: s.model,
            textModel: s.textModel,
            keyHint: s.keyHint,
          }
        : { configured: false },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const uid = await owner();
    const raw = await request.text();
    if (raw.length > 4000) return new Response("Too large", { status: 413 });
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return Response.json(
        { error: "请检查接口地址、模型名称和密钥。" },
        { status: 400 },
      );
    const input = parsed.data;
    let base: string;
    try {
      base = normalizeModelBase(input.baseUrl);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    const old = await settingsFor(uid);
    const textModel = input.textModel ?? old?.textModel ?? defaultTextModel(base);
    if (!input.apiKey && !old)
      return Response.json(
        { error: "首次配置自定义 API 需要填写 API Key。" },
        { status: 400 },
      );
    if (
      old &&
      !input.apiKey &&
      normalizeModelBase(old.baseUrl) !== base
    )
      return Response.json(
        { error: "更换接口地址时请重新输入对应密钥。" },
        { status: 400 },
      );
    const encrypted = input.apiKey
      ? await encryptSecret(input.apiKey, uid)
      : old!.encryptedKey;
    const hint = input.apiKey ? input.apiKey.slice(-4) : old!.keyHint;
    await db()
      .prepare(
        "INSERT INTO model_settings (owner_id, protocol, base_url, model, text_model, encrypted_key, key_hint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET protocol = excluded.protocol, base_url = excluded.base_url, model = excluded.model, text_model = excluded.text_model, encrypted_key = excluded.encrypted_key, key_hint = excluded.key_hint, updated_at = excluded.updated_at",
      )
      .bind(
        uid,
        input.protocol,
        base,
        input.model,
        textModel,
        encrypted,
        hint,
        new Date().toISOString(),
      )
      .run();
    return Response.json({
      configured: true,
      protocol: input.protocol,
      baseUrl: base,
      model: input.model,
      textModel,
      keyHint: hint,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
