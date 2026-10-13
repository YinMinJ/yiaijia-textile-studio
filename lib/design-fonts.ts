import { appPath } from "./app-path.ts";

export type TextFont = "rounded" | "sans" | "serif" | "kai" | `custom:${string}`;

export const builtInTextFonts = [
  { value: "rounded", label: "柔和圆体" },
  { value: "sans", label: "黑体" },
  { value: "serif", label: "宋体" },
  { value: "kai", label: "楷体" },
] as const;

const customIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const families: Record<(typeof builtInTextFonts)[number]["value"], string> = {
  rounded: "TextileSans, sans-serif",
  sans: "TextileSansPlain, sans-serif",
  serif: "TextileSerif, serif",
  kai: "TextileKai, serif",
};

export function customFontId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("custom:")) return undefined;
  const id = value.slice(7);
  return customIdPattern.test(id) ? id.toLowerCase() : undefined;
}

export function isTextFont(value: unknown): value is TextFont {
  return builtInTextFonts.some(font => font.value === value) || customFontId(value) !== undefined;
}

/** Names and URLs are derived only from a validated ID, never from a font filename. */
export function textFontFamily(value: TextFont = "rounded"): string {
  const id = customFontId(value);
  if (id) return `ZhijingFont_${id.replaceAll("-", "")}`;
  if (!isTextFont(value)) throw new Error("字体设置无效，请重新选择字体。");
  return families[value as keyof typeof families];
}

const readyByDocument = new WeakMap<Document, Map<TextFont, Promise<void>>>();

/** Share only the requested face across concurrent previews and full-size exports. */
export function ensureTextFont(value: TextFont = "rounded"): Promise<void> {
  const family = textFontFamily(value);
  let ready = readyByDocument.get(document);
  if (!ready) {
    ready = new Map();
    readyByDocument.set(document, ready);
  }
  const id = customFontId(value);
  const key: TextFont = id ? `custom:${id}` : value;
  if (!ready.has(key)) {
    const load = async () => {
      if (id) {
        const face = new FontFace(family, `url("${appPath(`/api/fonts/${id}`)}")`);
        const loaded = await face.load();
        if (loaded.status !== "loaded") throw new Error("FontFace was not loaded");
        document.fonts.add(loaded);
        return;
      }
      const results = await Promise.all([400, 500, 700].map(weight =>
        document.fonts.load(`${weight} 16px ${family}`, "织境 家纺 Aa 0123 ×"),
      ));
      // Every bundled face must resolve; a silent browser fallback would change
      // measured wrapping and the customer's exported design.
      if (results.some(faces => faces.length === 0))
        throw new Error("The bundled font was not loaded");
    };
    ready.set(key, load().catch(() => {
      ready!.delete(key);
      throw new Error(id
        ? "自定义字体暂时无法加载，请确认字体仍可用，或重新选择字体后再导出。"
        : "文案字体暂时无法加载，请刷新页面后重试。");
    }));
  }
  return ready.get(key)!;
}
