import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, webcrypto } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const EMAIL = "import-owner@example.test";
const FAKE_KEY = "fixture-only-model-key-4826";
async function encrypt(value, secret, ownerId) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.importKey("raw", Buffer.from(secret, "base64"), "AES-GCM", false, ["encrypt"]);
  const data = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(ownerId) }, key, new TextEncoder().encode(value));
  return Buffer.from(iv).toString("base64") + "." + Buffer.from(data).toString("base64");
}
async function decrypt(value, secret, ownerId) {
  const [iv, ciphertext] = value.split(".").map(part => Buffer.from(part, "base64"));
  const key = await webcrypto.subtle.importKey("raw", Buffer.from(secret, "base64"), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(ownerId) }, key, ciphertext));
}
function inspect(directory, work) {
  const sqlite = new DatabaseSync(path.join(directory, "app.sqlite"), { readOnly: true });
  try { return work(sqlite); } finally { sqlite.close(); }
}
async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "zhijing-model-import-test-"));
  const resolved = realpathSync(directory);
  const temporaryRoot = realpathSync(tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(temporaryRoot));
  assert.ok(path.basename(resolved).startsWith("zhijing-model-import-test-"));
  t.after(() => rmSync(resolved, { recursive: true, force: true }));
  const env = { ...process.env, DATA_DIR: directory, APP_LOCAL_MODE: "0" };
  delete env.API_KEY_ENCRYPTION_SECRET;
  delete env.APP_ADMIN_EMAIL;
  delete env.APP_ADMIN_PASSWORD;
  const user = spawnSync(process.execPath, ["scripts/create-user.mjs"], {
    cwd: ROOT, env, input: JSON.stringify({ email: EMAIL, password: "fixture-account-password-5467" }), encoding: "utf8",
  });
  assert.equal(user.status, 0);
  const secret = randomBytes(32).toString("base64");
  const row = { owner_id: "local-user", protocol: "custom", base_url: "https://api.b.ai/v1", model: "gpt-image-2", text_model: "deepseek-v4.1-flash", image_quality: "high", image_resolution: "2k", encrypted_key: await encrypt(FAKE_KEY, secret, "local-user"), key_hint: FAKE_KEY.slice(-4), updated_at: new Date().toISOString() };
  const input = { targetEmail: EMAIL, sourceEncryptionSecret: secret, settings: row };
  return {
    directory, input,
    run: (value = input, extraArguments = []) => spawnSync(process.execPath, ["scripts/import-model-settings.mjs", ...extraArguments], { cwd: ROOT, env, input: JSON.stringify(value), encoding: "utf8" }),
  };
}
function assertNoSecrets(result, input) {
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(FAKE_KEY));
  assert.ok(!output.includes(input.sourceEncryptionSecret));
  assert.ok(!output.includes(input.settings.encrypted_key));
}

test("CLI imports only API settings and re-encrypts with the server secret and target owner", async t => {
  const context = await fixture(t);
  const result = context.run();
  assert.equal(result.status, 0);
  assertNoSecrets(result, context.input);
  const row = inspect(context.directory, sqlite => {
    for (const table of ["projects", "assets", "sessions", "generation_jobs"]) assert.equal(sqlite.prepare(`SELECT count(*) AS total FROM ${table}`).get().total, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM accounts").get().total, 1);
    const target = sqlite.prepare("SELECT id FROM accounts WHERE email = ?").get(EMAIL);
    const imported = sqlite.prepare("SELECT * FROM model_settings").get();
    assert.equal(imported.owner_id, target.id);
    assert.equal(imported.protocol, "custom");
    for (const field of ["base_url", "model", "text_model", "image_quality", "image_resolution", "key_hint"]) assert.equal(imported[field], context.input.settings[field]);
    return imported;
  });
  const secret = readFileSync(path.join(context.directory, "encryption-secret"), "utf8").trim();
  assert.notEqual(secret, context.input.sourceEncryptionSecret);
  assert.notEqual(row.encrypted_key, context.input.settings.encrypted_key);
  assert.equal(await decrypt(row.encrypted_key, secret, row.owner_id), FAKE_KEY);
  await assert.rejects(decrypt(row.encrypted_key, secret, "local-user"));
  await assert.rejects(decrypt(row.encrypted_key, context.input.sourceEncryptionSecret, row.owner_id));
});

test("a missing target email is not created by the configuration importer", async t => {
  const context = await fixture(t);
  const result = context.run({ ...context.input, targetEmail: "missing@example.test" });
  assert.equal(result.status, 1);
  assertNoSecrets(result, context.input);
  inspect(context.directory, sqlite => {
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM model_settings").get().total, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM accounts").get().total, 1);
  });
});

test("wrong source owner or secret cannot import a usable configuration", async t => {
  const context = await fixture(t);
  for (const input of [{ ...context.input, settings: { ...context.input.settings, owner_id: "wrong-owner" } }, { ...context.input, sourceEncryptionSecret: randomBytes(32).toString("base64") }]) {
    const result = context.run(input);
    assert.equal(result.status, 1);
    assertNoSecrets(result, input);
  }
  inspect(context.directory, sqlite => assert.equal(sqlite.prepare("SELECT count(*) AS total FROM model_settings").get().total, 0));
});

test("existing configuration is preserved unless overwrite is explicitly requested", async t => {
  const context = await fixture(t);
  assert.equal(context.run().status, 0);
  const before = inspect(context.directory, sqlite => sqlite.prepare("SELECT * FROM model_settings").get());
  assert.equal(context.run().status, 1);
  assert.deepEqual(inspect(context.directory, sqlite => sqlite.prepare("SELECT * FROM model_settings").get()), before);
  const result = context.run({ ...context.input, overwrite: true, settings: { ...context.input.settings, image_quality: "medium" } });
  assert.equal(result.status, 0);
  assertNoSecrets(result, context.input);
  inspect(context.directory, sqlite => assert.equal(sqlite.prepare("SELECT image_quality FROM model_settings").get().image_quality, "medium"));
});

test("CLI rejects unrelated data, malformed encryption and secrets passed as arguments", async t => {
  const context = await fixture(t);
  for (const input of [{ ...context.input, projects: [] }, { ...context.input, settings: { ...context.input.settings, encrypted_key: "invalid" } }, { ...context.input, settings: { ...context.input.settings, key_hint: "0000" } }]) {
    const result = context.run(input);
    assert.equal(result.status, 1);
    assertNoSecrets(result, input);
  }
  const result = context.run(context.input, ["--api-key", FAKE_KEY]);
  assert.equal(result.status, 1);
  assertNoSecrets(result, context.input);
  inspect(context.directory, sqlite => assert.equal(sqlite.prepare("SELECT count(*) AS total FROM model_settings").get().total, 0));
});
