import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getSqlite } from "./database.ts";
import { appBasePath } from "./app-path.ts";

export type AuthUser = { id: string; email: string; displayName: string };
export type CreateAccountInput = { email: string; password: string; displayName?: string };
type AccountRow = { id: string; email: string; display_name: string; password_hash: string };
type AuthOptions = { database?: DatabaseSync; now?: number };

export const SESSION_COOKIE_NAME = "yiaijia_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const SERVICE_LOGIN_ATTEMPT_LIMIT = 60;
export const SERVICE_LOGIN_WINDOW_MS = 60 * 1000;
export const AUTHENTICATION_ERROR = "邮箱或密码不正确。";

const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const HASH_LENGTH = 64;
const MAX_PASSWORD_BYTES = 1024;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const initializedDatabases = new WeakSet<DatabaseSync>();
const pendingBootstraps = new WeakMap<DatabaseSync, Promise<AuthUser | null>>();

export class AuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthInputError";
  }
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

function authDatabase(database?: DatabaseSync): DatabaseSync {
  const db = database ?? getSqlite();
  if (!initializedDatabases.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id, created_at);
      CREATE TABLE IF NOT EXISTS login_attempts (
        bucket TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS login_attempts_expiry ON login_attempts(expires_at);
    `);
    initializedDatabases.add(db);
  }
  return db;
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function validPasswordSize(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024 && Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES;
}

function validateAccount(input: CreateAccountInput): Required<CreateAccountInput> {
  const email = normalizeEmail(input.email);
  if (!validEmail(email)) throw new AuthInputError("请输入有效邮箱（最长 254 个字符）。");
  if (!validPasswordSize(input.password) || [...input.password].length < 12 || [...input.password].length > 256) {
    throw new AuthInputError("密码须为 12–256 个字符，最长 1024 字节。");
  }
  if (input.displayName !== undefined && typeof input.displayName !== "string") {
    throw new AuthInputError("显示名称须为文字。");
  }
  const displayName = input.displayName?.trim() || email.split("@")[0];
  if ([...displayName].length > 80 || /[\u0000-\u001f\u007f]/u.test(displayName)) {
    throw new AuthInputError("显示名称须为 1–80 个可见字符。");
  }
  return { email, password: input.password, displayName };
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, HASH_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derivePassword(password, salt);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password: unknown, storedHash: string | null): Promise<boolean> {
  // Unknown accounts and malformed hashes still perform the same bounded KDF.
  // Do not accept arbitrary stored parameters: they could cause excessive work.
  const match = storedHash?.match(/^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
  const salt = match ? Buffer.from(match[1], "hex") : Buffer.alloc(16);
  const expected = match ? Buffer.from(match[2], "hex") : Buffer.alloc(HASH_LENGTH);
  const isBoundedPassword = validPasswordSize(password);
  const actual = await derivePassword(isBoundedPassword ? password : "", salt);
  const matches = timingSafeEqual(actual, expected);
  return !!match && isBoundedPassword && matches;
}

function publicUser(account: Pick<AccountRow, "id" | "email" | "display_name">): AuthUser {
  return { id: account.id, email: account.email, displayName: account.display_name };
}

function insertAccount(db: DatabaseSync, input: Required<CreateAccountInput>, passwordHash: string, now: number): AuthUser {
  const id = randomUUID();
  db.prepare("INSERT INTO accounts (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, input.email, passwordHash, input.displayName, now);
  return { id, email: input.email, displayName: input.displayName };
}

export async function createAccount(input: CreateAccountInput, options: AuthOptions = {}): Promise<AuthUser> {
  const values = validateAccount(input);
  const db = authDatabase(options.database);
  const passwordHash = await hashPassword(values.password);
  return transaction(db, () => {
    if (db.prepare("SELECT 1 FROM accounts WHERE email = ?").get(values.email)) {
      throw new AuthInputError("此邮箱已存在；未修改原账户。");
    }
    return insertAccount(db, values, passwordHash, options.now ?? Date.now());
  });
}

export function hasAccounts(options: AuthOptions = {}): boolean {
  return !!authDatabase(options.database).prepare("SELECT 1 FROM accounts LIMIT 1").get();
}

/** Used by the local launcher; never creates a second account after a race. */
export async function createInitialAccount(input: CreateAccountInput, options: AuthOptions = {}): Promise<AuthUser | null> {
  const db = authDatabase(options.database);
  if (hasAccounts({ database: db })) return null;
  const values = validateAccount(input);
  const passwordHash = await hashPassword(values.password);
  return transaction(db, () => {
    if (hasAccounts({ database: db })) return null;
    return insertAccount(db, values, passwordHash, options.now ?? Date.now());
  });
}

/** Only explicitly supplied environment credentials may create the first account. */
export async function bootstrapAdminAccount(
  environment: Record<string, string | undefined> = process.env,
  options: AuthOptions = {},
): Promise<AuthUser | null> {
  const db = authDatabase(options.database);
  if (db.prepare("SELECT 1 FROM accounts LIMIT 1").get()) return null;
  const email = environment.APP_ADMIN_EMAIL;
  const password = environment.APP_ADMIN_PASSWORD;
  if (!email && !password) return null;
  if (!email || !password) {
    throw new AuthConfigurationError("首次管理员初始化需同时设置 APP_ADMIN_EMAIL 和 APP_ADMIN_PASSWORD。");
  }
  // createInitialAccount checks again under a write lock after the KDF.
  return createInitialAccount({ email, password, displayName: environment.APP_ADMIN_DISPLAY_NAME }, { ...options, database: db });
}

export async function ensureBootstrapAdmin(database?: DatabaseSync): Promise<void> {
  const db = authDatabase(database);
  let pending = pendingBootstraps.get(db);
  if (!pending) {
    pending = bootstrapAdminAccount(process.env, { database: db });
    pendingBootstraps.set(db, pending);
  }
  try {
    await pending;
  } finally {
    if (pendingBootstraps.get(db) === pending) pendingBootstraps.delete(db);
  }
}

/** Reserves an attempt before awaiting the KDF, including across processes. */
function reserveLoginAttempt(db: DatabaseSync, email: string, now: number): number | null {
  const buckets = [
    { key: "service", limit: SERVICE_LOGIN_ATTEMPT_LIMIT, window: SERVICE_LOGIN_WINDOW_MS },
    { key: `account:${hashToken(email)}`, limit: LOGIN_ATTEMPT_LIMIT, window: LOGIN_WINDOW_MS },
  ];
  return transaction(db, () => {
    db.prepare("DELETE FROM login_attempts WHERE expires_at <= ?").run(now);
    let retryAfter = 0;
    for (const bucket of buckets) {
      const row = db.prepare("SELECT attempts, expires_at FROM login_attempts WHERE bucket = ?").get(bucket.key) as
        { attempts: number; expires_at: number } | undefined;
      if (row && row.attempts >= bucket.limit) {
        retryAfter = Math.max(retryAfter, Math.ceil((row.expires_at - now) / 1000));
      }
    }
    if (retryAfter) return retryAfter;
    for (const bucket of buckets) {
      db.prepare(`INSERT INTO login_attempts (bucket, attempts, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(bucket) DO UPDATE SET attempts = login_attempts.attempts + 1`)
        .run(bucket.key, now + bucket.window);
    }
    // Successful attempts also count. Resetting this bucket after a success
    // would discard reservations for other concurrently verifying requests.
    return null;
  });
}

export type LoginResult =
  | { ok: true; user: AuthUser; token: string; expiresAt: number }
  | { ok: false; reason: "credentials" }
  | { ok: false; reason: "rate-limited"; retryAfter: number };

export async function loginWithPassword(
  emailValue: unknown,
  password: unknown,
  options: AuthOptions & { previousToken?: string } = {},
): Promise<LoginResult> {
  const db = authDatabase(options.database);
  const now = options.now ?? Date.now();
  const email = normalizeEmail(emailValue);
  // HTTP input is bounded independently. Keep direct callers bounded as well.
  const normalized = email.length <= 254 ? email : "invalid-email";
  const retryAfter = reserveLoginAttempt(db, normalized, now);
  if (retryAfter !== null) return { ok: false, reason: "rate-limited", retryAfter };
  const account = validEmail(email)
    ? db.prepare("SELECT id, email, display_name, password_hash FROM accounts WHERE email = ?").get(email) as AccountRow | undefined
    : undefined;
  const matches = await verifyPassword(password, account?.password_hash ?? null);
  if (!account || !matches) return { ok: false, reason: "credentials" };

  const token = randomBytes(32).toString("base64url");
  const issuedAt = options.now ?? Date.now();
  const expiresAt = issuedAt + SESSION_MAX_AGE_SECONDS * 1000;
  const created = transaction(db, () => {
    // An account may have changed or been removed while the KDF was pending.
    // Never mint a session from credentials that are no longer current.
    const current = db.prepare("SELECT password_hash FROM accounts WHERE id = ?").get(account.id) as
      { password_hash: string } | undefined;
    if (!current || current.password_hash !== account.password_hash) return false;
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(issuedAt);
    if (options.previousToken && SESSION_TOKEN_PATTERN.test(options.previousToken)) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(options.previousToken));
    }
    db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), account.id, issuedAt, expiresAt);
    db.prepare(`DELETE FROM sessions WHERE account_id = ? AND token_hash NOT IN
      (SELECT token_hash FROM sessions WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20)`)
      .run(account.id, account.id);
    return true;
  });
  if (!created) return { ok: false, reason: "credentials" };
  return { ok: true, user: publicUser(account), token, expiresAt };
}

export function getSessionUser(token: unknown, options: AuthOptions = {}): AuthUser | null {
  if (typeof token !== "string" || !SESSION_TOKEN_PATTERN.test(token)) return null;
  const db = authDatabase(options.database);
  const row = db.prepare(`SELECT a.id, a.email, a.display_name FROM sessions s
    JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .get(hashToken(token), options.now ?? Date.now()) as Pick<AccountRow, "id" | "email" | "display_name"> | undefined;
  return row ? publicUser(row) : null;
}

export function revokeSession(token: unknown, options: AuthOptions = {}): void {
  if (typeof token !== "string" || !SESSION_TOKEN_PATTERN.test(token)) return;
  authDatabase(options.database).prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function getAppUrl(value = process.env.APP_URL): URL {
  let url: URL;
  try {
    url = new URL(value?.trim() || "http://localhost:3000");
  } catch {
    throw new AuthConfigurationError("APP_URL 必须是完整的网站地址。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new AuthConfigurationError("APP_URL 必须仅包含 http/https 协议、域名和可选端口。");
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLoopback) {
    throw new AuthConfigurationError("非本机地址的 APP_URL 必须使用 HTTPS。");
  }
  return url;
}

/** Never trust Host/X-Forwarded-Host or permit an absent Origin for writes. */
export function isSameOriginRequest(request: Pick<Request, "headers">): boolean {
  return request.headers.get("origin") === getAppUrl().origin;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getAppUrl().protocol === "https:",
    path: appBasePath() || "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
