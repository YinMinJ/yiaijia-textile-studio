import { owner, checkOrigin } from "@/lib/server-store";
import { probeModelConnection } from "@/lib/model-api";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const uid = await owner();
    return Response.json(await probeModelConnection(uid));
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json(
      { error: (e as Error).message || "连接检测失败。" },
      { status: 502 },
    );
  }
}
