"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Eye, LayoutTemplate, LoaderCircle, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { preserveHeroCopy } from "@/lib/design-copy";
import { drawDesign } from "@/lib/design-renderer";
import {
  categories, categoryFor, dimensions, makeModules, modulePurpose, sampleProject, sourceAsset, templates, updateProjectTemplate,
  type DesignModule, type ProductCategory, type Project, type TemplateId,
} from "@/lib/design-model";
import "./template-library.css";

const example = sampleProject();

function TemplateCanvas({ project, module, expanded = false }: {
  project: Project;
  module: DesignModule;
  expanded?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement("canvas");
    setState("loading");
    setError("");
    void drawDesign(canvas, project, module, expanded ? 0.65 : 0.4)
      .then(() => {
        if (cancelled || !ref.current) return;
        ref.current.width = canvas.width;
        ref.current.height = canvas.height;
        const context = ref.current.getContext("2d");
        if (!context) throw new Error("当前浏览器无法显示预览。");
        context.drawImage(canvas, 0, 0);
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "预览暂时无法加载，请稍后重试。");
        setState("error");
      })
      .finally(() => { canvas.width = 1; canvas.height = 1; });
    return () => { cancelled = true; };
  }, [project, module, expanded]);
  const size = dimensions(module);
  return (
    <div className={"tl-canvas " + (expanded ? "tl-canvas-expanded" : "")} aria-busy={state === "loading"}>
      <canvas
        ref={ref}
        role="img"
        aria-label={`${module.kind === "main" ? "主图" : "详情"} ${module.index}：${module.title}`}
        style={{ aspectRatio: `${size.width} / ${size.height}`, visibility: state === "ready" ? "visible" : "hidden" }}
      />
      {state === "loading" && <span className="tl-canvas-status" role="status"><LoaderCircle size={19} className="spin" />正在排版</span>}
      {state === "error" && <span className="tl-canvas-status tl-canvas-error" role="alert">{error}</span>}
    </div>
  );
}

function previewProject(source: Project, template: TemplateId, category: ProductCategory, output: "main" | "detail", preserveExisting: boolean): Project {
  const arranged = preserveExisting ? updateProjectTemplate(source, template) : source;
  const preview: Project = {
    ...arranged,
    template,
    category,
    output,
    assets: source.assets.filter(asset => !asset.generated),
    modules: [],
    generation: "template",
    generationBatch: undefined,
    workflow: "plan",
  };
  preview.modules = preserveExisting && arranged.modules.some(module => module.kind === output)
    ? arranged.modules.filter(module => module.kind === output).map(module => {
      const original = sourceAsset(arranged, module);
      const secondaryId = module.sourceImageId2 ?? module.imageId2;
      return {
        ...module,
        imageId: original?.id || module.sourceImageId || module.imageId,
        imageId2: secondaryId,
        aiStatus: undefined,
        aiError: undefined,
      };
    })
    : preserveHeroCopy(source, makeModules(preview));
  return preview;
}

export default function TemplateLibrary({ currentProject, busy, onUse }: {
  currentProject: Project | null;
  busy: boolean;
  onUse: (template: TemplateId, category: ProductCategory, output: "main" | "detail") => void;
}) {
  const [category, setCategory] = useState<ProductCategory>(() => currentProject ? categoryFor(currentProject).id : "quilt");
  const [output, setOutput] = useState<"main" | "detail">(currentProject?.output || "main");
  const [previewId, setPreviewId] = useState<TemplateId | null>(null);
  const hasOriginals = !!currentProject?.assets.some(asset => !asset.generated);
  const appliesToCurrent = !!currentProject
    && categoryFor(currentProject).id === category
    && (currentProject.output || "main") === output;
  const source = hasOriginals ? currentProject! : example;
  const designs = useMemo(() => templates.map(template => ({
    template,
    project: previewProject(source, template.id, category, output, hasOriginals && appliesToCurrent),
  })), [source, category, output, hasOriginals, appliesToCurrent]);
  const preview = designs.find(item => item.template.id === previewId);
  const currentCategory = categories.find(item => item.id === category)!;
  const outputName = output === "main" ? "商品主图" : "详情长图";
  const count = output === "main" ? 5 : 7;
  const useLabel = appliesToCurrent ? "应用到当前作品" : "使用模板新建";
  const applyNotice = appliesToCurrent
    ? "应用后按新风格排版，保留商品资料与原图；首图和用途相同的图片保留文案、选图与裁切。"
    : "将新建此类目的空白商品，请上传对应商品实拍；当前作品有未保存修改时会先提醒处理。";
  const sampleNotice = !hasOriginals
    ? category === "bedding-set"
      ? "当前用内置被子实拍演示套件排版；制作时请上传实际套件图片。"
      : "当前展示内置商品示例，使用模板后可换成自己的商品。"
    : categoryFor(source).id !== category
      ? "当前用已打开作品的实拍预览新类目排版；请在制作时核对商品类目与素材。"
      : appliesToCurrent
        ? `正在用「${source.info.name || "当前作品"}」的实拍与现有文案预览。`
        : `当前用「${source.info.name || "当前作品"}」的实拍演示${outputName}排版；使用后将新建空白商品。`;

  function useTemplate(id: TemplateId) {
    if (busy) return;
    onUse(id, category, output);
    setPreviewId(null);
  }

  return (
    <section className="tl-library" aria-labelledby="template-library-title">
      <header className="tl-heading">
        <div>
          <span className="tl-eyebrow"><LayoutTemplate size={15} />灵感与排版</span>
          <h1 id="template-library-title">风格模板</h1>
          <p>先看效果，再选适合商品的表达。首图文案由你写，其余文案可交给 AI。</p>
        </div>
        <span className="tl-total">{templates.length} 款风格</span>
      </header>

      <div className="tl-filter-panel">
        <div className="tl-filter-row">
          <span className="tl-filter-label" id="tl-category-label">商品类目</span>
          <div className="tl-filter-options" role="group" aria-labelledby="tl-category-label">
            {categories.map(item => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}
          </div>
        </div>
        <div className="tl-filter-row">
          <span className="tl-filter-label" id="tl-output-label">图片用途</span>
          <div className="tl-filter-options" role="group" aria-labelledby="tl-output-label">
            <button type="button" aria-pressed={output === "main"} onClick={() => setOutput("main")}>商品主图 <small>5 张</small></button>
            <button type="button" aria-pressed={output === "detail"} onClick={() => setOutput("detail")}>详情长图 <small>7 张</small></button>
          </div>
        </div>
      </div>

      <div className="tl-results-heading">
        <p>{currentCategory.name} <span>/</span> {outputName} <span>·</span> {templates.length} 款可用</p>
        <span>{sampleNotice}</span>
      </div>
      <p className="tl-apply-notice">{appliesToCurrent ? "应用到当前作品" : "新建商品"}<span>{applyNotice}</span></p>

      <div className="tl-grid">
        {designs.map(({ template, project }) => {
          const active = currentProject?.template === template.id && categoryFor(currentProject).id === category && currentProject.output === output;
          return (
            <article className={"tl-card " + (active ? "tl-card-current" : "")} key={template.id}>
              <button type="button" className="tl-art-button" aria-label={`预览${template.name}模板`} onClick={() => setPreviewId(template.id)}>
                <TemplateCanvas project={project} module={project.modules[0]} />
                <span className="tl-art-tag">{outputName} · {count} 张</span>
                <span className="tl-art-hover"><Eye size={16} />查看排版</span>
              </button>
              <div className="tl-card-content">
                <div className="tl-card-title"><h2>{template.name}</h2>{active && <span><Check size={12} />当前</span>}</div>
                <p className="tl-card-description">{template.description}</p>
                <div className="tl-card-tags">{template.tag.split(" · ").map(tag => <span key={tag}>{tag}</span>)}</div>
                <div className="tl-card-actions">
                  <button type="button" className="tl-button tl-button-secondary" onClick={() => setPreviewId(template.id)} aria-label={`预览${template.name}`}><Eye size={15} />预览</button>
                  <button type="button" className="tl-button tl-button-primary" disabled={busy} onClick={() => useTemplate(template.id)} aria-label={`使用${template.name}模板`}>{useLabel}<ArrowRight size={15} /></button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="tl-footer-note"><Check size={16} /><p>模板包含完整排版与可编辑文案，预览使用商品实拍。应用后可继续调整图片、标题和裁切。</p></div>

      <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreviewId(null); }}>
        <DialogContent className="tl-preview-dialog" showCloseButton={false}>
          {preview && <>
            <DialogHeader className="tl-preview-header">
              <div className="tl-preview-heading">
                <div><span className="tl-eyebrow">{currentCategory.name} / {outputName}</span><DialogTitle>{preview.template.name}</DialogTitle></div>
                <button type="button" className="tl-close" aria-label="关闭模板预览" onClick={() => setPreviewId(null)}><X size={21} /></button>
              </div>
              <DialogDescription>{sampleNotice} 以下展示前 3 张，整套共 {count} 张。</DialogDescription>
            </DialogHeader>
            <div className="tl-preview-gallery">
              {preview.project.modules.slice(0, 3).map(module => <figure key={module.id}>
                <TemplateCanvas project={preview.project} module={module} expanded />
                <figcaption><span>{String(module.index).padStart(2, "0")}</span>{modulePurpose(module).split(" · ")[0]}</figcaption>
              </figure>)}
            </div>
            <div className="tl-preview-footer">
              <p>{applyNotice}</p>
              <button type="button" className="tl-button tl-button-primary" disabled={busy} onClick={() => useTemplate(preview.template.id)}>{useLabel}<ArrowRight size={16} /></button>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
