import { ref } from "vue";
import { appPath } from "../lib/app-path";
import type { TextFont } from "../lib/design-fonts";

type CustomFont = { id: string; name: string; url: string };
export function useCopyFonts() {
  const fonts = ref<CustomFont[]>([]);
  const error = ref("");
  const loading = ref(false);
  let loaded = false;
  async function load() {
    if (loading.value || loaded) return;
    loading.value = true;
    error.value = "";
    try {
      const response = await fetch(appPath("/api/fonts"), { signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "我的字体暂时无法读取，请重试。");
      fonts.value = [...fonts.value, ...data.fonts.filter((font: CustomFont) => !fonts.value.some(existing => existing.id === font.id))];
      loaded = true;
    } catch (e) { error.value = e instanceof Error ? e.message : "我的字体暂时无法读取，请重试。"; }
    finally { loading.value = false; }
  }
  async function upload(file: File): Promise<TextFont> {
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024)
      throw new Error("请选择20MB以内的 TTF、OTF、WOFF 或 WOFF2 字体文件。");
    // Browser validation happens before storing an unsupported or corrupt font.
    try { await new FontFace("ZhijingUploadCheck", await file.arrayBuffer()).load(); }
    catch { throw new Error("这个字体文件无法读取，请换一个有效的字体文件。"); }
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(appPath("/api/fonts"), { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.font?.id) throw new Error(data?.error || "字体上传失败，请稍后重试。");
    fonts.value = [data.font, ...fonts.value.filter(font => font.id !== data.font.id)];
    return `custom:${data.font.id}`;
  }
  return { fonts, loading, error, load, upload };
}
