import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as model from "../lib/design-model.ts";
import * as copy from "../lib/design-copy.ts";
import { appPath } from "../lib/app-path.ts";
import { appLocalMode } from "../lib/app-mode.ts";

const originalBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH;
test.after(() => {
  if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_APP_BASE_PATH;
  else process.env.NEXT_PUBLIC_APP_BASE_PATH = originalBasePath;
});
const state = { requests: [], oversizedUrl: "", missingUrl: "", sourceBytes: new Uint8Array([1, 2, 3]) };
globalThis.__studioGenerationTest = {
  ...model, ...copy, appPath, appLocalMode,
  ref: value => ({ value }), shallowRef: value => ({ value }),
  computed: getter => ({ get value() { return getter(); } }),
  onMounted: () => {}, onBeforeUnmount: () => {},
  setTimeout: () => 0, clearTimeout: () => {},
  fetch: async (url, request = {}) => {
    state.requests.push({ url, request });
    if (url === appPath("/api/projects")) return Response.json({ project: JSON.parse(request.body) });
    if (url === appPath("/api/generate-image")) return Response.json({
      asset: { id: "generated-test-image", name: "generated product", generated: true, url: "/api/assets/generated-test-image", role: "整体", width: 1024, height: 1024 },
    });
    if (url === state.missingUrl) return new Response("missing", { status: 404 });
    return new Response(url === state.oversizedUrl ? new Uint8Array(8 * 1024 * 1024 + 1) : state.sourceBytes, { headers: { "Content-Type": "image/jpeg" } });
  },
};
const source = (await readFile(new URL("../frontend/useStudio.ts", import.meta.url), "utf8"))
  .replace(/^import[^;]+;\r?\n/gm, "");
const { outputText } = ts.transpileModule(
  "const { " + Object.keys(globalThis.__studioGenerationTest).join(", ") + " } = globalThis.__studioGenerationTest;\n" + source,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
);
const { useStudio } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));

function setup({ knownColor = true, basePath = "" } = {}) {
  process.env.NEXT_PUBLIC_APP_BASE_PATH = basePath;
  state.requests = [];
  state.oversizedUrl = "";
  state.missingUrl = "";
  const project = { ...model.sampleProject(), output: "main", workflow: "complete", generation: "template" };
  project.info.colors = knownColor ? "米白、灰紫" : "";
  project.assets = [
    { id: "primary", url: "/api/assets/primary", name: "米白叠放", width: 1800, height: 1800, role: "叠放" },
    { id: "same-detail", url: "/api/assets/same-detail", name: "米白纹理", width: 1800, height: 1800, role: "细节" },
    { id: "same-whole", url: "/api/assets/same-whole", name: "米白整床", width: 1800, height: 1800, role: "整体" },
    { id: "other-color", url: "/api/assets/other-color", name: "灰紫整床", width: 1800, height: 1800, role: "整体" },
  ];
  project.modules = model.makeModules(project);
  const studio = useStudio();
  studio.project.value = project;
  studio.modelConfigured.value = true;
  return { studio, project, hero: project.modules[0] };
}

test("Vue generation uploads the authoritative primary then at most two matching original references", async () => {
  const { studio, project, hero } = setup();
  await studio.runAI(project, hero.id);
  assert.deepEqual(state.requests.filter(item => item.url.startsWith("/api/assets/")).map(item => item.url), [
    "/api/assets/primary", "/api/assets/same-detail", "/api/assets/same-whole",
  ]);
  const calls = state.requests.filter(item => item.url === "/api/generate-image");
  assert.equal(calls.length, 1);
  const form = calls[0].request.body;
  assert.deepEqual(form.getAll("image").map(file => ({ name: file.name, size: file.size, type: file.type })), [
    { name: "product-1.jpg", size: 3, type: "image/jpeg" },
    { name: "product-2.jpg", size: 3, type: "image/jpeg" },
    { name: "product-3.jpg", size: 3, type: "image/jpeg" },
  ]);
  assert.equal(form.get("moduleId"), hero.id);
  assert.equal(studio.project.value.modules[0].sourceImageId, "primary");
  assert.equal(studio.project.value.modules[0].imageId, "generated-test-image");
  assert.equal(studio.project.value.modules[0].aiStatus, "succeeded");
});

test("unknown color remains a compatible one-image edit and failed reference reads never reach the paid endpoint", async () => {
  let fixture = setup({ knownColor: false });
  await fixture.studio.runAI(fixture.project, fixture.hero.id);
  assert.equal(state.requests.find(item => item.url === "/api/generate-image").request.body.getAll("image").length, 1);
  fixture = setup();
  state.missingUrl = "/api/assets/same-detail";
  await fixture.studio.runAI(fixture.project, fixture.hero.id);
  assert.equal(state.requests.filter(item => item.url === "/api/generate-image").length, 0);
  assert.equal(fixture.studio.project.value.modules[0].aiStatus, "failed");
  assert.match(fixture.studio.project.value.modules[0].aiError, /参考素材读取失败/);
  assert.equal(fixture.studio.busy.value, "");
});

test("a reference larger than eight MB stops before generation without substituting another product image", async () => {
  const { studio, project, hero } = setup();
  state.oversizedUrl = "/api/assets/same-detail";
  await studio.runAI(project, hero.id);
  assert.equal(state.requests.filter(item => item.url === "/api/generate-image").length, 0);
  assert.match(studio.project.value.modules[0].aiError, /8MB/);
  assert.deepEqual(state.requests.filter(item => item.url.startsWith("/api/assets/")).map(item => item.url), [
    "/api/assets/primary", "/api/assets/same-detail",
  ]);
});

test("Vue zoom editing preserves the completed image and saves the numeric scale without a model request", async () => {
  const { studio, project, hero } = setup();
  const generated = { ...project.assets[0], id: "saved-generated", generated: true };
  const complete = { ...project, sample: undefined, generation: "ai", generationBatch: "preserved-batch", assets: [...project.assets, generated], modules: project.modules.map(module => module.id === hero.id ? { ...module, imageId: generated.id, aiStatus: "succeeded" } : module) };
  studio.project.value = complete;
  studio.editingId.value = hero.id;
  studio.updateModule({ imageZoom: 1.4, cropX: 65, cropY: 40 });
  const edited = studio.project.value.modules[0];
  assert.equal(edited.imageZoom, 1.4);
  assert.equal(edited.imageId, generated.id);
  assert.equal(edited.aiStatus, "succeeded");
  assert.equal(studio.project.value.generationBatch, "preserved-batch");
  assert.equal(state.requests.length, 0);
  await studio.save();
  const saved = JSON.parse(state.requests.find(item => item.url === "/api/projects").request.body);
  assert.equal(saved.modules[0].imageZoom, 1.4);
  assert.equal(saved.modules[0].cropX, 65);
  assert.equal(saved.modules[0].cropY, 40);
  assert.equal(state.requests.filter(item => item.url === "/api/generate-image").length, 0);
});

test("Vue multiline copy, text position and color edits keep completed photos and never request generation", async () => {
  const { studio, project, hero } = setup();
  const generated = { ...project.assets[0], id: "saved-generated", generated: true };
  studio.project.value = { ...project, sample: undefined, generation: "ai", generationBatch: "preserved-batch", assets: [...project.assets, generated], modules: project.modules.map(module => module.id === hero.id ? { ...module, imageId: generated.id, aiStatus: "succeeded" } : module) };
  studio.editingId.value = hero.id;
  studio.updateModule({ title: "时尚双版设计\n营造卧室美学", textPosition: "top-right", textColor: "dark" });
  studio.updatePlan(hero.id, { textPosition: "bottom-left", textColor: "light" });
  const edited = studio.project.value.modules[0];
  assert.equal(edited.title, "时尚双版设计\n营造卧室美学");
  assert.equal(edited.textPosition, "bottom-left");
  assert.equal(edited.textColor, "light");
  assert.equal(edited.imageId, generated.id);
  assert.equal(edited.aiStatus, "succeeded");
  assert.equal(studio.project.value.workflow, "complete");
  assert.equal(studio.project.value.generationBatch, "preserved-batch");
  assert.equal(state.requests.length, 0);
  await studio.save();
  const saved = JSON.parse(state.requests.find(item => item.url === "/api/projects").request.body);
  assert.equal(saved.modules[0].title, edited.title);
  assert.equal(saved.modules[0].textPosition, "bottom-left");
  assert.equal(saved.modules[0].textColor, "light");
  assert.equal(state.requests.filter(item => ["/api/generate-image", "/api/generate-copy"].includes(item.url)).length, 0);
});

test("Vue subpath generation prefixes reference, generation and persistence requests without changing stored asset URLs", async () => {
  const { studio, project, hero } = setup({ basePath: "/zhijing" });
  const originalUrls = project.assets.map(asset => asset.url);
  await studio.runAI(project, hero.id);
  assert.deepEqual(state.requests.map(item => item.url), [
    "/zhijing/api/projects",
    "/zhijing/api/assets/primary",
    "/zhijing/api/assets/same-detail",
    "/zhijing/api/assets/same-whole",
    "/zhijing/api/generate-image",
    "/zhijing/api/projects",
  ]);
  const generation = state.requests.find(item => item.url === "/zhijing/api/generate-image");
  assert.equal(generation.request.body.getAll("image").length, 3);
  assert.equal(generation.request.body.get("moduleId"), hero.id);
  const persisted = state.requests.filter(item => item.url === "/zhijing/api/projects").map(item => JSON.parse(item.request.body));
  assert.deepEqual(persisted[0].assets.map(asset => asset.url), originalUrls);
  assert.deepEqual(persisted[1].assets.map(asset => asset.url), [...originalUrls, "/api/assets/generated-test-image"]);
  assert.deepEqual(studio.project.value.assets.map(asset => asset.url), persisted[1].assets.map(asset => asset.url));
  assert.equal(studio.project.value.modules[0].aiStatus, "succeeded");
});

test("Vue subpath manual edits save through the prefixed endpoint while preserving canonical original and generated asset URLs", async () => {
  const { studio, project, hero } = setup({ basePath: "/zhijing" });
  const generated = { ...project.assets[0], id: "saved-generated", url: "/api/assets/saved-generated", generated: true };
  studio.project.value = {
    ...project, sample: undefined, generation: "ai", assets: [...project.assets, generated],
    modules: project.modules.map(module => module.id === hero.id ? { ...module, imageId: generated.id, aiStatus: "succeeded" } : module),
  };
  studio.editingId.value = hero.id;
  studio.updateModule({ title: "全棉亲肤面料\n柔软顺滑", imageZoom: 1.2 });
  const expectedUrls = studio.project.value.assets.map(asset => asset.url);
  assert.equal(await studio.save(), true);
  assert.deepEqual(state.requests.map(item => item.url), ["/zhijing/api/projects"]);
  const saved = JSON.parse(state.requests[0].request.body);
  assert.deepEqual(saved.assets.map(asset => asset.url), expectedUrls);
  assert.equal(saved.modules[0].title, "全棉亲肤面料\n柔软顺滑");
  assert.equal(saved.modules[0].imageZoom, 1.2);
  assert.equal(saved.modules[0].imageId, generated.id);
  assert.equal(saved.modules[0].aiStatus, "succeeded");
});
