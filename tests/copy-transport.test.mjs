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
  respond: () => { throw new Error("No test response configured"); },
};
globalThis.__copyTransportTest = state;
const source = (await readFile(new URL("../lib/model-api.ts", import.meta.url), "utf8"))
  .replace('import { getEncryptionSecret } from "./server-secrets";', 'const getEncryptionSecret = () => globalThis.__copyTransportTest.secret;')
  .replace('import { db } from "./server-store";', 'const db = () => ({prepare: () => ({bind: () => ({first: async () => globalThis.__copyTransportTest.settings})})});')
  .replace(/import \{\s+publicHttps,[\s\S]*?\} from "\.\/model-connection";/, 'const {publicHttps, normalizeModelBase, providerError, inspectModelList, customAPIEndpoint} = globalThis.__copyTransportTest.connection;')
  .replace('export { publicHttps, normalizeModelBase } from "./model-connection";', '')
  + '\nconst fetch = async (...args) => { globalThis.__copyTransportTest.requests.push(args); return globalThis.__copyTransportTest.respond(...args); };';
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { completeCopy, encryptSecret, CopyAPIError } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
const key = "test-only-private-key";
const settings = {
  protocol: "custom", baseUrl: "https://api.b.ai/v1/images/edits", model: "gpt-image-2", textModel: "DeepSeek-V4.1-Flash",
  encryptedKey: await encryptSecret(key, "test-owner"), keyHint: "-key",
};
const messages = [{ role: "system", content: "Return JSON" }, { role: "user", content: "Example product" }];
function reset() { state.settings = { ...settings }; state.requests = []; }

test("copy transport uses saved text model and same encrypted credential at chat endpoint without sending image model", async () => {
  reset();
  state.respond = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: ' {"copies":[]} ' } }] });
  assert.deepEqual(await completeCopy("test-owner", messages), { content: '{"copies":[]}', model: "DeepSeek-V4.1-Flash" });
  assert.equal(state.requests.length, 1);
  const [url, request] = state.requests[0];
  assert.equal(url, "https://api.b.ai/v1/chat/completions");
  assert.equal(request.headers.Authorization, "Bearer " + key);
  assert.equal(request.redirect, "error");
  assert.deepEqual(JSON.parse(request.body), { model: "DeepSeek-V4.1-Flash", messages, stream: false, max_tokens: 4096, reasoning_effort: "low" });
  state.settings.textModel = "deepseek-v4.1-flash";
  await completeCopy("test-owner", messages);
  assert.equal(JSON.parse(state.requests[1][1].body).reasoning_effort, "low");
  assert.equal(JSON.parse(state.requests[1][1].body).model, "deepseek-v4.1-flash");
  state.settings.baseUrl = "https://api.example.com/v1";
  await completeCopy("test-owner", messages);
  assert.equal("reasoning_effort" in JSON.parse(state.requests[2][1].body), false);
});

test("empty text-model configuration fails before any provider request", async () => {
  reset();
  state.settings.textModel = "";
  await assert.rejects(completeCopy("test-owner", messages), error => error instanceof CopyAPIError && /文案模型名称/.test(error.message));
  assert.equal(state.requests.length, 0);
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

test("timeout returns an actionable safe message and does not retry", async () => {
  reset();
  state.respond = () => { throw new DOMException("internal address", "TimeoutError"); };
  await assert.rejects(completeCopy("test-owner", messages), error => error instanceof CopyAPIError && /60 秒/.test(error.message) && !error.message.includes("internal address"));
  assert.equal(state.requests.length, 1);
});

test("non-JSON, blank and truncated model outputs are rejected without returning partial content", async () => {
  for (const result of [
    () => new Response("<html>not a chat endpoint</html>"),
    () => Response.json(null),
    () => Response.json({ choices: [{ message: { content: "   " } }] }),
    () => Response.json({ choices: [{ finish_reason: "length", message: { content: '{"copies":[' } }] }),
  ]) {
    reset();
    state.respond = result;
    await assert.rejects(completeCopy("test-owner", messages), CopyAPIError);
    assert.equal(state.requests.length, 1);
  }
});
