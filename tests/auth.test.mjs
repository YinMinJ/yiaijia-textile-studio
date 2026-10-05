import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  AuthConfigurationError,
  AuthInputError,
  bootstrapAdminAccount,
  createAccount,
  createInitialAccount,
  getAppUrl,
  getSessionUser,
  hasAccounts,
  isSameOriginRequest,
  LOGIN_ATTEMPT_LIMIT,
  LOGIN_WINDOW_MS,
  loginWithPassword,
  revokeSession,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "../lib/auth-core.ts";

const PASSWORD = "test-only-long-password-62";
const START = 1_800_000_000_000;
const cleanupTasks = new WeakMap();

function cleanup(t, action) {
  let tasks = cleanupTasks.get(t);
  if (!tasks) {
    tasks = [];
    cleanupTasks.set(t, tasks);
    t.after(() => {
      // SQLite handles must close before their containing directory is removed
      // on Windows. TestContext.after hooks themselves run in insertion order.
      for (const task of tasks.toReversed()) task();
    });
  }
  tasks.push(action);
}

function database(t, filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  cleanup(t, () => { if (db.isOpen) db.close(); });
  return db;
}

function temporaryDirectory(t) {
  const root = path.resolve(tmpdir());
  const directory = mkdtempSync(path.join(root, "yiaijia-auth-test-"));
  cleanup(t, () => {
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith("yiaijia-auth-test-"));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("accounts normalize email, reject weak/duplicate credentials, and independently salt passwords", async (t) => {
  const db = database(t);
  await assert.rejects(createAccount({ email: "owner@example.com", password: "short" }, { database: db }), AuthInputError);
  const first = await createAccount({ email: "  Owner@Example.COM ", password: PASSWORD, displayName: "设计师" }, { database: db });
  await createAccount({ email: "second@example.com", password: PASSWORD }, { database: db });
  assert.equal(first.email, "owner@example.com");
  assert.equal(first.displayName, "设计师");
  await assert.rejects(createAccount({ email: "OWNER@EXAMPLE.COM", password: PASSWORD }, { database: db }), AuthInputError);
  const rows = db.prepare("SELECT password_hash FROM accounts ORDER BY email").all();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row.password_hash, /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    assert.equal(row.password_hash.includes(PASSWORD), false);
  }
  assert.notEqual(rows[0].password_hash.split("$")[4], rows[1].password_hash.split("$")[4]);
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
});

test("wrong passwords, unknown accounts, invalid input, and corrupt stored hashes share one failure", async (t) => {
  const db = database(t);
  const user = await createAccount({ email: "owner@example.com", password: PASSWORD }, { database: db });
  const failed = { ok: false, reason: "credentials" };
  assert.deepEqual(await loginWithPassword(user.email, "wrong-password", { database: db, now: START }), failed);
  assert.deepEqual(await loginWithPassword("absent@example.com", "wrong-password", { database: db, now: START }), failed);
  assert.deepEqual(await loginWithPassword({ email: user.email }, { password: PASSWORD }, { database: db, now: START }), failed);
  assert.deepEqual(await loginWithPassword(user.email, "x".repeat(2048), { database: db, now: START }), failed);
  db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run("scrypt$999999999$8$3$bad$bad", user.id);
  assert.deepEqual(await loginWithPassword(user.email, PASSWORD, { database: db, now: START }), failed);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
});

test("session tokens remain hashed at rest, expire exactly, and survive a process connection restart", async (t) => {
  const filename = path.join(temporaryDirectory(t), "auth.sqlite");
  const db = database(t, filename);
  const user = await createAccount({ email: "owner@example.com", password: PASSWORD }, { database: db });
  const login = await loginWithPassword("OWNER@EXAMPLE.COM", PASSWORD, { database: db, now: START });
  assert.equal(login.ok, true);
  assert.deepEqual(login.user, user);
  assert.match(login.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(login.expiresAt, START + SESSION_MAX_AGE_SECONDS * 1000);
  const stored = db.prepare("SELECT token_hash FROM sessions").get().token_hash;
  assert.notEqual(stored, login.token);
  assert.equal(stored, createHash("sha256").update(login.token).digest("hex"));
  db.close();
  const reopened = database(t, filename);
  assert.deepEqual(getSessionUser(login.token, { database: reopened, now: login.expiresAt - 1 }), user);
  assert.equal(getSessionUser(login.token, { database: reopened, now: login.expiresAt }), null);
  assert.equal(getSessionUser(stored, { database: reopened, now: START }), null);
  assert.equal(getSessionUser("invalid", { database: reopened, now: START }), null);
  assert.equal(getSessionUser(null, { database: reopened, now: START }), null);
});

test("login rotates the browser session and logout revokes the replacement", async (t) => {
  const db = database(t);
  const user = await createAccount({ email: "owner@example.com", password: PASSWORD }, { database: db });
  const first = await loginWithPassword(user.email, PASSWORD, { database: db, now: START });
  const second = await loginWithPassword(user.email, PASSWORD, { database: db, now: START + 1, previousToken: first.token });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.token, second.token);
  assert.equal(getSessionUser(first.token, { database: db, now: START + 2 }), null);
  assert.deepEqual(getSessionUser(second.token, { database: db, now: START + 2 }), user);
  revokeSession(second.token, { database: db });
  assert.equal(getSessionUser(second.token, { database: db, now: START + 2 }), null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
});

test("a password change during verification cannot issue a session using old credentials", async (t) => {
  const db = database(t);
  const user = await createAccount({ email: "owner@example.com", password: PASSWORD }, { database: db });
  const pendingLogin = loginWithPassword(user.email, PASSWORD, { database: db, now: START });
  db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run("invalidated-by-administrator", user.id);
  assert.deepEqual(await pendingLogin, { ok: false, reason: "credentials" });
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
});

test("deleted accounts lose sessions and cannot finish an in-flight login", async (t) => {
  const db = database(t);
  const user = await createAccount({ email: "owner@example.com", password: PASSWORD }, { database: db });
  const login = await loginWithPassword(user.email, PASSWORD, { database: db, now: START });
  const pendingLogin = loginWithPassword(user.email, PASSWORD, { database: db, now: START + 1 });
  db.prepare("DELETE FROM accounts WHERE id = ?").run(user.id);
  assert.deepEqual(await pendingLogin, { ok: false, reason: "credentials" });
  assert.equal(getSessionUser(login.token, { database: db, now: START + 2 }), null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
});

test("persistent limit reserves concurrent attempts, survives restart, and never extends a blocked window", async (t) => {
  const filename = path.join(temporaryDirectory(t), "auth.sqlite");
  const db = database(t, filename);
  const results = await Promise.all(Array.from({ length: LOGIN_ATTEMPT_LIMIT + 3 }, (_, index) =>
    loginWithPassword(index % 2 ? "Limited@Example.com" : " limited@example.com ", PASSWORD, { database: db, now: START })));
  assert.equal(results.filter((result) => result.reason === "credentials").length, LOGIN_ATTEMPT_LIMIT);
  assert.equal(results.filter((result) => result.reason === "rate-limited").length, 3);
  db.close();
  const reopened = database(t, filename);
  const blocked = await loginWithPassword("limited@example.com", PASSWORD, { database: reopened, now: START + 60_000 });
  assert.deepEqual(blocked, { ok: false, reason: "rate-limited", retryAfter: (LOGIN_WINDOW_MS - 60_000) / 1000 });
  const stillBlocked = await loginWithPassword("limited@example.com", PASSWORD, { database: reopened, now: START + LOGIN_WINDOW_MS - 1 });
  assert.deepEqual(stillBlocked, { ok: false, reason: "rate-limited", retryAfter: 1 });
  assert.deepEqual(await loginWithPassword("limited@example.com", PASSWORD, { database: reopened, now: START + LOGIN_WINDOW_MS }), { ok: false, reason: "credentials" });
});

test("bootstrap requires explicit credentials, is atomic, and never changes an existing account", async (t) => {
  const filename = path.join(temporaryDirectory(t), "auth.sqlite");
  const first = database(t, filename);
  const second = database(t, filename);
  assert.equal(await bootstrapAdminAccount({}, { database: first }), null);
  assert.equal(hasAccounts({ database: first }), false);
  await assert.rejects(bootstrapAdminAccount({ APP_ADMIN_EMAIL: "owner@example.com" }, { database: first }), AuthConfigurationError);
  const results = await Promise.all([
    bootstrapAdminAccount({ APP_ADMIN_EMAIL: "one@example.com", APP_ADMIN_PASSWORD: PASSWORD }, { database: first }),
    bootstrapAdminAccount({ APP_ADMIN_EMAIL: "two@example.com", APP_ADMIN_PASSWORD: PASSWORD }, { database: second }),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(first.prepare("SELECT count(*) AS n FROM accounts").get().n, 1);
  assert.equal(await bootstrapAdminAccount({ APP_ADMIN_EMAIL: "replacement@example.com", APP_ADMIN_PASSWORD: "short" }, { database: first }), null);
  assert.equal(await createInitialAccount({ email: "later@example.com", password: PASSWORD }, { database: first }), null);
  const user = results.find(Boolean);
  assert.equal((await loginWithPassword(user.email, PASSWORD, { database: first, now: START })).ok, true);
  assert.equal(hasAccounts({ database: first }), true);
});

test("APP_URL is the only trusted origin and public deployments require HTTPS", () => {
  const original = process.env.APP_URL;
  try {
    delete process.env.APP_URL;
    assert.equal(getAppUrl().origin, "http://localhost:3000");
    assert.equal(sessionCookieOptions().secure, false);
    for (const invalid of ["https://example.com/path", "https://a:b@example.com", "ftp://example.com", "http://example.com", "not a url"]) {
      assert.throws(() => getAppUrl(invalid), AuthConfigurationError);
    }
    process.env.APP_URL = "https://studio.example.com";
    const cookie = sessionCookieOptions();
    assert.equal(cookie.secure, true);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.path, "/");
    assert.equal(cookie.maxAge, SESSION_MAX_AGE_SECONDS);
    assert.equal("domain" in cookie, false);
    assert.equal(isSameOriginRequest(new Request("http://internal:3000/api/auth/login", { headers: { Origin: "https://studio.example.com" } })), true);
    for (const origin of [undefined, "null", "https://attacker.example", "http://studio.example.com", "https://studio.example.com:444", "https://studio.example.com/"]) {
      const headers = new Headers({ Host: "studio.example.com", "X-Forwarded-Host": "studio.example.com" });
      if (origin !== undefined) headers.set("Origin", origin);
      assert.equal(isSameOriginRequest(new Request("https://studio.example.com/api/auth/login", { headers })), false);
    }
  } finally {
    if (original === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = original;
  }
});

function runCli(directory, input, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/create-user.mjs", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: directory, APP_ADMIN_EMAIL: "", APP_ADMIN_PASSWORD: "", APP_ADMIN_DISPLAY_NAME: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.on("error", () => {}); // --if-empty may exit before consuming input.
    child.stdin.end(input);
  });
}

test("CLI accepts stdin JSON without echoing a password and --if-empty never overwrites an account", async (t) => {
  const directory = temporaryDirectory(t);
  const input = JSON.stringify({ email: "cli@example.com", password: PASSWORD, displayName: "测试设计师" });
  const created = await runCli(directory, input, ["--if-empty"]);
  assert.equal(created.code, 0, created.stderr);
  assert.match(created.stdout, /账户已创建/);
  assert.equal(`${created.stdout}${created.stderr}`.includes(PASSWORD), false);
  const skipped = await runCli(directory, "this is intentionally not JSON", ["--if-empty"]);
  assert.equal(skipped.code, 0, skipped.stderr);
  assert.match(skipped.stdout, /账户已就绪/);
  const duplicate = await runCli(directory, input);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /此邮箱已存在/);
  assert.equal(`${duplicate.stdout}${duplicate.stderr}`.includes(PASSWORD), false);
  const db = database(t, path.join(directory, "app.sqlite"));
  assert.equal(db.prepare("SELECT count(*) AS n FROM accounts").get().n, 1);
});
