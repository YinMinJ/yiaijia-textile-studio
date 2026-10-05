"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import ModelSettings from "./model-settings";
import DesignPlan from "./design-plan";
import CategoryPicker from "./category-picker";
import StudioHome from "./studio-home";
import TemplateLibrary from "./template-library";
import "./studio-refresh.css";
import { buildCopyInput, applyGeneratedCopy, preserveHeroCopy, type GeneratedCopy } from "@/lib/design-copy";
import { zip, unzip, strToU8 } from "fflate";
import { toast } from "sonner";
import {
  Sparkles,
  Plus,
  LayoutDashboard,
  Images,
  PanelsTopLeft,
  FolderOpen,
  HelpCircle,
  Upload,
  Download,
  Check,
  Settings2,
  X,
  Layers,
  FileImage,
  Save,
  LoaderCircle,
  Grid2X2,
  ChevronRight,
  ImagePlus,
  BookOpen,
  Search,
  ArrowLeft,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";
import {
  freshProject,
  sampleProject,
  templates,
  makeModules,
  dimensions,
  modulePurpose,
  needsAI,
  sourceAsset,
  usesSecondary,
  moduleSection,
  prepareImageRun,
  categoryFor,
  switchCategory,
  updateProjectTemplate,
  type ProductCategory,
  type Project,
  type ProductInfo,
  type Asset,
  type AssetRole,
  type DesignModule,
  type TemplateId,
} from "@/lib/design-model";
import { drawDesign, renderBlob, downloadBlob } from "@/lib/design-renderer";

type View = "home" | "editor" | "templates" | "works" | "assets" | "settings";
const categoryRoles: Record<ProductCategory, AssetRole[]> = {
  quilt: ["整体", "叠放", "填充", "细节", "工艺", "颜色", "其他"],
  "bedding-set": ["整体", "被套", "床单", "枕套", "细节", "工艺", "颜色", "其他"],
};
function CanvasPreview({
  project,
  module,
  large = false,
}: {
  project: Project;
  module: DesignModule;
  large?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let stop = false;
    setLoading(true);
    setError("");
    const canvas = document.createElement("canvas");
    drawDesign(canvas, project, module, large ? 1 : 0.55)
      .then(() => {
        if (stop || !ref.current) return;
        ref.current.width = canvas.width;
        ref.current.height = canvas.height;
        ref.current.getContext("2d")?.drawImage(canvas, 0, 0);
        setLoading(false);
        canvas.width = 1;
        canvas.height = 1;
      })
      .catch((e) => {
        if (!stop) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      stop = true;
    };
  }, [project, module, large]);
  const d = dimensions(module);
  return (
    <div
      className={"canvas-wrap " + (large ? "large" : "")}
      style={{ aspectRatio: d.width + "/" + d.height }}
    >
      <canvas
        ref={ref}
        aria-label={
          (module.kind === "main" ? "主图" : "详情") +
          module.index +
          "：" +
          module.title
        }
      />
      {loading && (
        <span className="canvas-status">
          <LoaderCircle className="spin" size={20} />
          正在排版
        </span>
      )}
      {error && <span className="canvas-status error">{error}</span>}
    </div>
  );
}
function TemplateCard({
  id,
  selected,
  onSelect,
}: {
  id: TemplateId;
  selected?: boolean;
  onSelect: () => void;
}) {
  const t = templates.find((t) => t.id === id)!;
  return (
    <button
      className={"template-card " + (selected ? "selected" : "")}
      onClick={onSelect}
      aria-pressed={!!selected}
    >
      <div
        className={"template-art " + id}
        style={{ background: t.bg, color: t.ink }}
      >
        <span className="template-brand">{id === "vip" ? "宜爱家" : "YIAIJIA / HOME"}</span>
        <strong>
          {id === "vip" ? "格纹肌理" : id === "editorial"
            ? "在细节里，\n发现质感。"
            : id === "clean"
              ? "好物，\n自在呈现。"
              : "把温柔，\n铺进日常。"}
        </strong>
        <img src={t.image} alt={t.name + "家纺模板示例"} />
        <span className="template-edition">{id === "vip" ? "看得见的细节" : "HOME TEXTILES — 01"}</span>
      </div>
      <div className="template-caption">
        <div>
          <h3>{t.name}</h3>
          <p>{t.tag}</p>
        </div>
        <span className={"check-ring " + (selected ? "on" : "")}>
          {selected ? <Check size={15} /> : <Plus size={15} />}
        </span>
      </div>
    </button>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <FolderOpen size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
async function zipFiles(files: Record<string, Uint8Array>) {
  return new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 0 }, (err, data) =>
      err ? reject(err) : resolve(data),
    ),
  );
}
async function unpack(files: File[]) {
  const images: File[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      if (file.size > 200 * 1024 * 1024)
        throw new Error("ZIP文件请小于200MB。");
      let total = 0,
        count = 0;
      const raw = new Uint8Array(await file.arrayBuffer());
      const entries = await new Promise<Record<string, Uint8Array>>(
        (resolve, reject) =>
          unzip(
            raw,
            {
              filter: (f) => {
                if (
                  !/\.(jpe?g|png|webp)$/i.test(f.name) ||
                  f.name.startsWith("__MACOSX")
                )
                  return false;
                total += f.originalSize;
                count++;
                return (
                  f.originalSize <= 30 * 1024 * 1024 &&
                  total <= 300 * 1024 * 1024 &&
                  count <= 40
                );
              },
            },
            (err, data) =>
              err
                ? reject(new Error("无法解压此ZIP，请重新打包或直接选择图片。"))
                : resolve(data),
          ),
      );
      for (const [name, data] of Object.entries(entries)) {
        const type = /\.png$/i.test(name)
          ? "image/png"
          : /\.webp$/i.test(name)
            ? "image/webp"
            : "image/jpeg";
        images.push(
          new File([data as BlobPart], name.split("/").pop() || name, { type }),
        );
      }
    } else if (/\.(jpe?g|png|webp)$/i.test(file.name)) {
      images.push(file);
    } else {
      toast.warning("已跳过不支持的文件：" + file.name);
    }
  }
  return images;
}
async function prepareImage(file: File) {
  if (file.size > 30 * 1024 * 1024) throw new Error(file.name + "超过30MB。");
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 80000000) {
    bitmap.close();
    throw new Error(file.name + "像素过大，请先缩小图片。");
  }
  const ratio = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * ratio);
  c.height = Math.round(bitmap.height * ratio);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) =>
    c.toBlob(
      (b) => (b ? res(b) : rej(new Error("无法读取此图片。"))),
      "image/jpeg",
      0.94,
    ),
  );
  const width = c.width,
    height = c.height;
  c.width = 1;
  c.height = 1;
  return {
    file: new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg",
    }),
    width,
    height,
  };
}

export default function Studio({ signedIn }: { signedIn: boolean }) {
  const [view, setView] = useState<View>("home");
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const [workSearch, setWorkSearch] = useState("");
  const [workFilter, setWorkFilter] = useState<"all" | "main" | "detail">("all");
  const [workCategory, setWorkCategory] = useState<"all" | ProductCategory>("all");
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOutput, setNewOutput] = useState<"main" | "detail">("main");
  const [newCategory, setNewCategory] = useState<ProductCategory>("quilt");
  const [modelConfigured, setModelConfigured] = useState(false);
  const generationRunning = useRef(false);
  const copyRunning = useRef(false);
  const [copyResult, setCopyResult] = useState<{
    projectId: string;
    message: string;
    error?: boolean;
    before?: GeneratedCopy[];
    after?: GeneratedCopy[];
  } | null>(null);
  const dirtyRef = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [step, setStep] = useState("materials");
  const [outputTab, setOutputTab] = useState("main");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [lastDownload, setLastDownload] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [drop, setDrop] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(signedIn);
  const input = useRef<HTMLInputElement>(null);
  const current = useRef(project);
  current.current = project;
  dirtyRef.current = dirty;
  useEffect(() => {
    if (signedIn)
      fetch("/api/model-settings")
        .then((r) => r.json())
        .then((d) =>
          setModelConfigured(!!(d as { configured?: boolean }).configured),
        )
        .catch(() => {});
  }, [signedIn]);
  const loadProjects = useCallback(async () => {
    if (!signedIn) return;
    setHistoryLoading(true);
    try {
      const r = await fetch("/api/projects");
      const data = (await r.json()) as {
        error?: string;
        projects: Project[];
        project: Project;
        id: string;
        url: string;
        name: string;
      };
      if (!r.ok) throw new Error(data.error || "请求失败");
      setProjects(data.projects);
      setHistoryError("");
    } catch (e) {
      setHistoryError((e as Error).message || "作品暂时无法读取。");
    } finally {
      setHistoryLoading(false);
    }
  }, [signedIn]);
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function patchProject(p: Project) {
    setProject(p);
    setDirty(true);
  }
  function requestProjectSwitch(action: () => void) {
    if (busy || generationRunning.current || copyRunning.current) {
      toast.info("当前任务正在处理中，完成后即可切换商品。");
      return;
    }
    if (current.current && dirtyRef.current) setPendingSwitch(() => action);
    else action();
  }
  function openProject(p: Project) {
    if (current.current?.id === p.id) {
      setView("editor");
      return;
    }
    requestProjectSwitch(() => {
      setProject(p);
      setDirty(false);
      setEditingId(null);
      setStep(!p.modules.length ? "materials" : p.workflow === "plan" ? "plan" : "results");
      setOutputTab(p.output || "main");
      setView("editor");
    });
  }
  function startCreation(output: "main" | "detail") {
    if (busy) return;
    setNewOutput(output);
    setNewOpen(true);
  }
  async function finishProjectSwitch(saveFirst: boolean) {
    const action = pendingSwitch;
    if (!action || busy) return;
    if (saveFirst && !(await save())) return;
    setPendingSwitch(null);
    action();
  }
  async function generateCopy() {
    if (!project || busy || copyRunning.current) return;
    if (!signedIn || !modelConfigured) {
      toast.info("请先在“自定义 API”中配置文案模型。");
      setView("settings");
      return;
    }
    const original = project;
    copyRunning.current = true;
    setCopyResult(null);
    setBusy("大模型正在编写其他图片的文案 · 首图文案由你填写");
    try {
      const request = buildCopyInput(original);
      const response = await fetch("/api/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(75000),
      });
      const data = (await response.json()) as { copies?: GeneratedCopy[]; model?: string; error?: string };
      if (!response.ok || !data.copies) throw new Error(data.error || "文案生成失败，请重试。");
      if (current.current !== original) {
        toast.info("当前作品已发生变化，本次文案未覆盖你的修改。");
        return;
      }
      const next = applyGeneratedCopy(original, data.copies);
      patchProject(next);
      setCopyResult({ projectId: original.id,
        message: `已由 ${data.model || "大模型"} 生成 ${data.copies.length} 张图的文案。首图保留原文，请核对卖点后保存作品。`,
        before: original.modules.filter((m) => data.copies!.some((c) => c.id === m.id)).map(({ id, title, subtitle }) => ({ id, title, subtitle })),
        after: data.copies,
      });
      toast.success("其他图文案已生成，可逐张修改；首图文案保持不变。");
    } catch (e) {
      const message = (e as Error).name === "TimeoutError" ? "文案生成超时，原文案已保留。可稍后重试。" : (e as Error).message;
      setCopyResult({ projectId: original.id, message, error: true });
      toast.error(message);
    } finally {
      copyRunning.current = false;
      setBusy("");
    }
  }
  function undoCopy() {
    if (!project || busy || copyResult?.projectId !== project.id || !copyResult.before || !copyResult.after) return;
    const before = copyResult.before, after = copyResult.after;
    patchProject({ ...project, modules: project.modules.map((m) => {
      const generated = after.find((c) => c.id === m.id);
      const previous = before.find((c) => c.id === m.id);
      return generated && previous && m.title === generated.title && m.subtitle === generated.subtitle ? { ...m, title: previous.title, subtitle: previous.subtitle } : m;
    }) });
    setCopyResult({ projectId: project.id, message: "已撤销本次自动文案，你后续手动修改的内容已保留。" });
  }
  function openSample(kind: "main" | "detail" = "main") {
    requestProjectSwitch(() => {
    const p = sampleProject();
    p.output = kind;
    p.generation = "template";
    p.modules = p.modules.filter((m) => m.kind === kind);
    setProject(p);
    setView("editor");
    setStep("plan");
    setOutputTab(kind);
    setDirty(false);
    });
  }
  function navigate(v: View) {
    setView(v);
  }
  async function save(p = project) {
    if (!p) return false;
    if (!signedIn) {
      toast.error("请先登录后保存作品。");
      return false;
    }
    if (!p.info.name.trim()) {
      toast.error("请先填写商品名称。");
      return false;
    }
    setBusy("正在保存作品");
    try {
      const value = {
        ...p,
        id: p.sample ? crypto.randomUUID() : p.id,
        sample: undefined,
      };
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = (await r.json()) as {
        error?: string;
        projects: Project[];
        project: Project;
        id: string;
        url: string;
        name: string;
      };
      if (!r.ok) throw new Error(data.error || "保存失败");
      setProject(data.project);
      setProjects((old) => [
        data.project,
        ...old.filter((q) => q.id !== data.project.id),
      ]);
      setDirty(false);
      toast.success("作品已保存，下次可以继续编辑。");
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }
  function createProject() {
    if (!newName.trim() || busy) return;
    setNewOpen(false);
    requestProjectSwitch(() => {
    const p = freshProject();
    p.category = newCategory;
    p.info.name = newName.trim();
    p.output = newOutput;
    p.generation = "template";
    setProject(p);
    setNewOpen(false);
    setNewName("");
    setStep("materials");
    setOutputTab(newOutput);
    setView("editor");
    setDirty(true);
    });
  }
  function updateInfo(key: keyof ProductInfo, value: string) {
    if (project)
      patchProject({ ...project, info: { ...project.info, [key]: value } });
  }
  async function importFiles(files: File[]) {
    if (!project || !files.length || busy) return;
    if (!signedIn) {
      toast.error("登录后即可上传自己的商品素材。");
      return;
    }
    setBusy("正在整理素材");
    setProgress(0);
    try {
      const expanded = await unpack(files);
      if (!expanded.length)
        throw new Error("没有找到可用的JPG、PNG或WebP图片。");
      const remaining = 40 - project.assets.filter((a) => !a.generated).length;
      if (remaining <= 0) throw new Error("一款商品最多40张素材。");
      if (expanded.length > remaining)
        toast.warning("本次仅导入前" + remaining + "张图片。");
      const next: Asset[] = [];
      const errors: string[] = [];
      for (const [i, file] of expanded.slice(0, remaining).entries()) {
        setBusy(
          "正在上传 " + (i + 1) + " / " + Math.min(expanded.length, remaining),
        );
        try {
          const prepared = await prepareImage(file);
          const form = new FormData();
          form.set("file", prepared.file);
          const r = await fetch("/api/assets", { method: "POST", body: form });
          const data = (await r.json()) as {
            error?: string;
            projects: Project[];
            project: Project;
            id: string;
            url: string;
            name: string;
          };
          if (!r.ok) throw new Error(data.error || "请求失败");
          next.push({
            ...data,
            width: prepared.width,
            height: prepared.height,
            role: project.assets.length + next.length === 0 ? "整体" : "其他",
          });
        } catch (e) {
          errors.push(file.name + "：" + (e as Error).message);
        }
        setProgress(
          Math.round(((i + 1) / Math.min(expanded.length, remaining)) * 100),
        );
      }
      patchProject({ ...project, assets: [...project.assets, ...next] });
      if (next.length)
        toast.success(
          "已导入" + next.length + "张素材，请标记整体图与细节图。",
        );
      if (errors.length)
        toast.error(
          errors[0] +
            (errors.length > 1
              ? "，另有" + (errors.length - 1) + "张未导入"
              : ""),
        );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
      setProgress(0);
      if (input.current) input.current.value = "";
    }
  }
  async function persist(p: Project) {
    const value = {
      ...p,
      id: p.sample ? crypto.randomUUID() : p.id,
      sample: undefined,
    };
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const data = (await r.json()) as { project?: Project; error?: string };
    if (!r.ok || !data.project)
      throw new Error(data.error || "保存失败，请保留当前页面。");
    return data.project;
  }
  async function runAI(initial: Project, onlyId?: string) {
    if (generationRunning.current) return;
    const requested = initial.modules.find((m) => m.id === onlyId);
    if (requested && !needsAI(initial, requested)) {
      toast.info("这个模块保留实拍或真实资料，可直接修改文字与选图。");
      return;
    }
    if (!modelConfigured) {
      toast.info("请先在“自定义 API”中配置图片编辑接口。");
      setEditingId(null);
      setView("settings");
      return;
    }
    if (!signedIn) {
      toast.error("登录后即可使用自己的模型。");
      return;
    }
    generationRunning.current = true;
    setBusy("正在保存生成任务");
    let p = prepareImageRun(initial, onlyId);
    try {
      p = (await persist(p)) as typeof p;
      setProject(p);
      setView("editor");
      setStep("results");
      setOutputTab(p.output || "main");
      const targets = p.modules.filter((m) =>
        needsAI(p, m) && (onlyId ? m.id === onlyId : m.aiStatus !== "succeeded"),
      );
      for (const [i, target] of targets.entries()) {
        setBusy(
          "AI生成 " + (i + 1) + " / " + targets.length + " · 请保持页面打开",
        );
        setProgress(Math.round((i / targets.length) * 100));
        try {
          const a = sourceAsset(p, target);
          if (!a) throw new Error("这张图缺少原始实拍，请回到内容计划重新选图。");
          const source = await fetch(a.url);
          if (!source.ok) throw new Error("商品素材读取失败。");
          const form = new FormData();
          form.append("image", await source.blob(), "product.jpg");
          form.set("projectId", p.id);
          form.set("moduleId", target.id);
          if (onlyId) form.set("retry", "true");
          const r = await fetch("/api/generate-image", {
            method: "POST",
            body: form,
          });
          const data = (await r.json()) as { asset?: Asset; error?: string };
          if (!r.ok || !data.asset)
            throw new Error(data.error || "模型没有返回图片。");
          const asset = data.asset;
          p = {
            ...p,
            assets: [...p.assets.filter((a) => a.id !== asset.id), asset],
            modules: p.modules.map((m) =>
              m.id === target.id
                ? {
                    ...m,
                    sourceImageId: a.id,
                    imageId: asset.id,
                    aiStatus: "succeeded",
                    aiError: undefined,
                  }
                : m,
            ),
          };
          setProject(p);
          setDirty(true);
          p = (await persist(p)) as typeof p;
          setProject(p);
          setDirty(false);
        } catch (e) {
          const message = (e as Error).message;
          p = {
            ...p,
            modules: p.modules.map((m) =>
              m.id === target.id
                ? { ...m, aiStatus: "failed", aiError: message.slice(0, 400) }
                : m,
            ),
          };
          setProject(p);
          setDirty(true);
          try {
            p = (await persist(p)) as typeof p;
            setProject(p);
            setDirty(false);
          } catch {}
          toast.error(message);
          break;
        }
      }
      setProjects((old) => [p, ...old.filter((q) => q.id !== p.id)]);
      if (initial.workflow === "preview" && requested && p.modules.find((m) => m.id === requested.id)?.aiStatus === "succeeded")
        toast.success("首图已完成，确认方向后再继续整套。");
      else if (p.modules.every((m) => m.aiStatus === "succeeded"))
        toast.success("AI素材已生成，请检查商品花色与细节后导出。");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
      setProgress(0);
      generationRunning.current = false;
    }
  }
  function preparePlan(rebuild = false) {
    if (!project) return;
    if (!project.info.name.trim()) {
      toast.error("请填写商品名称。");
      return;
    }
    if (!project.assets.some((a) => !a.generated)) {
      toast.error("先上传至少 1 张商品实拍，就可以开始制作。");
      return;
    }
    const original = { ...project };
    const next = {
      ...original,
      modules: !rebuild && project.modules.length ? project.modules : preserveHeroCopy(project, makeModules(original)),
      workflow: "plan" as const,
      status: "draft" as const,
    };
    patchProject(next);
    setStep("plan");
    setOutputTab(project.output || "main");
  }
  function changeCategory(category: ProductCategory) {
    if (!project || categoryFor(project).id === category || busy) return;
    const next = switchCategory(project, category);
    patchProject({ ...next, modules: preserveHeroCopy(project, next.modules) });
    setEditingId(null);
    toast.success("已切换为" + categoryFor({ category }).name + "方案，请核对资料与实拍用途。");
  }
  function previewPlan(mode: "template" | "ai") {
    if (!project || !project.modules.length || busy) return;
    const next: Project = {
      ...project, workflow: "preview", generation: mode,
      generationBatch: crypto.randomUUID(),
      assets: project.assets.filter((a) => !a.generated),
      modules: project.modules.map((m) => ({ ...m,
        imageId: sourceAsset(project, m)?.id || m.imageId,
        sourceImageId: sourceAsset(project, m)?.id,
        imageId2: m.sourceImageId2 || m.imageId2,
        aiStatus: undefined, aiError: undefined,
      })),
    };
    if (next.modules.some((m) => moduleSection(m) !== "specs" && !sourceAsset(next, m))) {
      toast.error("请先为每个模块选好原始实拍，再预览首图。");
      return;
    }
    patchProject(next);
    setStep("results");
    setOutputTab(next.output || "main");
    if (mode === "ai") void runAI(next, next.modules[0].id);
  }
  function completePlan() {
    if (!project || busy) return;
    const first = project.modules[0];
    if (project.generation === "ai" && needsAI(project, first) && first.aiStatus !== "succeeded") {
      toast.error("请先完成首图，或回到内容计划选择实拍预览。");
      return;
    }
    const next: Project = { ...project, workflow: "complete", status: "ready" };
    patchProject(next);
    if (next.generation === "ai") void runAI(next);
    else toast.success("整套排版已完成，可以逐张检查并导出。");
  }
  function selectTemplate(id: TemplateId) {
    if (project) {
      const next = updateProjectTemplate(project, id);
      if (next !== project) {
        patchProject(next);
        setStep(next.modules.length ? "plan" : "materials");
      }
      setView("editor");
    } else {
      const p = sampleProject();
      p.template = id;
      p.output = "main";
      p.generation = "template";
      p.modules = makeModules(p);
      setOutputTab("main");
      setProject(p);
      setView("editor");
      setStep("plan");
      setDirty(false);
    }
  }
  function useLibraryTemplate(template: TemplateId, category: ProductCategory, output: "main" | "detail") {
    if (busy) return;
    if (project && categoryFor(project).id === category && (project.output || "main") === output) {
      selectTemplate(template);
    } else {
      requestProjectSwitch(() => {
      const next = freshProject();
      next.template = template;
      next.category = category;
      next.output = output;
      setProject(next);
      setDirty(true);
      setStep("materials");
      setOutputTab(output);
      setView("editor");
      setEditingId(null);
      });
    }
  }
  function removeProjectAsset(asset: Asset) {
    if (!project || busy) return;
    const references = project.modules.filter(m => [m.imageId, m.imageId2, m.sourceImageId, m.sourceImageId2].includes(asset.id));
    if (references.length) {
      toast.info("这张素材已用于内容计划，请先更换对应图片，再移除素材。现有文案和成图已保留。");
      return;
    }
    patchProject({ ...project, assets: project.assets.filter(a => a.id !== asset.id) });
  }
  function updateModule(changes: Partial<DesignModule>) {
    if (project) {
      if (changes.imageId && project.assets.some((a) => a.id === changes.imageId && !a.generated)) {
        changes.sourceImageId = changes.imageId;
        changes.aiStatus = undefined;
        changes.aiError = undefined;
      }
      if (changes.imageId2 && project.assets.some((a) => a.id === changes.imageId2 && !a.generated)) changes.sourceImageId2 = changes.imageId2;
      patchProject({
        ...project,
        generationBatch: changes.imageId ? crypto.randomUUID() : project.generationBatch,
        modules: project.modules.map((m) =>
          m.id === editingId ? { ...m, ...changes } : m,
        ),
      });
    }
  }
  async function downloadOne(m: DesignModule) {
    if (!project) return;
    if (project.generation === "ai" && needsAI(project, m) && m.aiStatus !== "succeeded") {
      toast.error("这张图片还未生成完成，请先重试。");
      return;
    }
    try {
      setBusy("正在导出图片");
      const blob = await renderBlob(project, m);
      setLastDownload(
        downloadBlob(
          blob,
          (m.kind === "main" ? "主图" : "详情") +
            String(m.index).padStart(2, "0") +
            ".jpg",
        ),
      );
      toast.success("图片已导出");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function downloadAll() {
    if (
      !project || project.workflow === "plan" || project.workflow === "preview" ||
      project.modules.length !==
        (project.output === "main" ? 5 : project.output === "detail" ? 7 : 12)
    )
      return;
    if (
      project.generation === "ai" &&
      project.modules.some((m) => needsAI(project, m) && m.aiStatus !== "succeeded")
    ) {
      toast.error("请先完成剩余图片，再导出。");
      return;
    }
    setBusy("正在导出整套图片");
    setProgress(0);
    try {
      const files: Record<string, Uint8Array> = {};
      for (const [i, m] of project.modules.entries()) {
        const d = dimensions(m);
        const name =
          (m.kind === "main"
            ? "01_主图_1200x1200/主图"
            : "02_详情切片_790/详情") +
          String(m.index).padStart(2, "0") +
          ".jpg";
        const blob = await renderBlob(project, m);
        files[name] = new Uint8Array(await blob.arrayBuffer());
        if (d.width !== 1200 && d.width !== 790)
          throw new Error("尺寸校验失败");
        setProgress(Math.round(((i + 1) / (project.modules.length + 1)) * 100));
      }
      files["商品资料.txt"] = strToU8(
        "商品：" +
          project.info.name +
          "\n品牌：" +
          project.info.brand +
          "\n类目：" + categoryFor(project).name +
          "\n风格参考：" + categoryFor(project).referenceUrl +
          (categoryFor(project).id === "bedding-set" && project.info.setContents ? "\n套件组成：" + project.info.setContents : "") +
          "\n输出：" +
          (project.output === "main"
            ? "5张主图，1200×1200"
            : project.output === "detail"
              ? "7张详情切片，宽790"
              : "主图和详情") +
          "\n\n导出前请检查文字、商品外观及商品参数。",
      );
      const archive = await zipFiles(files);
      setLastDownload(
        downloadBlob(
          new Blob([archive as BlobPart], { type: "application/zip" }),
          project.info.name.replace(/[\\/:*?"<>|]/g, "_") +
            (project.output === "main"
              ? "_主图.zip"
              : project.output === "detail"
                ? "_详情切片.zip"
                : "_主图与详情.zip"),
        ),
      );
      setProgress(100);
      toast.success(project.modules.length + "张图片已按顺序打包导出。");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
      setProgress(0);
    }
  }
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options?: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const definitions = [
      {
        name: "read_design_project",
        title: "读取当前商品设计",
        description:
          "读取当前打开的商品、素材数量、模板和模块标题，不保存或导出。",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => {
          const p = current.current;
          return p
            ? {
                name: p.info.name,
                template: p.template,
                assetCount: p.assets.length,
                modules: p.modules.map((m) => ({
                  id: m.id,
                  title: m.title,
                  kind: m.kind,
                })),
              }
            : { project: null };
        },
      },
      {
        name: "open_quilt_example",
        title: "打开被子设计样例",
        description:
          "在工作台打开被子样例，供查看与编辑。若当前有未保存修改，将拒绝切换。不会保存或导出文件。",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input: unknown) => {
          if (input && Object.keys(input as object).length)
            throw new Error("此操作不接受参数。");
          if (dirtyRef.current)
            throw new Error("请先通过界面保存并离开当前商品。");
          openSample();
          return { opened: true, name: "立体格纹绗缝被" };
        },
      },
    ];
    for (const tool of definitions) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => controller.abort();
  }, []);
  const activeModule = project?.modules.find((m) => m.id === editingId);
  const titles: Record<View, string> = {
    home: "创作工作台",
    editor: "商品套图",
    templates: "模板中心",
    works: "我的作品",
    assets: "商品素材",
    settings: "自定义 API",
  };
  const isAiIncomplete =
    !!project &&
    project.generation === "ai" &&
    project.modules.some((m) => needsAI(project, m) && m.aiStatus !== "succeeded");
  const savedAssets = projects
    .flatMap((p) => p.assets.filter(a => !a.generated).map((a) => ({ ...a, projectName: p.info.name })))
    .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i);
  const filteredProjects = projects.filter(p =>
    (!workSearch.trim() || `${p.info.name} ${p.info.brand}`.toLocaleLowerCase().includes(workSearch.trim().toLocaleLowerCase())) &&
    (workFilter === "all" || p.output === workFilter || (!p.output && p.modules.some(m => m.kind === workFilter))) &&
    (workCategory === "all" || categoryFor(p).id === workCategory)
  );
  function workStatus(p: Project) {
    if (!p.modules.length) return "待完善资料";
    if (p.workflow === "plan") return "待确认计划";
    if (p.modules.some(m => m.aiStatus === "failed")) return "部分图片需重试";
    if (p.workflow === "preview") return "待确认首图";
    if (p.generation === "ai" && p.modules.some(m => needsAI(p, m) && m.aiStatus !== "succeeded")) return "图片待生成";
    return p.workflow === "complete" || p.status === "ready" ? "已完成排版" : "继续制作";
  }
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "208px" } as React.CSSProperties}
    >
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <button
            className="brand"
            onClick={() => navigate("home")}
            aria-label="宜爱家工作台首页"
          >
            <span className="brand-mark">
              <Layers size={24} />
            </span>
            <span>
              <b>宜爱家</b>
              <small>家纺设计工作台</small>
            </span>
          </button>
          <button
            className="btn primary sidebar-new"
            onClick={() => startCreation("main")}
            disabled={!!busy}
          >
            <Plus size={17} />
            新建商品
          </button>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">工作台</div>
          <SidebarMenu>
            {(
              [
                { id: "home", icon: LayoutDashboard, label: "创作工作台" },
                { id: "templates", icon: PanelsTopLeft, label: "风格模板" },
                { id: "works", icon: FolderOpen, label: "我的作品" },
                { id: "assets", icon: Images, label: "商品素材" },
                { id: "settings", icon: Settings2, label: "自定义 API" },
              ] as const
            ).map((n) => (
              <SidebarMenuItem key={n.id}>
                <SidebarMenuButton
                  className="nav-item"
                  isActive={view === n.id}
                  onClick={() => navigate(n.id)}
                >
                  <n.icon size={19} />
                  <span>{n.label}</span>
                  {n.id === "works" && projects.length > 0 && (
                    <span className="nav-count">{projects.length}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <button className="help-button" onClick={() => setHelpOpen(true)}>
            <HelpCircle size={18} />
            使用帮助
          </button>
          <div className="profile">
            <div className="avatar">宜</div>
            <div>
              <b>宜爱家工作台</b>
              <small>商品设计 · 本地创作</small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <SidebarTrigger aria-label="打开导航" />
            <span>{titles[view]}</span>
          </div>
          <div className="topbar-right">
            {project && view !== "editor" && <button className="text-button return-editor" onClick={() => setView("editor")}><ArrowLeft size={14} />继续当前作品{dirty ? " · 未保存" : ""}</button>}
            <button
              className="settings-top-hint"
              onClick={() => setView("settings")}
            >
              <Settings2 size={14} />
              {modelConfigured ? "API 已配置" : "配置自定义 API"}
            </button>
            <span className="trial-badge">本地工作台</span>
            <button
              className="icon-button"
              aria-label="使用帮助"
              onClick={() => setHelpOpen(true)}
            >
              <HelpCircle size={19} />
            </button>
            <span className="top-avatar">宜</span>
          </div>
        </header>
        {busy && (
          <div className="busy-strip" role="status">
            <LoaderCircle size={16} className="spin" />
            <span>{busy}</span>
            {progress > 0 && (
              <Progress value={progress} className="busy-progress" />
            )}
          </div>
        )}
        {lastDownload && (
          <div className="download-banner" role="status">
            <Check size={16} />
            <span>文件已准备好</span>
            <a
              className="btn"
              href={lastDownload.url}
              download={lastDownload.name}
            >
              下载 {lastDownload.name}
            </a>
            <button
              className="icon-button"
              aria-label="收起下载提示"
              onClick={() => setLastDownload(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {view === "home" && <StudioHome
          projects={projects} currentProject={project} dirty={dirty} busy={!!busy}
          historyLoading={historyLoading} historyError={historyError}
          onCreate={startCreation} onTemplates={() => setView("templates")}
          onOpen={openProject} onResume={() => setView("editor")} onSample={openSample}
          onRetry={() => void loadProjects()} onAllWorks={() => setView("works")}
        />}
        {view === "settings" && (
          <ModelSettings signedIn={signedIn} onSaved={setModelConfigured} />
        )}
        {view === "templates" && <TemplateLibrary currentProject={project} busy={!!busy} onUse={useLibraryTemplate} />}
        {view === "works" && (
          <main className="page">
            <div className="section-heading">
              <div><span className="eyebrow">MY COLLECTION</span><h1>我的作品</h1><p>保存每一次上新，下次接着做。</p></div>
              <button className="btn primary" disabled={!!busy} onClick={() => startCreation("main")}><Plus size={17} />新建商品</button>
            </div>
            <div className="work-toolbar">
              <label className="work-search"><Search size={18} /><input aria-label="搜索作品" value={workSearch} onChange={e => setWorkSearch(e.target.value)} placeholder="搜索商品名称或品牌" /></label>
              <div className="work-filter-row">
                <div className="work-filter" role="group" aria-label="按图片用途筛选">
                  {([['all','全部作品'],['main','商品主图'],['detail','商品详情']] as const).map(([value,label]) => <button key={value} aria-pressed={workFilter === value} onClick={() => setWorkFilter(value)}>{label}</button>)}
                </div>
                <div className="work-category"><Select value={workCategory} onValueChange={v => setWorkCategory(v as typeof workCategory)}><SelectTrigger aria-label="按商品类目筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类目</SelectItem><SelectItem value="quilt">被子</SelectItem><SelectItem value="bedding-set">床上套件</SelectItem></SelectContent></Select></div>
                <span className="muted">{filteredProjects.length} 个作品</span>
              </div>
            </div>
            {historyLoading ? <div className="empty-state"><LoaderCircle className="spin" />正在读取作品</div>
              : historyError ? <Empty title="作品暂时无法读取" text={historyError} action={<button className="btn" onClick={() => void loadProjects()}>重试</button>} />
              : filteredProjects.length ? <div className="works-grid">
                {filteredProjects.map(p => <button className="work-card" key={p.id} disabled={!!busy} onClick={() => openProject(p)}>
                  <div className="work-art">{p.modules[0] ? <CanvasPreview project={p} module={p.modules[0]} /> : p.assets[0] ? <img src={p.assets[0].url} alt={p.info.name} /> : <FileImage size={40} />}</div>
                  <div><h3>{p.info.name}</h3><p>{categoryFor(p).name} · {p.output === "detail" ? "商品详情" : p.output === "main" ? "商品主图" : "主图与详情"}</p><p>{workStatus(p)}<span>{new Date(p.updatedAt).toLocaleDateString("zh-CN")}</span></p></div>
                </button>)}
              </div>
              : projects.length ? <Empty title="没有符合条件的作品" text="试试其他商品名称、图片用途或类目。" action={<button className="btn" onClick={() => {setWorkSearch("");setWorkFilter("all");setWorkCategory("all");}}>清除筛选</button>} />
              : <Empty title="还没有保存的作品" text="上传一款商品，或打开样例修改后保存。" action={<button className="btn primary" disabled={!!busy} onClick={() => openSample("main")}>体验被子样例</button>} />}
          </main>
        )}
        {view === "assets" && (
          <main className="page">
            <div className="section-heading">
              <div>
                <h1>商品素材</h1>
                <p>已保存项目中的实拍素材，按商品保留。</p>
              </div>
              <button className="btn primary" disabled={!!busy} onClick={() => startCreation("main")}>
                <ImagePlus size={17} />
                导入新商品
              </button>
            </div>
            {savedAssets.length ? (
              <div className="asset-library">
                {savedAssets.map((a) => (
                  <div className="asset-tile" key={a.id}>
                    <img src={a.url} alt={a.name} />
                    <div>
                      <b>{a.name}</b>
                      <small>
                        {a.projectName} · {a.role}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="还没有商品素材"
                text="在商品项目内导入照片并保存后，即可在这里查看。"
                action={
                  <button
                    className="btn primary"
                    disabled={!!busy}
                    onClick={() => startCreation("main")}
                  >
                    创建商品项目
                  </button>
                }
              />
            )}
          </main>
        )}
        {view === "editor" && project && (
          <main className="page editor-page">
            <div className="project-heading">
              <div>
                <button className="back-link" onClick={() => setView("home")}>
                  工作台 / 商品套图
                </button>
                <h1>
                  {project.info.name || "新商品"}
                  <span className="pill">
                    {project.sample ? "示例" : dirty ? "未保存" : "已保存"}
                  </span>
                </h1>
              </div>
              <div className="project-actions">
                {!signedIn && (
                  <a
                    href="/login"
                    target="_top"
                    className="btn"
                  >
                    登录保存
                  </a>
                )}
                <button
                  className="btn"
                  disabled={!!busy}
                  onClick={() => void save()}
                >
                  <Save size={16} />
                  保存作品
                </button>
                <button
                  className="btn primary"
                  disabled={
                    !!busy ||
                    project.workflow === "plan" || project.workflow === "preview" ||
                    isAiIncomplete ||
                    project.modules.length !==
                      (project.output === "main"
                        ? 5
                        : project.output === "detail"
                          ? 7
                          : 12)
                  }
                  onClick={() => void downloadAll()}
                >
                  <Download size={17} />
                  整套导出
                </button>
              </div>
            </div>
            <fieldset disabled={!!busy} className="editor-lock"><Tabs value={step} onValueChange={setStep} className="editor-tabs">
              <TabsList className="step-tabs">
                <TabsTrigger value="materials">
                  <span>01</span>商品资料
                </TabsTrigger>
                <TabsTrigger value="template">
                  <span>02</span>视觉风格
                </TabsTrigger>
                <TabsTrigger value="plan" disabled={!project.modules.length}>
                  <span>03</span>内容计划
                </TabsTrigger>
                <TabsTrigger value="results" disabled={!project.modules.length}>
                  <span>04</span>首图与整套
                </TabsTrigger>
              </TabsList>
              <TabsContent value="materials">
                <CategoryPicker value={categoryFor(project).id} onChange={changeCategory} disabled={!!busy} />
                <div className="category-guide"><b>{categoryFor(project).name}素材建议</b><span>{categoryFor(project).photoGuide}</span></div>
                {project.sample && categoryFor(project).id === "bedding-set" && <p className="plan-facts">当前内置素材来自被子，仅供流程试用。制作床上套件时，请换成实际套件的实拍图。</p>}
                <div className="material-layout">
                  <section className="material-panel">
                    <div className="section-line">
                      <h2>
                        商品实拍{" "}
                        <span className="muted">
                          {project.assets.filter(a => !a.generated).length} / 40
                        </span>
                      </h2>
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => input.current?.click()}
                      >
                        <Plus size={16} />
                        添加素材
                      </button>
                    </div>
                    <input
                      ref={input}
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.webp,.zip"
                      className="hidden"
                      onChange={(e) =>
                        void importFiles(Array.from(e.target.files || []))
                      }
                    />
                    <button
                      className={"drop-zone " + (drop ? "dragging" : "")}
                      disabled={!!busy}
                      onClick={() => input.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDrop(true);
                      }}
                      onDragLeave={() => setDrop(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDrop(false);
                        void importFiles(Array.from(e.dataTransfer.files));
                      }}
                    >
                      <Upload size={25} />
                      <b>点击选择，或把商品素材拖到这里</b>
                      <span>
                        1 张实拍即可开始 · 支持 JPG / PNG / WebP / ZIP
                      </span>
                    </button>
                    {project.assets.some(a => !a.generated) && (
                      <div className="material-grid">
                        {project.assets.filter(a => !a.generated).map((a) => (
                          <div className="material-card" key={a.id}>
                            <img src={a.url} alt={a.name} />
                            <button
                              className="remove-asset"
                              aria-label={"从当前项目移除" + a.name}
                              onClick={() => removeProjectAsset(a)}
                            >
                              <X size={13} />
                            </button>
                            <div className="material-caption">
                              <span title={a.name}>{a.name}</span>
                              <Select
                                value={a.role}
                                onValueChange={(role) =>
                                  patchProject({
                                    ...project,
                                    assets: project.assets.map((x) =>
                                      x.id === a.id
                                        ? { ...x, role: role as AssetRole }
                                        : x,
                                    ),
                                  })
                                }
                              >
                                <SelectTrigger aria-label={a.name + "的用途"}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Array.from(new Set([a.role, ...categoryRoles[categoryFor(project).id]])).map((r) => (
                                    <SelectItem key={r} value={r}>
                                      {r}图
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="material-tip">
                      <FileImage size={16} />
                      <span>
                        建议准备 5 张不同角度的实拍，包含整体与细节；图片较少时会复用。标记用途后，排版会优先匹配对应图片。
                      </span>
                    </div>
                  </section>
                  <aside className="info-panel">
                    <div className="section-line">
                      <h2>商品资料</h2>
                      <span className="pill">真实信息</span>
                    </div>
                    <label>
                      商品名称 <span className="required">*</span>
                      <input
                        maxLength={40}
                        value={project.info.name}
                        onChange={(e) => updateInfo("name", e.target.value)}
                        placeholder={categoryFor(project).id === "quilt" ? "例如：立体格纹绗缝被" : "例如：花卉印花床品套件"}
                      />
                    </label>
                    <label>
                      品牌名称
                      <input
                        maxLength={30}
                        value={project.info.brand}
                        onChange={(e) => updateInfo("brand", e.target.value)}
                      />
                    </label>
                    <label>
                      首屏的一句话定位
                      <input
                        maxLength={70}
                        value={project.info.subtitle}
                        onChange={(e) => updateInfo("subtitle", e.target.value)}
                        placeholder="例如：格纹肌理，搭配弧线绗缝"
                      />
                    </label>
                    <label>
                      已确认的卖点 · 按重要程度排序
                      <textarea
                        maxLength={300}
                        rows={3}
                        value={project.info.sellingPoints}
                        onChange={(e) =>
                          updateInfo("sellingPoints", e.target.value)
                        }
                        placeholder={categoryFor(project).id === "quilt" ? "每行一个，最多6个；如已确认的面料、填充和工艺特点" : "每行一个；填写已确认的花型、面料、搭配或工艺特点"}
                      />
                    </label>
                    <div className="field-pair">
                      <label>
                        面料成分
                        <input
                          maxLength={60}
                          value={project.info.material}
                          onChange={(e) =>
                            updateInfo("material", e.target.value)
                          }
                          placeholder="按真实标签填写"
                        />
                      </label>
                      {categoryFor(project).id === "quilt" ? <label>
                        填充物
                        <input
                          maxLength={60}
                          value={project.info.filling}
                          onChange={(e) =>
                            updateInfo("filling", e.target.value)
                          }
                          placeholder="未确认可留空"
                        />
                      </label> : <label>
                        套件组成
                        <input maxLength={160} value={project.info.setContents || ""} onChange={(e) => updateInfo("setContents", e.target.value)} placeholder="按实际填写，例如：被套×1、床单×1、枕套×2" />
                      </label>}
                      <label>
                        尺寸规格
                        <input
                          maxLength={80}
                          value={project.info.size}
                          onChange={(e) => updateInfo("size", e.target.value)}
                          placeholder={categoryFor(project).id === "quilt" ? "被子实际长×宽" : "分别填写被套、床单/床笠、枕套尺寸"}
                        />
                      </label>
                      {categoryFor(project).id === "quilt" && <label>
                        重量
                        <input
                          maxLength={60}
                          value={project.info.weight}
                          onChange={(e) => updateInfo("weight", e.target.value)}
                          placeholder="未确认可留空"
                        />
                      </label>}
                    </div>
                    <label>
                      {categoryFor(project).id === "quilt" ? "颜色名称" : "花型 / 配色名称"}
                      <input
                        maxLength={60}
                        value={project.info.colors}
                        onChange={(e) => updateInfo("colors", e.target.value)}
                        placeholder="按店铺实际色名填写"
                      />
                    </label>
                    <label>
                      洗护说明
                      <input
                        maxLength={160}
                        value={project.info.care}
                        onChange={(e) => updateInfo("care", e.target.value)}
                        placeholder="按洗护标识填写"
                      />
                    </label>
                    <p className="field-note">未填写的参数会从成品中省略。</p>
                  </aside>
                </div>
                <div className="editor-bottom">
                  <span>
                    <Layers size={17} />
                    {
                      templates.find((t) => t.id === project.template)?.name
                    } ·{" "}
                    {project.output === "detail"
                      ? "790宽详情切片"
                      : "5张1200主图"}
                  </span>
                  <div>
                    <button
                      className="btn"
                      onClick={() => setStep("template")}
                      disabled={!!busy}
                    >
                      选择视觉风格
                    </button>
                    <button className="btn primary" onClick={() => preparePlan()} disabled={!!busy}>直接制定内容计划 <ChevronRight size={17} /></button>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="template">
                <CategoryPicker value={categoryFor(project).id} onChange={changeCategory} disabled={!!busy} />
                <div className="style-brief"><div><span className="eyebrow">宜爱家店铺 · {categoryFor(project).name}</span><h2>{categoryFor(project).id === "quilt" ? "看见体积，也看清填充与做工" : "从整床搭配，看到每件的细节"}</h2><p>{categoryFor(project).summary}</p></div><div className="style-chips"><span>{categoryFor(project).id === "quilt" ? "叠放大图" : "整床花型"}</span><span>{categoryFor(project).id === "quilt" ? "面料与填充" : "套件组成"}</span><span>真实资料</span></div></div>
                <div className="template-grid editor-templates">
                  {templates.map((t) => (
                    <TemplateCard
                      key={t.id}
                      id={t.id}
                      selected={project.template === t.id}
                      onSelect={() => {
                        if (project.template !== t.id) patchProject(updateProjectTemplate(project, t.id));
                      }}
                    />
                  ))}
                </div>
                <div className="editor-bottom">
                  <span>选择风格后，逐张确定标题、实拍与顺序。</span>
                  <button
                    className="btn primary"
                    onClick={() => preparePlan()}
                    disabled={!!busy}
                  >
                    下一步：制定内容计划
                  </button>
                </div>
              </TabsContent>
              <TabsContent value="plan">
                <DesignPlan project={project} onChange={patchProject} onPreview={previewPlan} onReview={() => setStep("results")} onGenerateCopy={() => void generateCopy()} onUndoCopy={undoCopy} copyResult={copyResult?.projectId === project.id ? copyResult : null} busy={!!busy} copyBusy={copyRunning.current} />
                <div className="plan-reset"><span>按最新资料重新安排其余文案与选图，首图保留你填写的文案。</span><button className="text-button" disabled={!!busy} onClick={() => preparePlan(true)}>按最新资料重新规划</button></div>
              </TabsContent>
              <TabsContent value="results">
                {project.workflow === "plan" ? <div className="preview-gate"><h2>先完成内容计划</h2><p>确定每张图的卖点与实拍后，再预览首图。</p><button className="btn primary" onClick={() => setStep("plan")}>返回内容计划</button></div> : project.workflow === "preview" ? <div className="first-preview">
                  <button className="first-preview-art" aria-label="编辑首图" onClick={() => setEditingId(project.modules[0].id)}><CanvasPreview project={project} module={project.modules[0]} large /></button>
                  <div className="first-preview-copy"><span className="eyebrow">首图试排 / 先确认方向</span><h2>这一张，决定整套的感觉</h2><p>检查标题是否抓住主卖点、商品是否足够突出，以及颜色和纹理是否与实物一致。点击首图即可改字、换图或调整裁切。</p>
                    <div className="first-preview-points"><span><Check size={16} />标题、照片、色调统一</span><span><Check size={16} />后续每张只讲一个重点</span><span><Check size={16} />细节与配色保留真实实拍</span></div>
                    {project.generation === "ai" && project.modules[0].aiStatus !== "succeeded" && <div className="error-banner"><p>{project.modules[0].aiError || "首图尚未生成完成。"}</p><button className="btn" disabled={!!busy} onClick={() => void runAI(project, project.modules[0].id)}>重试首图</button></div>}
                    <button className="btn primary wide" disabled={!!busy || (project.generation === "ai" && project.modules[0].aiStatus !== "succeeded")} onClick={completePlan}>首图方向确认，完成整套 <ChevronRight size={17} /></button>
                    <button className="btn wide" disabled={!!busy} onClick={() => setStep("plan")}>返回调整卖点与选图</button>
                    <small>{project.generation === "ai" ? `确认后还需优化 ${project.modules.slice(1).filter((m) => needsAI(project, m)).length} 张场景图，使用当前自定义 API。` : "实拍排版不调用模型，确认后展示整套图片。"}</small>
                  </div>
                </div> : <>
                <div className="result-intro">
                  <div>
                    <span className="ready-label">
                      <Check size={15} />
                      {project.generation === "ai"
                        ? isAiIncomplete
                          ? "部分图片尚未完成"
                          : "AI素材已生成"
                        : "套图排版预览"}
                    </span>
                    <span>点击图片，改字、换图或调整裁切位置。</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setStep("plan")}
                  >
                    调整卖点与顺序
                  </button>
                </div>
                {isAiIncomplete && (
                  <div className="error-banner">
                    <p>
                      已完成的结果会保留。未完成的图片可以继续生成，费用按服务商实际调用结算。
                    </p>
                    <button
                      className="btn"
                      disabled={!!busy}
                      onClick={() => void runAI(project)}
                    >
                      继续未完成的图片
                    </button>
                  </div>
                )}
                <Tabs
                  value={outputTab}
                  onValueChange={setOutputTab}
                  className="output-tabs"
                >
                  <TabsList className="result-tabs">
                    {project.output !== "detail" && (
                      <TabsTrigger value="main">
                        商品主图 <span>5</span>
                      </TabsTrigger>
                    )}
                    {project.output !== "main" && (
                      <TabsTrigger value="detail">
                        详情切片 <span>7</span>
                      </TabsTrigger>
                    )}
                  </TabsList>
                  <TabsContent value="main">
                    <div className="result-size">
                      <span>1200 × 1200 px</span>
                      <span>JPG · 按序导出</span>
                    </div>
                    <div className="output-grid main-output">
                      {project.modules
                        .filter((m) => m.kind === "main")
                        .map((m) => (
                          <div className="output-card" key={m.id}>
                            <button
                              className="output-art"
                              onClick={() => setEditingId(m.id)}
                            >
                              <CanvasPreview project={project} module={m} />
                              <span className="edit-overlay">
                                <Settings2 size={16} />
                                编辑这一张
                              </span>
                            </button>
                            <div className="output-meta">
                              <span>
                                主图 {String(m.index).padStart(2, "0")}
                                {project.generation === "ai" && (
                                  <small>
                                    {!needsAI(project, m) ? "实拍排版" : m.aiStatus === "succeeded"
                                      ? project.assets.find((a) => a.id === m.imageId)?.generated ? "AI完成" : "实拍排版"
                                      : m.aiStatus === "failed"
                                        ? "生成失败"
                                        : "待生成"}
                                  </small>
                                )}
                              </span>
                              <button
                                className="icon-button"
                                aria-label={"下载主图" + m.index}
                                onClick={() => void downloadOne(m)}
                                disabled={!!busy}
                              >
                                <Download size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="detail">
                    <div className="result-size">
                      <span>790 px 宽 · 7 个完整模块</span>
                      <span>切片已按顺序排列</span>
                    </div>
                    <div className="output-grid detail-output">
                      {project.modules
                        .filter((m) => m.kind === "detail")
                        .map((m) => (
                          <div className="output-card" key={m.id}>
                            <button
                              className="output-art"
                              onClick={() => setEditingId(m.id)}
                            >
                              <CanvasPreview project={project} module={m} />
                              <span className="edit-overlay">
                                <Settings2 size={16} />
                                编辑这一张
                              </span>
                            </button>
                            <div className="output-meta">
                              <span>
                                详情 {String(m.index).padStart(2, "0")}
                                <small>
                                  790 × {dimensions(m).height}
                                  {project.generation === "ai"
                                    ? " · " +
                                      (!needsAI(project, m) ? "实拍排版" : m.aiStatus === "succeeded"
                                        ? project.assets.find((a) => a.id === m.imageId)?.generated ? "AI完成" : "实拍排版"
                                        : m.aiStatus === "failed"
                                          ? "失败"
                                          : "待生成")
                                    : ""}
                                </small>
                              </span>
                              <button
                                className="icon-button"
                                aria-label={"下载详情" + m.index}
                                onClick={() => void downloadOne(m)}
                                disabled={!!busy}
                              >
                                <Download size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </TabsContent>
                </Tabs>
                <div className="export-note">
                  <Check size={17} />
                  <span>
                    导出前请检查商品花色、细节与文字。AI素材可能与实物有差异；下载仅包含当前选择的主图或详情切片。
                  </span>
                </div>
                </>}
              </TabsContent>
            </Tabs></fieldset>
          </main>
        )}
      </SidebarInset>
      <Dialog open={!!pendingSwitch} onOpenChange={open => { if (!open && !busy) setPendingSwitch(null); }}>
        <DialogContent className="new-dialog">
          <DialogHeader>
            <DialogTitle>保留当前修改？</DialogTitle>
            <DialogDescription>「{project?.info.name || "当前商品"}」有未保存的内容。保存后再切换，下次还能接着编辑。</DialogDescription>
          </DialogHeader>
          <div className="pending-dialog-actions">
            <button className="btn" disabled={!!busy} onClick={() => { setPendingSwitch(null); setView("editor"); }}>继续编辑</button>
            <button className="btn" disabled={!!busy} onClick={() => void finishProjectSwitch(false)}>不保存，切换</button>
            <button className="btn primary" disabled={!!busy} onClick={() => void finishProjectSwitch(true)}>保存并切换</button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="new-dialog">
          <DialogHeader>
            <span className="dialog-emblem">
              <Sparkles size={24} />
            </span>
            <DialogTitle>开始一款商品的创作</DialogTitle>
            <DialogDescription>
              先选择商品类目与制作类型，再导入商品实拍。
            </DialogDescription>
          </DialogHeader>
          <CategoryPicker value={newCategory} onChange={setNewCategory} compact />
          <label className="form-label">
            商品名称
            <input
              autoFocus
              value={newName}
              maxLength={40}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createProject();
              }}
              placeholder={newCategory === "quilt" ? "例如：秋冬格纹绗缝被" : "例如：小花印花床品套件"}
            />
          </label>
          <div
            className="output-choice"
            role="group"
            aria-label="新商品制作类型"
          >
            <button
              className={newOutput === "main" ? "active" : ""}
              aria-pressed={newOutput === "main"}
              onClick={() => setNewOutput("main")}
            >
              <Grid2X2 size={16} />
              5张主图
            </button>
            <button
              className={newOutput === "detail" ? "active" : ""}
              aria-pressed={newOutput === "detail"}
              onClick={() => setNewOutput("detail")}
            >
              <BookOpen size={16} />
              790详情页
            </button>
          </div>
          <button
            className="btn primary wide"
            onClick={createProject}
            disabled={!newName.trim() || !!busy}
          >
            创建并导入素材
          </button>
          <button
            className="text-button center"
            onClick={() => {
              setNewOpen(false);
              openSample();
            }}
          >
            没有素材？先体验被子样例
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editingId}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
      >
        <DialogContent className="edit-dialog">
          <DialogHeader>
            <DialogTitle>
              {activeModule
                ? (activeModule.kind === "main" ? "主图 " : "详情 ") +
                  String(activeModule.index).padStart(2, "0") +
                  " · 局部编辑"
                : "局部编辑"}
            </DialogTitle>
            <DialogDescription>
              修改会实时显示在预览中，完成后可保存作品。
            </DialogDescription>
          </DialogHeader>
          {activeModule && project && (
            <div className="edit-dialog-grid">
              <div className="edit-preview">
                <CanvasPreview project={project} module={activeModule} large />
              </div>
              <fieldset className="edit-controls editor-lock" disabled={!!busy}>
                <label>
                  标题
                  <input
                    maxLength={40}
                    value={activeModule.title}
                    onChange={(e) => updateModule({ title: e.target.value })}
                  />
                </label>
                <label>
                  副标题
                  <textarea
                    rows={2}
                    maxLength={100}
                    value={activeModule.subtitle}
                    onChange={(e) => updateModule({ subtitle: e.target.value })}
                  />
                </label>
                <label>
                  主图片
                  <Select
                    value={activeModule.imageId}
                    onValueChange={(imageId) => updateModule({ imageId })}
                  >
                    <SelectTrigger aria-label="主图片">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {project.assets.filter((a) => !a.generated || a.id === activeModule.imageId).map((a) => (
                        <SelectItem value={a.id} key={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {usesSecondary(activeModule) && (
                  <label>
                    第二张图片
                    <Select
                      value={activeModule.imageId2}
                      onValueChange={(imageId2) => updateModule({ imageId2 })}
                    >
                      <SelectTrigger aria-label="第二张图片">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {project.assets.filter((a) => !a.generated).map((a) => (
                          <SelectItem value={a.id} key={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                <div className="crop-control">
                  <label>
                    水平裁切 <span>{activeModule.cropX}%</span>
                  </label>
                  <Slider
                    aria-label="水平裁切"
                    min={0}
                    max={100}
                    step={1}
                    value={[activeModule.cropX]}
                    onValueChange={([cropX]) => updateModule({ cropX })}
                  />
                </div>
                <div className="crop-control">
                  <label>
                    垂直裁切 <span>{activeModule.cropY}%</span>
                  </label>
                  <Slider
                    aria-label="垂直裁切"
                    min={0}
                    max={100}
                    step={1}
                    value={[activeModule.cropY]}
                    onValueChange={([cropY]) => updateModule({ cropY })}
                  />
                </div>
                <p className="field-note">
                  只调整这一张的文字和主图片裁切，不改变其他模块。
                </p>
                <button
                  className="btn primary wide"
                  disabled={!!busy}
                  onClick={() => void downloadOne(activeModule)}
                >
                  <Download size={16} />
                  下载这一张
                </button>
                {needsAI(project, activeModule) && <><button
                  className="btn wide"
                  disabled={!!busy}
                  onClick={() => void runAI(project, activeModule.id)}
                >
                  <Sparkles size={16} />
                  用自定义 API 重做这一张
                </button>
                <p className="field-note">
                  重做会发起1次图片生成，可能产生服务商费用。
                </p></>}
                <button className="btn wide" onClick={() => setEditingId(null)}>
                  完成编辑
                </button>
              </fieldset>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="help-dialog">
          <DialogHeader>
            <DialogTitle>把商品素材，变成整套图片</DialogTitle>
            <DialogDescription>
              上传素材后，独立选择主图或详情页。
            </DialogDescription>
          </DialogHeader>
          <ol className="help-steps">
            <li>
              <b>1. 整理一款商品</b>
              <p>
                上传至少5张实拍，标记整体、细节和配色。ZIP最大200MB，单个项目最多40张素材。
              </p>
            </li>
            <li>
              <b>2. 填写真实资料</b>
              <p>
                名称必填，材质、规格、重量按实际标签填写，暂未确认的可以留空。
              </p>
            </li>
            <li>
              <b>3. 制定内容计划</b>
              <p>
                选择视觉风格，为每张图确定一个卖点和对应实拍，按商品特点调整顺序。
              </p>
            </li>
            <li>
              <b>4. 先看首图，再完成整套</b>
              <p>预览首图并确认方向，再完成整套。逐张检查后保存、导出ZIP，按文件名顺序上传店铺。</p>
            </li>
          </ol>
          <div className="help-note">
            实拍排版预览不调用模型。AI 生成需要在“自定义 API”中填写 OpenAI 兼容图片编辑接口，费用由对应服务商结算；先测试 1 张再批量生成。
          </div>
        </DialogContent>
      </Dialog>
      <Toaster position="bottom-right" richColors theme="dark" />
    </SidebarProvider>
  );
}
