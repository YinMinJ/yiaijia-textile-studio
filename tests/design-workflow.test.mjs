import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { z } from "zod";
import {
  sampleProject, freshProject, makeModules, sourceAsset, needsAI,
  moduleSection, modulePurpose, dimensions, prepareImageRun, usesSecondary,
  categories, categoryFor, switchCategory, updatePlanModule, updateProjectTemplate, referenceAssets,
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
  assert.ok(p.modules.filter(m => needsAI(p, m)).every(m => ["hero", "scene", "benefits"].includes(m.section)));
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
  assert.deepEqual(p.modules.filter(usesSecondary).map(m => m.section), ["filling", "craft", "colors"]);
});

test("editing plan copy preserves completed images, generation batch and the current workflow", () => {
  for (const workflow of [undefined, "plan", "preview", "complete"]) {
    const p = { ...sampleProject(), workflow, generation: "ai", generationBatch: randomUUID() };
    const target = p.modules[0];
    Object.assign(target, { imageId: "generated-hero", aiStatus: "succeeded" });
    const before = structuredClone(p);
    const next = updatePlanModule(p, target.id, { title: "手动首图标题", subtitle: "手动补充说明" });
    assert.equal(next.workflow, workflow);
    assert.equal(next.generationBatch, p.generationBatch);
    assert.equal(next.assets, p.assets);
    assert.deepEqual(next.modules[0], { ...target, title: "手动首图标题", subtitle: "手动补充说明" });
    assert.ok(next.modules.slice(1).every((m, index) => m === p.modules[index + 1]));
    assert.deepEqual(p, before);
  }
});

test("changing a plan's primary photo invalidates only that result without restarting the workflow", () => {
  for (const workflow of ["plan", "preview", "complete"]) {
    const p = { ...sampleProject(), workflow, generation: "ai", generationBatch: randomUUID() };
    const target = p.modules[0];
    Object.assign(target, { imageId: "generated-hero", aiStatus: "failed", aiError: "old failure" });
    p.assets.push({ ...p.assets[0], id: "generated-hero", generated: true });
    p.modules[1].aiStatus = "succeeded";
    const before = structuredClone(p);
    const next = updatePlanModule(p, target.id, { imageId: "00237" });
    assert.equal(next.workflow, workflow);
    assert.notEqual(next.generationBatch, p.generationBatch);
    assert.match(next.generationBatch, /^[\da-f-]{36}$/);
    assert.equal(next.assets, p.assets, "existing generated assets stay available");
    assert.deepEqual(next.modules[0], { ...target, imageId: "00237", sourceImageId: "00237", aiStatus: "pending", aiError: undefined });
    assert.ok(next.modules.slice(1).every((m, index) => m === p.modules[index + 1]));
    assert.deepEqual(p, before);
  }
  const photoLayout = { ...sampleProject(), workflow: "complete", generation: "template" };
  assert.equal(updatePlanModule(photoLayout, photoLayout.modules[0].id, { imageId: "00237" }).modules[0].aiStatus, undefined);
  const aiLayout = { ...sampleProject(), workflow: "complete", generation: "ai" };
  const craft = aiLayout.modules.find(m => m.section === "craft");
  assert.equal(updatePlanModule(aiLayout, craft.id, { sourceImageId: "00233" }).modules.find(m => m.id === craft.id).aiStatus, undefined, "photo-only modules do not become pending AI jobs");
});

test("secondary photo selection and removal preserve the primary result and generation batch", () => {
  const p = { ...sampleProject(), workflow: "complete", generation: "ai", generationBatch: randomUUID() };
  const target = p.modules.find(m => m.section === "colors");
  target.aiStatus = "succeeded";
  for (const imageId2 of ["00240", ""]) {
    const next = updatePlanModule(p, target.id, { imageId2 });
    assert.equal(next.workflow, "complete");
    assert.equal(next.generationBatch, p.generationBatch);
    assert.deepEqual(next.modules.find(m => m.id === target.id), { ...target, imageId2, sourceImageId2: imageId2 });
    assert.ok(next.modules.filter(m => m.id !== target.id).every(m => m === p.modules.find(old => old.id === m.id)));
  }
  const unchanged = updatePlanModule(p, target.id, { imageId: target.sourceImageId });
  assert.equal(unchanged.generationBatch, p.generationBatch, "reselecting an unchanged original needs no new batch");
  p.assets.push({ ...p.assets[0], id: "generated-photo", generated: true });
  assert.equal(updatePlanModule(p, target.id, { imageId: "generated-photo" }), p);
  assert.equal(updatePlanModule(p, target.id, { imageId2: "missing-photo" }), p);
});

test("reselecting the current template leaves manual copy, AI results and workflow untouched", () => {
  const p = { ...sampleProject(), generation: "ai", workflow: "complete", generationBatch: randomUUID() };
  Object.assign(p.modules[0], { title: "手写标题", imageId: "generated", aiStatus: "succeeded" });
  assert.equal(updateProjectTemplate(p, p.template), p);
});

test("switching templates preserves edited copy and real photo crops by purpose rather than image number", () => {
  const p = { ...sampleProject(), generation: "ai", workflow: "complete", generationBatch: randomUUID() };
  for (const module of p.modules) {
    module.title = `${module.kind}-${module.section}-已编辑`;
    module.subtitle = `${module.kind}-${module.section}-补充说明`;
  }
  const hero = p.modules.find(m => m.kind === "main" && m.section === "hero");
  Object.assign(hero, { title: "手写首图", subtitle: "", imageId: "generated-hero", sourceImageId: "00237", cropX: 31, cropY: 69, aiStatus: "succeeded" });
  p.assets.push({ ...p.assets[0], id: "generated-hero", generated: true });
  const scene = p.modules.find(m => m.kind === "main" && m.section === "scene");
  Object.assign(scene, { imageId: "00224", sourceImageId: "00224", cropX: 70, cropY: 40 });
  const colors = p.modules.find(m => m.kind === "main" && m.section === "colors");
  Object.assign(colors, { imageId2: "", sourceImageId2: "" });
  const before = structuredClone(p);
  const next = updateProjectTemplate(p, "warm");
  assert.equal(next.template, "warm");
  assert.equal(next.workflow, "plan");
  assert.equal(next.status, "draft");
  assert.notEqual(next.generationBatch, p.generationBatch);
  assert.equal(next.assets, p.assets);
  const nextHero = next.modules.find(m => m.kind === "main" && moduleSection(m) === "hero");
  assert.equal(nextHero.title, "手写首图");
  assert.equal(nextHero.subtitle, "");
  assert.equal(nextHero.imageId, "00237");
  assert.equal(nextHero.sourceImageId, "00237");
  assert.equal(nextHero.cropX, 31);
  assert.equal(nextHero.cropY, 69);
  const nextScene = next.modules.find(m => m.kind === "main" && moduleSection(m) === "scene");
  assert.notEqual(nextScene.index, scene.index, "purpose moves from main image 2 to 4");
  assert.equal(nextScene.title, scene.title);
  assert.equal(nextScene.subtitle, scene.subtitle);
  assert.equal(nextScene.imageId, "00224");
  assert.equal(nextScene.cropX, scene.cropX);
  assert.equal(nextScene.cropY, scene.cropY);
  assert.equal(next.modules.find(m => m.kind === "main" && moduleSection(m) === "colors").sourceImageId2, "");
  assert.ok(next.modules.every(m => !m.aiStatus && !m.aiError && !p.assets.find(a => a.id === m.imageId)?.generated));
  assert.deepEqual(p, before);
});

test("template changes safely use new original defaults when legacy source references are missing", () => {
  const p = { ...sampleProject(), template: "warm", output: "detail" };
  p.modules = makeModules(p);
  const legacyHero = p.modules[0];
  legacyHero.title = "旧版首图标题";
  legacyHero.imageId = "generated-legacy";
  delete legacyHero.sourceImageId;
  p.assets.push({ ...p.assets[0], id: legacyHero.imageId, generated: true });
  const next = updateProjectTemplate(p, "vip");
  assert.equal(next.modules.length, 7);
  assert.equal(next.modules[0].title, legacyHero.title);
  assert.ok(next.modules.every(m => p.assets.some(a => a.id === m.imageId && !a.generated)));
  assert.deepEqual(updateProjectTemplate(freshProject(), "clean").modules, [], "selecting a style before upload creates no broken image references");
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

test("commercial reference bundles preserve the selected color and never use generated images", () => {
  const p = sampleProject();
  const hero = p.modules[0];
  p.assets.unshift({ ...p.assets[0], id: "ai-reference", generated: true });
  const refs = referenceAssets(p, hero);
  assert.equal(refs[0].id, hero.sourceImageId);
  assert.equal(refs.length, 3);
  assert.ok(refs.every(a => !a.generated && a.name.includes("米白")));
  assert.equal(new Set(refs.map(a => a.id)).size, refs.length);
  const gray = { ...hero, sourceImageId: "00237" };
  assert.ok(referenceAssets(p, gray).every(a => a.name.includes("灰紫")));
  p.info.colors = "";
  assert.deepEqual(referenceAssets(p, hero).map(a => a.id), [hero.sourceImageId]);
  assert.deepEqual(referenceAssets(p, { ...hero, sourceImageId: "missing" }), []);
});

test("automatic detail comparisons never pair a selected color with another variant or an unidentified photo", () => {
  const p = sampleProject();
  const photo = (id, name, role) => ({ id, name, role, url: `/samples/${id}.jpg`, width: 1200, height: 1200 });
  p.assets = [
    photo("white-bed", "米白 · 整体", "整体"),
    photo("gray-texture", "灰紫 · 面料特写", "细节"),
    photo("gray-craft", "灰紫 · 包边工艺", "工艺"),
    photo("white-color", "米白 · 配色", "颜色"),
    photo("gray-color", "灰紫 · 配色", "颜色"),
  ];
  const evidenceModules = project => makeModules(project).filter(m => ["texture", "craft"].includes(m.section));
  assert.ok(evidenceModules(p).every(m => m.imageId.startsWith("gray-") && m.imageId2 === ""), "gray details must not be accompanied by the only white whole-product photo");
  p.assets.push(photo("gray-bed", "灰紫 · 整体", "整体"));
  assert.ok(evidenceModules(p).every(m => m.imageId2 === "gray-bed"), "a confirmed matching variant can accompany its detail");
  p.assets.find(a => a.id === "gray-bed").name = "未标注颜色的整床实拍";
  assert.ok(evidenceModules(p).every(m => m.imageId2 === ""), "an unknown color must not be guessed from the asset role");
  const comparison = makeModules(p).find(m => m.section === "colors");
  assert.equal(comparison.imageId, "white-color");
  assert.equal(comparison.imageId2, "gray-color", "the explicitly labeled color-comparison module may show both variants");
  p.info.colors = "";
  assert.ok(evidenceModules(p).every(m => m.imageId2 === ""), "missing color facts leave automatic comparisons unset");
});

test("single-photo plans omit duplicate comparisons and match selling points to their purpose", () => {
  const p = sampleProject();
  p.assets = [p.assets[0]];
  p.info.sellingPoints = "包边走线\n格纹肌理\n两色展示";
  const modules = makeModules(p);
  assert.ok(modules.every(m => !m.imageId2));
  assert.equal(modules.find(m => m.section === "texture").title, "格纹肌理");
  assert.equal(modules.find(m => m.section === "craft").title, "包边走线");
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
    ...p.assets[0], id: role, name: "米白 · " + role + "实拍", role,
  })));
  const quilt = makeModules(p);
  assert.equal(quilt.find(m => m.section === "hero").sourceImageId, "叠放");
  assert.equal(quilt.find(m => m.section === "filling").sourceImageId, "填充");
  assert.equal(quilt.find(m => m.section === "craft").sourceImageId, "工艺");
  p.category = "bedding-set";
  p.info = { ...freshProject().info, name: "花型床上套件", colors: "米白", setContents: "被套1件、枕套1件" };
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
    all: async () => ({ results: sql.includes("FROM generation_jobs") ? jobs.filter(job => !job.id || job.id.startsWith(args[2].slice(0, -1))) : [...heldProjects.values()].map(data => ({ data })) }),
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

test("changing visual composition preserves generated results and manual hero copy", async () => {
  heldProjects.clear(); jobs = [];
  const p = { ...sampleProject(), id: randomUUID(), generation: "ai", workflow: "complete", generationBatch: randomUUID() };
  p.modules[0] = { ...p.modules[0], title: "我的首图标题", subtitle: "", aiStatus: "succeeded" };
  const next = updatePlanModule(p, p.modules[0].id, { composition: "immersive", imageZoom: 1.15 });
  assert.equal(next.generationBatch, p.generationBatch);
  assert.equal(next.modules[0].title, "我的首图标题");
  assert.equal(next.modules[0].aiStatus, "succeeded");
  assert.equal((await post(next)).status, 200);
  const saved = (await (await route.GET()).json()).projects[0];
  assert.equal(saved.modules[0].composition, "immersive");
  assert.equal(saved.modules[0].imageZoom, 1.15);
  assert.equal(updateProjectTemplate(next, "warm").modules[0].composition, "immersive");
  assert.equal(updateProjectTemplate(next, "warm").modules[0].imageZoom, 1.15);
  assert.equal((await post({ ...next, modules: [{ ...next.modules[0], composition: "broken" }] })).status, 400);
  assert.equal((await post({ ...next, modules: [{ ...next.modules[0], imageZoom: 2.1 }] })).status, 400);
});


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

test("saving a new plan photo prevents old generation jobs from restoring the previous result", async () => {
  heldProjects.clear();
  const p = { ...sampleProject(), id: randomUUID(), workflow: "complete", generation: "ai", generationBatch: randomUUID() };
  const target = p.modules[0];
  const oldResult = { ...p.assets[0], id: randomUUID(), generated: true };
  oldResult.url = "/api/assets/" + oldResult.id;
  p.assets.push(oldResult);
  Object.assign(target, { imageId: oldResult.id, aiStatus: "succeeded" });
  jobs = [{ id: `${p.id}:${p.generationBatch}:${target.id}`, module_id: target.id, status: "succeeded", result: JSON.stringify(oldResult) }];
  const next = updatePlanModule(p, target.id, { imageId: "00237" });
  assert.equal((await post(next)).status, 200);
  const reloaded = (await (await route.GET()).json()).projects[0];
  assert.equal(reloaded.workflow, "complete");
  assert.equal(reloaded.generationBatch, next.generationBatch);
  assert.equal(reloaded.modules[0].imageId, "00237");
  assert.equal(reloaded.modules[0].sourceImageId, "00237");
  assert.equal(reloaded.modules[0].aiStatus, "pending");
  assert.deepEqual(reloaded.modules.slice(1), p.modules.slice(1));
  assert.ok(reloaded.assets.some(a => a.id === oldResult.id), "prior image is retained without becoming the selected photo");
  jobs = [];
});

test("saving a new template never reloads generation results created for the previous template", async () => {
  heldProjects.clear();
  const p = { ...sampleProject(), id: randomUUID(), workflow: "complete", generation: "ai", generationBatch: randomUUID() };
  const target = p.modules[0];
  const oldResult = { ...p.assets[0], id: randomUUID(), generated: true };
  oldResult.url = "/api/assets/" + oldResult.id;
  p.assets.push(oldResult);
  Object.assign(target, { imageId: oldResult.id, aiStatus: "succeeded", title: "首图手写内容" });
  jobs = [{ id: `${p.id}:${p.generationBatch}:${target.id}`, module_id: target.id, status: "succeeded", result: JSON.stringify(oldResult) }];
  const next = updateProjectTemplate(p, "clean");
  assert.equal((await post(next)).status, 200);
  const reloaded = (await (await route.GET()).json()).projects[0];
  assert.equal(reloaded.template, "clean");
  assert.equal(reloaded.workflow, "plan");
  assert.equal(reloaded.modules[0].title, "首图手写内容");
  assert.equal(reloaded.modules[0].imageId, target.sourceImageId);
  assert.equal(reloaded.modules[0].aiStatus, undefined);
  assert.deepEqual(reloaded.modules, next.modules);
  jobs = [];
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
