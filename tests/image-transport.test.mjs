import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as connection from "../lib/model-connection.ts";

const state = {
  settings: null,
  secret: Buffer.alloc(32, 9).toString("base64"),
  connection,
  requests: [],
  timeouts: [],
  respond: () => { throw new Error("No test response configured"); },
};
globalThis.__imageTransportTest = state;
const source = (await readFile(new URL("../lib/model-api.ts", import.meta.url), "utf8"))
  .replace('import { getEncryptionSecret } from "./server-secrets";', 'const getEncryptionSecret = () => globalThis.__imageTransportTest.secret;')
  .replace('import { db } from "./server-store";', 'const db = () => ({prepare: () => ({bind: () => ({first: async () => globalThis.__imageTransportTest.settings})})});')
  .replace('from "./copy-request"', `from ${JSON.stringify(new URL("../lib/copy-request.ts", import.meta.url).href)}`)
  .replace(/import \{\s+publicHttps,[\s\S]*?\} from "\.\/model-connection";/, 'const {publicHttps, normalizeModelBase, providerError, inspectModelList, customAPIEndpoint, imageRequestParameters, IMAGE_GENERATION_TIMEOUT_MS} = globalThis.__imageTransportTest.connection;')
  .replace('export { publicHttps, normalizeModelBase } from "./model-connection";', '')
  + '\nconst fetch = async (...args) => { globalThis.__imageTransportTest.requests.push(args); return globalThis.__imageTransportTest.respond(...args); };'
  + '\nconst AbortSignal = {timeout: milliseconds => {globalThis.__imageTransportTest.timeouts.push(milliseconds); return globalThis.AbortSignal.timeout(milliseconds);}};';
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { editProduct, encryptSecret } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
const key = "image-transport-test-private-key";
const settings = {
  protocol: "custom", baseUrl: "https://api.b.ai/v1/images/edits", model: "gpt-image-2", textModel: "deepseek-v4.1-flash",
  encryptedKey: await encryptSecret(key, "test-owner"), keyHint: "-key",
};
const image = new File([new Uint8Array([0xff, 0xd8, 0xff])], "test-product.jpg", { type: "image/jpeg" });
const outputBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
function reset(overrides = {}) {
  state.settings = { ...settings, ...overrides };
  state.requests = [];
  state.timeouts = [];
  state.respond = () => Response.json({ data: [{ b64_json: Buffer.from(outputBytes).toString("base64") }] });
}

test("legacy image settings send the compatible square edit request without a quality parameter", async () => {
  reset();
  const output = await editProduct("test-owner", [image], "Keep the real product");
  assert.equal(state.requests.length, 1);
  assert.deepEqual(state.timeouts, [360000]);
  const [url, request] = state.requests[0];
  assert.equal(url, "https://api.b.ai/v1/images/edits");
  assert.equal(request.headers.Authorization, "Bearer " + key);
  assert.equal(request.redirect, "error");
  assert.equal(request.body.get("model"), settings.model);
  assert.equal(request.body.get("size"), "1024x1024");
  assert.equal(request.body.get("n"), "1");
  assert.equal(request.body.get("quality"), null);
  assert.equal(request.body.get("input_fidelity"), null);
  assert.ok(request.body.get("image") instanceof File);
  assert.equal(request.body.get("image[]"), null);
  assert.equal(output.mime, "image/png");
  assert.equal(output.model, settings.model);
  assert.deepEqual(output.bytes, outputBytes);
});

test("saved high quality and 2K settings reach the provider for both square and portrait requests", async () => {
  for (const [kind, size] of [["main", "2048x2048"], ["detail", "1536x2048"]]) {
    reset({ imageQuality: "high", imageResolution: "2k" });
    await editProduct("test-owner", [image, image], "Keep the real product", { kind });
    assert.equal(state.requests.length, 1, "a charged request must not be retried automatically");
    const form = state.requests[0][1].body;
    assert.equal(form.get("size"), size);
    assert.equal(form.get("quality"), "high");
    assert.equal(form.get("image"), null);
    assert.equal(form.getAll("image[]").length, 2);
    assert.equal(form.get("input_fidelity"), null);
  }
});

test("custom-provider explicit quality is forwarded while portrait sizes remain restricted to the verified integration", async () => {
  reset({ baseUrl: "https://custom.example.com/v1", imageQuality: "medium", imageResolution: "2k" });
  await editProduct("test-owner", [image], "Keep the real product", { kind: "detail" });
  assert.equal(state.requests[0][1].body.get("size"), "2048x2048");
  assert.equal(state.requests[0][1].body.get("quality"), "medium");
  reset({ imageQuality: "auto", imageResolution: "1k" });
  await editProduct("test-owner", [image], "Keep the real product");
  assert.equal(state.requests[0][1].body.get("quality"), null);
});

test("a rejected image request returns redacted provider errors without another charged call", async () => {
  reset({ imageQuality: "high", imageResolution: "2k" });
  state.respond = () => Response.json({ error: { message: `Invalid ${key} Bearer other-private-token https://signed.example.com?token=123` } }, { status: 400 });
  await assert.rejects(editProduct("test-owner", [image], "Keep the real product"), error => {
    assert.match(error.message, /HTTP 400/);
    assert.doesNotMatch(error.message, /image-transport-test-private-key|other-private-token|token=123/);
    return true;
  });
  assert.equal(state.requests.length, 1);
});

test("slow image generation receives six minutes and a timeout never triggers another paid attempt", async () => {
  reset({ imageQuality: "high", imageResolution: "2k" });
  state.respond = () => { throw new DOMException("private provider connection", "TimeoutError"); };
  await assert.rejects(editProduct("test-owner", [image], "Keep the real product"), error => {
    assert.match(error.message, /6分钟/);
    assert.match(error.message, /确认结果后再重试，避免重复计费/);
    assert.doesNotMatch(error.message, /private provider connection/);
    return true;
  });
  assert.deepEqual(state.timeouts, [360000]);
  assert.equal(state.requests.length, 1);
});
