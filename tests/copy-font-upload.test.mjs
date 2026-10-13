import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function fixture() {
  const source = (await readFile(new URL("../frontend/useCopyFonts.ts", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace("export function useCopyFonts", "function useCopyFonts");
  const compiled = ts.transpileModule(`export function create(env) { const { ref, appPath, fetch, FontFace } = env; ${source}; return useCopyFonts(); }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  const { create } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputText).toString("base64"));
  const state = { calls: [], invalid: false, respond: async () => Response.json({ fonts: [] }) };
  const fonts = create({
    ref: value => ({ value }), appPath: value => "/zhijing" + value,
    fetch: (url, options) => { state.calls.push({ url, options }); return state.respond(url, options); },
    FontFace: class { async load() { if (state.invalid) throw Error("invalid"); return this; } },
  });
  return { state, fonts };
}

test("font uploads validate locally before transmission and retain library after an upstream failure", async () => {
  const { state, fonts } = await fixture();
  const file = new File(["font bytes"], "BrandFont.woff2");
  await assert.rejects(fonts.upload(new File(["x"], "bad.svg")), /字体文件/);
  state.invalid = true;
  await assert.rejects(fonts.upload(file), /无法读取/);
  assert.equal(state.calls.length, 0);
  state.invalid = false;
  const existing = { id: "existing", name: "Existing", url: "/api/fonts/existing" };
  fonts.fonts.value = [existing];
  state.respond = async () => Response.json({ error: "字体空间已满" }, { status: 413 });
  await assert.rejects(fonts.upload(file), /字体空间已满/);
  assert.deepEqual(fonts.fonts.value, [existing]);
  assert.equal(state.calls[0].url, "/zhijing/api/fonts");
  assert.equal(state.calls[0].options.method, "POST");
  assert.equal(state.calls[0].options.body.get("file").name, file.name);
});

test("a late font library response preserves the newly uploaded font and failed listing can retry", async () => {
  const { state, fonts } = await fixture();
  let resolveList;
  const uploaded = { id: "55e94b80-eef6-4cc4-9f4f-ae08b2cb4f75", name: "My font", url: "/api/fonts/55e94b80-eef6-4cc4-9f4f-ae08b2cb4f75" };
  state.respond = async (_url, options) => options.method === "POST" ? Response.json({ font: uploaded }) : new Promise(resolve => { resolveList = resolve; });
  const pending = fonts.load();
  assert.equal(await fonts.upload(new File(["font bytes"], "My font.ttf")), `custom:${uploaded.id}`);
  resolveList(Response.json({ fonts: [] }));
  await pending;
  assert.deepEqual(fonts.fonts.value, [uploaded]);
  const next = await fixture();
  next.state.respond = async () => Response.json({ error: "暂时不可用" }, { status: 503 });
  await next.fonts.load();
  assert.match(next.fonts.error.value, /暂时不可用/);
  next.state.respond = async () => Response.json({ fonts: [uploaded] });
  await next.fonts.load();
  assert.equal(next.fonts.error.value, "");
  assert.deepEqual(next.fonts.fonts.value, [uploaded]);
});

test("font network timeouts show an actionable localized message without automatic uploads", async () => {
  const { state, fonts } = await fixture();
  state.respond = async () => { throw new DOMException("signal timed out", "TimeoutError"); };
  await fonts.load();
  assert.match(fonts.error.value, /重新读取/);
  assert.doesNotMatch(fonts.error.value, /signal timed out/);
  await assert.rejects(fonts.upload(new File(["font bytes"], "Custom.woff2")), /先重新读取字体列表查看结果/);
  assert.equal(state.calls.length, 2, "timeouts do not automatically duplicate an upload");
});
