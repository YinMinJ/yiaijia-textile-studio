"use client";

import { ArrowDown, ArrowUp, Sparkles, ArrowRight, LoaderCircle, Undo2 } from "lucide-react";
import { categoryFor, modulePurpose, moduleSection, sourceAsset, usesSecondary, type Project, type DesignModule } from "@/lib/design-model";

export default function DesignPlan({ project, onChange, onPreview, onReview, onGenerateCopy, onUndoCopy, copyResult, busy, copyBusy }: {
  project: Project;
  onChange: (p: Project) => void;
  onPreview: (mode: "template" | "ai") => void;
  onReview: () => void;
  onGenerateCopy: () => void;
  onUndoCopy: () => void;
  copyResult: { message: string; error?: boolean; before?: unknown[] } | null;
  busy: boolean;
  copyBusy: boolean;
}) {
  const originals = project.assets.filter((a) => !a.generated);
  const category = categoryFor(project);
  const hasCompletedLayout = project.workflow === "complete" || (!project.workflow && project.status === "ready");
  function edit(id: string, changes: Partial<DesignModule>) {
    onChange({ ...project, workflow: changes.imageId !== undefined || changes.imageId2 !== undefined ? "plan" : project.workflow, modules: project.modules.map((m) => m.id === id ? { ...m, ...changes } : m) });
  }
  function move(id: string, delta: number) {
    const modules = [...project.modules];
    const from = modules.findIndex((m) => m.id === id);
    const to = from + delta;
    if (!modules[to] || modules[to].kind !== modules[from].kind || moduleSection(modules[to]) === "hero") return;
    [modules[from], modules[to]] = [modules[to], modules[from]];
    const count = { main: 0, detail: 0 };
    onChange({ ...project, workflow: "plan", modules: modules.map((m) => ({ ...m, index: ++count[m.kind] })) });
  }
  const missing = [!project.info.material && "面料成分", !project.info.size && "尺寸规格", !project.info.care && "洗护说明", category.id === "quilt" ? !project.info.filling && "填充物" : !project.info.setContents && "套件组成"].filter(Boolean);
  return <section className="design-plan">
    <div className="plan-heading">
      <div><span className="eyebrow">先把一款商品讲清楚</span><h2>每张图，只讲一个重点</h2><p>先定卖点，再配实拍。{project.template === "vip" ? "首屏固定在前，其余模块可调整顺序。" : "当前模板使用固定顺序；宜爱家店铺风格支持自由调整。"}</p></div>
      <span className="pill">{project.modules.length} 张图的内容计划</span>
    </div>
    <div className="plan-category-reference"><span><b>{category.name}方案</b> · {category.summary}</span><a href={category.referenceUrl} target="_blank" rel="noreferrer">查看本类目参考 ↗</a></div>
    <div className="plan-route">{project.modules.map((m, i) => <span key={m.id}>{i > 0 && <ArrowRight size={13} />}{modulePurpose(m).split(" · ")[0]}</span>)}</div>
    {missing.length > 0 && <p className="plan-facts">待补充：{missing.join("、")}。未填写的信息不会自动编造，可返回“商品资料”补齐。</p>}
    <div className="plan-copy-actions">
      <div><b>首图自己写，其余交给 AI</b><p>填写首图标题和补充说明，再一键生成其余图片的文案。AI 按商品资料和每张图的用途编写，生成后仍可手动修改。</p></div>
      <button className="btn primary" disabled={busy || !project.modules.some((m) => moduleSection(m) !== "hero" && m.index !== 1)} onClick={onGenerateCopy}>
        {copyBusy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{copyBusy ? "正在编写文案" : "AI 生成其他图文案"}
      </button>
    </div>
    {copyResult && <div className={copyResult.error ? "error-banner" : "plan-copy-result"} role={copyResult.error ? "alert" : "status"}><span>{copyResult.message}</span>{copyResult.before && <button className="text-button" disabled={busy} onClick={onUndoCopy}><Undo2 size={14} />撤销本次生成</button>}</div>}
    <div className="plan-rows">
      {project.modules.map((m, i) => {
        const a = sourceAsset(project, m);
        const section = moduleSection(m);
        const photoHint = section === "filling" && a?.role !== "填充" && a?.role !== "叠放" ? "暂用现有实拍。建议补充填充或叠放照片，不自动绘制内部结构。" : section === "components" ? "分别选择被套、枕套或床单实拍；组成与件数以商品资料为准。" : section === "hero" && category.id === "quilt" && a?.role !== "叠放" ? "首图优先选叠放实拍；当前使用整体图。" : "";
        const factsOnly = moduleSection(m) === "specs" || (project.template === "vip" && moduleSection(m) === "care");
        return <article className="plan-row" key={m.id}>
          <div className="plan-order"><b>{String(i + 1).padStart(2, "0")}</b><span>{modulePurpose(m).split(" · ")[0]}</span>
            {project.template === "vip" && moduleSection(m) !== "hero" && <div>
              <button className="icon-button" aria-label={`上移${modulePurpose(m)}`} disabled={busy || i === 0 || project.modules[i - 1].kind !== m.kind || moduleSection(project.modules[i - 1]) === "hero"} onClick={() => move(m.id, -1)}><ArrowUp size={15} /></button>
              <button className="icon-button" aria-label={`下移${modulePurpose(m)}`} disabled={busy || !project.modules[i + 1] || project.modules[i + 1].kind !== m.kind || moduleSection(project.modules[i + 1]) === "hero"} onClick={() => move(m.id, 1)}><ArrowDown size={15} /></button>
            </div>}
          </div>
          <div className="plan-copy">
            <span className={`copy-mode ${section === "hero" || m.index === 1 ? "manual" : ""}`}>{section === "hero" || m.index === 1 ? "首图 · 手动文案，AI 不改写" : "支持 AI 编写 · 可手动修改"}</span>
            <label>{section === "hero" || m.index === 1 ? "首图主标题" : "这张图的主标题"}<input disabled={busy} maxLength={40} value={m.title} onChange={(e) => edit(m.id, { title: e.target.value })} /></label>
            <label>{section === "hero" || m.index === 1 ? "首图补充说明" : "补充说明"}<textarea disabled={busy} rows={2} maxLength={100} value={m.subtitle} placeholder="一句话说明，让照片证明卖点" onChange={(e) => edit(m.id, { subtitle: e.target.value })} /></label>
          </div>
          <div className="plan-source">
            {factsOnly ? <div className="plan-info-card"><b>{moduleSection(m) === "specs" ? "真实参数" : "选购与洗护"}</b><span>{moduleSection(m) === "specs" ? "使用已填写的商品资料" : project.info.care || "可在商品资料中填写洗护标识内容"}</span></div> : <>
              {a && <img src={a.url} alt={`${modulePurpose(m)}选用的实拍：${a.name}`} />}
              <label>用哪张实拍证明<select aria-label={`${modulePurpose(m)}的原始实拍`} value={a?.id || ""} onChange={(e) => edit(m.id, { sourceImageId: e.target.value, imageId: e.target.value, aiStatus: undefined, aiError: undefined })}>
                <option value="" disabled>请选择原始实拍</option>{originals.map((asset) => <option key={asset.id} value={asset.id}>{asset.role} · {asset.name}</option>)}
              </select></label>
              {usesSecondary(m) && <label>{section === "components" ? "另一件的实拍" : "第二张配色实拍"}<select aria-label={`${modulePurpose(m)}的第二张实拍`} value={m.sourceImageId2 || m.imageId2} onChange={(e) => edit(m.id, { sourceImageId2: e.target.value, imageId2: e.target.value })}><option value="">暂不使用第二张</option>{originals.map((asset) => <option key={asset.id} value={asset.id}>{asset.role} · {asset.name}</option>)}</select></label>}
              {photoHint && <small className="plan-source-hint">{photoHint}</small>}
            </>}
          </div>
        </article>;
      })}
    </div>
    {hasCompletedLayout ? <div className="plan-next"><div><b>文案修改会同步到整套图</b><p>已生成的图片继续使用，检查排版后即可保存和导出。</p></div><button className="btn primary" disabled={busy} onClick={onReview}>查看更新后的整套图<ArrowRight size={16} /></button></div> : <div className="plan-next"><div><b>先看首图，满意再完成整套</b><p>{project.template === "vip" ? "细节与配色保留实拍；AI 仅优化首屏和场景的光线、背景。" : "先预览一张，确认文字、商品占比和整体方向。"}</p></div><div className="plan-buttons">
      <button className="btn" disabled={busy} onClick={() => onPreview("template")}>用实拍预览首图</button>
      <button className="btn primary" disabled={busy} onClick={() => onPreview("ai")}><Sparkles size={16} />AI 优化首图</button>
    </div></div>}
  </section>;
}
