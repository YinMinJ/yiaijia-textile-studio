import {
  categoryFor,
  dimensions,
  templates,
  type Project,
  type DesignModule,
} from "./design-model";
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
        image.src = url;
      }),
    );
  return pictures.get(url)!;
}
let fontReady: Promise<unknown> | null = null;
function font() {
  if (!fontReady) {
    fontReady = Promise.all([400, 500, 700].map((weight) =>
      document.fonts.load(`${weight} 16px TextileSans`, "宜爱家 Aa 0123 ×"),
    )).catch(() => {
      fontReady = null;
      throw new Error("文案字体暂时无法加载，请刷新页面后重试。");
    });
  }
  return fontReady;
}
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  max: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight = 500,
) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.font = weight + " " + size + "px TextileSans, sans-serif";
  while (ctx.measureText(text).width > max && size > 17) {
    size -= 1;
    ctx.font = weight + " " + size + "px TextileSans, sans-serif";
  }
  ctx.fillText(text, x, y, max);
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
) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale,
    sh = h / scale;
  const sx = ((image.naturalWidth - sw) * cx) / 100,
    sy = ((image.naturalHeight - sh) * cy) / 100;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  value: string,
  width: number,
) {
  const lines: string[] = [];
  for (const paragraph of value.trim().split(/\r?\n/)) {
    let line = "";
    for (const letter of paragraph) {
      if (line && ctx.measureText(line + letter).width > width) {
        lines.push(line.trimEnd());
        line = letter.trimStart();
      } else line += letter;
    }
    if (line) lines.push(line);
  }
  return lines;
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
  },
) {
  if (!value.trim()) return y;
  const leading = options.leading ?? 1.3;
  let size = options.size;
  let lines: string[] = [];
  for (;;) {
    ctx.font = `${options.weight ?? 400} ${size}px TextileSans, sans-serif`;
    lines = wrapLines(ctx, value, width);
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

function contain(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

async function drawVip(
  ctx: CanvasRenderingContext2D,
  p: Project,
  m: DesignModule,
  w: number,
  h: number,
) {
  const main = m.kind === "main";
  const category = categoryFor(p);
  const bedding = category.id === "bedding-set";
  const section = m.section ||
    (main
      ? ["hero", "texture", "craft", "scene", "colors"]
      : ["hero", "benefits", "texture", "craft", "colors", "specs", "care"])[m.index - 1];
  const palette = { ...category.palette, white: "#fffdf8", line: bedding ? "#e5dbc1" : "#d8cbbb" };
  const pad = main ? 52 : 44;
  const inner = w - pad * 2;
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, w, h);
  const copy = (
    value: string, x: number, y: number, width: number, height: number,
    size: number, options: Parameters<typeof textBox>[6] = { size },
  ) => textBox(ctx, value, x, y, width, height, { color: palette.ink, ...options });
  const rounded = (x: number, y: number, width: number, height: number, radius = 24) => {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  };
  const ornament = () => {
    if (!bedding) return;
    ctx.fillStyle = "#efe1b96b";
    ctx.beginPath();
    ctx.ellipse(w - 72, 168, 166, 192, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e5c9ba38";
    ctx.beginPath();
    ctx.arc(28, h - 40, 142, 0, Math.PI * 2);
    ctx.fill();
  };
  const line = (y: number, width = inner) => {
    ctx.fillStyle = palette.ink;
    ctx.fillRect(pad, y, width, 2);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(pad, y - 3, Math.min(60, width), 8);
  };
  const points = [...new Set(p.info.sellingPoints.split(/[\n；;]/)
    .map((value) => value.trim()).filter(Boolean))];
  const pills = (values: string[], x: number, y: number, width: number, size: number) => {
    const labels = values.map((value) => value.trim()).filter(Boolean).slice(0, bedding ? 1 : 2);
    if (!labels.length) return;
    const gap = 12;
    const slot = (width - gap * (labels.length - 1)) / labels.length;
    ctx.font = `500 ${size}px TextileSans, sans-serif`;
    const widths = labels.map((label) => Math.min(slot, ctx.measureText(label).width + 34));
    // Keep the complete label group on the title's right edge, regardless of copy length.
    let chipX = x + width - widths.reduce((sum, value) => sum + value, 0) - gap * (labels.length - 1);
    labels.forEach((label, index) => {
      const chipWidth = widths[index];
      ctx.fillStyle = palette.accent;
      rounded(chipX, y, chipWidth, size + 25, bedding ? 8 : (size + 25) / 2);
      ctx.fill();
      copy(label, chipX + 17, y + 10, chipWidth - 34, size + 8, size,
        { size, min: 15, color: palette.white, weight: 500, align: "center" });
      chipX += chipWidth + gap;
    });
  };
  const brand = (onPhoto = false) => {
    const label = p.info.brand.trim();
    if (!label) return;
    const size = main ? 30 : 22;
    ctx.font = `700 ${size}px TextileSans, sans-serif`;
    const width = Math.min(inner, ctx.measureText(label).width + 32);
    if (onPhoto) {
      ctx.fillStyle = "#fffdf8e8";
      rounded(pad - 16, 28, width, size + 25, bedding ? 12 : 0);
      ctx.fill();
    }
    copy(label, pad, main ? 39 : 34, inner, 42, size, {
      size, color: palette.brand, weight: 700,
    });
  };
  const header = (height: number, centered = false, subtitle = m.subtitle) => {
    ornament();
    brand();
    const titleY = main ? 104 : 91;
    const titleH = height - titleY - (subtitle ? 80 : 27);
    const bottom = copy(m.title, pad, titleY, inner, titleH, main ? 74 : 62, {
      size: main ? 74 : 62, min: main ? 24 : 20, weight: 700,
      align: centered ? "center" : "left", leading: 1.18,
    });
    if (subtitle)
      copy(subtitle, pad, Math.min(bottom + 17, height - 64), inner, 52,
        main ? 30 : 25, {
          size: main ? 30 : 25, min: 13, color: palette.muted,
          align: centered ? "center" : "left",
        });
  };
  const primary = p.assets.find((asset) => asset.id === m.imageId);
  if (section === "specs") {
    header(222);
    const rows = [
      ["商品名称", p.info.name], ["品牌", p.info.brand],
      ["面料成分", p.info.material],
      ...(bedding ? [["套件组成", p.info.setContents || ""]] : [["填充物", p.info.filling]]),
      ["尺寸规格", p.info.size], ...(!bedding ? [["重量", p.info.weight]] : []),
      ["颜色", p.info.colors], ["洗护说明", p.info.care],
    ].filter(([, value]) => value.trim());
    const valueWidth = inner - 176;
    let fontSize = 26;
    let heights: number[] = [];
    for (;;) {
      ctx.font = `400 ${fontSize}px TextileSans, sans-serif`;
      heights = rows.map(([, value]) => Math.max(70,
        wrapLines(ctx, value, valueWidth).length * fontSize * 1.3 + 32));
      if (heights.reduce((sum, value) => sum + value, 0) <= h - 266 || fontSize <= 12)
        break;
      fontSize--;
    }
    let y = 226;
    rows.forEach(([label, value], index) => {
      const rowHeight = heights[index];
      ctx.fillStyle = index % 2 === 0 ? (bedding ? "#f0e6cd" : "#ede2d2") : palette.white;
      ctx.fillRect(pad, y, inner, rowHeight);
      copy(label, pad + 20, y + 20, 130, rowHeight - 26, 23, {
        size: 23, color: palette.muted,
      });
      copy(value, pad + 154, y + 18, valueWidth, rowHeight - 28, fontSize, {
        size: fontSize, min: fontSize,
      });
      y += rowHeight;
    });
    if (primary && h - y > 260) {
      const product = await picture(primary.url);
      cover(ctx, product, pad, y + 30, inner, h - y - 62, m.cropX, m.cropY);
    }
    return;
  }
  if (!primary) throw new Error("请为这张图选择对应的商品实拍。");
  const img = await picture(primary.url);
  const photo = (x: number, y: number, width: number, height: number) =>
    cover(ctx, img, x, y, width, height, m.cropX, m.cropY);
  const photoFrame = (image: HTMLImageElement, x: number, y: number,
    width: number, height: number, fit = false, radius = bedding ? 30 : 0) => {
    ctx.save();
    rounded(x, y, width, height, radius);
    ctx.clip();
    ctx.fillStyle = palette.white;
    ctx.fillRect(x, y, width, height);
    if (fit) contain(ctx, image, x, y, width, height);
    else cover(ctx, image, x, y, width, height, m.cropX, m.cropY);
    ctx.restore();
  };

  if (section === "colors") {
    header(main ? 268 : 249);
    const second = p.assets.find((asset) => asset.id === m.imageId2);
    const pair = second && second.id !== primary.id;
    const swatches = p.info.colors.split(/[·、,，;；/|\n]/).map((s) => s.trim()).filter(Boolean);
    const colorLabel = (id: string, sourceId?: string) => {
      const source = p.assets.find((asset) => asset.id === (sourceId || id));
      return swatches.find((name) => source?.name.includes(name)) || "";
    };
    const frame = (image: HTMLImageElement, x: number, y: number,
      width: number, height: number, label: string) => {
      ctx.fillStyle = palette.white;
      rounded(x, y, width, height, bedding ? 30 : 0);
      ctx.fill();
      photoFrame(image, x, y, width, height - (label ? 64 : 0), true);
      if (label) copy(label, x + 16, y + height - 49, width - 32, 42,
        main ? 30 : 26, { size: main ? 30 : 26, align: "center", weight: 500 });
    };
    if (pair) {
      const img2 = await picture(second.url);
      if (main) {
        const gap = 20, x = 28, width = (w - x * 2 - gap) / 2;
        frame(img, x, 292, width, h - 344,
          colorLabel(primary.id, m.sourceImageId));
        frame(img2, x + width + gap, 292, width, h - 344,
          colorLabel(second.id, m.sourceImageId2));
      } else {
        const top = 268, gap = 18, height = (h - top - 42 - gap) / 2;
        frame(img, pad, top, inner, height, colorLabel(primary.id, m.sourceImageId));
        frame(img2, pad, top + height + gap, inner, height,
          colorLabel(second.id, m.sourceImageId2));
      }
    } else frame(img, pad, main ? 284 : 265, inner,
      h - (main ? 330 : 307), colorLabel(primary.id, m.sourceImageId));
    return;
  }

  if (main && section === "hero") {
    photo(0, 0, w, h);
    const fade = ctx.createLinearGradient(0, 0, 0, h * 0.27);
    fade.addColorStop(0, bedding ? "#fff9edda" : "#fff9eeef");
    fade.addColorStop(0.58, bedding ? "#fff9ed94" : "#fff9eec2");
    fade.addColorStop(1, "#fff9ee00");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h * 0.27);
    brand();
    const titleX = w * 0.27, titleWidth = w - titleX - pad;
    const bottom = copy(m.title, titleX, 40, titleWidth, 180, 82, {
      size: 82, min: 33, weight: 700, align: "right", leading: 1.08,
    });
    const claims = m.subtitle.trim() ? m.subtitle.split(/[·\n；;]/).map((value) => value.trim()) : points;
    pills(claims, titleX, Math.min(bottom + 15, 228), titleWidth, 29);
    return;
  }
  if (main && section === "scene") {
    photo(0, 0, w, h);
    brand(true);
    const boxWidth = bedding ? inner * 0.75 : inner * 0.82;
    ctx.fillStyle = palette.paper + "ed";
    rounded(pad - 20, h - 256, boxWidth + 40, 221, bedding ? 24 : 0);
    ctx.fill();
    const bottom = copy(m.title, pad, h - 236, boxWidth, 116, 64, {
      size: 64, min: 32, weight: 700, leading: 1.15,
    });
    copy(m.subtitle, pad, bottom + 14, boxWidth, h - bottom - 61, 29,
      { size: 30, color: palette.muted });
    return;
  }
  if (section === "components") {
    header(main ? 260 : 248, true);
    const second = p.assets.find((asset) => asset.id === m.imageId2 && asset.id !== primary.id);
    const labelFor = (id: string, sourceId?: string) => {
      const asset = p.assets.find((item) => item.id === (sourceId || id));
      return asset && ["被套", "床单", "枕套"].includes(asset.role) ? asset.role : "";
    };
    const labels = [labelFor(primary.id, m.sourceImageId), second ? labelFor(second.id, m.sourceImageId2) : ""];
    const top = main ? 278 : 268, gap = 20;
    const component = (image: HTMLImageElement, x: number, y: number,
      width: number, height: number, label: string) => {
      const caption = label ? 57 : 0;
      photoFrame(image, x, y, width, height - caption, true);
      if (label) copy(label, x, y + height - 44, width, 42, main ? 30 : 26,
        { size: main ? 30 : 26, align: "center", weight: 500 });
    };
    if (second) {
      const image2 = await picture(second.url);
      if (main) {
        const width = (inner - gap) / 2;
        component(img, pad, top, width, h - top - 44, labels[0]);
        component(image2, pad + width + gap, top, width, h - top - 44, labels[1]);
      } else {
        const height = (h - top - 44 - gap) / 2;
        component(img, pad, top, inner, height, labels[0]);
        component(image2, pad, top + height + gap, inner, height, labels[1]);
      }
    } else component(img, pad, top, inner, h - top - 44, labels[0]);
    return;
  }
  if (section === "filling") {
    const head = main ? 272 : 260;
    header(head);
    line(head - 7);
    // Contain the supplied photo so thickness and the edges stay visible.
    // An absent filling photo is an ordinary product photo, never a fabricated cutaway.
    photoFrame(img, pad, head + 20, inner, h - head - 54, true, 0);
    return;
  }
  if (section === "pattern") {
    header(256, true);
    const benefits = points.slice(0, 4);
    const rowCount = Math.ceil(benefits.length / 2);
    const gap = 14, cardWidth = (inner - gap) / 2;
    benefits.forEach((point, index) => {
      const x = pad + (index % 2) * (cardWidth + gap);
      const y = 269 + Math.floor(index / 2) * 71;
      ctx.fillStyle = ["#eed2c1", "#dae1c9", "#eee0ab", "#e7d7be"][index];
      rounded(x, y, cardWidth, 57, 28);
      ctx.fill();
      copy(point, x + 17, y + 12, cardWidth - 34, 36, 24,
        { size: 24, min: 13, weight: 500, align: "center" });
    });
    const top = 274 + rowCount * 71;
    photoFrame(img, pad, top, inner, h - top - 37, false, 34);
    return;
  }
  if (section === "benefits") {
    const items = points.slice(0, bedding ? 4 : 6);
    const duplicates = m.subtitle.split(/[·\n；;]/).map((value) => value.trim()).filter(Boolean);
    header(238, true, duplicates.length && duplicates.every((value) => points.includes(value)) ? "" : m.subtitle);
    const cols = Math.min(bedding ? 2 : 3, items.length);
    const rows = cols ? Math.ceil(items.length / cols) : 0;
    const gap = 14, cardH = bedding ? 143 : 137, top = 248;
    items.forEach((point, index) => {
      const cardW = (inner - gap * (cols - 1)) / cols;
      const x = pad + (index % cols) * (cardW + gap);
      const y = top + Math.floor(index / cols) * (cardH + gap);
      if (bedding) {
        ctx.fillStyle = ["#eed2c1", "#dae1c9", "#eee0ab", "#e7d7be"][index];
        rounded(x, y, cardW, cardH, 20);
        ctx.fill();
      }
      // Decorative textile-like linework, without certification or feature symbols.
      const cx = x + cardW / 2, cy = y + 31;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(cx - 20, cy - 18, 40, 36, 7);
      ctx.moveTo(cx - 10, cy - 18);
      ctx.lineTo(cx - 10, cy + 18);
      ctx.moveTo(cx + 10, cy - 18);
      ctx.lineTo(cx + 10, cy + 18);
      ctx.moveTo(cx - 20, cy);
      ctx.lineTo(cx + 20, cy);
      ctx.stroke();
      copy(point, x + 12, y + 67, cardW - 24, cardH - 70, 27,
        { size: 27, min: 15, weight: 500, align: "center" });
    });
    const photoY = rows ? top + rows * (cardH + gap) + 7 : top;
    photoFrame(img, bedding ? pad : 0, photoY, bedding ? inner : w,
      h - photoY - (bedding ? 34 : 0));
    return;
  }
  if (main) {
    const head = 260;
    header(head, bedding);
    if (bedding) photoFrame(img, pad, head + 16, inner, h - head - 51);
    else {
      line(head - 6);
      photo(0, head + 17, w, h - head - 17);
    }
    return;
  }
  if (section === "hero") {
    header(298, bedding);
    if (bedding) photoFrame(img, 28, 307, w - 56, h - 337, false, 38);
    else {
      line(286);
      photo(0, 308, w, h - 308);
    }
    return;
  }
  if (section === "care") {
    header(256);
    const care = p.info.care.trim();
    const photoHeight = care ? Math.min(585, h * 0.49) : h - 280;
    photoFrame(img, bedding ? pad : 0, 270, bedding ? inner : w, photoHeight);
    if (care) {
      const y = 270 + photoHeight;
      ctx.fillStyle = "#ebe2d5";
      ctx.fillRect(pad, y + 26, inner, h - y - 52);
      copy(care, pad + 26, y + 51, inner - 52, h - y - 95, 29, {
        size: 29, min: 15, color: palette.ink,
      });
    }
    return;
  }
  if (section === "craft") {
    if (bedding) {
      header(258, true);
      photoFrame(img, pad, 270, inner, h - 307);
      return;
    }
    photo(0, 0, w, h - 263);
    brand(true);
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, h - 263, w, 263);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(pad, h - 236, 60, 5);
    const bottom = copy(m.title, pad, h - 208, inner, 128, 57, {
      size: 57, min: 32, weight: 700, leading: 1.18,
    });
    copy(m.subtitle, pad, bottom + 12, inner, h - bottom - 28, 25,
      { size: 25, min: 20, color: palette.muted });
    return;
  }
  header(264, bedding);
  if (bedding) photoFrame(img, pad, 280, inner, h - 317);
  else {
    line(264);
    photo(0, 280, w, h - 280);
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
  const w = size.width,
    h = size.height;
  if (p.template === "vip") {
    await drawVip(ctx, p, m, w, h);
    return canvas;
  }
  const theme = templates.find((t) => t.id === p.template)!;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);
  const primary = p.assets.find((a) => a.id === m.imageId) || p.assets[0];
  const second = p.assets.find((a) => a.id === m.imageId2) || primary;
  if (!primary) throw new Error("请先上传商品图片。");
  const [img, img2] = await Promise.all([
    picture(primary.url),
    picture(second.url),
  ]);
  const pad = Math.round(w * 0.05),
    inner = w - pad * 2;
  const text = (
    t: string,
    x: number,
    y: number,
    max: number,
    sz: number,
    align: CanvasTextAlign = "left",
    bold = false,
  ) => fitText(ctx, t, x, y, max, sz, theme.ink, align, bold ? 700 : 400);
  const rule = (y: number) => {
    ctx.strokeStyle = theme.accent + "55";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  };
  const brand = () => {
    text(p.info.brand, pad, 32, inner * 0.65, w * 0.024);
    text(
      m.kind === "main"
        ? "HOME TEXTILES"
        : "DETAIL / " + String(m.index).padStart(2, "0"),
      w - pad,
      38,
      inner * 0.4,
      w * 0.016,
      "right",
    );
  };
  const header = (y = 104) => {
    text(m.title, pad, y, inner, w * 0.065, "left", true);
    if (m.subtitle) text(m.subtitle, pad, y + w * 0.097, inner, w * 0.025);
  };
  const footer = () => {
    rule(h - 70);
    text(p.info.brand, pad, h - 47, inner * 0.5, w * 0.021);
    text(
      String(m.index).padStart(2, "0"),
      w - pad,
      h - 47,
      inner * 0.3,
      w * 0.02,
      "right",
    );
  };
  if (m.kind === "main") {
    if (m.index === 1) {
      cover(ctx, img, 0, 0, w, h, m.cropX, m.cropY);
      const fade = ctx.createLinearGradient(0, 0, 0, h * 0.42);
      fade.addColorStop(0, theme.bg);
      fade.addColorStop(0.72, theme.bg + "df");
      fade.addColorStop(1, theme.bg + "00");
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h * 0.42);
      text(p.info.brand, pad, 45, inner, 32);
      text(m.title, w / 2, 126, inner, 82, "center", true);
      text(m.subtitle, w / 2, 238, inner, 30, "center");
      if (p.info.colors) text(p.info.colors, w / 2, 296, inner, 25, "center");
      ctx.fillStyle = theme.bg + "e8";
      ctx.fillRect(0, h - 88, w, 88);
      text(
        p.info.sellingPoints.split("\n").filter(Boolean).join("  /  ") ||
          p.info.brand,
        w / 2,
        h - 57,
        inner,
        25,
        "center",
      );
    } else if (m.index === 3) {
      brand();
      header();
      cover(ctx, img, pad, 302, inner * 0.62, 700, m.cropX, m.cropY);
      cover(ctx, img2, pad + inner * 0.65, 302, inner * 0.35, 465);
      text("近看细节", pad + inner * 0.65, 815, inner * 0.35, 32);
      if (m.subtitle)
        text(m.subtitle, pad + inner * 0.65, 875, inner * 0.35, 22);
      footer();
    } else if (m.index === 5) {
      brand();
      header();
      cover(ctx, img, pad, 305, (inner - 24) / 2, 698, m.cropX, m.cropY);
      cover(ctx, img2, pad + (inner + 24) / 2, 305, (inner - 24) / 2, 698);
      text(p.info.colors || "商品颜色展示", pad, 1045, inner, 29);
      footer();
    } else {
      brand();
      header();
      cover(ctx, img, pad, 290, inner, h - 425, m.cropX, m.cropY);
      footer();
    }
  } else {
    brand();
    if (m.index === 6) {
      header(105);
      const bedding = categoryFor(p).id === "bedding-set";
      const rows = [
        ["商品名称", p.info.name],
        ["品牌", p.info.brand],
        ["面料成分", p.info.material],
        ...(bedding ? [["套件组成", p.info.setContents || ""]] : [["填充物", p.info.filling]]),
        ["尺寸规格", p.info.size],
        ...(!bedding ? [["重量", p.info.weight]] : []),
        ["颜色", p.info.colors],
        ["洗护说明", p.info.care],
      ].filter((row) => row[1]);
      let y = 260;
      for (const [label, value] of rows) {
        ctx.fillStyle = theme.ink + "08";
        ctx.fillRect(pad, y, inner, 65);
        text(label, pad + 22, y + 19, inner * 0.24, 23);
        text(value, pad + inner * 0.28, y + 19, inner * 0.67, 25);
        y += 69;
      }
      footer();
    } else if (m.index === 4 || m.index === 5) {
      header(115);
      cover(ctx, img, pad, 285, inner * 0.6, h - 450, m.cropX, m.cropY);
      cover(ctx, img2, pad + inner * 0.63, 365, inner * 0.37, h - 540);
      footer();
    } else if (m.index === 7) {
      cover(ctx, img, 0, 0, w, h - 260, m.cropX, m.cropY);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, h - 260, w, 260);
      text(m.title, w / 2, h - 210, inner, 48, "center", true);
      text(m.subtitle, w / 2, h - 127, inner, 23, "center");
      text(p.info.brand, w / 2, h - 64, inner, 23, "center");
    } else {
      header(118);
      const y = 285;
      cover(ctx, img, pad, y, inner, h - y - 118, m.cropX, m.cropY);
      footer();
    }
  }
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
