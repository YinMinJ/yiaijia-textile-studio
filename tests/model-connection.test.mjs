import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
const source = await readFile(
  new URL("../lib/model-connection.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const { normalizeModelBase, customAPIEndpoint, providerError, inspectModelList, defaultTextModel } =
  await import(
    "data:text/javascript;base64," + Buffer.from(outputText).toString("base64")
  );

test("bare origin gains v1; prefixed and explicit endpoints remain usable", () => {
  assert.equal(
    normalizeModelBase(" https://api.daitu.cc/ "),
    "https://api.daitu.cc/v1",
  );
  assert.equal(
    customAPIEndpoint("https://api.daitu.cc/v1/", "images/edits"),
    "https://api.daitu.cc/v1/images/edits",
  );
  assert.equal(
    customAPIEndpoint(
      "https://api.example.com/custom/v1/images/edits",
      "images/edits",
    ),
    "https://api.example.com/custom/v1/images/edits",
  );
  assert.equal(
    customAPIEndpoint("https://api.example.com/images/edits", "images/edits"),
    "https://api.example.com/images/edits",
  );
  assert.equal(
    customAPIEndpoint("https://api.example.com/v1/images/edits", "models"),
    "https://api.example.com/v1/models",
  );
  assert.equal(
    customAPIEndpoint("https://api.example.com/custom/v1/images/edits", "chat/completions"),
    "https://api.example.com/custom/v1/chat/completions",
  );
});
test("endpoint validation keeps credential destinations public", () => {
  for (const value of [
    "http://api.example.com",
    "https://127.0.0.1/v1",
    "https://user:pass@api.example.com/v1",
    "https://api.example.com/v1?key=abc",
    "https://api.example.com/v1/chat/completions",
    "https://api.example.com/v1/images/generations",
    "https://api.example.com/v1/models",
  ]) {
    assert.throws(() => normalizeModelBase(value));
  }
});
test("the observed Cloudflare 1010 is reported as firewall refusal, not an invalid key", () => {
  const error = providerError(
    403,
    JSON.stringify({
      error_code: 1010,
      error_name: "browser_signature_banned",
      ray_id: "a4530c382d6cfa1d",
    }),
  );
  assert.match(error.message, /Cloudflare 1010/);
  assert.match(error.message, /防火墙/);
  assert.match(error.message, /a4530c382d6cfa1d/);
});
test("provider details redact keys, bearer credentials and signed URLs", () => {
  const secret = "example-private-token";
  const e = providerError(
    400,
    JSON.stringify({
      error: {
        message:
          "Invalid " +
          secret +
          " sk-fakeToken https://api.example.com?key=abc Bearer secret",
      },
    }),
    secret,
  );
  assert.doesNotMatch(
    e.message,
    /example-private-token|sk-fakeToken|key=abc|Bearer secret/,
  );
  assert.match(e.message, /HTTP 400/);
});
test("model-list access never claims image generation success or silently changes model", () => {
  const data = { data: [{ id: "GPT-image-2.5" }] };
  assert.equal(inspectModelList(data, "GPT-image-2.5").modelFound, true);
  assert.match(
    inspectModelList(data, "GPT-image-2.5").message,
    /尚未验证图片编辑/,
  );
  assert.equal(inspectModelList(data, "gpt-image-2.5").modelFound, false);
  assert.equal(
    inspectModelList(data, "gpt-image-2.5").suggestedModel,
    "GPT-image-2.5",
  );
  assert.throws(() => inspectModelList({ html: "not a model response" }, "x"));
});

test("model-list probe reports text-model availability independently and preserves exact spelling", () => {
  const payload = { data: [{ id: "gpt-image-2" }, { id: "DeepSeek-V4.1-Flash" }] };
  const found = inspectModelList(payload, "gpt-image-2", "DeepSeek-V4.1-Flash");
  assert.equal(found.modelFound, true);
  assert.equal(found.textModelFound, true);
  assert.match(found.message, /尚未验证文案生成/);
  const mismatch = inspectModelList(payload, "gpt-image-2", "deepseek-v4.1-flash");
  assert.equal(mismatch.textModelFound, false);
  assert.equal(mismatch.suggestedTextModel, "DeepSeek-V4.1-Flash");
  assert.equal(inspectModelList(payload, "gpt-image-2").textModelFound, undefined);
  assert.equal(defaultTextModel("https://api.b.ai/v1/images/edits"), "deepseek-v4.1-flash");
  assert.equal(defaultTextModel("https://api.b.ai.example.com/v1"), "");
});

test("text model migration retains old settings and only initializes the existing B.AI custom configuration", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(await readFile(new URL("../drizzle/0001_clammy_leech.sql", import.meta.url), "utf8"));
    const insert = database.prepare("INSERT INTO model_settings VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const [uid, protocol, url] of [
      ["bai", "custom", "https://api.b.ai/v1"],
      ["legacy-bai", "openai", "https://api.b.ai/v1/images/edits"],
      ["other", "custom", "https://api.b.ai.example.com/v1"],
      ["native", "seedream", "https://api.b.ai/v1"],
    ]) insert.run(uid, protocol, url, "existing-image-model", "encrypted-value", "1234", "old-date");
    database.exec(await readFile(new URL("../drizzle/0002_copy_model.sql", import.meta.url), "utf8"));
    database.exec(await readFile(new URL("../drizzle/0003_copy_model_id.sql", import.meta.url), "utf8"));
    const rows = database.prepare("SELECT * FROM model_settings ORDER BY owner_id").all();
    assert.equal(rows.find(r => r.owner_id === "bai").text_model, "deepseek-v4.1-flash");
    assert.equal(rows.find(r => r.owner_id === "legacy-bai").text_model, "deepseek-v4.1-flash");
    assert.equal(rows.find(r => r.owner_id === "other").text_model, "");
    assert.equal(rows.find(r => r.owner_id === "native").text_model, "");
    for (const row of rows) {
      assert.equal(row.model, "existing-image-model");
      assert.equal(row.encrypted_key, "encrypted-value");
      assert.equal(row.updated_at, "old-date");
    }
  } finally {
    database.close();
  }
});
