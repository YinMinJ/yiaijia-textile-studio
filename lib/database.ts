import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// These are the application's business-schema migrations. Keeping
// the list explicit prevents example schemas from being installed accidentally.
const migrations = [
  "0000_light_master_chief.sql",
  "0001_clammy_leech.sql",
  "0002_copy_model.sql",
  "0003_copy_model_id.sql",
  "0004_image_quality.sql",
] as const;

const databaseState = globalThis as typeof globalThis & {
  __yiaijiaDatabases?: Map<string, DatabaseSync>;
};

/** All persistent app files share this directory, including CLI-created users. */
export function getDataDirectory(): string {
  const directory = path.resolve(process.env.DATA_DIR || "data");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return realpathSync(directory);
}

function migrate(sqlite: DatabaseSync) {
  // BEGIN IMMEDIATE also serializes initial migration runs in separate workers.
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __app_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        sha256 TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    const find = sqlite.prepare(
      "SELECT sha256 FROM __app_migrations WHERE name = ?",
    );
    const record = sqlite.prepare(
      "INSERT INTO __app_migrations (name, sha256, applied_at) VALUES (?, ?, ?)",
    );
    for (const name of migrations) {
      const sql = readFileSync(path.join(process.cwd(), "drizzle", name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = find.get(name);
      if (applied) {
        if (applied.sha256 !== checksum)
          throw new Error(`已应用的数据库迁移发生变化：${name}`);
        continue;
      }
      sqlite.exec(sql);
      record.run(name, checksum, new Date().toISOString());
    }
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

/** A process-local connection, also retained across Next.js development reloads. */
export function getSqlite(): DatabaseSync {
  const filename = path.join(getDataDirectory(), "app.sqlite");
  const connections = (databaseState.__yiaijiaDatabases ??= new Map());
  const existing = connections.get(filename);
  if (existing?.isOpen) return existing;

  // Create the database privately and never follow a pre-existing file symlink.
  const fd = openSync(
    filename,
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (!fstatSync(fd).isFile()) throw new Error("数据库路径必须是普通文件。");
    fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }

  const sqlite = new DatabaseSync(filename);
  try {
    sqlite.exec("PRAGMA busy_timeout = 5000");
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("PRAGMA synchronous = NORMAL");
    migrate(sqlite);
    connections.set(filename, sqlite);
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
