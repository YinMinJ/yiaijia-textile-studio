"use client";

import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FolderOpen,
  Grid2X2,
  ImageIcon,
  LayoutTemplate,
  LoaderCircle,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { categoryFor, moduleSection, needsAI, type Project } from "../lib/design-model";
import "./studio-home.css";

type StudioHomeProps = {
  projects: Project[];
  currentProject: Project | null;
  dirty: boolean;
  busy: boolean;
  historyLoading: boolean;
  historyError: string;
  onCreate: (output: "main" | "detail") => void;
  onTemplates: () => void;
  onOpen: (project: Project) => void;
  onResume: () => void;
  onSample: (output: "main" | "detail") => void;
  onRetry: () => void;
  onAllWorks: () => void;
};

function coverFor(project: Project) {
  const hero = project.modules.find((module) => moduleSection(module) === "hero");
  return project.assets.find((asset) => asset.id === hero?.imageId)
    || project.assets.find((asset) => !asset.generated);
}

function workStatus(project: Project) {
  if (!project.modules.length) return "待完善商品资料";
  if (project.workflow === "plan") return "待确认内容计划";
  if (project.modules.some((module) => module.aiStatus === "failed")) return "部分图片需重试";
  if (project.workflow === "preview") return "待确认首图";
  if (project.generation === "ai" && project.modules.some((module) => needsAI(project, module) && module.aiStatus !== "succeeded")) {
    return "图片待生成";
  }
  return project.workflow === "complete" || project.status === "ready" ? "已完成排版" : "继续制作";
}

function savedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "已保存";
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日保存`;
}

function outputName(project: Project) {
  if (project.output === "detail") return "商品详情";
  if (project.output === "main") return "商品主图";
  const kinds = new Set(project.modules.map((module) => module.kind));
  return kinds.size > 1 ? "主图与详情" : kinds.has("detail") ? "商品详情" : "商品主图";
}

export default function StudioHome({
  projects, currentProject, dirty, busy, historyLoading, historyError,
  onCreate, onTemplates, onOpen, onResume, onSample, onRetry, onAllWorks,
}: StudioHomeProps) {
  const currentCover = currentProject ? coverFor(currentProject) : null;
  const currentSaveStatus = currentProject?.sample ? "样例体验"
    : dirty ? "有未保存修改"
    : currentProject && !projects.some((project) => project.id === currentProject.id) ? "尚未保存"
    : "已保存";

  return (
    <main className="page studio-home">
      <header className="sh-heading">
        <div>
          <p className="sh-eyebrow">宜爱家 · 商品视觉工作台</p>
          <h1>今天，上新什么好物？</h1>
        </div>
        <span className="sh-local"><span /> 本地工作空间</span>
      </header>

      <section className="sh-hero" aria-labelledby="sh-hero-title">
        <img className="sh-hero-photo" src="/samples/00224.jpg" alt="米白格纹绗缝被的温暖家居实拍场景" />
        <div className="sh-hero-content">
          <span className="sh-hero-kicker"><Sparkles size={14} /> 为家纺商品而设计</span>
          <h2 id="sh-hero-title">好商品，<br />值得被好好看见。</h2>
          <p>从真实素材出发，把商品主图与详情页<br className="sh-desktop-break" />做得清楚、统一、有质感。</p>
          <button className="sh-primary" disabled={busy} onClick={() => onCreate("main")}>
            <Plus size={17} /> 新建商品作品 <ArrowRight size={17} />
          </button>
          <div className="sh-hero-notes">
            <span><Check size={13} /> 首图文案自己写</span>
            <span><Check size={13} /> 其余文案 AI 辅助</span>
          </div>
        </div>
        <div className="sh-photo-caption"><span>真实商品 · 柔和家居</span><b>让细节说话</b></div>
      </section>

      <section className="sh-section" aria-labelledby="sh-tools-title">
        <div className="sh-section-heading">
          <div><h2 id="sh-tools-title">选择你的创作方式</h2><p>主图、详情各自制作，成套风格保持一致。</p></div>
          <span className="sh-section-label">从这里开始</span>
        </div>
        <div className="sh-task-grid">
          <button className="sh-task sh-task-main" disabled={busy} onClick={() => onCreate("main")}>
            <span className="sh-task-top"><span className="sh-task-icon"><Grid2X2 size={21} /></span><ArrowRight size={19} /></span>
            <span className="sh-task-copy"><b>制作商品主图</b><span>先确认首图，再完成整套卖点图。</span></span>
            <span className="sh-task-bottom"><small>5 张主图 · 1200 × 1200</small><span className="sh-mini-squares" aria-hidden="true"><i /><i /><i /></span></span>
          </button>
          <button className="sh-task sh-task-detail" disabled={busy} onClick={() => onCreate("detail")}>
            <span className="sh-task-top"><span className="sh-task-icon"><BookOpen size={21} /></span><ArrowRight size={19} /></span>
            <span className="sh-task-copy"><b>制作商品详情</b><span>从整体到细节，把商品讲清楚。</span></span>
            <span className="sh-task-bottom"><small>7 张详情 · 宽 790 px</small><span className="sh-mini-pages" aria-hidden="true"><i /><i /><i /></span></span>
          </button>
          <button className="sh-task sh-task-template" disabled={busy} onClick={onTemplates}>
            <span className="sh-task-top"><span className="sh-task-icon"><LayoutTemplate size={21} /></span><ArrowRight size={19} /></span>
            <span className="sh-task-copy"><b>选择视觉模板</b><span>找到适合商品的留白、色彩与排版。</span></span>
            <span className="sh-task-bottom"><small>4 种风格 · 自由选择</small><span className="sh-mini-palette" aria-hidden="true"><i /><i /><i /><i /></span></span>
          </button>
        </div>
      </section>

      {currentProject && (
        <section className="sh-resume" aria-label="继续当前作品">
          <div className="sh-resume-image">{currentCover ? <img src={currentCover.url} alt="" /> : <PencilLine size={25} />}</div>
          <div className="sh-resume-copy">
            <span>继续当前作品 <i /> {currentSaveStatus}</span>
            <h2>{currentProject.info.name || "未命名商品作品"}</h2>
            <p>{categoryFor(currentProject).name} · {outputName(currentProject)} · {workStatus(currentProject)}</p>
          </div>
          <button className="sh-secondary" onClick={onResume} disabled={busy}>继续编辑 <ArrowRight size={16} /></button>
        </section>
      )}

      <section className="sh-section" aria-labelledby="sh-recent-title">
        <div className="sh-section-heading">
          <div><h2 id="sh-recent-title">最近作品</h2><p>接着上次的想法，继续打磨。</p></div>
          <button className="sh-link" onClick={onAllWorks} disabled={busy}>全部作品 <ChevronRight size={15} /></button>
        </div>
        {historyLoading ? (
          <div className="sh-state" role="status"><LoaderCircle className="sh-spin" size={23} /><span>正在读取本地作品…</span></div>
        ) : historyError ? (
          <div className="sh-state sh-state-error" role="alert"><FolderOpen size={24} /><div><b>作品列表暂时无法加载</b><p>{historyError}</p></div><button className="sh-secondary" disabled={busy} onClick={onRetry}><RefreshCw size={15} /> 重新加载</button></div>
        ) : projects.length ? (
          <div className="sh-work-grid">
            {projects.slice(0, 3).map((project) => {
              const cover = coverFor(project);
              return (
                <button key={project.id} className="sh-work" disabled={busy} onClick={() => onOpen(project)}>
                  <span className="sh-work-image">
                    {cover ? <img src={cover.url} alt={`${project.info.name || "商品作品"}的素材预览`} /> : <ImageIcon size={34} />}
                    <span className="sh-work-type">{outputName(project)}</span>
                    <span className="sh-work-open"><ArrowRight size={17} /></span>
                  </span>
                  <span className="sh-work-info"><b>{project.info.name || "未命名商品作品"}</b><span>{categoryFor(project).name} · {workStatus(project)}</span><small><Clock3 size={12} /> {savedDate(project.updatedAt)}</small></span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="sh-state sh-empty"><span className="sh-empty-icon"><FolderOpen size={27} /></span><div><b>第一件好作品，从这里开始</b><p>上传商品素材开始制作，保存后会显示在这里。</p></div><button className="sh-secondary" disabled={busy} onClick={() => onCreate("main")}><Plus size={15} /> 新建作品</button></div>
        )}
      </section>

      <section className="sh-section sh-samples" aria-labelledby="sh-samples-title">
        <div className="sh-section-heading"><div><h2 id="sh-samples-title">先看看，一套好图怎么做</h2><p>打开内置样例，体验选图、文案与排版。</p></div><span className="sh-section-label">可编辑样例</span></div>
        <div className="sh-sample-grid">
          <button className="sh-sample" onClick={() => onSample("main")} disabled={busy}>
            <img src="/samples/00233.jpg" alt="格纹绗缝被的面料与做工近景" />
            <span><small>主图创作</small><b>把卖点放在第一眼</b><em>体验 5 张商品主图 <ArrowRight size={15} /></em></span>
          </button>
          <button className="sh-sample" onClick={() => onSample("detail")} disabled={busy}>
            <img src="/samples/00237.jpg" alt="绗缝被的柔软织物细节" />
            <span><small>详情创作</small><b>给每个细节一个位置</b><em>体验 7 张商品详情 <ArrowRight size={15} /></em></span>
          </button>
        </div>
      </section>
    </main>
  );
}
