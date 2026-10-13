/** Validate font containers before storing or passing their bytes to a browser. */
export const FONT_FILE_LIMIT = 20 * 1024 * 1024;
export const FONT_ACCOUNT_LIMIT = 100 * 1024 * 1024;
export const FONT_ACCOUNT_COUNT = 20;

const sfntLimit = 100 * 1024 * 1024;
// Some table tags contain a significant trailing space.
const woff2Tags = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

function invalid(): never {
  throw new Error("字体文件格式不正确或已损坏，请上传有效的 TTF、OTF、WOFF 或 WOFF2 字体。");
}

export function fontDisplayName(filename: string): string {
  return filename.split(/[\\/]/).at(-1)!.replace(/\.(ttf|otf|woff2?)$/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "自定义字体";
}

export function inspectFontUpload(filename: string, bytes: Uint8Array): { name: string; mime: string } {
  if (bytes.byteLength > FONT_FILE_LIMIT) throw new Error("单个字体请小于 20MB。");
  const extension = filename.match(/\.([^.]+)$/)?.[1].toLowerCase();
  if (!extension || !["ttf", "otf", "woff", "woff2"].includes(extension) || bytes.byteLength < 12) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = bytes.byteLength;
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const u16 = (offset: number) => view.getUint16(offset);
  const u32 = (offset: number) => view.getUint32(offset);
  const signature = tag(0);
  const tables = new Map<string, number>();
  const addTable = (name: string, length: number) => {
    if (!/^[\x20-\x7e]{4}$/.test(name) || tables.has(name) || length > sfntLimit) invalid();
    tables.set(name, length);
  };
  const requireTables = () => {
    if ((tables.get("head") ?? 0) < 54 || (tables.get("cmap") ?? 0) < 4 ||
      (tables.get("name") ?? 0) < 6 || (tables.get("maxp") ?? 0) < 6 ||
      !(tables.has("CFF ") || tables.has("CFF2") || (tables.has("glyf") && tables.has("loca")))) invalid();
  };
  const ranges: Array<[number, number]> = [];
  const addRange = (offset: number, length: number, minimum: number) => {
    if (offset < minimum || offset % 4 !== 0 || offset + length > size) invalid();
    if (length) {
      if (ranges.some(([start, end]) => offset < end && offset + length > start)) invalid();
      ranges.push([offset, offset + length]);
    }
  };
  if (signature === "wOFF" || signature === "wOF2") {
    const isWoff2 = signature === "wOF2";
    const headerSize = isWoff2 ? 48 : 44;
    if (extension !== (isWoff2 ? "woff2" : "woff") || size < headerSize || u32(8) !== size || u16(14) !== 0) invalid();
    if (u32(4) !== 0x00010000 && tag(4) !== "OTTO") invalid();
    const count = u16(12);
    const sfntSize = u32(16);
    if (!count || count > 4096 || sfntSize < 12 + count * 16 || sfntSize > sfntLimit) invalid();
    // Metadata and private data must be wholly inside the supplied container.
    const extraOffset = isWoff2 ? 28 : 24;
    for (const [offsetAt, lengthAt] of [[extraOffset, extraOffset + 4], [extraOffset + 12, extraOffset + 16]]) {
      const offset = u32(offsetAt), length = u32(lengthAt);
      if (Boolean(offset) !== Boolean(length) || (offset && (offset < headerSize || offset + length > size))) invalid();
    }
    if (!isWoff2) {
      const directoryEnd = 44 + count * 20;
      if (directoryEnd > size) invalid();
      for (let i = 0; i < count; i++) {
        const record = 44 + i * 20;
        const length = u32(record + 8), originalLength = u32(record + 12);
        if (length > originalLength) invalid();
        addTable(tag(record), originalLength);
        addRange(u32(record + 4), length, directoryEnd);
      }
    } else {
      let cursor = 48;
      const base128 = () => {
        let value = 0;
        for (let i = 0; i < 5; i++) {
          if (cursor >= size) invalid();
          const next = bytes[cursor++];
          if ((!i && next === 0x80) || value > 0x1ffffff) invalid();
          value = value * 128 + (next & 0x7f);
          if (!(next & 0x80)) return value;
        }
        return invalid();
      };
      for (let i = 0; i < count; i++) {
        if (cursor >= size) invalid();
        const flags = bytes[cursor++];
        let name = woff2Tags[flags & 63];
        if ((flags & 63) === 63) {
          if (cursor + 4 > size) invalid();
          name = tag(cursor); cursor += 4;
        }
        const originalLength = base128();
        addTable(name, originalLength);
        const version = flags >> 6;
        const outlines = name === "glyf" || name === "loca";
        if ((outlines && version !== 0 && version !== 3) || (!outlines && version !== 0 && !(name === "hmtx" && version === 1))) invalid();
        if (outlines ? version === 0 : version !== 0) {
          const transformedLength = base128();
          if (transformedLength > sfntLimit || (name === "loca" && transformedLength !== 0)) invalid();
        }
      }
      const compressedLength = u32(20);
      if (!compressedLength || cursor + compressedLength > size) invalid();
      for (const offsetAt of [28, 40]) {
        if (u32(offsetAt) && u32(offsetAt) < cursor + compressedLength) invalid();
      }
    }
    requireTables();
    const expandedBytes = [...tables.values()].reduce((sum, length) => sum + Math.ceil(length / 4) * 4, 12 + count * 16);
    if (expandedBytes > sfntLimit) invalid();
    return { name: fontDisplayName(filename), mime: isWoff2 ? "font/woff2" : "font/woff" };
  }
  const isOpenType = signature === "OTTO";
  if (extension !== (isOpenType ? "otf" : "ttf") || (!isOpenType && u32(0) !== 0x00010000)) invalid();
  const count = u16(4);
  const directoryEnd = 12 + count * 16;
  if (!count || count > 4096 || directoryEnd > size) invalid();
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const length = u32(record + 12);
    addTable(tag(record), length);
    addRange(u32(record + 8), length, directoryEnd);
  }
  requireTables();
  return { name: fontDisplayName(filename), mime: isOpenType ? "font/otf" : "font/ttf" };
}
