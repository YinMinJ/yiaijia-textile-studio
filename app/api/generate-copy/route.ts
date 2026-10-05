import { owner, checkOrigin, errorResponse } from "@/lib/server-store";
import { completeCopy, CopyAPIError } from "@/lib/model-api";
import { buildCopyMessages, copyInputSchema, parseGeneratedCopy } from "@/lib/design-copy";

const maxRequestBytes = 24 * 1024;

async function readInput(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > maxRequestBytes)
    throw Response.json({ error: "商品资料过长，请精简后重试。" }, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Response.json({ error: "请填写商品资料。" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxRequestBytes) {
      await reader.cancel();
      throw Response.json({ error: "商品资料过长，请精简后重试。" }, { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Response.json({ error: "商品资料格式不正确，请刷新页面后重试。" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const uid = await owner();
    const parsed = copyInputSchema.safeParse(await readInput(request));
    if (!parsed.success)
      return Response.json({ error: "请检查商品资料及图片计划；首图文案需手动填写。" }, { status: 400 });
    let result: { content: string; model: string };
    try { result = await completeCopy(uid, buildCopyMessages(parsed.data)); }
    catch (error) {
      const message = error instanceof CopyAPIError
        ? error.message
        : "文案模型暂时无法完成生成，请检查自定义 API 的文案模型设置后重试。";
      return Response.json({ error: message + " 原文案已保留。" }, { status: 502 });
    }
    try {
      return Response.json({ copies: parseGeneratedCopy(result.content, parsed.data), model: result.model });
    } catch {
      return Response.json({ error: "模型返回的文案不完整或格式不正确，请重试；原文案已保留。" }, { status: 502 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
