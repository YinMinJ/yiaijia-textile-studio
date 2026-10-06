import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as model from "../lib/design-model.ts";
import * as copy from "../lib/design-copy.ts";

const state = { requests: [], oversizedUrl: "", missingUrl: "", sourceBytes: new Uint8Array([1, 2, 3]) };
globalThis.__studioGenerationTest = {
  ...model, ...copy,
  ref: value => ({ value }), shallowRef: value => ({ value }),
  computed: getter => ({ get value() { return getter(); } }),
  onMounted: () => {}, onBeforeUnmount: () => {},
  setTimeout: () => 0, clearTimeout: () => {},
  fetch: async (url, request = {}) => {
    state.requests.push({ url, request });
    if (url === "/api/projects") return Response.json({ project: JSON.parse(request.body) });
    if (url === "/api/generate-image") return Response.json({
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

function setup({ knownColor = true } = {}) {
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
