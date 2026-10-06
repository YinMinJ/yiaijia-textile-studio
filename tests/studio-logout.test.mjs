import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { sampleProject } from "../lib/design-model.ts";

const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
// Run the actual composable without mounting UI or invoking lifecycle network reads.
const vue = moduleUrl(`export { ref, shallowRef, computed } from ${JSON.stringify(import.meta.resolve("vue"))}; export function onMounted() {} export function onBeforeUnmount() {}`);
const renderer = moduleUrl("export function renderBlob() { throw new Error('Unexpected rendering'); } export function downloadBlob() { throw new Error('Unexpected download'); }");
const imports = {
  vue,
  fflate: import.meta.resolve("fflate"),
  "../lib/design-renderer": renderer,
};
const source = (await readFile(new URL("../frontend/useStudio.ts", import.meta.url), "utf8"))
  .replace(/from (['"])([^'"]+)\1/g, (_, quote, name) => `from ${JSON.stringify(imports[name] || new URL(name + ".ts", import.meta.url).href)}`);
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { useStudio } = await import(moduleUrl(outputText));

async function withStudio(mode, work) {
  const previous = {
    mode: process.env.NEXT_PUBLIC_APP_LOCAL_MODE,
    prefix: process.env.NEXT_PUBLIC_APP_BASE_PATH,
    fetch: globalThis.fetch,
    window: globalThis.window,
    setTimeout: globalThis.setTimeout,
  };
  process.env.NEXT_PUBLIC_APP_LOCAL_MODE = mode;
  process.env.NEXT_PUBLIC_APP_BASE_PATH = "/zhijing";
  const calls = [], navigations = [];
  globalThis.window = { location: { assign: url => navigations.push(url) } };
  globalThis.setTimeout = (...arguments_) => { const timer = previous.setTimeout(...arguments_); timer.unref(); return timer; };
  globalThis.fetch = async (url, options) => { calls.push({ url, method: options?.method }); return Response.json({ ok: true }); };
  const studio = useStudio();
  studio.project.value = { ...sampleProject(), sample: false };
  try { await work({ studio, calls, navigations }); }
  finally {
    if (previous.mode === undefined) delete process.env.NEXT_PUBLIC_APP_LOCAL_MODE;
    else process.env.NEXT_PUBLIC_APP_LOCAL_MODE = previous.mode;
    if (previous.prefix === undefined) delete process.env.NEXT_PUBLIC_APP_BASE_PATH;
    else process.env.NEXT_PUBLIC_APP_BASE_PATH = previous.prefix;
    globalThis.fetch = previous.fetch;
    globalThis.window = previous.window;
    globalThis.setTimeout = previous.setTimeout;
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("local mode never sends a logout request", async () => {
  await withStudio("1", async ({ studio, calls, navigations }) => {
    studio.requestLogout();
    await settle();
    assert.deepEqual(calls, []);
    assert.deepEqual(navigations, []);
  });
});

test("unsaved work waits for an explicit choice before account logout", async () => {
  await withStudio("0", async ({ studio, calls, navigations }) => {
    studio.dirty.value = true;
    studio.requestLogout();
    assert.equal(studio.pendingIntent.value, "logout");
    assert.equal(typeof studio.pendingSwitch.value, "function");
    assert.deepEqual(calls, []);
    assert.equal(studio.dirty.value, true);
    await studio.finishProjectSwitch(false);
    await settle();
    assert.deepEqual(calls, [{ url: "/zhijing/api/auth/logout", method: "POST" }]);
    assert.deepEqual(navigations, ["/zhijing/login"]);
    assert.equal(studio.dirty.value, false);
  });
});

test("a failed save retains the pending logout and unsaved project", async () => {
  await withStudio("0", async ({ studio, calls, navigations }) => {
    globalThis.fetch = async (url, options) => { calls.push({ url, method: options.method }); return Response.json({ error: "保存失败" }, { status: 503 }); };
    studio.dirty.value = true;
    studio.requestLogout();
    await studio.finishProjectSwitch(true);
    assert.deepEqual(calls, [{ url: "/zhijing/api/projects", method: "POST" }]);
    assert.equal(studio.dirty.value, true);
    assert.equal(typeof studio.pendingSwitch.value, "function");
    assert.deepEqual(navigations, []);
  });
});

test("save-and-logout persists the work before revoking the session", async () => {
  await withStudio("0", async ({ studio, calls, navigations }) => {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, method: options.method });
      return Response.json(url.endsWith("/projects") ? { project: studio.project.value, projects: [studio.project.value] } : { ok: true });
    };
    studio.dirty.value = true;
    studio.requestLogout();
    await studio.finishProjectSwitch(true);
    await settle();
    assert.deepEqual(calls.map(call => call.url), ["/zhijing/api/projects", "/zhijing/api/auth/logout"]);
    assert.deepEqual(navigations, ["/zhijing/login"]);
    assert.equal(studio.dirty.value, false);
  });
});

test("logout failure preserves dirty work and stays in the workbench", async () => {
  await withStudio("0", async ({ studio, navigations }) => {
    globalThis.fetch = async () => Response.json({ error: "退出失败" }, { status: 503 });
    studio.dirty.value = true;
    studio.requestLogout();
    await studio.finishProjectSwitch(false);
    await settle();
    assert.equal(studio.dirty.value, true);
    assert.deepEqual(navigations, []);
    assert.equal(studio.notice.value?.type, "error");
  });
});

test("active work prevents logout before opening the save dialog", async () => {
  await withStudio("0", async ({ studio, calls }) => {
    studio.busy.value = "正在生成首图";
    studio.dirty.value = true;
    studio.requestLogout();
    await settle();
    assert.equal(studio.pendingSwitch.value, null);
    assert.deepEqual(calls, []);
  });
});
