import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getDataDirectory } from "./database.ts";

const secrets = new Map<string, string>();

function isFileError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function validateSecret(value: string): string {
  const secret = value.trim();
  // A 32-byte AES-256 key has 44 characters in canonical padded base64.
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(secret) ||
    Buffer.from(secret, "base64").length !== 32 ||
    Buffer.from(secret, "base64").toString("base64") !== secret
  )
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET 必须是32字节随机密钥的Base64编码。请勿替换已有密钥，否则已保存的API Key将无法解密。",
    );
  return secret;
}

function readSecret(filename: string): string {
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 128)
      throw new Error("本地密钥文件格式不正确。");
    fchmodSync(fd, 0o600);
    return validateSecret(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}

function syncDirectory(directory: string) {
  // POSIX filesystems support directory fsync; Windows may reject opening one.
  let fd: number | undefined;
  try {
    fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    fsyncSync(fd);
  } catch (error) {
    if (
      !["EINVAL", "EISDIR", "EPERM", "ENOTSUP"].some((code) =>
        isFileError(error, code),
      )
    )
      throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Stable across restarts; the environment variable always takes precedence. */
export function getEncryptionSecret(): string {
  if (process.env.API_KEY_ENCRYPTION_SECRET !== undefined)
    return validateSecret(process.env.API_KEY_ENCRYPTION_SECRET);

  const directory = getDataDirectory();
  const filename = path.join(directory, "encryption-secret");
  const cached = secrets.get(filename);
  if (cached) return cached;

  try {
    const secret = readSecret(filename);
    secrets.set(filename, secret);
    return secret;
  } catch (error) {
    if (!isFileError(error, "ENOENT")) throw error;
  }

  const temporary = path.join(directory, `.encryption-secret-${randomUUID()}.tmp`);
  const fd = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      writeFileSync(fd, randomBytes(32).toString("base64") + "\n", "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      // Linking installs a fully written file without overwriting another
      // worker's key. A plain rename would rotate the key in that race.
      linkSync(temporary, filename);
      syncDirectory(directory);
    } catch (error) {
      if (!isFileError(error, "EEXIST")) throw error;
    }
  } finally {
    unlinkSync(temporary);
  }

  const secret = readSecret(filename);
  secrets.set(filename, secret);
  return secret;
}
