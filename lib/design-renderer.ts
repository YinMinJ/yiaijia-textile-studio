import {
  categoryFor,
  moduleSection,
  dimensions,
  type Project,
  type DesignModule,
} from "./design-model";
import { appPath } from "./app-path";
const pictures = new Map<string, Promise<HTMLImageElement>>();
function picture(url: string) {
  if (!pictures.has(url))
    pictures.set(
      url,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => {
          pictures.delete(url);
          reject(new Error("图片暂时无法读取，请重新选择素材。"));
        };
        image.src = appPath(url);
      }),
    );
  return pictures.get(url)!;
}
let fontReady: Promise<unknown> | null = null;
function font() {
  if (!fontReady) {
    fontReady = Promise.all([400, 500, 700].map((weight) =>
      document.fonts.load(`${weight} 16px TextileSans`, "织境 家纺 Aa 0123 ×"),
    )).catch(() => {
      fontReady = null;
      throw new Error("文案字体暂时无法加载，请刷新页面后重试。");
    });
  }
  return fontReady;
}
function cover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  cx = 50,
  cy = 50,
  zoom = 1,
) {
  const enlargement = Number.isFinite(zoom) ? Math.min(2, Math.max(1, zoom)) : 1;
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight) * enlargement;
  const sw = w / scale,
    sh = h / scale;
  const position = (value: number) => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50;
  const sx = ((image.naturalWidth - sw) * position(cx)) / 100,
    sy = ((image.naturalHeight - sh) * position(cy)) / 100;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  value: string,
  width: number,
) {
  const lines: string[] = [];
  for (const paragraph of value.trim().split(/\r?\n/)) {
    const paragraphStart = lines.length;
    let line = "";
    for (const letter of paragraph) {
      if (line && ctx.measureText(line + letter).width > width) {
        lines.push(line.trimEnd());
        line = letter.trimStart();
      } else line += letter;
    }
    if (line) {
      // Balance an automatically wrapped one-character Chinese tail. Explicit
      // newlines and punctuation stay where the author placed them.
      if (/^\p{Script=Han}$/u.test(line) && lines.length > paragraphStart) {
        const previous = [...lines[lines.length - 1]];
        const last = previous[previous.length - 1];
        const beforeLast = previous[previous.length - 2];
        if (previous.length > 2 && /^\p{Script=Han}$/u.test(last) &&
          !/[（\[\{《〈「『【〔“‘]/u.test(beforeLast) &&
          ctx.measureText(last + line).width <= width) {
          lines[lines.length - 1] = previous.slice(0, -1).join("");
          line = last + line;
        }
      }
      lines.push(line);
    }
  }
  return lines;
}

/** A two-line headline reads as clauses, rather than a long line and a short tail. */
function headlineLines(ctx: CanvasRenderingContext2D, value: string, width: number) {
  const automatic = wrapLines(ctx, value, width);
  if (automatic.length !== 2 || /[\r\n]/.test(value)) return automatic;
  const letters = [...value.trim()];
  const candidates: { lines: string[]; balance: number }[] = [];
  letters.forEach((letter, index) => {
    if (letter !== "，" || index === letters.length - 1) return;
    const first = letters.slice(0, index + 1).join("").trimEnd();
    const second = letters.slice(index + 1).join("").trimStart();
    if (!first || !second) return;
    const firstWidth = ctx.measureText(first).width, secondWidth = ctx.measureText(second).width;
    if (firstWidth <= width && secondWidth <= width)
      candidates.push({ lines: [first, second], balance: Math.abs(firstWidth - secondWidth) });
  });
  candidates.sort((a, b) => a.balance - b.balance);
  return candidates[0]?.lines || automatic;
}

/** Keep copy inside a measured box, including explicit line breaks and CJK. */
function textBox(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    size: number;
    min?: number;
    color?: string;
    weight?: number;
    align?: CanvasTextAlign;
    leading?: number;
    headline?: boolean;
  },
) {
  if (!value.trim()) return y;
  const leading = options.leading ?? 1.3;
  let size = options.size;
  let lines: string[] = [];
  for (;;) {
    ctx.font = `${options.weight ?? 400} ${size}px TextileSans, sans-serif`;
    lines = options.headline ? headlineLines(ctx, value, width) : wrapLines(ctx, value, width);
    if (lines.length * size * leading <= height || size <= (options.min ?? 20))
      break;
    size -= 1;
  }
  const maximum = Math.max(1, Math.floor(height / (size * leading)));
  if (lines.length > maximum) {
    lines = lines.slice(0, maximum);
    let last = lines[maximum - 1];
    while (last && ctx.measureText(last + "…").width > width)
      last = last.slice(0, -1);
    lines[maximum - 1] = last + "…";
  }
  ctx.fillStyle = options.color ?? "#302921";
  ctx.textBaseline = "top";
  ctx.textAlign = options.align ?? "left";
  const anchor = options.align === "center" ? x + width / 2 : options.align === "right" ? x + width : x;
  lines.forEach((line, i) => ctx.fillText(line, anchor, y + i * size * leading));
  return y + lines.length * size * leading;
}

type CopyAppearance = DesignModule & {
  textPosition?: "auto" | "top-right" | "top-left" | "bottom-right" | "bottom-left";
  textColor?: "auto" | "dark" | "light";
};

/** Contrast follows the actual picture; it never paints a backing behind copy. */
function photoInk(
  ctx: CanvasRenderingContext2D,
  module: CopyAppearance,
  box: { x: number; y: number; width: number; height: number },
  onPhoto: boolean,
) {
  if (module.textColor === "dark") return "#262626";
  if (module.textColor === "light") return "#ffffff";
  if (!onPhoto || typeof ctx.getImageData !== "function") return "#262626";
  try {
    const transform = typeof ctx.getTransform === "function" ? ctx.getTransform() : { a: 1, d: 1 };
    const scaleX = Math.abs(transform.a) || 1, scaleY = Math.abs(transform.d) || 1;
    let total = 0, samples = 0;
    for (const dx of [0.18, 0.5, 0.82]) {
      for (const dy of [0.16, 0.5, 0.84]) {
        const pixels = ctx.getImageData(
          Math.max(0, Math.round((box.x + box.width * dx) * scaleX)),
          Math.max(0, Math.round((box.y + box.height * dy) * scaleY)), 5, 5,
        ).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if (!pixels[i + 3]) continue;
          total += (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255;
          samples++;
        }
      }
    }
    return samples && total / samples < 0.47 ? "#ffffff" : "#262626";
  } catch {
    // Cross-origin pictures can disallow pixel reads. Manual color remains available.
    return "#262626";
  }
}

async function drawReference(
  ctx: CanvasRenderingContext2D,
  p: Project,
  m: DesignModule,
  w: number,
  h: number,
) {
  const appearance = m as CopyAppearance;
  const section = moduleSection(m);
  const composition = m.composition || "auto";
  const position = appearance.textPosition && appearance.textPosition !== "auto"
    ? appearance.textPosition : "top-right";
  const left = position.endsWith("left"), bottom = position.startsWith("bottom");
  const align: CanvasTextAlign = left ? "left" : "right";
  const pad = w * 0.04, inner = w - pad * 2;
  // Saved module copy is authoritative, including an intentionally empty line.
  // Generation decides the facts; changing layout never inserts new claims.
  const subtitle = m.subtitle;
  // One plain canvas foundation is sufficient for photo grids and real product
  // information. There are no text panels, filled badges, masks or gradients.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const copy = (value: string, x: number, y: number, width: number, height: number,
    size: number, options: Partial<Parameters<typeof textBox>[6]> = {}) =>
    textBox(ctx, value, x, y, width, height, {
      size, min: w * 0.021, color: "#262626", ...options,
    });
  const headlineX = left ? pad : w * 0.265;
  const headlineWidth = w * 0.735 - pad;
  const titleSize = w * (composition === "minimal" ? 0.064 : 0.072);
  const subtitleSize = w * 0.035;
  const titleLimit = w * 0.215, subtitleLimit = w * 0.125;
  const gap = w * 0.015;
  const heightFor = (value: string, width: number, size: number, limit: number,
    weight: number, leading: number, min: number, headline = false) => {
    if (!value.trim()) return 0;
    while (true) {
      ctx.font = `${weight} ${size}px TextileSans, sans-serif`;
      const count = (headline ? headlineLines(ctx, value, width) : wrapLines(ctx, value, width)).length;
      if (count * size * leading <= limit || size <= min) return Math.min(limit, count * size * leading);
      size--;
    }
  };
  const titleHeight = heightFor(m.title, headlineWidth, titleSize, titleLimit, 700, 1.2, w * 0.032, true);
  const subtitleHeight = heightFor(subtitle, headlineWidth, subtitleSize, subtitleLimit, 400, 1.25, w * 0.021);
  const copyHeight = titleHeight + (subtitleHeight && titleHeight ? gap : 0) + subtitleHeight;
  const topY = w * 0.067;
  const copyY = bottom ? h - pad - copyHeight : topY;
  const headingBox = { x: headlineX, y: copyY, width: headlineWidth, height: Math.max(1, copyHeight) };
  const heading = (onPhoto: boolean) => {
    const ink = photoInk(ctx, appearance, headingBox, onPhoto);
    const end = copy(m.title, headlineX, copyY, headlineWidth, Math.max(titleHeight, 1), titleSize,
      { min: w * 0.032, weight: 700, leading: 1.2, align, color: ink, headline: true });
    if (subtitleHeight) copy(subtitle, headlineX, end + (titleHeight ? gap : 0), headlineWidth,
      subtitleHeight, subtitleSize, { min: w * 0.021, leading: 1.25, align, color: ink });
  };
  if (section === "specs") {
    heading(false);
    const bedding = categoryFor(p).id === "bedding-set";
    const rows = [
      ["商品名称", p.info.name], ["品牌", p.info.brand], ["面料成分", p.info.material],
      ...(bedding ? [["套件组成", p.info.setContents || ""]] : [["填充物", p.info.filling]]),
      ["尺寸规格", p.info.size], ...(!bedding ? [["重量", p.info.weight]] : []),
      ["颜色", p.info.colors], ["洗护说明", p.info.care],
    ].filter(([, value]) => value.trim());
    const rowTop = bottom ? pad * 1.8 : topY + copyHeight + pad;
    const rowBottom = bottom ? copyY - pad : h - pad;
    const valueX = pad + inner * 0.255, valueWidth = w - pad - valueX;
    let size = w * 0.034;
    let heights: number[] = [];
    for (;;) {
      ctx.font = `400 ${size}px TextileSans, sans-serif`;
      heights = rows.map(([, value]) => Math.max(w * 0.085,
        wrapLines(ctx, value, valueWidth).length * size * 1.3 + w * 0.032));
      if (heights.reduce((sum, value) => sum + value, 0) <= rowBottom - rowTop || size <= w * 0.019) break;
      size--;
    }
    const factor = Math.min(1, (rowBottom - rowTop) / (heights.reduce((sum, value) => sum + value, 0) || 1));
    let y = rowTop;
    const ink = photoInk(ctx, appearance, headingBox, false);
    rows.forEach(([label, value], index) => {
      const height = heights[index] * factor;
      copy(label, pad, y + w * 0.012, inner * 0.22, Math.max(1, height - w * 0.02), Math.min(size, w * 0.029),
        { min: w * 0.017, color: appearance.textColor === "light" ? ink : "#696969" });
      copy(value, valueX, y + w * 0.012, valueWidth, Math.max(1, height - w * 0.02), size,
        { min: w * 0.019, leading: 1.3, color: ink });
      y += height;
    });
    return;
  }

  const primary = p.assets.find(asset => asset.id === m.imageId) || (!m.imageId ? p.assets[0] : undefined);
  if (!primary) throw new Error("请为这张图选择对应的商品实拍。");
  const img = await picture(primary.url);
  const secondAsset = p.assets.find(asset => asset.id === m.imageId2 && asset.id !== primary.id &&
    asset.id !== (m.sourceImageId || primary.id) && !asset.generated);
  const second = secondAsset ? await picture(secondAsset.url) : undefined;
  const photo = (x: number, y: number, width: number, height: number) =>
    cover(ctx, img, x, y, width, height, m.cropX, m.cropY, m.imageZoom);
  const photoFrame = (image: HTMLImageElement, x: number, y: number, width: number, height: number, radius = 0) => {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.clip();
    cover(ctx, image, x, y, width, height);
    ctx.restore();
  };
  const labelFor = (id: string, sourceId?: string) => {
    const asset = p.assets.find(item => item.id === (sourceId || id));
    if (!asset) return "";
    if (section === "components") return ["被套", "床单", "枕套"].includes(asset.role) ? asset.role : "";
    const names = p.info.colors.split(/[·、,，;；/|\n]/).map(value => value.trim()).filter(Boolean);
    return names.find(name => asset.name.includes(name)) || "";
  };
  const photoLabel = (value: string, x: number, y: number, width: number, alignment: CanvasTextAlign = "left") => {
    if (!value) return;
    const box = { x, y, width, height: w * 0.043 };
    copy(value, x, y, width, box.height, w * 0.028,
      { color: photoInk(ctx, appearance, box, true), align: alignment, min: w * 0.019 });
  };
  // Component and color views are photographic grids. Captions remain directly
  // on each real picture, without any white footer or colored caption strip.
  if (["colors", "components"].includes(section) && second && secondAsset) {
    const gap = composition === "immersive" ? 0 : w * (composition === "minimal" ? 0.02 : 0.012);
    const labels = [labelFor(primary.id, m.sourceImageId), labelFor(secondAsset.id, m.sourceImageId2)];
    if (m.kind === "main") {
      const ratio = composition === "split" ? 0.64 : composition === "immersive" ? 0.56 : 0.5;
      const firstWidth = (w - gap) * ratio, secondWidth = w - gap - firstWidth;
      const firstX = composition === "split" ? secondWidth + gap : 0;
      const secondX = composition === "split" ? 0 : firstWidth + gap;
      photo(firstX, 0, firstWidth, h);
      photoFrame(second, secondX, 0, secondWidth, h);
      const captionY = bottom ? pad * 1.6 : h - pad - w * 0.028;
      photoLabel(labels[0], firstX + pad * 0.5, captionY, firstWidth - pad, "left");
      photoLabel(labels[1], secondX + pad * 0.5, captionY, secondWidth - pad, "right");
    } else {
      const ratio = composition === "split" ? 0.61 : composition === "minimal" ? 0.43 : composition === "immersive" ? 0.55 : 0.5;
      const firstHeight = (h - gap) * ratio, secondY = firstHeight + gap;
      photo(0, 0, w, firstHeight);
      photoFrame(second, 0, secondY, w, h - secondY);
      photoLabel(labels[0], pad, firstHeight - pad - w * 0.028, inner);
      photoLabel(labels[1], pad, bottom ? secondY + pad * 1.6 : h - pad - w * 0.028, inner);
    }
    heading(true);
    return;
  }

  const evidence = ["texture", "pattern", "craft", "filling", "components", "colors"].includes(section);
  if (composition === "split" && second && evidence) {
    const gap = w * 0.012, secondWidth = (w - gap) * 0.31;
    // A narrow detail photograph sits beside the larger product photograph;
    // transparent type stays over the product at the chosen corner.
    photo(secondWidth + gap, 0, w - secondWidth - gap, h);
    photoFrame(second, 0, 0, secondWidth, h);
    heading(true);
    return;
  }
  photo(0, 0, w, h);
  if (second && evidence) {
    const width = w * (composition === "immersive" ? 0.23 : composition === "minimal" ? 0.19 : 0.285);
    // Keep the secondary evidence away from the selected copy corner.
    const insetLeft = bottom ? !left : composition === "immersive" ? left : !left;
    const x = insetLeft ? pad : w - pad - width;
    const y = bottom ? pad * 2 : h - pad - width;
    photoFrame(second, x, y, width, width, w * 0.018);
  }
  heading(true);
  if (["colors", "components"].includes(section)) {
    const label = labelFor(primary.id, m.sourceImageId);
    if (label) {
      const box = { x: pad, y: bottom ? pad * 1.6 : h - pad - w * 0.038, width: inner, height: w * 0.038 };
      copy(label, box.x, box.y, box.width, box.height, w * 0.028,
        { color: photoInk(ctx, appearance, box, true), align: "left" });
    }
  }
}

export async function drawDesign(
  canvas: HTMLCanvasElement,
  p: Project,
  m: DesignModule,
  scale = 1,
) {
  await font();
  const size = dimensions(m);
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器无法绘制图片。");
  ctx.scale(scale, scale);
  // Existing projects and every template share the same transparent typography.
  await drawReference(ctx, p, m, size.width, size.height);
  return canvas;
}
export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("图片导出失败，请重试。"))),
      "image/jpeg",
      0.94,
    ),
  );
}
export async function renderBlob(p: Project, m: DesignModule) {
  const canvas = document.createElement("canvas");
  await drawDesign(canvas, p, m);
  const blob = await canvasBlob(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return blob;
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { url, name };
}
