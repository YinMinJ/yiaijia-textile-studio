import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isSameOriginRequest, revokeSession, SESSION_COOKIE_NAME, sessionCookieOptions } from "../../../../lib/auth-core.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: "请求来源不受信任。" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const cookieStore = await cookies();
    revokeSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      ...sessionCookieOptions(),
      expires: new Date(0),
      maxAge: 0,
    });
    return response;
  } catch {
    console.error("退出登录失败；请检查服务器认证配置与数据目录。");
    return NextResponse.json({ error: "暂时无法退出登录，请重试。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
