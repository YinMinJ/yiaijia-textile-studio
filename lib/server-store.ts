import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
  createReadStream,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import { getCurrentUser } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/auth-core";
import { getDataDirectory, getSqlite } from "@/lib/database";

export async function owner() {
  const user = await getCurrentUser();
  if (!user)
    throw new Response(JSON.stringify({ error: "请登录后保存或上传商品。" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  return user.id;
}

class LocalStatement {
  constructor(
    private readonly statement: StatementSync,
    private readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: SQLInputValue[]): LocalStatement {
    return new LocalStatement(this.statement, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    return {
      results: this.statement.all(...this.values) as T[],
      success: true,
    };
  }

  async run(): Promise<{
    success: true;
    meta: { changes: number; last_row_id: number };
  }> {
    const result = this.statement.run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

export function db() {
  return {
    prepare(sql: string) {
      return new LocalStatement(getSqlite().prepare(sql));
    },
  };
}

type DirectoryIdentity = { name: string; dev: number; ino: number };
type ObjectLocation = { filename: string; directories: DirectoryIdentity[] };
type ObjectValue = string | ArrayBuffer | Uint8Array | Blob | ReadableStream<Uint8Array>;

function isFileError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function inspectDirectory(name: string, create: boolean): DirectoryIdentity | null {
  if (create) {
    try {
      mkdirSync(name, { mode: 0o700 });
    } catch (error) {
      if (!isFileError(error, "EEXIST")) throw error;
    }
  }
  let stat;
  try {
    stat = lstatSync(name);
  } catch (error) {
    if (!create && isFileError(error, "ENOENT")) return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(name) !== name)
    throw new Error("素材存储目录不安全。");
  return { name, dev: stat.dev, ino: stat.ino };
}

function locateObject(key: string, create: boolean): ObjectLocation | null {
  if (
    typeof key !== "string" ||
    key.length > 512 ||
    !key.split("/").every((segment) => /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(segment))
  )
    throw new Error("素材存储路径不正确。");

  const segments = key.split("/");
  let directory = path.join(getDataDirectory(), "uploads");
  const directories: DirectoryIdentity[] = [];
  for (const segment of ["", ...segments.slice(0, -1)]) {
    if (segment) directory = path.join(directory, segment);
    const identity = inspectDirectory(directory, create);
    if (!identity) return null;
    directories.push(identity);
  }
  return { filename: path.join(directory, segments.at(-1)!), directories };
}

function assertDirectories(directories: DirectoryIdentity[]) {
  for (const expected of directories) {
    const actual = inspectDirectory(expected.name, false);
    if (!actual || actual.dev !== expected.dev || actual.ino !== expected.ino)
      throw new Error("素材存储目录发生变化，请重试。");
  }
}

function inspectObject(filename: string): boolean {
  try {
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("素材文件路径不安全。");
    return true;
  } catch (error) {
    if (isFileError(error, "ENOENT")) return false;
    throw error;
  }
}

function writeBytes(fd: number, value: Uint8Array) {
  let offset = 0;
  while (offset < value.byteLength)
    offset += writeSync(fd, value, offset, value.byteLength - offset);
}

async function writeObject(fd: number, value: ObjectValue) {
  if (typeof value === "string") {
    writeBytes(fd, Buffer.from(value));
    return;
  }
  if (value instanceof ArrayBuffer) {
    writeBytes(fd, new Uint8Array(value));
    return;
  }
  if (value instanceof Uint8Array) {
    writeBytes(fd, value);
    return;
  }
  const stream = value instanceof Blob ? value.stream() : value;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      writeBytes(fd, chunk);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function bucket() {
  return {
    async put(
      key: string,
      value: ObjectValue,
      _options?: { httpMetadata?: { contentType?: string } },
    ) {
      // MIME metadata already lives in the assets table used by the GET route.
      const location = locateObject(key, true)!;
      inspectObject(location.filename);
      const temporary = path.join(path.dirname(location.filename), `.upload-${randomUUID()}.tmp`);
      const fd = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      let closed = false;
      let committed = false;
      try {
        await writeObject(fd, value);
        fsyncSync(fd);
        closeSync(fd);
        closed = true;
        assertDirectories(location.directories);
        inspectObject(location.filename);
        renameSync(temporary, location.filename);
        committed = true;
      } finally {
        if (!closed) closeSync(fd);
        if (!committed) {
          // Do not follow a directory that was swapped while streaming a file.
          assertDirectories(location.directories);
          try {
            unlinkSync(temporary);
          } catch (error) {
            if (!isFileError(error, "ENOENT")) throw error;
          }
        }
      }
      return { key };
    },

    async get(key: string) {
      const location = locateObject(key, false);
      if (!location || !inspectObject(location.filename)) return null;
      assertDirectories(location.directories);
      let fd: number;
      try {
        fd = openSync(location.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if (isFileError(error, "ENOENT")) return null;
        throw error;
      }
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile()) throw new Error("素材文件路径不安全。");
        const nodeStream = createReadStream(location.filename, { fd, autoClose: true });
        return {
          key,
          size: stat.size,
          body: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
        };
      } catch (error) {
        closeSync(fd);
        throw error;
      }
    },

    async delete(key: string) {
      const location = locateObject(key, false);
      if (!location || !inspectObject(location.filename)) return;
      assertDirectories(location.directories);
      try {
        unlinkSync(location.filename);
      } catch (error) {
        if (!isFileError(error, "ENOENT")) throw error;
      }
    },
  };
}
export function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  console.error("studio request failed", error);
  return Response.json(
    { error: "暂时无法完成操作，请保留当前页面并重试。" },
    { status: 503 },
  );
}
export function checkOrigin(request: Request) {
  if (!isSameOriginRequest(request))
    throw new Response("请求来源不匹配", { status: 403 });
}
