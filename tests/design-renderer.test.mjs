import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { sampleProject } from "../lib/design-model.ts";

// Exercise actual drawing commands; browser proofs cover the real rounded font.
const source = (await readFile(new URL("../lib/design-renderer.ts", import.meta.url), "utf8"))
  .replace('"./design-model"', JSON.stringify(new URL("../lib/design-model.ts", import.meta.url).href))
  .replace('"./app-path"', JSON.stringify(new URL("../lib/app-path.ts", import.meta.url).href));
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { drawDesign } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));

function recordingCanvas({ pixelTone, blockedPixels = false } = {}) {
  const rectangles = [], texts = [], images = [], events = [];
  let path;
  const ctx = {
    font: "400 16px sans-serif", textAlign: "left", fillStyle: "#000",
    scale() {},
    drawImage(image, ...args) {
      const [x, y, width, height] = args.length === 8 ? args.slice(4) : args;
      images.push({ source: image.source, x, y, width, height,
        naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
        crop: args.length === 8 ? { x: args[0], y: args[1], width: args[2], height: args[3] } : undefined });
      events.push("photo");
    },
    fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); events.push("fill"); },
    createLinearGradient() { throw new Error("Copy must not paint a gradient backing"); },
    beginPath() { path = undefined; }, save() {}, restore() {}, clip() {},
    roundRect(x, y, width, height) { path = { x, y, width, height }; },
    fill() { if (path) rectangles.push({ ...path, color: this.fillStyle }); events.push("fill"); },
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] || 16);
      return { width: [...value].reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? size : size * 0.55), 0) };
    },
    fillText(value, anchor, y) {
      const width = this.measureText(value).width;
      const height = Number(this.font.match(/([\d.]+)px/)?.[1] || 16);
      const x = this.textAlign === "right" ? anchor - width : this.textAlign === "center" ? anchor - width / 2 : anchor;
      texts.push({ value, x, y, width, height, anchor, align: this.textAlign, color: this.fillStyle, weight: Number(this.font.split(" ")[0]) });
      events.push("text");
    },
  };
  if (pixelTone !== undefined || blockedPixels) ctx.getImageData = () => {
    if (blockedPixels) throw new Error("Pixels are blocked by image origin policy");
    const pixels = new Uint8ClampedArray(100);
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] = pixels[i + 1] = pixels[i + 2] = pixelTone; pixels[i + 3] = 255; }
    return { data: pixels };
  };
  return { width: 0, height: 0, getContext: () => ctx, rectangles, texts, images, events };
}

async function renderModule({
  section = "texture", kind = "detail", composition, second = false,
  title = "近看织物的柔软肌理", subtitle = "保留实物颜色与细节，近景展示面料纹理。",
  sellingPoints = "细密格纹\n真实绗缝\n柔和配色\n未经选择的第四条",
  category = "quilt", template = "vip", info = {},
  imageZoom, cropX = 50, cropY = 50, textPosition, textColor,
  pixelTone, blockedPixels = false, legacy = false, index,
  assetNames, assetRoles,
} = {}) {
  const previousDocument = globalThis.document, previousImage = globalThis.Image;
  globalThis.document = { fonts: { load: async () => [] } };
  globalThis.Image = class {
    naturalWidth = 1200; naturalHeight = 1200;
    set src(value) { this.source = value; queueMicrotask(() => this.onload?.()); }
  };
  try {
    const project = sampleProject();
    project.category = category; project.template = template;
    Object.assign(project.info, { sellingPoints, ...info });
    if (assetNames) assetNames.forEach((name, i) => { project.assets[i].name = name; });
    if (assetRoles) assetRoles.forEach((role, i) => { project.assets[i].role = role; });
    const module = {
      ...project.modules.find(item => item.section === section) || project.modules[0],
      kind, section, composition, title, subtitle, imageZoom, cropX, cropY, textPosition, textColor,
      imageId: project.assets[0].id, imageId2: second ? project.assets[1].id : "",
      sourceImageId: project.assets[0].id, sourceImageId2: second ? project.assets[1].id : "",
      ...(index === undefined ? {} : { index }),
    };
    if (legacy) delete module.section;
    const before = structuredClone({ project, module });
    const canvas = recordingCanvas({ pixelTone, blockedPixels });
    await drawDesign(canvas, project, module);
    assert.deepEqual({ project, module }, before, "rendering preserves saved copy, crops and references");
    return { canvas, project, module };
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
  }
}

const right = rect => rect.x + rect.width, bottom = rect => rect.y + rect.height;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.01, `${message}: ${actual} vs ${expected}`);
const copyTexts = result => result.canvas.texts;
function assertInsideCanvas(canvas) {
  for (const [kind, elements] of [["photo", canvas.images], ["text", canvas.texts]]) for (const element of elements) {
    for (const key of ["x", "y", "width", "height"]) assert.ok(Number.isFinite(element[key]), `${kind} ${key} is finite`);
    assert.ok(element.x >= -0.1 && element.y >= -0.1, `${kind} starts within the canvas: ${JSON.stringify(element)}`);
    assert.ok(right(element) <= canvas.width + 0.1 && bottom(element) <= canvas.height + 0.1,
      `${kind} stays within the canvas: ${JSON.stringify(element)}`);
    assert.ok(element.width > 0 && element.height > 0, `${kind} has a visible area`);
  }
}
function assertNoCopyBacking(canvas) {
  assert.deepEqual(canvas.rectangles, [{ x: 0, y: 0, width: canvas.width, height: canvas.height, color: "#ffffff" }],
    "only the full canvas foundation is filled; no text panel, pill, footer or gradient exists");
  assert.equal(canvas.events[0], "fill");
  assert.ok(canvas.events.slice(1).every(event => event !== "fill"), "every photo and text is drawn after the only fill");
}

for (const [label, title, subtitle] of [
  ["short copy", "华夫格大豆被", "软糯亲肤 · 不易跑棉"],
  ["stacked copy", "时尚双版设计\n营造卧室美学", "AB双版设计，双面可用\n提升卧室格调"],
  ["long copy", "华夫格纹理大豆纤维被春秋冬四季家用被芯", "近看格纹 · 商品实拍"],
]) test(`reference hero ${label} aligns transparent title and subtitle on the same right edge`, async () => {
  const result = await renderModule({ section: "hero", kind: "main", title, subtitle });
  const copy = copyTexts(result);
  assert.ok(copy.length > 1);
  for (const line of copy) { assert.equal(line.align, "right"); close(right(line), 1152, "all copy shares the safe right margin"); }
  const titles = copy.filter(line => line.weight === 700), subtitles = copy.filter(line => line.weight === 400);
  assert.ok(Math.min(...subtitles.map(line => line.y)) > Math.max(...titles.map(bottom)), "subtitle follows every title line");
  assert.ok(titles[0].height >= subtitles[0].height * 1.5, "title has a strong visual hierarchy");
  assertNoCopyBacking(result.canvas); assertInsideCanvas(result.canvas);
});

test("an intentionally empty manual hero subtitle stays empty instead of gaining product claims", async () => {
  const result = await renderModule({ section: "hero", kind: "main", title: "用户手写首图", subtitle: "", sellingPoints: "不应插入的卖点" });
  assert.deepEqual(copyTexts(result).map(line => line.value), ["用户手写首图"]);
  assertNoCopyBacking(result.canvas);
});

test("default black rounded typography stays large on bright photographs", async () => {
  const result = await renderModule({ section: "hero", kind: "main", title: "全棉亲肤面料\n柔软顺滑", subtitle: "柔软舒适透气", pixelTone: 235 });
  const copy = copyTexts(result);
  assert.ok(copy.every(line => line.color === "#262626"));
  close(copy.find(line => line.weight === 700).height, 1200 * 0.072, "headline follows the reference scale");
  close(copy.find(line => line.weight === 400).height, 1200 * 0.035, "subtitle keeps its quieter reference scale");
  assertNoCopyBacking(result.canvas);
});

test("corner controls place unboxed copy with matching alignment and safe margins", async () => {
  for (const composition of ["auto", "immersive", "split", "minimal"]) for (const textPosition of ["top-right", "top-left", "bottom-right", "bottom-left"]) {
    const result = await renderModule({ section: "hero", kind: "main", composition, textPosition, title: "明确的商品卖点", subtitle: "用户确认的说明" });
    const copy = copyTexts(result), isLeft = textPosition.endsWith("left"), isBottom = textPosition.startsWith("bottom");
    assert.ok(copy.every(line => line.align === (isLeft ? "left" : "right")));
    assert.ok(copy.every(line => isBottom ? line.y > 600 : line.y < 600), "copy follows the selected vertical corner");
    for (const line of copy) close(isLeft ? line.x : right(line), isLeft ? 48 : 1152, "copy uses one safe outer edge");
    assertInsideCanvas(result.canvas); assertNoCopyBacking(result.canvas);
  }
});

test("automatic contrast reads the actual photo and gracefully falls back when pixel reads fail", async () => {
  const dark = await renderModule({ section: "hero", pixelTone: 25 });
  assert.ok(dark.canvas.texts.every(line => line.color === "#ffffff"));
  const bright = await renderModule({ section: "hero", pixelTone: 230 });
  assert.ok(bright.canvas.texts.every(line => line.color === "#262626"));
  const blocked = await renderModule({ section: "hero", blockedPixels: true });
  assert.ok(blocked.canvas.texts.every(line => line.color === "#262626"));
  for (const [textColor, expected] of [["dark", "#262626"], ["light", "#ffffff"]]) {
    const result = await renderModule({ section: "hero", textColor, pixelTone: textColor === "dark" ? 0 : 255 });
    assert.ok(result.canvas.texts.every(line => line.color === expected));
    assertNoCopyBacking(result.canvas);
  }
});

test("every old and current template removes copy backing and brand overlays at both export sizes", async () => {
  for (const template of ["vip", "warm", "clean", "editorial"]) for (const kind of ["main", "detail"])
    for (const composition of [undefined, "auto", "immersive", "split", "minimal"])
      for (const section of ["hero", "scene", "texture", "pattern", "craft", "filling", "components", "benefits", "colors", "care", "specs"]) {
        const { canvas, project } = await renderModule({ template, kind, section, composition,
          second: !["hero", "scene", "benefits", "care", "specs"].includes(section),
          info: { brand: "品牌回归校验" },
          title: "柔软织物\n近看真实质感", subtitle: "商品实拍展示 · 花型与配色请核对所选规格" });
        try {
          assertInsideCanvas(canvas); assertNoCopyBacking(canvas);
          const brandText = canvas.texts.filter(text => text.value === project.info.brand);
          if (section === "specs") {
            assert.equal(brandText.length, 1, "product specs keep the supplied brand only in its factual row");
            assert.equal(brandText[0].weight, 400, "the brand remains a parameter value rather than a branded heading");
            assert.ok(brandText[0].y > 120, "no brand name is painted in the top-left corner");
            assert.ok(canvas.texts.some(text => text.value === "品牌"), "the actual brand row label is preserved");
          } else assert.equal(brandText.length, 0, "main and detail photos have no program-added brand name");
        }
        catch (error) { throw new Error(`${template}/${kind}/${section}/${composition || "legacy"}: ${error.message}`); }
        if (section !== "specs") {
          const area = canvas.images.reduce((sum, image) => sum + image.width * image.height, 0);
          assert.ok(area >= canvas.width * canvas.height * 0.97, "photos fill the canvas without a reserved copy band");
        }
      }
});

test("legacy sectionless modules retain the shared moduleSection mapping and manual copy", async () => {
  for (const template of ["vip", "warm", "clean", "editorial"]) for (const kind of ["main", "detail"]) {
    const legacy = await renderModule({ template, kind, section: "texture", index: 2, legacy: true,
      second: true, title: "用户保存的面料说明", subtitle: "用户保存的副标题", sellingPoints: "别替换成这个" });
    const current = await renderModule({ template, kind, section: "texture", index: 2,
      second: true, title: "用户保存的面料说明", subtitle: "用户保存的副标题", sellingPoints: "别替换成这个" });
    // Sectionless projects retain their existing export height; semantics and
    // selected evidence stay the same even when the modern section is taller.
    assert.deepEqual(legacy.canvas.images.map(image => image.source), current.canvas.images.map(image => image.source));
    assert.equal(legacy.canvas.images.length, 2, "legacy texture keeps its second evidence photo");
    close(legacy.canvas.height - bottom(legacy.canvas.images[1]), current.canvas.height - bottom(current.canvas.images[1]),
      "the inset retains its natural bottom margin at the legacy export height");
    assert.deepEqual(legacy.canvas.texts, current.canvas.texts);
    assert.ok(legacy.canvas.texts.every(text => text.value !== legacy.project.info.brand),
      "saved legacy modules also omit the old top-left brand overlay");
    assertNoCopyBacking(legacy.canvas);
  }
});

test("removing the corner brand does not erase an explicitly authored brand headline", async () => {
  const result = await renderModule({ section: "hero", kind: "main", title: "作者手写品牌", subtitle: "",
    info: { brand: "作者手写品牌" } });
  assert.deepEqual(result.canvas.texts.map(text => text.value), ["作者手写品牌"]);
  close(result.canvas.texts[0].y, 1200 * 0.067, "the saved headline retains its selected heading location");
  assert.equal(result.canvas.texts[0].weight, 700);
});

test("evidence never manufactures a second photo and compositions remain visibly distinct", async () => {
  for (const section of ["texture", "pattern", "craft", "filling", "components", "colors"]) {
    for (const composition of ["auto", "split", "immersive", "minimal"]) {
      const { canvas } = await renderModule({ section, composition });
      assert.equal(canvas.images.length, 1, `${section}/${composition} uses one supplied photo`);
      assertInsideCanvas(canvas); assertNoCopyBacking(canvas);
    }
    const paired = await renderModule({ section, composition: "split", second: true });
    assert.equal(new Set(paired.canvas.images.map(image => image.source)).size, 2, "paired evidence is distinct");
  }
  const geometry = [];
  for (const composition of ["auto", "immersive", "split", "minimal"]) {
    const result = await renderModule({ composition, second: true });
    geometry.push(JSON.stringify({ images: result.canvas.images, texts: copyTexts(result) }));
  }
  assert.equal(new Set(geometry).size, 4, "photo and typography choices are distinct");
});

test("saved benefits and care copy remain authoritative without adding facts or feature illustrations", async () => {
  for (const section of ["benefits", "care"]) {
    const result = await renderModule({ section, title: "用户确认的标题", subtitle: "用户确认的一句说明",
      sellingPoints: "不要填入其他卖点", info: { care: "也不要强行替换成这句洗护说明" } });
    assert.equal(copyTexts(result).map(line => line.value).join(""), "用户确认的标题用户确认的一句说明");
    assert.equal(result.canvas.images.length, 1, "only the real product photo is drawn");
    assertNoCopyBacking(result.canvas);
  }
});

test("photo-grid captions remain unboxed and never overlap the selected bottom copy", async () => {
  const intersects = (a, b) => a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
  for (const section of ["colors", "components"]) for (const kind of ["main", "detail"])
    for (const composition of ["auto", "split", "minimal", "immersive"]) for (const second of [false, true]) {
      const result = await renderModule({ section, kind, composition, second, textPosition: "bottom-right",
        title: "商品实拍展示", subtitle: "确认花型与品项",
        info: { colors: "奶油黄、浅粉" }, assetNames: ["奶油黄实拍", "浅粉实拍"], assetRoles: ["被套", "枕套"] });
      const labels = result.canvas.texts.filter(line => ["奶油黄", "浅粉", "被套", "枕套"].includes(line.value));
      const headings = result.canvas.texts.filter(line => ["商品实拍展示", "确认花型与品项"].includes(line.value));
      assert.ok(labels.length >= 1); assert.ok(headings.length >= 2);
      for (const label of labels) for (const heading of headings) assert.equal(intersects(label, heading), false,
        `${kind}/${section}/${composition} caption stays away from manual bottom copy`);
      assertInsideCanvas(result.canvas); assertNoCopyBacking(result.canvas);
    }
});

test("product specs preserve supplied facts with no row fills or invented composition", async () => {
  const { canvas } = await renderModule({ section: "specs", category: "bedding-set",
    info: { name: "用户确认的花型床品", material: "面料以已确认标签为准", filling: "", weight: "", colors: "", care: "",
      setContents: "被套1件、枕套2件", size: "200×230cm" } });
  const copy = canvas.texts.map(line => line.value).join("\n");
  assert.match(copy, /用户确认的花型床品/); assert.match(copy, /被套1件、枕套2件/); assert.match(copy, /200×230cm/);
  assert.doesNotMatch(copy, /填充物|重量|100%|抗菌|四件套|认证/);
  assertInsideCanvas(canvas); assertNoCopyBacking(canvas);
});

test("zoom retains legacy framing and makes square crops adjustable without moving typography", async () => {
  const legacy = await renderModule({ section: "hero", kind: "main" });
  const unchanged = await renderModule({ section: "hero", kind: "main", imageZoom: 1 });
  assert.deepEqual(unchanged.canvas.images, legacy.canvas.images);
  const enlarged = await renderModule({ section: "hero", kind: "main", imageZoom: 1.2, cropY: 100 });
  const before = legacy.canvas.images[0], after = enlarged.canvas.images[0];
  assert.ok(after.crop.width < before.crop.width && after.crop.height < before.crop.height);
  assert.ok(after.crop.y > before.crop.y);
  close(after.crop.y + after.crop.height, after.naturalHeight, "bottom crop keeps actual lower edge");
  assert.deepEqual(enlarged.canvas.texts, legacy.canvas.texts, "framing does not rewrite or shift the chosen type layout");
  assertInsideCanvas(enlarged.canvas);
});

test("enlargement keeps source bounds and does not enlarge secondary evidence", async () => {
  for (const imageZoom of [1, 1.2, 2, 99, -2, Number.NaN]) for (const cropX of [0, 100]) for (const cropY of [0, 100]) {
    const { canvas } = await renderModule({ section: "texture", imageZoom, cropX, cropY });
    for (const image of canvas.images) {
      assert.ok(image.crop.x >= 0 && image.crop.y >= 0);
      assert.ok(right(image.crop) <= image.naturalWidth + 0.1 && bottom(image.crop) <= image.naturalHeight + 0.1);
    }
    assertInsideCanvas(canvas);
  }
  const baseline = await renderModule({ section: "texture", composition: "split", second: true, imageZoom: 1 });
  const enlarged = await renderModule({ section: "texture", composition: "split", second: true, imageZoom: 1.2, cropX: 100, cropY: 100 });
  assert.notDeepEqual(enlarged.canvas.images[0].crop, baseline.canvas.images[0].crop);
  assert.deepEqual(enlarged.canvas.images[1], baseline.canvas.images[1]);
});

test("Chinese wrapping preserves manual line breaks and balances automatic one-character tails", async () => {
  const title = "喜欢它，从这些细节开始";
  const automatic = await renderModule({ section: "benefits", title });
  const titleLines = automatic.canvas.texts.filter(line => line.weight === 700).map(line => line.value);
  assert.equal(titleLines.join(""), title);
  assert.ok(titleLines.every(line => [...line].length > 1));
  const explicitTitle = "喜欢它，从这些细节开\n始";
  const explicit = await renderModule({ section: "benefits", title: explicitTitle });
  const explicitLines = explicit.canvas.texts.filter(line => line.weight === 700).map(line => line.value);
  assert.equal(explicitLines.at(-1), "始");
  assert.equal(explicitLines.join(""), explicitTitle.replace("\n", ""));
  const quoted = await renderModule({ section: "benefits", title: "轻柔软「开始" });
  const quoteLines = quoted.canvas.texts.filter(line => line.weight === 700).map(line => line.value);
  assert.ok(quoteLines.every(line => !line.endsWith("「")));
  assert.equal(quoteLines.join(""), "轻柔软「开始");
  for (const result of [automatic, explicit, quoted]) assertInsideCanvas(result.canvas);
});

test("two-line headlines prefer complete Chinese clauses while preserving punctuation and manual breaks", async () => {
  const title = "垂落的弧度，看得见的形态";
  for (const kind of ["main", "detail"]) {
    const result = await renderModule({ section: "filling", kind, title, subtitle: "" });
    const lines = copyTexts(result).map(line => line.value);
    assert.deepEqual(lines, ["垂落的弧度，", "看得见的形态"]);
    assert.equal(lines.join(""), title, "no character or punctuation is removed");
    assertInsideCanvas(result.canvas); assertNoCopyBacking(result.canvas);
  }
  const manual = await renderModule({ section: "filling", title: "垂落的弧度，看得见\n的形态", subtitle: "" });
  assert.equal(copyTexts(manual).at(-1).value, "的形态", "an explicit author break remains authoritative");
  const short = await renderModule({ section: "hero", kind: "main", title: "柔软，舒服", subtitle: "" });
  assert.deepEqual(copyTexts(short).map(line => line.value), ["柔软，舒服"], "a title that fits one line is not split");
  const subtitle = await renderModule({ section: "hero", kind: "main", title: "商品实拍", subtitle: title });
  assert.deepEqual(copyTexts(subtitle).filter(line => line.weight === 400).map(line => line.value), [title],
    "headline balancing does not force clause breaks into subtitles");
});
