export type ImageProtocol = "custom";

export function publicHttps(value: string, allowQuery = false) {
  const url = new URL(value.trim());
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (!allowQuery && !!url.search) ||
    !!url.hash ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    host.startsWith("[") ||
    /^\d+\./.test(host) ||
    /\.(local|internal|localhost|test|invalid)$/.test(host) ||
    host === "localhost" ||
    host === "metadata.google.internal"
  )
    throw new Error("请填写公开服务商的 HTTPS 接口地址，不含查询参数。");
  return url.toString().replace(/\/$/, "");
}

export function normalizeModelBase(value: string) {
  const url = new URL(publicHttps(value));
  const path = url.pathname.replace(/\/+$/, "");
  const basePath = path.replace(/\/images\/edits$/, "");
  if (/\/(images|chat|completions|responses|models)(\/|$)/.test(basePath)) {
    throw new Error(
      "请填写兼容图片编辑的 Base URL 或完整 images/edits 地址，不能填写聊天或图片生成接口。",
    );
  }
  url.pathname = path || "/v1";
  return url.toString().replace(/\/$/, "");
}

export function customAPIEndpoint(
  value: string,
  resource: "models" | "images/edits" | "chat/completions",
) {
  return (
    normalizeModelBase(value).replace(/\/images\/edits$/, "") +
    "/" +
    resource
  );
}

export function defaultTextModel(baseUrl: string) {
  return new URL(normalizeModelBase(baseUrl)).hostname === "api.b.ai"
    ? "deepseek-v4.1-flash"
    : "";
}

function safeDetail(value: unknown, secret: string) {
  if (typeof value !== "string") return "";
  let text = secret ? value.split(secret).join("[已隐藏]") : value;
  text = text
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[密钥已隐藏]")
    .replace(/data:[^\s]+/g, "[图片内容已隐藏]")
    .replace(/https?:\/\/\S+/g, "[接口地址]")
    .replace(/[\r\n\t]+/g, " ");
  return text.slice(0, 200);
}

export function providerError(
  status: number,
  body: string,
  secret = "",
  rayHeader = "",
) {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object") payload = parsed;
  } catch {
    /* HTML errors use safe generic messages. */
  }
  if (
    payload?.error_code === 1010 ||
    /error[\s:]*1010|browser_signature_banned/i.test(body)
  ) {
    const ray = String(payload.ray_id || rayHeader).match(
      /^[a-zA-Z0-9-]{1,80}$/,
    )?.[0];
    return new Error(
      "服务商防火墙拒绝了服务器请求（HTTP " +
        status +
        " / Cloudflare 1010）。请联系服务商允许 API 的服务器调用；这不能证明密钥无效。" +
        (ray ? " 排查编号：" + ray : ""),
    );
  }
  const error = payload?.error;
  const detail = safeDetail(
    error && typeof error === "object"
      ? (error as { message?: unknown }).message
      : typeof error === "string"
        ? error
        : payload?.message,
    secret,
  );
  const message =
    status === 401
      ? "接口鉴权失败，请检查 API Key。"
      : status === 403
        ? "服务商拒绝访问，请检查密钥权限、模型分组或访问限制。"
        : status === 404
          ? "未找到接口，请检查 Base URL 及服务商支持的接口路径。"
          : status === 429
            ? "接口额度不足或请求受限，请检查服务商账户。"
            : status === 400
              ? "请求参数或模型名称不匹配。"
              : status >= 500
                ? "模型服务商暂时无法处理请求。"
                : "服务商未完成请求。";
  return new Error(
    message + "（HTTP " + status + "）" + (detail ? " " + detail : ""),
  );
}

export function inspectModelList(payload: unknown, model: string, textModel = "") {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data))
    throw new Error(
      "接口没有返回 OpenAI 格式的模型列表，请核对 Base URL。尚未验证图片生成。",
    );
  const ids = data
    .map((v: unknown) => (v as { id?: unknown })?.id)
    .filter((v): v is string => typeof v === "string");
  const modelFound = ids.includes(model);
  const suggestedModel = !modelFound
    ? ids.find((id) => id.toLowerCase() === model.toLowerCase())
    : undefined;
  const textModelFound = textModel ? ids.includes(textModel) : undefined;
  const suggestedTextModel = textModel && !textModelFound
    ? ids.find((id) => id.toLowerCase() === textModel.toLowerCase())
    : undefined;
  const copyMessage = textModel
    ? textModelFound
      ? " 文案模型已在列表中找到；尚未验证文案生成。"
      : suggestedTextModel
        ? " 文案模型名称大小写与列表不一致，准确名称是：" + suggestedTextModel
        : " 列表中没有所填文案模型，请核对模型 ID 和权限。"
    : " 尚未配置文案模型。";
  return {
    connected: true,
    modelFound,
    suggestedModel,
    textModelFound,
    suggestedTextModel,
    message: (modelFound
      ? "接口和模型列表可访问，已找到所填模型。尚未验证图片编辑能力；可再进行单图试生成。"
      : suggestedModel
        ? "接口可访问，模型名称大小写与列表不一致。列表中的准确名称是：" +
          suggestedModel
        : "接口可访问，但模型列表没有所填名称。请核对服务商的准确模型 ID 和权限；尚未验证图片编辑能力。") + copyMessage,
  };
}
