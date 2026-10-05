// Runs the production app against an isolated temporary database. No model calls.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await realpath(tmpdir());
const directory = await mkdtemp(path.join(temporaryRoot, "yiaijia-http-"));
const networkGuard = path.join(directory, "block-upstream.mjs");
const upstreamAttempts = path.join(directory, "upstream-attempts.log");
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const number = probe.address().port;
    probe.close(() => resolve(number));
  });
});
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, APP_LOCAL_MODE: "0", PORT: String(port), APP_URL: origin, DATA_DIR: directory, NEXT_TELEMETRY_DISABLED: "1" };
delete env.APP_ADMIN_EMAIL;
delete env.APP_ADMIN_PASSWORD;
delete env.API_KEY_ENCRYPTION_SECRET;
const checks = [];
const password = randomBytes(24).toString("base64url");
const fakeKey = `integration-only-${randomBytes(20).toString("hex")}`;
let server;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pass(name) { checks.push({ check: name, result: "passed" }); }
function createAccount(email) {
  const result = spawnSync(process.execPath, ["scripts/create-user.mjs"], {
    cwd: root, env, encoding: "utf8", input: JSON.stringify({ email, password, displayName: "验收账户" }),
  });
  assert.equal(result.status, 0, "account CLI must succeed");
  assert.ok(!`${result.stdout}${result.stderr}`.includes(password), "CLI must not print password");
}
async function start() {
  server = spawn(process.execPath, ["--import", pathToFileURL(networkGuard).href, "scripts/start-server.mjs"], { cwd: root, env, stdio: ["ignore", "ignore", "ignore"] });
  let spawnError;
  server.once("error", (error) => { spawnError = error; });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (spawnError || server.exitCode !== null) throw new Error("production server failed to start");
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await pause(100);
  }
  throw new Error("production server health check timed out");
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const running = server;
  await new Promise((resolve) => {
    const timer = setTimeout(() => running.kill("SIGKILL"), 3000);
    running.once("exit", () => { clearTimeout(timer); resolve(); });
    running.kill("SIGTERM");
  });
}
async function request(url, { cookie, body, method = "GET", headers = {} } = {}) {
  return fetch(`${origin}${url}`, {
    method, redirect: "manual", signal: AbortSignal.timeout(10000),
    headers: { ...(method === "GET" ? {} : { Origin: origin }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body }),
  });
}
async function jsonPost(url, data, cookie, headers) {
  return request(url, { method: "POST", cookie, body: JSON.stringify(data), headers: { "Content-Type": "application/json", ...headers } });
}
async function login(email) {
  const response = await jsonPost("/api/auth/login", { email, password });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  return cookie.split(";")[0];
}
async function assertNoUpstreamRequests() {
  assert.equal(await readFile(upstreamAttempts, "utf8"), "", "isolated server must not attempt an upstream request");
}
async function removeTemporaryDirectory() {
  const resolved = await realpath(directory);
  const relative = path.relative(temporaryRoot, resolved);
  assert.ok(
    !path.isAbsolute(relative) && relative.startsWith("yiaijia-http-") &&
      !relative.includes(path.sep) && path.dirname(resolved) === temporaryRoot &&
      resolved === path.resolve(directory),
    "refusing to recursively remove a path outside the exact verification temporary directory",
  );
  await rm(resolved, { recursive: true, force: true });
}

try {
  await writeFile(upstreamAttempts, "", "utf8");
  await writeFile(networkGuard, `import { appendFileSync } from "node:fs";
globalThis.fetch = async () => {
  appendFileSync(new URL("./upstream-attempts.log", import.meta.url), "blocked\\n");
  throw new Error("HTTP verification blocks all outbound API requests");
};
`, "utf8");
  createAccount("owner@example.test");
  createAccount("second@example.test");
  await start();
  pass("生产启动脚本与数据库健康检查");

  let response = await request("/");
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/login");
  assert.equal((await request("/api/projects", { headers: { "oai-authenticated-user-id": "forged-platform-user" } })).status, 401);
  assert.equal((await jsonPost("/api/generate-copy", {})).status, 401);
  pass("匿名访问受限且不信任旧平台身份请求头");

  response = await request("/login");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("登录工作台"));
  const css = html.match(/href="([^"\s]*\/_next\/static\/[^"\s]*\.css[^"\s]*)"/);
  assert.ok(css, "login page must include a stylesheet");
  assert.equal((await request(css[1])).status, 200);
  assert.equal((await request("/samples/00224.jpg")).status, 200);
  pass("登录页、CSS 与公共商品样例可访问");

  assert.equal((await jsonPost("/api/auth/login", { email: "owner@example.test", password }, undefined, { Origin: "https://unrelated.example" })).status, 403);
  const firstCookie = await login("owner@example.test");
  const secondCookie = await login("second@example.test");
  assert.equal((await request("/", { cookie: firstCookie })).status, 200);
  pass("独立账户登录与跨域来源拒绝");

  const bytes = await readFile(path.join(root, "public", "samples", "00224.jpg"));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), "商品验收.jpg");
  response = await request("/api/assets", { method: "POST", cookie: firstCookie, body: form });
  assert.equal(response.status, 200);
  const asset = await response.json();
  response = await request(asset.url, { cookie: firstCookie });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await request(asset.url, { cookie: secondCookie })).status, 404);
  pass("图片上传读取字节一致、禁止共享缓存、账户间素材隔离");

  const project = {
    id: randomUUID(),
    info: { brand: "宜爱家", name: "独立版验收被子", subtitle: "", material: "", filling: "", size: "", weight: "", colors: "", care: "", sellingPoints: "" },
    template: "warm", assets: [{ ...asset, width: 1200, height: 1200, role: "整体" }], modules: [],
    status: "draft", output: "main", generation: "template",
  };
  assert.equal((await jsonPost("/api/projects", project, firstCookie)).status, 200);
  assert.equal((await jsonPost("/api/projects", project, secondCookie)).status, 403);
  const ownProjects = await (await request("/api/projects", { cookie: firstCookie })).json();
  assert.equal(ownProjects.projects[0].id, project.id);
  const otherProjects = await (await request("/api/projects", { cookie: secondCookie })).json();
  assert.equal(otherProjects.projects.length, 0);
  pass("项目保存、回读与跨账户覆盖拒绝");

  const customSettings = { baseUrl: "https://image-api.example.com/v1/images/edits", model: "custom-image-model", textModel: "custom-copy-model" };
  response = await jsonPost("/api/model-settings", { ...customSettings, apiKey: fakeKey }, firstCookie);
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes(fakeKey));
  const ownSettings = await (await request("/api/model-settings", { cookie: firstCookie })).json();
  assert.equal(ownSettings.configured, true);
  assert.equal(ownSettings.protocol, "custom");
  assert.equal(ownSettings.baseUrl, customSettings.baseUrl);
  assert.equal(ownSettings.model, customSettings.model);
  assert.equal(ownSettings.textModel, customSettings.textModel);
  assert.equal(ownSettings.keyHint, fakeKey.slice(-4));
  assert.ok(!("apiKey" in ownSettings) && !("encryptedKey" in ownSettings));
  assert.equal((await (await request("/api/model-settings", { cookie: secondCookie })).json()).configured, false);
  const db = new DatabaseSync(path.join(directory, "app.sqlite"), { readOnly: true });
  const firstUid = db.prepare("SELECT id FROM accounts WHERE email = ?").get("owner@example.test").id;
  const secondUid = db.prepare("SELECT id FROM accounts WHERE email = ?").get("second@example.test").id;
  const encrypted = db.prepare("SELECT encrypted_key FROM model_settings WHERE owner_id = ?").get(firstUid).encrypted_key;
  assert.ok(encrypted && !encrypted.includes(fakeKey));
  const savedSessions = db.prepare("SELECT token_hash FROM sessions").all();
  assert.ok(savedSessions.every((row) => row.token_hash !== firstCookie.split("=")[1]));
  db.close();
  const savedSecret = await readFile(path.join(directory, "encryption-secret"), "utf8");
  assert.equal(Buffer.from(savedSecret.trim(), "base64").length, 32);
  pass("自定义 API 完整图片编辑地址及独立文案模型保存、配置隔离、密钥加密及会话 token 哈希存储");

  const copyInput = {
    info: project.info,
    category: "quilt",
    modules: [{ id: "copy-scene", kind: "main", index: 2, section: "scene", purpose: "整体展示", sourceRole: "整体" }],
  };
  assert.equal((await jsonPost("/api/generate-copy", copyInput, firstCookie, { Origin: "https://unrelated.example" })).status, 403);
  assert.equal((await jsonPost("/api/generate-copy", {}, firstCookie)).status, 400);
  assert.equal((await request("/api/generate-copy", { method: "POST", cookie: firstCookie, body: "{not-json", headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await jsonPost("/api/generate-copy", { ...copyInput, modules: [{ ...copyInput.modules[0], index: 1, section: "hero" }] }, firstCookie)).status, 400);
  assert.equal((await jsonPost("/api/generate-copy", { ...copyInput, modules: [copyInput.modules[0], copyInput.modules[0]] }, firstCookie)).status, 400);
  assert.equal((await jsonPost("/api/generate-copy", { ...copyInput, info: { ...copyInput.info, name: "测".repeat(25000) } }, firstCookie)).status, 413);
  await assertNoUpstreamRequests();
  pass("文案接口要求登录与同源、拒绝错误资料及首图任务、重复图片和超长请求且不调用上游");

  const { textModel: copyModel, ...imageOnlySettings } = customSettings;
  assert.equal((await jsonPost("/api/model-settings", { ...imageOnlySettings, apiKey: "" }, firstCookie)).status, 200);
  assert.equal((await (await request("/api/model-settings", { cookie: firstCookie })).json()).textModel, copyModel);
  assert.equal((await jsonPost("/api/model-settings", { ...customSettings, textModel: "", apiKey: "" }, firstCookie)).status, 200);
  const blankCopySettings = await (await request("/api/model-settings", { cookie: firstCookie })).json();
  assert.equal(blankCopySettings.textModel, "");
  assert.equal(blankCopySettings.model, customSettings.model);
  assert.equal(blankCopySettings.keyHint, fakeKey.slice(-4));
  response = await jsonPost("/api/generate-copy", copyInput, firstCookie);
  assert.equal(response.status, 502);
  const missingCopyModel = await response.text();
  assert.match(missingCopyModel, /文案模型/);
  assert.ok(!missingCopyModel.includes(fakeKey));
  await assertNoUpstreamRequests();
  assert.equal((await jsonPost("/api/model-settings", { ...imageOnlySettings, apiKey: "" }, firstCookie)).status, 200);
  assert.equal((await (await request("/api/model-settings", { cookie: firstCookie })).json()).textModel, "");
  assert.equal((await jsonPost("/api/model-settings", { ...customSettings, apiKey: "" }, firstCookie)).status, 200);
  pass("旧客户端省略文案模型时保留配置、显式留空可清除、缺少文案模型不请求上游且不影响图像配置");

  assert.equal((await jsonPost("/api/model-settings", { ...customSettings, baseUrl: "https://another-api.example.com/v1", apiKey: "" }, firstCookie)).status, 400);
  assert.equal((await jsonPost("/api/model-settings", { ...customSettings, protocol: "custom", apiKey: "" }, firstCookie)).status, 200);
  for (const protocol of ["openai", "seedream", "dashscope", "unknown-protocol"]) {
    assert.equal((await jsonPost("/api/model-settings", { ...customSettings, protocol, apiKey: fakeKey }, firstCookie)).status, 400, `${protocol} must not be accepted by new saves`);
  }
  const fixtures = new DatabaseSync(path.join(directory, "app.sqlite"));
  try {
    assert.equal(fixtures.prepare("SELECT encrypted_key FROM model_settings WHERE owner_id = ?").get(firstUid).encrypted_key, encrypted);
    // A stored OpenAI-compatible configuration remains usable without exposing or replacing its key.
    fixtures.prepare("UPDATE model_settings SET protocol = ? WHERE owner_id = ?").run("openai", firstUid);
    const legacyOpenai = await (await request("/api/model-settings", { cookie: firstCookie })).json();
    assert.equal(legacyOpenai.configured, true);
    assert.equal(legacyOpenai.protocol, "custom");
    assert.equal(legacyOpenai.keyHint, fakeKey.slice(-4));
    assert.equal((await jsonPost("/api/model-settings", { ...customSettings, apiKey: "" }, firstCookie)).status, 200);
    const migrated = fixtures.prepare("SELECT protocol, encrypted_key FROM model_settings WHERE owner_id = ?").get(firstUid);
    assert.equal(migrated.protocol, "custom");
    assert.equal(migrated.encrypted_key, encrypted);
    // Synthetic fixture only: the second account's old provider key must never be decrypted or reused.
    for (const protocol of ["seedream", "dashscope"]) {
      fixtures.prepare("INSERT INTO model_settings (owner_id, protocol, base_url, model, encrypted_key, key_hint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET protocol = excluded.protocol")
        .run(secondUid, protocol, "https://legacy-api.example.com/api/v3", "legacy-image-model", encrypted, fakeKey.slice(-4), new Date().toISOString());
      const inactive = await (await request("/api/model-settings", { cookie: secondCookie })).json();
      assert.deepEqual(inactive, { configured: false });
      assert.equal((await jsonPost("/api/model-settings", { ...customSettings, apiKey: "" }, secondCookie)).status, 400);
      const probe = await request("/api/model-settings/test", { method: "POST", cookie: secondCookie });
      assert.equal(probe.status, 502);
      assert.match((await probe.json()).error, /请先.*保存/);
      const imageTest = new FormData();
      imageTest.append("image", new Blob([bytes], { type: "image/jpeg" }), "测试.jpg");
      imageTest.append("test", "true");
      const generated = await request("/api/generate-image", { method: "POST", cookie: secondCookie, body: imageTest });
      assert.equal(generated.status, 502);
      assert.match((await generated.json()).error, /请先.*保存/);
      assert.equal(fixtures.prepare("SELECT protocol FROM model_settings WHERE owner_id = ?").get(secondUid).protocol, protocol);
      await assertNoUpstreamRequests();
    }
  } finally {
    fixtures.close();
  }
  pass("只接受自定义 API 保存、地址变更需新密钥、旧兼容配置保留、原生供应商配置停用且不请求上游");

  await stop();
  await start();
  assert.equal((await (await request("/api/projects", { cookie: firstCookie })).json()).projects[0].id, project.id);
  assert.equal((await request(asset.url, { cookie: firstCookie })).status, 200);
  assert.equal((await (await request("/api/model-settings", { cookie: firstCookie })).json()).keyHint, fakeKey.slice(-4));
  assert.equal((await (await request("/api/model-settings", { cookie: firstCookie })).json()).model, customSettings.model);
  assert.equal((await (await request("/api/model-settings", { cookie: firstCookie })).json()).textModel, customSettings.textModel);
  assert.equal((await (await request("/api/model-settings", { cookie: firstCookie })).json()).protocol, "custom");
  assert.equal((await (await request("/api/model-settings", { cookie: secondCookie })).json()).configured, false);
  assert.equal(await readFile(path.join(directory, "encryption-secret"), "utf8"), savedSecret);
  pass("服务重启后账户会话、作品、图片、模型配置与加密密钥保留");

  assert.equal((await request("/api/auth/logout", { method: "POST", cookie: firstCookie })).status, 200);
  assert.equal((await request("/api/projects", { cookie: firstCookie })).status, 401);
  assert.equal((await request(asset.url, { cookie: firstCookie })).status, 401);
  assert.equal((await jsonPost("/api/generate-copy", copyInput, firstCookie)).status, 401);
  pass("退出后旧会话失效");

  await assertNoUpstreamRequests();
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), runtime: process.version, platform: process.platform, checks, realImageApiCalled: false }, null, 2));
} finally {
  await stop();
  await removeTemporaryDirectory();
}
