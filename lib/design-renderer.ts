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
  const composition = (m as DesignModule & { composition?: string }).composition || "auto";
  const palette = { ...category.palette, white: "#fffdf8" };
  const pad = main ? 52 : 40;
  const inner = w - pad * 2;
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, w, h);

  const copy = (
    value: string, x: number, y: number, width: number, height: number,
    size: number, options: Partial<Parameters<typeof textBox>[6]> = {},
  ) => textBox(ctx, value, x, y, width, height, {
    size, min: main ? 26 : 22, color: palette.ink, ...options,
  });
  const rect = (x: number, y: number, width: number, height: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  };
  const rounded = (x: number, y: number, width: number, height: number, radius = 12) => {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  };
  const fade = (top: number, height: number, reverse = false, strength = "f5") => {
    const gradient = ctx.createLinearGradient(0, top, 0, top + height);
    gradient.addColorStop(0, palette.paper + (reverse ? "00" : strength));
    gradient.addColorStop(0.48, palette.paper + "a8");
    gradient.addColorStop(1, palette.paper + (reverse ? strength : "00"));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, top, w, height);
  };
  const brand = (onPhoto = true, x = pad, y = main ? 39 : 31) => {
    const label = p.info.brand.trim();
    if (!label) return;
    const size = main ? 27 : 22;
    ctx.font = `700 ${size}px TextileSans, sans-serif`;
    const width = Math.min(w * 0.19, ctx.measureText(label).width + 26);
    if (onPhoto) {
      ctx.fillStyle = palette.white + "ed";
      rounded(x - 13, y - 10, width, size + 23, 4);
      ctx.fill();
    }
    copy(label, x, y, width - 26, size * 1.35, size, {
      size, min: 16, color: palette.brand, weight: 700,
    });
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
    let chipX = x + width - widths.reduce((sum, value) => sum + value, 0) - gap * (labels.length - 1);
    labels.forEach((label, index) => {
      const chipWidth = widths[index];
      ctx.fillStyle = palette.accent;
      rounded(chipX, y, chipWidth, size + 25, bedding ? 7 : (size + 25) / 2);
      ctx.fill();
      copy(label, chipX + 17, y + 10, chipWidth - 34, size + 8, size,
        { min: 15, color: palette.white, weight: 500, align: "center" });
      chipX += chipWidth + gap;
    });
  };
  // Product facts remain real text, with no generated badges, diagrams or claims.
  if (section === "specs") {
    brand(false);
    copy(m.title, pad, 91, inner, 115, main ? 66 : 54, { weight: 700, leading: 1.15 });
    rect(pad, 211, 52, 4, palette.accent);
    const rows = [
      ["商品名称", p.info.name], ["品牌", p.info.brand],
      ["面料成分", p.info.material],
      ...(bedding ? [["套件组成", p.info.setContents || ""]] : [["填充物", p.info.filling]]),
      ["尺寸规格", p.info.size], ...(!bedding ? [["重量", p.info.weight]] : []),
      ["颜色", p.info.colors], ["洗护说明", p.info.care],
    ].filter(([, value]) => value.trim());
    const valueWidth = inner - 162;
    let fontSize = main ? 30 : 28;
    let heights: number[] = [];
    for (;;) {
      ctx.font = `400 ${fontSize}px TextileSans, sans-serif`;
      heights = rows.map(([, value]) => Math.max(75,
        wrapLines(ctx, value, valueWidth).length * fontSize * 1.3 + 32));
      if (heights.reduce((sum, value) => sum + value, 0) <= h - 258 || fontSize <= 18) break;
      fontSize--;
    }
    const available = h - 262;
    const factor = Math.min(1, available / (heights.reduce((sum, value) => sum + value, 0) || 1));
    let y = 238;
    rows.forEach(([label, value], index) => {
      const rowHeight = heights[index] * factor;
      if (index) rect(pad, y, inner, 1, palette.muted + "32");
      copy(label, pad, y + 21, 132, rowHeight - 26, Math.min(fontSize, 25), {
        min: 16, color: palette.muted,
      });
      copy(value, pad + 158, y + 18, valueWidth, rowHeight - 25, fontSize, {
        min: 16, leading: 1.3,
      });
      y += rowHeight;
    });
    return;
  }

  const primary = p.assets.find((asset) => asset.id === m.imageId);
  if (!primary) throw new Error("请为这张图选择对应的商品实拍。");
  const img = await picture(primary.url);
  const secondAsset = p.assets.find((asset) => asset.id === m.imageId2 && asset.id !== primary.id &&
    asset.id !== (m.sourceImageId || primary.id) && !asset.generated);
  const second = secondAsset ? await picture(secondAsset.url) : undefined;
  const photo = (x: number, y: number, width: number, height: number) =>
    cover(ctx, img, x, y, width, height, m.cropX, m.cropY, m.imageZoom);
  const photoFrame = (image: HTMLImageElement, x: number, y: number,
    width: number, height: number, fit = false, radius = 0) => {
    ctx.save();
    rounded(x, y, width, height, radius);
    ctx.clip();
    rect(x, y, width, height, palette.white);
    if (fit) contain(ctx, image, x, y, width, height);
    else cover(ctx, image, x, y, width, height);
    ctx.restore();
  };
  const labelFor = (assetId: string, sourceId?: string) => {
    const asset = p.assets.find((item) => item.id === (sourceId || assetId));
    return asset && ["被套", "床单", "枕套"].includes(asset.role) ? asset.role : "";
  };
  const inset = (x: number, y: number, width: number, height = width, fit = false) => {
    if (!second) return;
    rect(x - 8, y - 8, width + 16, height + 16, palette.white);
    photoFrame(second, x, y, width, height, fit);
  };
  const caption = (top: number, height: number, subtitle = m.subtitle, centered = false) => {
    rect(0, top, w, height, palette.paper);
    if (composition !== "minimal") rect(pad, top + 21, main ? 48 : 38, 4, palette.accent);
    const titleTop = top + (composition === "minimal" ? 23 : 38);
    const titleHeight = subtitle ? height - (main ? 96 : 85) : height - 56;
    const bottom = copy(m.title, pad, titleTop, inner, Math.max(52, titleHeight), main ? 62 : 53, {
      weight: 700, leading: 1.15, align: centered ? "center" : "left",
    });
    if (subtitle) copy(subtitle, pad, bottom + 11, inner, Math.max(34, top + height - bottom - 28), main ? 28 : 26, {
      color: palette.muted, align: centered ? "center" : "left", leading: 1.3,
    });
  };

  if (main && section === "hero") {
    const split = composition === "split";
    photo(0, 0, w, split ? h - 252 : h);
    if (split) rect(0, h - 252, w, 252, palette.paper);
    else fade(0, h * (composition === "minimal" ? 0.23 : 0.27), false, composition === "immersive" ? "d9" : "ed");
    brand(false);
    const titleX = w * 0.27, titleWidth = w - titleX - pad;
    const titleTop = split ? h - 228 : 40;
    const bottom = copy(m.title, titleX, titleTop, titleWidth, split ? 145 : 180, composition === "minimal" ? 74 : 82, {
      min: 33, weight: 700, align: "right", leading: 1.08,
    });
    const claims = m.subtitle.trim() ? m.subtitle.split(/[·\n；;]/).map((value) => value.trim()) : points;
    if (composition === "minimal") {
      copy(claims.filter(Boolean).slice(0, 2).join(" · "), titleX, Math.min(bottom + 15, 234), titleWidth, 53, 29, {
        color: palette.muted, align: "right", min: 20,
      });
    } else pills(claims, titleX, Math.min(bottom + 15, split ? h - 72 : 228), titleWidth, 29);
    return;
  }

  if (section === "hero") {
    if (composition === "split") {
      const band = 248;
      photo(0, 0, w, h - band);
      brand();
      caption(h - band, band, m.subtitle, true);
    } else if (composition === "minimal") {
      photo(0, 0, w, h - 169);
      brand();
      caption(h - 169, 169, m.subtitle);
    } else {
      photo(0, 0, w, h);
      fade(0, Math.min(408, h * 0.35), false, composition === "immersive" ? "dc" : "f0");
      brand(false);
      const bottom = copy(m.title, pad, 103, inner, 171, 66, {
        min: 32, weight: 700, leading: 1.12,
      });
      copy(m.subtitle, pad, bottom + 17, inner * 0.9, 88, 28, { color: palette.muted, min: 22 });
    }
    return;
  }

  if (section === "scene") {
    photo(0, 0, w, h);
    brand();
    if (composition === "immersive") {
      fade(h - 290, 290, true);
      const bottom = copy(m.title, pad, h - 196, inner, 115, main ? 64 : 58, { weight: 700, min: 28, leading: 1.15 });
      copy(m.subtitle, pad, bottom + 12, inner, Math.max(34, h - bottom - 26), main ? 28 : 26, { color: palette.muted });
    } else if (composition === "split") {
      caption(h - 242, 242);
    } else if (composition === "minimal") {
      caption(h - 155, 155);
    } else {
      const boxWidth = main ? w * 0.66 : w * 0.86;
      const top = h - 205;
      ctx.fillStyle = palette.paper + "ed";
      rounded(pad - 18, top, boxWidth + 36, 176, 4);
      ctx.fill();
      const bottom = copy(m.title, pad, top + 22, boxWidth, 91, main ? 59 : 50, { min: 28, weight: 700, leading: 1.15 });
      copy(m.subtitle, pad, bottom + 10, boxWidth, Math.max(34, top + 153 - bottom), main ? 27 : 25, { color: palette.muted });
    }
    return;
  }

  if (section === "benefits") {
    photo(0, 0, w, h);
    brand();
    const items = points.slice(0, 3);
    if (composition === "minimal") {
      caption(h - 185, 185, items.join(" · ") || m.subtitle);
    } else if (composition === "immersive") {
      fade(h - 364, 364, true);
      const bottom = copy(m.title, pad, h - 271, inner, 96, main ? 64 : 55, { weight: 700 });
      copy(items.join(" · ") || m.subtitle, pad, bottom + 14, inner, Math.max(66, h - bottom - 39), main ? 32 : 28, { color: palette.muted });
    } else {
      // The photograph continues behind a narrow editorial panel, rather than a repeated icon grid.
      const x = w * 0.65, top = h * 0.25, width = w - x;
      rect(x, top, width, h - top, palette.paper + "f3");
      const insetPad = main ? 31 : 24;
      rect(x + insetPad, top + 33, 36, 4, palette.accent);
      const titleBottom = copy(m.title, x + insetPad, top + 57, width - insetPad * 2, 156, main ? 54 : 43, {
        min: 26, weight: 700, leading: 1.18,
      });
      const contentTop = titleBottom + 31;
      if (items.length) {
        const slot = (h - contentTop - 36) / items.length;
        items.forEach((point, index) => {
          const y = contentTop + index * slot;
          if (index) rect(x + insetPad, y - 13, width - insetPad * 2, 1, palette.muted + "45");
          copy(point, x + insetPad, y + 7, width - insetPad * 2, slot - 32, main ? 31 : 27, {
            min: 22, leading: 1.35,
          });
        });
      } else copy(m.subtitle, x + insetPad, contentTop, width - insetPad * 2, h - contentTop - 31, main ? 30 : 26, { color: palette.muted });
    }
    return;
  }

  if (section === "colors") {
    const names = p.info.colors.split(/[·、,，;；/|\n]/).map((value) => value.trim()).filter(Boolean);
    const colorLabel = (id: string, sourceId?: string) => {
      const asset = p.assets.find((item) => item.id === (sourceId || id));
      return names.find((name) => asset?.name.includes(name)) || "";
    };
    const label = (value: string, x: number, y: number, width: number) => {
      if (!value) return;
      rect(x, y, width, 61, palette.paper + "ee");
      copy(value, x + 17, y + 16, width - 34, 38, main ? 28 : 26, { weight: 500 });
    };
    if (second && secondAsset) {
      if (main && composition !== "immersive") {
        photo(0, 0, w, h * 0.72);
        brand();
        const side = w * 0.405, x = w - side - 35, y = h - side - 40;
        inset(x, y, side, side, true);
        const textWidth = x - pad - 28;
        copy(m.title, pad, h - 268, textWidth, 151, 61, { weight: 700, min: 30, leading: 1.15 });
        copy(m.subtitle, pad, h - 95, textWidth, 61, 27, { color: palette.muted, min: 20 });
        label(colorLabel(primary.id, m.sourceImageId), pad, h * 0.72 - 70, w * 0.4);
        label(colorLabel(secondAsset.id, m.sourceImageId2), x, y + side - 61, side);
      } else {
        const divider = composition === "minimal" ? 135 : 161;
        const firstHeight = (h - divider) / 2;
        photo(0, 0, w, firstHeight);
        brand();
        label(colorLabel(primary.id, m.sourceImageId), pad, firstHeight - 68, inner);
        caption(firstHeight, divider, m.subtitle, true);
        photoFrame(second, 0, firstHeight + divider, w, h - firstHeight - divider);
        label(colorLabel(secondAsset.id, m.sourceImageId2), pad, h - 71, inner);
      }
    } else {
      photo(0, 0, w, h);
      brand();
      caption(h - (main ? 198 : 180), main ? 198 : 180, m.subtitle);
      label(colorLabel(primary.id, m.sourceImageId), pad, h - (main ? 278 : 260), Math.min(inner, w * 0.45));
    }
    return;
  }

  // Texture, construction and components use photographic evidence. A second
  // frame is only drawn when the user selected another distinct original photo.
  if (["texture", "pattern", "craft", "filling", "components"].includes(section)) {
    const component = section === "components";
    if (composition === "auto" && ["texture", "pattern", "craft"].includes(section)) {
      photo(0, 0, w, h);
      const side = main ? 320 : 224;
      if (second) inset(w - side - pad, h - side - 256, side);
      if (section === "texture") {
        brand();
        const top = h - 213, width = main ? inner * 0.71 : inner * 0.88;
        rect(pad - 17, top, width + 34, 184, palette.paper + "ef");
        rect(pad, top + 21, 39, 4, palette.accent);
        const bottom = copy(m.title, pad, top + 39, width, 88, main ? 61 : 52, {
          min: 28, weight: 700, leading: 1.15,
        });
        copy(m.subtitle, pad, bottom + 12, width, Math.max(34, top + 158 - bottom), main ? 28 : 26, { color: palette.muted });
      } else {
        fade(0, section === "pattern" ? 364 : 320, false, "ee");
        brand(false);
        const centered = section === "pattern";
        const bottom = copy(m.title, pad, main ? 112 : 95, inner, 133, main ? 64 : 55, {
          min: 30, weight: 700, leading: 1.15, align: centered ? "center" : "left",
        });
        copy(m.subtitle, pad, bottom + 15, inner, 83, main ? 28 : 26, {
          color: palette.muted, align: centered ? "center" : "left",
        });
      }
      return;
    }
    if (composition === "split" && second) {
      const column = w * 0.64, gap = main ? 12 : 10;
      photo(0, 0, column, h);
      photoFrame(second, column + gap, 0, w - column - gap, h * 0.5, component);
      brand();
      const x = column + (main ? 31 : 24), width = w - x - (main ? 24 : 20), top = h * 0.5 + 31;
      rect(column + gap, h * 0.5, w - column - gap, h * 0.5, palette.paper);
      rect(x, top, 34, 4, palette.accent);
      const bottom = copy(m.title, x, top + 27, width, h * 0.26, main ? 54 : 43, { min: 26, weight: 700, leading: 1.18 });
      copy(m.subtitle, x, bottom + 17, width, Math.max(52, h - bottom - 38), main ? 28 : 25, { color: palette.muted, min: 21 });
      return;
    }
    const band = composition === "minimal" ? (main ? 166 : 155) : (main ? 207 : 203);
    const photoHeight = h - band;
    photo(0, 0, w, composition === "immersive" ? h : photoHeight);
    brand();
    if (second && composition !== "minimal") {
      const side = main ? 320 : 224;
      const y = Math.max(152, photoHeight - side - 37);
      inset(w - side - pad, y, side, component ? side * 0.82 : side, component);
      const componentLabel = secondAsset && component ? labelFor(secondAsset.id, m.sourceImageId2) : "";
      if (componentLabel) {
        rect(w - side - pad, y + side * 0.82 - 54, side, 54, palette.paper + "ed");
        copy(componentLabel, w - side - pad + 15, y + side * 0.82 - 42, side - 30, 36, main ? 28 : 25, { weight: 500 });
      }
    }
    if (composition === "immersive") {
      fade(h - band - 91, band + 91, true);
      const bottom = copy(m.title, pad, h - band + 19, inner, 111, main ? 64 : 54, { weight: 700, min: 28, leading: 1.15 });
      copy(m.subtitle, pad, bottom + 12, inner, Math.max(34, h - bottom - 25), main ? 28 : 26, { color: palette.muted });
    } else caption(photoHeight, band);
    return;
  }

  if (section === "care") {
    const band = main ? 266 : 244;
    photo(0, 0, w, h - band);
    brand();
    caption(h - band, band, p.info.care.trim() || m.subtitle);
    return;
  }
  photo(0, 0, w, h - 195);
  brand();
  caption(h - 195, 195);
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
      cover(ctx, img, 0, 0, w, h, m.cropX, m.cropY, m.imageZoom);
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
      cover(ctx, img, pad, 302, inner * 0.62, 700, m.cropX, m.cropY, m.imageZoom);
      cover(ctx, img2, pad + inner * 0.65, 302, inner * 0.35, 465);
      text("近看细节", pad + inner * 0.65, 815, inner * 0.35, 32);
      if (m.subtitle)
        text(m.subtitle, pad + inner * 0.65, 875, inner * 0.35, 22);
      footer();
    } else if (m.index === 5) {
      brand();
      header();
      cover(ctx, img, pad, 305, (inner - 24) / 2, 698, m.cropX, m.cropY, m.imageZoom);
      cover(ctx, img2, pad + (inner + 24) / 2, 305, (inner - 24) / 2, 698);
      text(p.info.colors || "商品颜色展示", pad, 1045, inner, 29);
      footer();
    } else {
      brand();
      header();
      cover(ctx, img, pad, 290, inner, h - 425, m.cropX, m.cropY, m.imageZoom);
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
      cover(ctx, img, pad, 285, inner * 0.6, h - 450, m.cropX, m.cropY, m.imageZoom);
      cover(ctx, img2, pad + inner * 0.63, 365, inner * 0.37, h - 540);
      footer();
    } else if (m.index === 7) {
      cover(ctx, img, 0, 0, w, h - 260, m.cropX, m.cropY, m.imageZoom);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, h - 260, w, 260);
      text(m.title, w / 2, h - 210, inner, 48, "center", true);
      text(m.subtitle, w / 2, h - 127, inner, 23, "center");
      text(p.info.brand, w / 2, h - 64, inner, 23, "center");
    } else {
      header(118);
      const y = 285;
      cover(ctx, img, pad, y, inner, h - y - 118, m.cropX, m.cropY, m.imageZoom);
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
