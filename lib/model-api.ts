import { getEncryptionSecret } from "./server-secrets";
import { db } from "./server-store";
import type { ImageProtocol, ImageQuality, ImageResolution } from "./model-connection";
import {
  publicHttps,
  normalizeModelBase,
  providerError,
  inspectModelList,
  customAPIEndpoint,
  imageRequestParameters,
  IMAGE_GENERATION_TIMEOUT_MS,
} from "./model-connection";
export { publicHttps, normalizeModelBase } from "./model-connection";
export type ModelSettings = {
  protocol: ImageProtocol;
  baseUrl: string;
  model: string;
  textModel: string;
  imageQuality: ImageQuality;
  imageResolution: ImageResolution;
  encryptedKey: string;
  keyHint: string;
};
const encode = (bytes: Uint8Array) => {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
const decode = (value: string) =>
  Uint8Array.from(atob(value), (v) => v.charCodeAt(0));
async function encryptionKey() {
  const secret = getEncryptionSecret();
  if (!secret) throw new Error("密钥加密服务尚未配置，请联系管理员。");
  return crypto.subtle.importKey(
    "raw",
    decode(secret),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptSecret(value: string, uid: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(uid) },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return encode(iv) + "." + encode(new Uint8Array(encrypted));
}
async function decryptSecret(value: string, uid: string) {
  const [iv, data] = value.split(".");
  const result = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(iv),
      additionalData: new TextEncoder().encode(uid),
    },
    await encryptionKey(),
    decode(data),
  );
  return new TextDecoder().decode(result);
}
export async function settingsFor(uid: string) {
  return db()
    .prepare(
      "SELECT 'custom' AS protocol, base_url AS baseUrl, model, text_model AS textModel, image_quality AS imageQuality, image_resolution AS imageResolution, encrypted_key AS encryptedKey, key_hint AS keyHint FROM model_settings WHERE owner_id = ? AND protocol IN ('custom', 'openai')",
    )
    .bind(uid)
    .first<ModelSettings>();
}
export async function limitedBytes(response: Response, max = 12 * 1024 * 1024) {
  if (Number(response.headers.get("content-length") || 0) > max)
    throw new Error("接口返回内容超过限制。");
  if (!response.body) throw new Error("接口没有返回内容。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let len = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    len += value.length;
    if (len > max) {
      await reader.cancel();
      throw new Error("接口返回内容超过限制。");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
export async function probeModelConnection(uid: string) {
  const settings = await settingsFor(uid);
  if (!settings) throw new Error("请先保存自定义 API 配置。");
  const baseUrl = normalizeModelBase(settings.baseUrl);
  const key = await decryptSecret(settings.encryptedKey, uid);
  let response: Response;
  try {
    response = await fetch(customAPIEndpoint(baseUrl, "models"), {
      headers: { Authorization: "Bearer " + key, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error(
      (e as Error).name === "TimeoutError"
        ? "连接检测超过 20 秒，请检查服务商状态。"
        : "无法连接模型列表接口，请检查地址、网络或重定向配置。",
    );
  }
  const raw = new TextDecoder().decode(
    await limitedBytes(response, 2 * 1024 * 1024),
  );
  if (!response.ok)
    throw providerError(
      response.status,
      raw,
      key,
      response.headers.get("cf-ray") || "",
    );
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(
      "接口返回网页或其他非 JSON 内容，请检查 Base URL；尚未验证图片生成。",
    );
  }
  if ((payload as { error?: unknown })?.error)
    throw providerError(response.status, raw, key);
  return { ...inspectModelList(payload, settings.model, settings.textModel), baseUrl };
}

export class CopyAPIError extends Error {}

export async function completeCopy(
  uid: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{ content: string; model: string }> {
  const settings = await settingsFor(uid);
  if (!settings?.textModel)
    throw new CopyAPIError("请先在“自定义 API”中填写并保存文案模型名称。");
  const key = await decryptSecret(settings.encryptedKey, uid);
  let response: Response;
  let raw: string;
  try {
    response = await fetch(customAPIEndpoint(settings.baseUrl, "chat/completions"), {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: settings.textModel,
        messages,
        stream: false,
        max_tokens: 4096,
        ...(new URL(settings.baseUrl).hostname === "api.b.ai" && settings.textModel.toLowerCase() === "deepseek-v4.1-flash"
          ? { reasoning_effort: "low" }
          : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });
    raw = new TextDecoder().decode(await limitedBytes(response, 1024 * 1024));
  } catch (e) {
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError")
      throw new CopyAPIError("文案接口超过 60 秒未完成，请稍后检查服务商结果再重试。");
    if ((e as Error).message === "接口返回内容超过限制。")
      throw new CopyAPIError("文案接口返回内容超过限制。");
    throw new CopyAPIError("无法连接文案 API，请检查接口地址、网络和服务商状态。");
  }
  if (!response.ok)
    throw new CopyAPIError(providerError(response.status, raw, key, response.headers.get("cf-ray") || "").message);
  let payload: {
    error?: unknown;
    choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new CopyAPIError("文案接口返回了非 JSON 内容，请检查 Base URL 和文案模型名称。");
  }
  if (!payload || typeof payload !== "object")
    throw new CopyAPIError("文案接口没有返回可用内容。");
  if (payload.error) throw new CopyAPIError(providerError(response.status, raw, key).message);
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new CopyAPIError("模型返回的文案不完整，请重试或调整文案模型。");
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new CopyAPIError("文案模型没有返回文字，请确认所填模型支持聊天补全接口。");
  return { content: content.trim(), model: settings.textModel };
}
export async function editProduct(
  uid: string,
  images: File[],
  prompt: string,
  options: { kind?: "main" | "detail" } = {},
) {
  const settings = await settingsFor(uid);
  if (!settings) throw new Error("请先在“自定义 API”中保存兼容图片编辑的接口。");
  const key = await decryptSecret(settings.encryptedKey, uid);
  const base = normalizeModelBase(settings.baseUrl);
  let response: Response;
  try {
    const form = new FormData();
    form.set("model", settings.model);
    form.set("prompt", prompt);
    const parameters = imageRequestParameters(settings, options);
    form.set("size", parameters.size);
    if (parameters.quality) form.set("quality", parameters.quality);
    form.set("n", "1");
    for (const [i, file] of images.entries())
      form.append(images.length === 1 ? "image" : "image[]", file, "product-" + i + ".jpg");
    response = await fetch(customAPIEndpoint(base, "images/edits"), {
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer " + key },
      body: form,
      signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS),
    });
  } catch (e) {
    if (
      (e as Error).name === "TimeoutError" ||
      (e as Error).name === "AbortError"
    )
      throw new Error(
        "图片接口超过6分钟未完成。请在服务商后台确认结果后再重试，避免重复计费。",
      );
    throw new Error("无法连接图片API，请检查地址、网络和服务商状态。");
  }
  const raw = await limitedBytes(
    response,
    response.ok ? 18 * 1024 * 1024 : 1024 * 1024,
  );
  const rawText = new TextDecoder().decode(raw);
  if (!response.ok)
    throw providerError(
      response.status,
      rawText,
      key,
      response.headers.get("cf-ray") || "",
    );
  let payload: {
    data?: { b64_json?: string; url?: string; error?: unknown }[];
    error?: unknown;
    code?: string;
  };
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error("接口返回了非JSON内容，请检查是否填写了正确的图片接口。");
  }
  if (payload.error || payload.code)
    throw providerError(response.status, rawText, key);
  const item = payload.data?.[0];
  if (item?.error)
    throw providerError(response.status, JSON.stringify({ error: item.error }), key);
  let bytes: Uint8Array;
  if (item?.b64_json) {
    bytes = decode(item.b64_json);
    if (bytes.length > 12 * 1024 * 1024) throw new Error("生成图片超过12MB。");
  } else {
    const url = item?.url;
    if (!url)
      throw new Error(
        "接口没有返回图片；此协议需要支持图像编辑，聊天接口不能替代。",
      );
    const publicUrl = publicHttps(url, true);
    const output = await fetch(publicUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!output.ok)
      throw new Error("生成成功，但下载图片失败，请检查服务商结果。");
    bytes = await limitedBytes(output);
  }
  let mime = "";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e)
    mime = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = "image/jpeg";
  else if (
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  )
    mime = "image/webp";
  if (!mime) throw new Error("服务商返回的文件不是可识别的图片。");
  return { bytes, mime, model: settings.model };
}
