#!/usr/bin/env node
import { webcrypto } from "node:crypto";
import { getSqlite } from "../lib/database.ts";
import { getEncryptionSecret } from "../lib/server-secrets.ts";
import { normalizeModelBase } from "../lib/model-connection.ts";

const MAX_INPUT_BYTES = 16 * 1024;
class ImportInputError extends Error {}
const fail = message => { throw new ImportInputError(message); };

function text(value, maximum, label, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) fail(`${label}格式不正确。`);
  return value.trim();
}
function base64(value, label) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(`${label}格式不正确。`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(`${label}格式不正确。`);
  return bytes;
}
async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) fail("标准输入超过16KB，未导入配置。");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { fail("标准输入必须是有效JSON对象。"); }
}
function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("标准输入必须是JSON对象。");
  if (Object.keys(input).some(key => !["targetEmail", "sourceEncryptionSecret", "settings", "overwrite"].includes(key))) fail("只接受目标邮箱、源加密主密钥及模型配置；不接收作品或账号数据。");
  const targetEmail = text(input.targetEmail, 254, "目标邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) fail("目标邮箱格式不正确。");
  if (input.overwrite !== undefined && typeof input.overwrite !== "boolean") fail("overwrite必须是布尔值。");
  const secret = base64(text(input.sourceEncryptionSecret, 128, "源加密主密钥"), "源加密主密钥");
  if (secret.length !== 32) fail("源加密主密钥必须是32字节Base64编码。");
  const row = input.settings;
  if (!row || typeof row !== "object" || Array.isArray(row)) fail("settings必须是源model_settings配置行。");
  if (!["custom", "openai"].includes(row.protocol)) fail("仅允许迁移有效的自定义API配置。");
  let baseUrl;
  try { baseUrl = normalizeModelBase(text(row.base_url, 500, "接口地址")); }
  catch { fail("源API接口地址格式不正确，未导入配置。"); }
  const ownerId = text(row.owner_id, 256, "源用户ID");
  const model = text(row.model, 100, "图像模型");
  const textModel = text(row.text_model ?? "", 100, "文案模型", true);
  const quality = row.image_quality ?? "auto";
  const resolution = row.image_resolution ?? "1k";
  if (!["auto", "high", "medium", "low"].includes(quality) || !["1k", "2k"].includes(resolution)) fail("生成质量或素材尺寸格式不正确。");
  const encrypted = text(row.encrypted_key, 4096, "源加密API Key");
  const parts = encrypted.split(".");
  if (parts.length !== 2) fail("源加密API Key格式不正确。");
  const iv = base64(parts[0], "源加密API Key");
  const ciphertext = base64(parts[1], "源加密API Key");
  if (iv.length !== 12 || ciphertext.length < 17) fail("源加密API Key格式不正确。");
  const hint = text(row.key_hint, 4, "源密钥末四位", true);
  return { targetEmail, secret, ownerId, model, textModel, quality, resolution, baseUrl, iv, ciphertext, hint, overwrite: input.overwrite === true };
}
async function importKey(bytes, usages) {
  return webcrypto.subtle.importKey("raw", bytes, "AES-GCM", false, usages);
}
async function main() {
  if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
    process.stdout.write("将自定义API配置导入已创建的织境服务器账号\n\n仅通过标准输入提供JSON：\n  { targetEmail, sourceEncryptionSecret, settings: 源model_settings行, overwrite?: false }\n\n在项目根目录运行，DATA_DIR指向服务器数据目录。仅写入model_settings；默认拒绝覆盖已存在配置。不会导入作品、素材、账号或登录会话，不会请求模型服务。不要将密钥放进命令行参数。\n");
    return;
  }
  if (process.argv.length !== 2) fail("仅接受--help；私密输入须通过标准输入JSON传入。");
  const input = validate(await readInput());
  const sqlite = getSqlite();
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get()) fail("目标账号尚未创建，请先创建服务器账号。");
  const target = sqlite.prepare("SELECT id FROM accounts WHERE email = ?").get(input.targetEmail);
  if (!target) fail("目标邮箱不存在，未导入配置；请先创建服务器账号。");

  let plaintext;
  try {
    const decoded = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: input.iv, additionalData: new TextEncoder().encode(input.ownerId) }, await importKey(input.secret, ["decrypt"]), input.ciphertext);
    plaintext = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch { fail("源配置无法解密，请核对源用户ID及原加密主密钥。"); }
  if (!plaintext || plaintext.trim() !== plaintext || plaintext.length > 1024 || /[\u0000-\u001f\u007f]/.test(plaintext) || plaintext.slice(-4) !== input.hint) fail("源API Key或末四位校验失败，未导入配置。");

  const serverSecret = base64(getEncryptionSecret(), "服务器加密主密钥");
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(target.id) }, await importKey(serverSecret, ["encrypt"]), new TextEncoder().encode(plaintext));
  const encryptedKey = Buffer.from(iv).toString("base64") + "." + Buffer.from(ciphertext).toString("base64");

  sqlite.exec("BEGIN IMMEDIATE");
  try {
    if (!sqlite.prepare("SELECT 1 FROM accounts WHERE id = ? AND email = ?").get(target.id, input.targetEmail)) fail("目标账号已发生变化，未导入配置。");
    if (!input.overwrite && sqlite.prepare("SELECT 1 FROM model_settings WHERE owner_id = ?").get(target.id)) fail("目标账号已有API配置；未覆盖。确认替换时在标准输入中明确设置overwrite=true。");
    sqlite.prepare("INSERT INTO model_settings (owner_id, protocol, base_url, model, text_model, image_quality, image_resolution, encrypted_key, key_hint, updated_at) VALUES (?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET protocol = excluded.protocol, base_url = excluded.base_url, model = excluded.model, text_model = excluded.text_model, image_quality = excluded.image_quality, image_resolution = excluded.image_resolution, encrypted_key = excluded.encrypted_key, key_hint = excluded.key_hint, updated_at = excluded.updated_at")
      .run(target.id, input.baseUrl, input.model, input.textModel, input.quality, input.resolution, encryptedKey, plaintext.slice(-4), new Date().toISOString());
    sqlite.exec("COMMIT");
  } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  process.stdout.write("自定义API配置已导入目标账号；未导入作品、素材、账号或会话。\n");
}

main().catch(error => {
  // Never print decrypted keys, input JSON, SQL values or arbitrary runtime errors.
  process.stderr.write((error instanceof ImportInputError ? error.message : "API配置导入失败，请检查服务器数据目录与加密配置。") + "\n");
  process.exitCode = 1;
});
