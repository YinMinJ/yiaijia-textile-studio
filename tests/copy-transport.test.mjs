import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as connection from "../lib/model-connection.ts";

const state = {
  settings: null,
  secret: Buffer.alloc(32, 7).toString("base64"),
  connection,
  requests: [],
  timeouts: [],
  respond: () => { throw new Error("No test response configured"); },
};
globalThis.__copyTransportTest = state;
const source = (await readFile(new URL("../lib/model-api.ts", import.meta.url), "utf8"))
  .replace('import { getEncryptionSecret } from "./server-secrets";', 'const getEncryptionSecret = () => globalThis.__copyTransportTest.secret;')
  .replace('import { db } from "./server-store";', 'const db = () => ({prepare: () => ({bind: () => ({first: async () => globalThis.__copyTransportTest.settings})})});')
  .replace(/import \{\s+publicHttps,[\s\S]*?\} from "\.\/model-connection";/, 'const {publicHttps, normalizeModelBase, providerError, inspectModelList, customAPIEndpoint} = globalThis.__copyTransportTest.connection;')
  .replace('export { publicHttps, normalizeModelBase } from "./model-connection";', '')
  + '\nconst fetch = async (...args) => { globalThis.__copyTransportTest.requests.push(args); return globalThis.__copyTransportTest.respond(...args); };'
  + '\nconst AbortSignal = {timeout: milliseconds => {globalThis.__copyTransportTest.timeouts.push(milliseconds); return globalThis.AbortSignal.timeout(milliseconds);}};';
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { completeCopy, encryptSecret, CopyAPIError } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
const key = "test-only-private-key";
const settings = {
  protocol: "custom", baseUrl: "https://api.b.ai/v1/images/edits", model: "gpt-image-2", textModel: "DeepSeek-V4.1-Flash",
  encryptedKey: await encryptSecret(key, "test-owner"), keyHint: "-key",
};
const messages = [{ role: "system", content: "Return JSON" }, { role: "user", content: "Example product" }];
function reset(overrides = {}) {
  state.settings = { ...settings, ...overrides };
  state.requests = [];
  state.timeouts = [];
  state.respond = () => { throw new Error("No test response configured"); };
}

function assistantOutput(text, overrides = {}) {
  return {
    type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text }], ...overrides,
  };
}

function completedResponse(text = ' {"copies":[]} ') {
  return { status: "completed", output: [assistantOutput(text)] };
}

test("B.AI DeepSeek copy transport preserves the saved model and credential at the Responses endpoint", async () => {
  for (const textModel of ["DeepSeek-V4.1-Flash", "deepseek-v4.1-flash", "DEEPSEEK-V4.1-FLASH"]) {
    reset({ textModel });
    state.respond = () => Response.json(completedResponse());
    assert.deepEqual(await completeCopy("test-owner", messages), { content: '{"copies":[]}', model: textModel });
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.timeouts, [60_000]);
    const [url, request] = state.requests[0];
    assert.equal(url, "https://api.b.ai/v1/responses");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.Authorization, "Bearer " + key);
    assert.equal(request.headers["Content-Type"], "application/json");
    assert.equal(request.redirect, "error");
    assert.deepEqual(JSON.parse(request.body), {
      model: textModel, input: messages, stream: false,
      max_output_tokens: 4096, reasoning: { effort: "none" },
    });
  }
});

test("Responses text comes from completed assistant messages and joins split output_text blocks", async () => {
  reset();
  state.respond = () => Response.json({
    status: "completed",
    output_text: "Ignore this nonstandard top-level shortcut",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "Private reasoning is not copy" }] },
      assistantOutput(undefined, { content: [
        { type: "output_text", text: ' {"co' },
        { type: "output_text", text: 'pies":' },
      ] }),
      { type: "function_call", name: "not_copy", arguments: "not assistant text" },
      assistantOutput("[]} "),
    ],
  });
  assert.deepEqual(await completeCopy("test-owner", messages), { content: '{"copies":[]}', model: "DeepSeek-V4.1-Flash" });
  assert.equal(state.requests.length, 1);
});

test("other hosts and other models retain the generic chat request without B.AI parameters", async () => {
  for (const overrides of [
    { baseUrl: "https://api.example.com/v1" },
    { baseUrl: "https://api.b.ai.example.com/v1/images/edits" },
    { textModel: "another-text-model" },
    { textModel: "deepseek-v4.1-flash-extra" },
  ]) {
    reset(overrides);
    state.respond = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: ' {"copies":[]} ' } }] });
    assert.deepEqual(await completeCopy("test-owner", messages), { content: '{"copies":[]}', model: state.settings.textModel });
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.timeouts, [60_000]);
    const [url, request] = state.requests[0];
    assert.equal(url, connection.customAPIEndpoint(state.settings.baseUrl, "chat/completions"));
    assert.equal(request.headers.Authorization, "Bearer " + key);
    assert.equal(request.redirect, "error");
    assert.deepEqual(JSON.parse(request.body), {
      model: state.settings.textModel, messages, stream: false, max_tokens: 4096,
    });
  }
});

test("empty text-model configuration fails before any provider request", async () => {
  for (const textModel of ["", null, undefined]) {
    reset({ textModel });
    await assert.rejects(completeCopy("test-owner", messages), error => error instanceof CopyAPIError && /文案模型名称/.test(error.message));
    assert.equal(state.requests.length, 0);
  }
});

test("upstream error details redact the saved credential and never trigger retries", async () => {
  reset();
  state.respond = () => Response.json({ error: { message: `Invalid ${key} Bearer private-value https://signed.example.com?token=123` } }, { status: 401 });
  await assert.rejects(completeCopy("test-owner", messages), error => {
    assert.ok(error instanceof CopyAPIError);
    assert.match(error.message, /鉴权失败/);
    assert.doesNotMatch(error.message, /test-only-private-key|private-value|token=123/);
    return true;
  });
  assert.equal(state.requests.length, 1);
});

test("timeout returns an actionable safe message and does not retry or fall back to chat", async () => {
  for (const name of ["TimeoutError", "AbortError"]) {
    reset();
    state.respond = () => { throw new DOMException("internal address", name); };
    await assert.rejects(completeCopy("test-owner", messages), error => error instanceof CopyAPIError && /60 秒/.test(error.message) && !error.message.includes("internal address"));
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0][0], "https://api.b.ai/v1/responses");
  }
});

test("Responses rejects incomplete, failed, pending and missing top-level completion status", async () => {
  for (const status of ["incomplete", "failed", "queued", "in_progress", undefined]) {
    reset();
    state.respond = () => Response.json({ ...completedResponse(), status });
    await assert.rejects(completeCopy("test-owner", messages), CopyAPIError, `status ${status}`);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0][0], "https://api.b.ai/v1/responses");
  }
});

test("Responses rejects malformed, blank, refused or unfinished assistant content without partial output", async () => {
  const valid = assistantOutput('{"copies":[]}');
  for (const [description, payload] of [
    ["null payload", null],
    ["non-object payload", "completed"],
    ["top-level text shortcut only", { status: "completed", output_text: '{"copies":[]}' }],
    ["missing output", { status: "completed" }],
    ["null output", { status: "completed", output: null }],
    ["object output", { status: "completed", output: { message: valid } }],
    ["empty output", { status: "completed", output: [] }],
    ["reasoning only", { status: "completed", output: [{ type: "reasoning", summary: [] }] }],
    ["user message only", { status: "completed", output: [assistantOutput("not assistant text", { role: "user" })] }],
    ["incomplete assistant", { status: "completed", output: [assistantOutput("partial", { status: "incomplete" })] }],
    ["missing assistant status", { status: "completed", output: [assistantOutput("partial", { status: undefined })] }],
    ["valid then incomplete assistant", { status: "completed", output: [valid, assistantOutput("partial", { status: "incomplete" })] }],
    ["blank text", completedResponse(" \n ")],
    ["non-string text", completedResponse(42)],
    ["missing text", { status: "completed", output: [assistantOutput(undefined)] }],
    ["missing content", { status: "completed", output: [assistantOutput("ignored", { content: undefined })] }],
    ["object content", { status: "completed", output: [assistantOutput("ignored", { content: { text: "malformed" } })] }],
    ["refusal", { status: "completed", output: [assistantOutput("ignored", { content: [{ type: "refusal", refusal: "Cannot comply" }] })] }],
    ["text and refusal", { status: "completed", output: [assistantOutput("ignored", { content: [
      { type: "output_text", text: '{"copies":[]}' }, { type: "refusal", refusal: "Cannot comply" },
    ] })] }],
    ["text and malformed text", { status: "completed", output: [assistantOutput("ignored", { content: [
      { type: "output_text", text: '{"copies":[]}' }, { type: "output_text", text: 42 },
    ] })] }],
  ]) {
    reset();
    state.respond = () => Response.json(payload);
    await assert.rejects(completeCopy("test-owner", messages), CopyAPIError, description);
    assert.equal(state.requests.length, 1, description);
  }
});

test("non-JSON Responses payloads fail once without a chat fallback", async () => {
  reset();
  state.respond = () => new Response("<html>not a Responses endpoint</html>");
  await assert.rejects(completeCopy("test-owner", messages), CopyAPIError);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0][0], "https://api.b.ai/v1/responses");
});

test("generic chat still rejects non-JSON, blank and truncated outputs", async () => {
  for (const result of [
    () => new Response("<html>not a chat endpoint</html>"),
    () => Response.json(null),
    () => Response.json({ choices: [{ message: { content: "   " } }] }),
    () => Response.json({ choices: [{ finish_reason: "length", message: { content: '{"copies":[' } }] }),
  ]) {
    reset({ baseUrl: "https://api.example.com/v1" });
    state.respond = result;
    await assert.rejects(completeCopy("test-owner", messages), CopyAPIError);
    assert.equal(state.requests.length, 1);
  }
});
