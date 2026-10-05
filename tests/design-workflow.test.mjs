import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { z } from "zod";
import {
  sampleProject, freshProject, makeModules, sourceAsset, needsAI,
  moduleSection, modulePurpose, dimensions, prepareImageRun, usesSecondary,
  categories, categoryFor, switchCategory,
} from "../lib/design-model.ts";

test("quilt plans follow the reference category and keep the correct original photos", () => {
  const p = sampleProject();
  assert.equal(freshProject().template, "vip");
  assert.equal(p.workflow, "plan");
  assert.deepEqual(p.modules.filter(m => m.kind === "main").map(moduleSection), ["hero", "scene", "filling", "craft", "colors"]);
  assert.deepEqual(p.modules.filter(m => m.kind === "detail").map(moduleSection), ["hero", "benefits", "texture", "filling", "craft", "colors", "specs"]);
  assert.equal(sourceAsset(p, p.modules.find(m => m.section === "texture")).id, "00233");
  assert.equal(sourceAsset(p, p.modules.find(m => m.section === "craft")).id, "00229");
  assert.equal(sourceAsset(p, p.modules.find(m => m.section === "scene")).id, "00237");
  assert.ok(p.modules.every(m => m.sourceImageId === m.imageId));
  assert.ok(p.modules.filter(m => needsAI(p, m)).every(m => ["hero", "scene"].includes(m.section)));
});

test("regeneration uses its original source after a result replaces the displayed photo", () => {
  const p = sampleProject();
  const m = p.modules.find(m => m.section === "scene");
  p.assets.unshift({ ...p.assets[0], id: "generated", generated: true });
  m.imageId = "generated";
  assert.equal(sourceAsset(p, m).id, "00237");
  assert.ok(makeModules(p).every(m => m.sourceImageId !== "generated"));
  p.assets = p.assets.filter(a => a.id !== "00237");
  assert.equal(sourceAsset(p, m), undefined, "missing chosen source must not silently become the first product photo");
  delete m.sourceImageId;
  assert.equal(sourceAsset(p, m), undefined, "generated legacy images are not original source material");
});

test("reordering preserves module purpose, dimensions and generation policy", () => {
  const p = sampleProject();
  const m = p.modules.find(m => m.section === "specs");
  const originalSize = dimensions(m);
  const reordered = { ...m, index: 1 };
  assert.deepEqual(dimensions(reordered), originalSize);
  assert.equal(originalSize.height, 1380);
  assert.equal(modulePurpose(reordered), modulePurpose(m));
  assert.equal(needsAI(p, reordered), false);
  assert.equal(moduleSection({ ...m, section: undefined, index: 6 }), "specs", "old projects retain the legacy section mapping");
});

test("one-image redo keeps other completed photos ready while a first preview leaves the remaining scene pending", () => {
  const p = { ...sampleProject(), output: "main", generation: "template", workflow: "complete" };
  p.modules = p.modules.filter(m => m.kind === "main");
  const single = prepareImageRun(p, p.modules[0].id);
  assert.deepEqual(single.modules.filter(m => needsAI(single, m) && m.aiStatus !== "succeeded").map(m => m.id), ["main-1"]);
  const preview = prepareImageRun({ ...p, workflow: "preview" }, p.modules[0].id);
  assert.equal(preview.modules.find(m => m.section === "scene").aiStatus, "pending");
  assert.ok(preview.modules.filter(m => !needsAI(preview, m)).every(m => m.aiStatus === "succeeded"));
  assert.deepEqual(p.modules.filter(usesSecondary).map(m => m.section), ["colors"]);
});

test("empty product facts stay empty instead of gaining materials, certificates or functions", () => {
  const p = sampleProject();
  p.info = { ...freshProject().info, name: "床品", sellingPoints: "" };
  const copy = makeModules(p).map(m => m.title + m.subtitle).join("\n");
  assert.doesNotMatch(copy, /新疆棉|纯棉|100%|抗菌|A类|认证|授权|可机洗|保暖/);
  assert.match(copy, /水洗标/);
  p.info.material = "用户确认的面料";
  p.info.sellingPoints = "可见的格纹\n已确认的工艺";
  const updated = makeModules(p);
  assert.equal(updated.find(m => m.section === "texture").title, "可见的格纹");
  assert.match(updated.find(m => m.section === "texture").subtitle, /用户确认的面料/);
});

test("category profiles retain the two selected reference links and old projects default to quilt", () => {
  assert.equal(categoryFor({}).id, "quilt");
  assert.equal(categoryFor(freshProject()).id, "quilt");
  assert.deepEqual(categories.map(c => c.referenceUrl), [
    "https://detail.vip.com/detail-1714230467-6922096046911460931.html",
    "https://detail.vip.com/detail-1714230467-6921823509075762179.html",
  ]);
  assert.notDeepEqual(categories[0].palette, categories[1].palette);
});

test("category roles choose real folded, filling and component photos without inventing set pieces", () => {
  const p = sampleProject();
  p.assets.push(...["叠放", "填充", "工艺", "被套", "床单", "枕套"].map(role => ({
    ...p.assets[0], id: role, name: role + "实拍", role,
  })));
  const quilt = makeModules(p);
  assert.equal(quilt.find(m => m.section === "hero").sourceImageId, "叠放");
  assert.equal(quilt.find(m => m.section === "filling").sourceImageId, "填充");
  assert.equal(quilt.find(m => m.section === "craft").sourceImageId, "工艺");
  p.category = "bedding-set";
  p.info = { ...freshProject().info, name: "花型床上套件", setContents: "被套1件、枕套1件" };
  const bedding = makeModules(p);
  assert.deepEqual(bedding.filter(m => m.kind === "main").map(moduleSection), ["hero", "scene", "texture", "components", "colors"]);
  assert.deepEqual(bedding.filter(m => m.kind === "detail").map(moduleSection), ["hero", "pattern", "texture", "components", "craft", "colors", "specs"]);
  assert.equal(bedding.find(m => m.section === "hero").sourceImageId, "00224");
  const component = bedding.find(m => m.section === "components");
  assert.equal(component.sourceImageId, "被套");
  assert.equal(component.sourceImageId2, "枕套");
  assert.equal(component.subtitle, p.info.setContents);
  assert.equal(usesSecondary(component), true);
  assert.equal(needsAI(p, component), false);
  assert.equal(dimensions(bedding.find(m => m.kind === "detail" && m.section === "components")).height, 1580);
  assert.doesNotMatch(bedding.map(m => m.title + m.subtitle).join("\n"), /四件套|4件|纯棉|100%|抗菌|A类|认证|授权/);
  const withoutDuvet = { ...p, assets: p.assets.filter(a => a.role !== "被套") };
  const sheetAndPillow = makeModules(withoutDuvet).find(m => m.section === "components");
  assert.equal(sheetAndPillow.sourceImageId, "床单");
  assert.equal(sheetAndPillow.sourceImageId2, "枕套");
  p.assets = p.assets.filter(a => !["枕套", "床单"].includes(a.role));
  delete p.info.setContents;
  const unspecified = makeModules(p).find(m => m.section === "components");
  assert.equal(unspecified.sourceImageId2, "", "missing component photo does not borrow an unrelated image");
  assert.match(unspecified.subtitle, /核对/);
});

test("switching category rebuilds a plan from originals and resets prior generation state", () => {
  const p = sampleProject();
  p.generation = "ai";
  p.generationBatch = randomUUID();
  p.workflow = "complete";
  p.output = "detail";
  const generated = { ...p.assets[0], id: "generated", generated: true };
  p.assets.push(generated);
  p.modules[0] = { ...p.modules[0], imageId: generated.id, aiStatus: "succeeded" };
  const next = switchCategory(p, "bedding-set");
  assert.equal(next.category, "bedding-set");
  assert.equal(next.workflow, "plan");
  assert.equal(next.status, "draft");
  assert.equal(next.generation, "template");
  assert.equal(next.generationBatch, undefined);
  assert.equal(next.modules.length, 7);
  assert.ok(next.modules.every(m => !m.aiStatus && m.sourceImageId !== generated.id));
  assert.deepEqual(next.info, p.info);
  assert.deepEqual(next.assets, p.assets.filter(a => !a.generated));
  assert.equal(p.modules[0].imageId, "generated", "switching does not mutate prior project state");
  assert.deepEqual(switchCategory(freshProject(), "bedding-set").modules, []);
});

const heldProjects = new Map();
let jobs = [];
globalThis.__designWorkflowRoute = {
  z,
  owner: async () => "test-owner",
  checkOrigin: () => {},
  errorResponse: error => { throw error; },
  db: () => ({ prepare: sql => ({ bind: (...args) => ({
    first: async () => sql.includes("FROM assets") ? { id: args[0] } : heldProjects.has(args[0]) ? { owner_id: "test-owner" } : null,
    all: async () => ({ results: sql.includes("FROM generation_jobs") ? jobs : [...heldProjects.values()].map(data => ({ data })) }),
    run: async () => { if (sql.includes("INSERT INTO projects")) heldProjects.set(args[0], args[3]); return { meta: { changes: 1 } }; },
  }) }) }),
};
const routeSource = (await readFile(new URL("../app/api/projects/route.ts", import.meta.url), "utf8"))
  .replace(/import \{ z \} from "zod";/, "const { z } = globalThis.__designWorkflowRoute;")
  .replace(/import \{ owner, db, errorResponse, checkOrigin \} from "@\/lib\/server-store";/, "const { owner, db, errorResponse, checkOrigin } = globalThis.__designWorkflowRoute;");
async function loadTs(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
}
const route = await loadTs(routeSource);
const post = data => route.POST(new Request("http://localhost/api/projects", { method: "POST", body: JSON.stringify(data) }));

test("project save and reload preserve semantic plans, workflow and original references", async () => {
  heldProjects.clear();
  jobs = [];
  const p = { ...sampleProject(), id: randomUUID(), workflow: "preview", generation: "ai", generationBatch: randomUUID() };
  const response = await post(p);
  assert.equal(response.status, 200);
  const saved = (await response.json()).project;
  assert.equal(saved.template, "vip");
  assert.equal(saved.category, "quilt");
  assert.equal(saved.workflow, "preview");
  assert.deepEqual(saved.modules, p.modules);
  const result = { ...p.assets[0], id: randomUUID(), generated: true };
  result.url = "/api/assets/" + result.id;
  jobs = [{ module_id: p.modules[0].id, status: "succeeded", result: JSON.stringify(result) }];
  const reloaded = (await (await route.GET()).json()).projects[0];
  assert.equal(reloaded.modules[0].imageId, result.id);
  assert.equal(reloaded.modules[0].sourceImageId, p.modules[0].sourceImageId);
  assert.equal(sourceAsset(reloaded, reloaded.modules[0]).id, "00224");
  assert.equal((await post(reloaded)).status, 200);
});

test("saving rejects missing or generated original references while old projects stay valid", async () => {
  const p = { ...sampleProject(), id: randomUUID() };
  p.modules[0].sourceImageId = "missing";
  assert.equal((await post(p)).status, 400);
  p.modules[0].sourceImageId = p.assets[0].id;
  p.assets[0].generated = true;
  assert.equal((await post(p)).status, 400);
  const legacy = { ...sampleProject(), id: randomUUID(), template: "warm" };
  delete legacy.workflow;
  delete legacy.category;
  delete legacy.info.setContents;
  legacy.modules = legacy.modules.map(({ section, sourceImageId, sourceImageId2, ...m }) => m);
  assert.equal((await post(legacy)).status, 200);
});

test("bedding category, set contents and specialized roles survive save and reload", async () => {
  heldProjects.clear();
  jobs = [];
  const p = switchCategory({ ...sampleProject(), id: randomUUID() }, "bedding-set");
  p.info.setContents = "被套1件、床单1件、枕套2件";
  p.assets[1].role = "枕套";
  p.modules = makeModules(p);
  const response = await post(p);
  assert.equal(response.status, 200);
  const saved = (await response.json()).project;
  assert.equal(saved.category, "bedding-set");
  assert.equal(saved.info.setContents, p.info.setContents);
  assert.equal(saved.assets[1].role, "枕套");
  const reloaded = (await (await route.GET()).json()).projects[0];
  assert.deepEqual(reloaded.modules, p.modules);
  assert.equal(categoryFor(reloaded).id, "bedding-set");
  assert.equal((await post({ ...p, category: "unknown" })).status, 400);
});

const generateSource = (await readFile(new URL("../app/api/generate-image/route.ts", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from "[^\"]+";\r?\n/gm, "");
const { imageDimensions } = await loadTs(generateSource + "\nexport { imageDimensions };\n");
test("generated asset dimensions come from image metadata and reject invalid headers", async () => {
  const jpeg = await readFile(new URL("../public/samples/00224.jpg", import.meta.url));
  assert.deepEqual(imageDimensions(jpeg, "image/jpeg"), { width: 1800, height: 1800 });
  const png = Buffer.alloc(24);
  png.writeUInt32BE(1024, 16);
  png.writeUInt32BE(768, 20);
  assert.deepEqual(imageDimensions(png, "image/png"), { width: 1024, height: 768 });
  const webp = Buffer.alloc(30);
  webp.write("VP8X", 12);
  webp.writeUInt32LE(10, 16);
  webp.writeUIntLE(639, 24, 3);
  webp.writeUIntLE(479, 27, 3);
  assert.deepEqual(imageDimensions(webp, "image/webp"), { width: 640, height: 480 });
  assert.throws(() => imageDimensions(new Uint8Array(0), "image/jpeg"), /尺寸信息无效/);
});
