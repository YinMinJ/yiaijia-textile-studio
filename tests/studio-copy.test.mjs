import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as timing from "../lib/copy-request.ts";
import * as copy from "../lib/design-copy.ts";
import { sampleProject } from "../lib/design-model.ts";
import { copyClock } from "./helpers/copy-clock.mjs";

// Execute each UI's actual handler with an isolated virtual clock and transport.
async function handlerFor(file, environment) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const start = source.indexOf("async function generateCopy()");
  const handler = source.slice(start, source.indexOf("function undoCopy()", start));
  const { outputText } = ts.transpileModule(
    `export function create(environment) { const { ${Object.keys(environment).join(", ")} } = environment; ${handler}; return generateCopy; }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  );
  const { create } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
  return create(environment);
}

async function fixture(flavor) {
  const original = sampleProject();
  const clock = copyClock();
  const state = { project: original, busy: "", result: null, calls: [], timeouts: [], respond: null };
  const project = { value: original }, busy = { value: "" }, copyBusy = { value: false }, copyRunning = { current: false };
  const environment = {
    ...timing, ...copy,
    project: flavor === "Vue" ? project : original,
    busy: flavor === "Vue" ? busy : "",
    current: { current: original }, copyBusy, copyRunning,
    signedIn: true, modelConfigured: flavor === "Vue" ? { value: true } : true,
    appPath: path => "/zhijing" + path,
    setView: () => {}, toast: { info() {}, error() {}, success() {} },
    setCopyResult: result => { state.result = result; },
    setBusy: value => { state.busy = busy.value = value; },
    patchProject: value => { state.project = project.value = value; },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    AbortSignal: { timeout: ms => { state.timeouts.push(ms); return clock.timeout(ms); } },
    fetch: (url, request) => { state.calls.push({ url, request }); return state.respond(url, request); },
  };
  const generate = await handlerFor(flavor === "Vue" ? "../frontend/useStudio.ts" : "../app/studio.tsx", environment);
  return { state, original, clock, generate, copyBusy, copyRunning };
}

for (const flavor of ["Vue", "React"]) {
  test(`${flavor} waits for slow copy, blocks duplicate submissions and keeps manual hero text`, async () => {
    const { state, original, clock, generate, copyBusy, copyRunning } = await fixture(flavor);
    const copies = original.modules.filter(copy.isAutomaticCopyModule).map(({ id }, i) => ({ id, title: `新文案${i + 1}`, subtitle: "新副标题" }));
    let finish;
    state.respond = () => new Promise(resolve => { finish = resolve; });
    const pending = generate();
    clock.advance(timing.COPY_SLOW_NOTICE_MS);
    assert.match(state.busy, /仍在等待.*请勿重复提交/);
    clock.advance(80_000);
    assert.equal(state.calls[0].request.signal.aborted, false);
    await generate();
    assert.equal(state.calls.length, 1);
    finish(Response.json({ copies, model: "qwen3.8-flash" }));
    await pending;
    assert.equal(state.result.error, undefined);
    assert.deepEqual(state.project.modules[0], original.modules[0]);
    assert.equal(state.project.modules[1].title, copies[0].title);
    assert.deepEqual(state.timeouts, [195_000]);
    assert.equal(state.busy, "");
    assert.equal(copyBusy.value, false);
    assert.equal(copyRunning.current, false);
    clock.advance(200_000);
    assert.equal(state.busy, "", "the slow notice cannot reappear after completion");
  });

  test(`${flavor} preserves original copy on server or browser deadline and never retries automatically`, async () => {
    for (const deadline of ["server", "browser"]) {
      const { state, original, clock, generate } = await fixture(flavor);
      state.respond = (_url, request) => {
        if (deadline === "server") {
          clock.advance(timing.COPY_GENERATION_TIMEOUT_MS);
          assert.equal(request.signal.aborted, false, "browser must wait for server error");
          return Response.json({ error: timing.COPY_TIMEOUT_MESSAGE + " 原文案已保留。" }, { status: 502 });
        }
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        });
      };
      const pending = generate();
      if (deadline === "browser") clock.advance(timing.COPY_CLIENT_TIMEOUT_MS);
      await pending;
      assert.equal(state.project, original);
      assert.equal(state.result.error, true);
      assert.match(state.result.message, /3 分钟.*原文案已保留/);
      assert.equal(state.calls.length, 1);
      assert.equal(state.busy, "");
      clock.advance(200_000);
      assert.equal(state.busy, "");
    }
  });
}
