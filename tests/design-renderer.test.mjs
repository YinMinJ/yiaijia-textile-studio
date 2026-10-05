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
  const rectangles = [], texts = [];
  let path;
  const ctx = {
    font: "400 16px sans-serif",
    textAlign: "left",
    fillStyle: "#000",
    scale() {},
    drawImage() {},
    fillRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    beginPath() { path = undefined; },
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
  return { width: 0, height: 0, getContext: () => ctx, rectangles, texts };
}

async function renderHero({ title = "华夫格大豆被", subtitle = "软糯亲肤 不易跑棉", category = "quilt", sellingPoints = "" } = {}) {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  globalThis.document = { fonts: { load: async () => [] } };
  globalThis.Image = class {
    naturalWidth = 1200;
    naturalHeight = 1200;
    set src(_) { queueMicrotask(() => this.onload?.()); }
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
