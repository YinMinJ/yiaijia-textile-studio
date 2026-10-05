import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  AUTHENTICATION_ERROR,
  ensureBootstrapAdmin,
  isSameOriginRequest,
  loginWithPassword,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "../../../../lib/auth-core.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8192;

async function readCredentials(request: Request): Promise<{ email: unknown; password: unknown }> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new Error("invalid-body");
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error("invalid-body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid-body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("invalid-body");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid-body");
  const record = body as Record<string, unknown>;
  return { email: record.email, password: record.password };
}

function json(body: object, status: number, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) return json({ error: "请求来源不受信任，请从本站重新登录。" }, 403);
    let credentials: { email: unknown; password: unknown };
    try {
      credentials = await readCredentials(request);
    } catch {
      return json({ error: AUTHENTICATION_ERROR }, 400);
    }
    await ensureBootstrapAdmin();
    const cookieStore = await cookies();
    const result = await loginWithPassword(credentials.email, credentials.password, {
      previousToken: cookieStore.get(SESSION_COOKIE_NAME)?.value,
    });
    if (!result.ok) {
      if (result.reason === "rate-limited") {
        return json({ error: "登录尝试过于频繁，请稍后再试。", retryAfter: result.retryAfter }, 429, { "Retry-After": String(result.retryAfter) });
      }
      return json({ error: AUTHENTICATION_ERROR }, 401);
    }
    const response = json({ ok: true }, 200);
    response.cookies.set(SESSION_COOKIE_NAME, result.token, {
      ...sessionCookieOptions(),
      expires: new Date(result.expiresAt),
    });
    return response;
  } catch {
    // Never return credentials, SQL errors, or environment values to a browser.
    console.error("登录服务无法处理请求；请检查服务器认证配置与数据目录。");
    return json({ error: "登录服务暂不可用，请联系管理员。" }, 503);
  }
}
