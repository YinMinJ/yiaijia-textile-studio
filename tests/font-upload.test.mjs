import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { FONT_FILE_LIMIT, fontDisplayName, inspectFontUpload } from "../lib/font-upload.ts";

function sfnt(openType = false) {
  const records = [["head", 54], ["cmap", 4], ["name", 6], ["maxp", 6], ...(openType ? [["CFF ", 4]] : [["glyf", 4], ["loca", 4]])];
  let cursor = 12 + records.length * 16;
  const bytes = Buffer.alloc(cursor + records.reduce((total, [, length]) => total + Math.ceil(length / 4) * 4, 0));
  if (openType) bytes.write("OTTO"); else bytes.writeUInt32BE(0x10000);
  bytes.writeUInt16BE(records.length, 4);
  for (const [index, [tag, length]] of records.entries()) {
    const record = 12 + index * 16;
    bytes.write(tag, record);
    bytes.writeUInt32BE(cursor, record + 8);
    bytes.writeUInt32BE(length, record + 12);
    cursor += Math.ceil(length / 4) * 4;
  }
  return bytes;
}

function woff() {
  const source = sfnt();
  const count = source.readUInt16BE(4);
  const directoryEnd = 44 + count * 20;
  const payload = source.subarray(12 + count * 16);
  const bytes = Buffer.alloc(directoryEnd + payload.length);
  bytes.write("wOFF"); bytes.writeUInt32BE(0x10000, 4);
  bytes.writeUInt32BE(bytes.length, 8); bytes.writeUInt16BE(count, 12);
  bytes.writeUInt32BE(source.length, 16);
  for (let i = 0; i < count; i++) {
    const record = 44 + i * 20, original = 12 + i * 16;
    source.copy(bytes, record, original, original + 4);
    bytes.writeUInt32BE(source.readUInt32BE(original + 8) - (12 + count * 16) + directoryEnd, record + 4);
    bytes.writeUInt32BE(source.readUInt32BE(original + 12), record + 8);
    bytes.writeUInt32BE(source.readUInt32BE(original + 12), record + 12);
  }
  payload.copy(bytes, directoryEnd);
  return bytes;
}

test("font validation accepts real bundled fonts and sfnt/WOFF container structures", () => {
  for (const name of readdirSync(new URL("../public/fonts/", import.meta.url)).filter(name => /\.(?:woff2?|otf|ttf)$/i.test(name))) {
    assert.match(inspectFontUpload(name, readFileSync(new URL(`../public/fonts/${name}`, import.meta.url))).mime, /^font\//);
  }
  assert.equal(inspectFontUpload("样例.ttf", sfnt()).mime, "font/ttf");
  assert.equal(inspectFontUpload("样例.OTF", sfnt(true)).mime, "font/otf");
  assert.equal(inspectFontUpload("样例.woff", woff()).mime, "font/woff");
});

test("font validation rejects renamed payloads, unsupported containers and excessive size", () => {
  for (const [name, bytes] of [["fake.ttf", Buffer.from("<html>not a font</html>")], ["fake.woff", sfnt()], ["fake.otf", sfnt()], ["font.ttc", sfnt()], ["font.svg", sfnt()], ["font.ttf", Buffer.alloc(4)]]) {
    assert.throws(() => inspectFontUpload(name, bytes), /格式不正确/);
  }
  assert.throws(() => inspectFontUpload("huge.ttf", new Uint8Array(FONT_FILE_LIMIT + 1)), /20MB/);
});

test("sfnt validation rejects truncated, duplicate, overlapping or out-of-range font tables", () => {
  const valid = sfnt();
  for (const mutate of [
    bytes => bytes.writeUInt16BE(4097, 4),
    bytes => bytes.writeUInt32BE(bytes.length, 20),
    bytes => bytes.writeUInt32BE(0xffffffff, 24),
    bytes => bytes.writeUInt32BE(bytes.readUInt32BE(20), 36),
    bytes => bytes.write("head", 28),
    bytes => bytes.write("gone", 12),
  ]) {
    const corrupt = Buffer.from(valid); mutate(corrupt);
    assert.throws(() => inspectFontUpload("invalid.ttf", corrupt), /格式不正确/);
  }
  assert.throws(() => inspectFontUpload("invalid.ttf", valid.subarray(0, valid.length - 1)), /格式不正确/);
});

test("compressed font validation rejects impossible dimensions, offsets and truncation", () => {
  const validWoff = woff();
  for (const mutate of [bytes => bytes.writeUInt32BE(0, 8), bytes => bytes.writeUInt16BE(1, 14), bytes => bytes.writeUInt32BE(0xffffffff, 16), bytes => bytes.writeUInt32BE(0xffffffff, 52)]) {
    const corrupt = Buffer.from(validWoff); mutate(corrupt);
    assert.throws(() => inspectFontUpload("invalid.woff", corrupt), /格式不正确/);
  }
  const validWoff2 = readFileSync(new URL("../public/fonts/ResourceHanRoundedCN-Regular.woff2", import.meta.url));
  for (const mutate of [bytes => bytes.writeUInt32BE(0, 20), bytes => bytes.writeUInt32BE(bytes.length, 20), bytes => { bytes.writeUInt32BE(4, 28); bytes.writeUInt32BE(4, 32); }, bytes => bytes.writeUInt16BE(4096, 12)]) {
    const corrupt = Buffer.from(validWoff2); mutate(corrupt);
    assert.throws(() => inspectFontUpload("invalid.woff2", corrupt), /格式不正确/);
  }
  assert.throws(() => inspectFontUpload("invalid.woff2", validWoff2.subarray(0, 60)), /格式不正确/);
});

test("font display names remove paths, extension and control characters and remain bounded", () => {
  assert.equal(fontDisplayName("C:\\secret\\ 我的字体.WOFF2"), "我的字体");
  assert.equal(fontDisplayName("../../A\u0000B.ttf"), "AB");
  assert.equal(fontDisplayName(" .otf"), "自定义字体");
  assert.equal(fontDisplayName("字".repeat(100) + ".ttf").length, 80);
});
