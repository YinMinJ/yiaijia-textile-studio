import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { sampleProject, categoryFor } from "../lib/design-model.ts";

// Exercise the public renderer with an instrumented canvas, rather than a
// duplicate of its layout arithmetic. Browser screenshots cover font pixels.
const source = (await readFile(new URL("../lib/design-renderer.ts", import.meta.url), "utf8"))
  .replace('"./design-model"', JSON.stringify(new URL("../lib/design-model.ts", import.meta.url).href));
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { drawDesign } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));

function recordingCanvas() {
  const rectangles = [], texts = [], images = [];
  let path;
  const ctx = {
    font: "400 16px sans-serif",
    textAlign: "left",
    fillStyle: "#000",
    scale() {},
    drawImage(image, ...args) {
      const [x, y, width, height] = args.length === 8 ? args.slice(4) : args;
      images.push({
        source: image.source, x, y, width, height,
        naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
        crop: args.length === 8 ? { x: args[0], y: args[1], width: args[2], height: args[3] } : undefined,
      });
    },
    fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); },
    createLinearGradient() { return { addColorStop() {} }; },
    beginPath() { path = undefined; },
    save() {},
    restore() {},
    clip() {},
    roundRect(x, y, width, height) { path = { x, y, width, height }; },
    fill() { if (path) rectangles.push({ ...path, color: this.fillStyle }); },
    measureText(value) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] || 16);
      return { width: [...value].reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? size : size * 0.55), 0) };
    },
    fillText(value, anchor, y) {
      const width = this.measureText(value).width;
      const height = Number(this.font.match(/([\d.]+)px/)?.[1] || 16);
      const x = this.textAlign === "right" ? anchor - width : this.textAlign === "center" ? anchor - width / 2 : anchor;
      texts.push({ value, x, y, width, height, anchor, align: this.textAlign, color: this.fillStyle });
    },
  };
  return { width: 0, height: 0, getContext: () => ctx, rectangles, texts, images };
}

async function renderHero({ title = "华夫格大豆被", subtitle = "软糯亲肤 不易跑棉", category = "quilt", sellingPoints = "" } = {}) {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  globalThis.document = { fonts: { load: async () => [] } };
  globalThis.Image = class {
    naturalWidth = 1200;
    naturalHeight = 1200;
    set src(value) { this.source = value; queueMicrotask(() => this.onload?.()); }
  };
  try {
    const project = sampleProject();
    project.category = category;
    project.info.sellingPoints = sellingPoints;
    const hero = { ...project.modules.find(module => module.kind === "main" && module.section === "hero"), title, subtitle };
    const canvas = recordingCanvas();
    await drawDesign(canvas, project, hero);
    const palette = categoryFor(project).palette;
    return {
      canvas,
      titles: canvas.texts.filter(text => text.color === palette.ink),
      chips: canvas.rectangles.filter(rect => rect.color === palette.accent),
      labels: canvas.texts.filter(text => text.color === "#fffdf8"),
      brand: canvas.texts.find(text => text.value === project.info.brand),
    };
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
  }
}

const right = rect => rect.x + rect.width;
const bottom = rect => rect.y + rect.height;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.01, `${message}: ${actual} vs ${expected}`);
function assertSafeHero({ canvas, titles, chips, labels, brand }) {
  assert.ok(titles.length > 0);
  const edge = titles[0].anchor;
  assert.ok(edge < canvas.width, "copy keeps its outer margin");
  for (const title of titles) {
    assert.equal(title.align, "right");
    close(right(title), edge, "every title line uses the same right edge");
    assert.ok(title.x > right(brand), "the title leaves room for the existing brand label");
  }
  if (!chips.length) return;
  close(right(chips.at(-1)), edge, "the complete selling-point group aligns with the title");
  assert.equal(labels.length, chips.length);
  chips.forEach((chip, index) => {
    const label = labels[index];
    assert.ok(chip.x >= 0 && right(chip) <= canvas.width);
    assert.ok(chip.y > Math.max(...titles.map(bottom)), "selling points sit below every title line");
    assert.ok(label.x >= chip.x && right(label) <= right(chip), "label stays inside its chip");
    assert.ok(label.y >= chip.y && bottom(label) <= bottom(chip), "label stays vertically inside its chip");
    close(label.x + label.width / 2, chip.x + chip.width / 2, "chip text is centered");
    if (index) {
      const gap = chip.x - right(chips[index - 1]);
      assert.ok(gap >= 8 && gap <= 24, "adjacent chips form one compact group without overlapping");
    }
  });
}

test("VIP hero single selling-point chip shares the title's right edge", async () => {
  const result = await renderHero();
  assert.equal(result.chips.length, 1);
  assertSafeHero(result);
});

test("VIP hero two unequal selling points stay together and align with the title", async () => {
  const result = await renderHero({ subtitle: "亲肤 · 细密格纹绗缝走线" });
  assert.equal(result.chips.length, 2);
  assertSafeHero(result);
});

test("VIP hero long Chinese selling points fit beneath a two-line title", async () => {
  const result = await renderHero({
    title: "华夫格大豆被\n柔软有型",
    subtitle: "细密格纹绗缝走线展示实际商品面料纹理 · 柔软蓬松的外观展示以实拍商品为准",
  });
  assert.equal(result.titles.length, 2);
  assert.equal(result.chips.length, 2);
  assertSafeHero(result);
});

test("VIP hero wrapping long titles preserves the selling-point group's position", async () => {
  const result = await renderHero({
    title: "华夫格纹理大豆纤维被春秋冬四季家用被芯",
    subtitle: "近看格纹 · 查看实拍",
  });
  assert.ok(result.titles.length >= 2);
  assertSafeHero(result);
});

test("bedding hero keeps its single category selling point aligned", async () => {
  const result = await renderHero({ category: "bedding-set", title: "印花床上套件", subtitle: "整床搭配 · 花型近看" });
  assert.equal(result.chips.length, 1);
  assertSafeHero(result);
});

test("empty hero subtitle falls back to product selling points, without empty chips", async () => {
  const result = await renderHero({ subtitle: "  ", sellingPoints: "格纹肌理\n\n弧线绗缝" });
  assert.deepEqual(result.labels.map(label => label.value), ["格纹肌理", "弧线绗缝"]);
  assertSafeHero(result);
  const empty = await renderHero({ subtitle: "", sellingPoints: "" });
  assert.equal(empty.chips.length, 0);
  assert.equal(empty.labels.length, 0);
  assertSafeHero(empty);
});

async function renderModule({
  section = "texture", kind = "detail", composition, second = false,
  title = "近看织物的柔软肌理", subtitle = "保留实物颜色与细节，近景展示面料纹理。",
  sellingPoints = "细密格纹\n真实绗缝\n柔和配色\n第四条不应重复堆满画面",
  category = "quilt", info = {},
  imageZoom, cropX = 50, cropY = 50,
} = {}) {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  globalThis.document = { fonts: { load: async () => [] } };
  globalThis.Image = class {
    naturalWidth = 1200;
    naturalHeight = 1200;
    set src(value) { this.source = value; queueMicrotask(() => this.onload?.()); }
  };
  try {
    const project = sampleProject();
    project.category = category;
    Object.assign(project.info, { sellingPoints, ...info });
    const module = {
      ...project.modules.find(item => item.section === section) || project.modules[0],
      kind, section, composition, title, subtitle,
      imageZoom, cropX, cropY,
      imageId: project.assets[0].id,
      imageId2: second ? project.assets[1].id : "",
      sourceImageId: project.assets[0].id,
      sourceImageId2: second ? project.assets[1].id : "",
    };
    const before = structuredClone({ project, module });
    const canvas = recordingCanvas();
    await drawDesign(canvas, project, module);
    assert.deepEqual({ project, module }, before, "rendering does not rewrite saved copy, crops or photo references");
    return { canvas, project, module };
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
  }
}

function assertInsideCanvas(canvas) {
  for (const [kind, elements] of [["photo", canvas.images], ["text", canvas.texts]]) {
    for (const element of elements) {
      for (const key of ["x", "y", "width", "height"]) assert.ok(Number.isFinite(element[key]), `${kind} ${key} is finite`);
      assert.ok(element.x >= -0.1 && element.y >= -0.1, `${kind} starts within the canvas: ${JSON.stringify(element)}`);
      assert.ok(right(element) <= canvas.width + 0.1 && bottom(element) <= canvas.height + 0.1,
        `${kind} stays within the canvas: ${JSON.stringify(element)}`);
      assert.ok(element.width > 0 && element.height > 0, `${kind} has a visible area`);
    }
  }
}

test("commercial VIP layouts keep all photographs and copy inside both export sizes", async () => {
  for (const kind of ["main", "detail"]) {
    for (const composition of [undefined, "auto", "immersive", "split", "minimal"]) {
      for (const section of ["hero", "scene", "texture", "pattern", "craft", "filling", "components", "benefits", "colors", "care", "specs"]) {
        const { canvas } = await renderModule({
          kind, section, composition, second: !["hero", "scene", "benefits", "care", "specs"].includes(section),
          title: "柔软织物\n近看真实质感", subtitle: "商品实拍展示 · 花型与配色请核对所选规格",
        });
        try { assertInsideCanvas(canvas); }
        catch (error) { throw new Error(`${kind}/${section}/${composition || "legacy"}: ${error.message}`); }
      }
    }
  }
});

test("evidence layouts never manufacture a second photograph when no distinct original is selected", async () => {
  for (const section of ["texture", "pattern", "craft", "filling", "components", "colors"]) {
    for (const composition of ["auto", "split", "immersive", "minimal"]) {
      const { canvas } = await renderModule({ section, composition });
      assert.equal(canvas.images.length, 1, `${section}/${composition} shows one real photograph`);
      assertInsideCanvas(canvas);
    }
    const paired = await renderModule({ section, composition: "split", second: true });
    assert.equal(new Set(paired.canvas.images.map(image => image.source)).size, 2, `${section} uses two distinct supplied images`);
  }
});

test("composition choices change the photograph and type placement while keeping manual copy", async () => {
  const previews = [];
  for (const composition of ["auto", "immersive", "split", "minimal"])
    previews.push(await renderModule({ composition, second: true }));
  const geometry = previews.map(({ canvas }) => JSON.stringify({
    images: canvas.images.map(({ x, y, width, height }) => ({ x, y, width, height })),
    texts: canvas.texts.filter(text => text.value !== "宜爱家").map(({ x, y, width, height }) => ({ x, y, width, height })),
  }));
  assert.equal(new Set(geometry).size, previews.length, "each option has a distinct visible layout");
  for (const { canvas } of previews) assert.ok(canvas.texts.some(text => text.value.includes("近看织物")));
});

test("benefits use at most three supplied claims and no generic certification or feature icons", async () => {
  const { canvas } = await renderModule({ section: "benefits" });
  const renderedCopy = canvas.texts.map(text => text.value).join("\n");
  assert.match(renderedCopy, /细密格纹/);
  assert.match(renderedCopy, /真实绗缝/);
  assert.match(renderedCopy, /柔和配色/);
  assert.doesNotMatch(renderedCopy, /第四条|抗菌|100%|认证|A类/);
  assert.ok(canvas.images[0].width * canvas.images[0].height >= canvas.width * canvas.height * 0.75,
    "the photograph is the dominant canvas layer");
});

test("product specs preserve supplied values and omit unknown composition or functions", async () => {
  const { canvas } = await renderModule({
    section: "specs", category: "bedding-set",
    info: { name: "用户确认的花型床品", material: "面料以已确认标签为准", filling: "", weight: "", colors: "", care: "", setContents: "被套1件、枕套2件", size: "200×230cm" },
  });
  const renderedCopy = canvas.texts.map(text => text.value).join("\n");
  assert.match(renderedCopy, /用户确认的花型床品/);
  assert.match(renderedCopy, /被套1件、枕套2件/);
  assert.match(renderedCopy, /200×230cm/);
  assert.doesNotMatch(renderedCopy, /填充物|重量|100%|抗菌|四件套|认证/);
  assertInsideCanvas(canvas);
});

test("image zoom keeps legacy framing and makes square hero crops adjustable", async () => {
  const legacy = await renderModule({ section: "hero", kind: "main" });
  const unchanged = await renderModule({ section: "hero", kind: "main", imageZoom: 1 });
  assert.deepEqual(unchanged.canvas.images, legacy.canvas.images, "zoom 1 exactly retains saved framing");
  const enlarged = await renderModule({ section: "hero", kind: "main", imageZoom: 1.2, cropY: 100 });
  const before = legacy.canvas.images[0], after = enlarged.canvas.images[0];
  assert.ok(after.crop.width < before.crop.width && after.crop.height < before.crop.height, "enlargement shows a closer source area");
  assert.ok(after.crop.y > before.crop.y, "bottom positioning reduces the empty wall above a square photograph");
  close(after.crop.y + after.crop.height, after.naturalHeight, "bottom position retains the photograph's lower edge");
  assertInsideCanvas(enlarged.canvas);
});

test("enlargement stays inside the source photograph and does not enlarge a second evidence image", async () => {
  for (const imageZoom of [1, 1.2, 2, 99, -2, Number.NaN]) {
    for (const cropX of [0, 100]) {
      for (const cropY of [0, 100]) {
        const { canvas } = await renderModule({ section: "texture", imageZoom, cropX, cropY });
        for (const image of canvas.images) {
          assert.ok(image.crop.x >= 0 && image.crop.y >= 0);
          assert.ok(right(image.crop) <= image.naturalWidth + 0.1 && bottom(image.crop) <= image.naturalHeight + 0.1,
            "the enlarged crop never asks for pixels outside the actual photograph");
        }
        assertInsideCanvas(canvas);
      }
    }
  }
  const baseline = await renderModule({ section: "texture", composition: "split", second: true, imageZoom: 1 });
  const enlarged = await renderModule({ section: "texture", composition: "split", second: true, imageZoom: 1.2, cropX: 100, cropY: 100 });
  assert.notDeepEqual(enlarged.canvas.images[0].crop, baseline.canvas.images[0].crop);
  assert.deepEqual(enlarged.canvas.images[1], baseline.canvas.images[1], "secondary evidence keeps its independent default framing");
});

test("Chinese automatic wrapping keeps the final word readable without rewriting explicit breaks or punctuation", async () => {
  const title = "喜欢它，从这些细节开始";
  const automatic = await renderModule({ section: "benefits", title });
  const titleLines = automatic.canvas.texts.filter(text => title.includes(text.value)).map(text => text.value);
  assert.equal(titleLines.join(""), title, "every supplied character stays in its original order");
  assert.ok(titleLines.includes("开始"), "the final word remains together rather than leaving 始 alone");
  assert.ok(titleLines.every(line => [...line].length > 1));
  const explicitTitle = "喜欢它，从这些细节开\n始";
  const explicit = await renderModule({ section: "benefits", title: explicitTitle });
  const explicitLines = explicit.canvas.texts.filter(text => explicitTitle.includes(text.value)).map(text => text.value);
  assert.equal(explicitLines.at(-1), "始", "an author-supplied newline stays intentional");
  assert.equal(explicitLines.join(""), explicitTitle.replace("\n", ""));
  const quoted = await renderModule({ section: "benefits", title: "轻柔软「开始" });
  const quoteLines = quoted.canvas.texts.filter(text => "轻柔软「开始".includes(text.value)).map(text => text.value);
  assert.ok(quoteLines.every(line => !line.endsWith("「")), "balancing never strands an opening quotation mark");
  assert.equal(quoteLines.join(""), "轻柔软「开始");
  for (const result of [automatic, explicit, quoted]) assertInsideCanvas(result.canvas);
});
