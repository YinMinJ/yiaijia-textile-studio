import { ref, shallowRef, computed, onMounted, onBeforeUnmount, type Ref } from 'vue';
import { zip, unzip, strToU8 } from 'fflate';
import { buildCopyInput, applyGeneratedCopy, preserveHeroCopy, type GeneratedCopy } from '../lib/design-copy';
import { freshProject, sampleProject, templates, makeModules, dimensions, modulePurpose, needsAI, sourceAsset, referenceAssets, usesSecondary, moduleSection, prepareImageRun, categoryFor, switchCategory, updatePlanModule, updateProjectTemplate, type ProductCategory, type Project, type ProductInfo, type Asset, type AssetRole, type DesignModule, type TemplateId } from '../lib/design-model';
import { renderBlob, downloadBlob } from '../lib/design-renderer';

export type View = 'home'|'editor'|'templates'|'works'|'assets'|'settings';
export type Step = 'materials'|'template'|'plan'|'results';
export type CopyResult = {projectId:string;message:string;error?:boolean;before?:GeneratedCopy[];after?:GeneratedCopy[]};
type Setter<T> = T | ((previous:T)=>T);
function setRef<T>(target:Ref<T>, value:Setter<T>) { target.value = typeof value === 'function' ? (value as (p:T)=>T)(target.value) : value; }
async function zipFiles(files:Record<string,Uint8Array>) { return new Promise<Uint8Array>((resolve,reject)=>zip(files,{level:0},(e,data)=>e?reject(e):resolve(data))); }

export function useStudio() {
  const signedIn = true;
  const view=ref<View>('home'), step=ref<Step>('materials'), outputTab=ref('main');
  const project=shallowRef<Project|null>(null), projects=shallowRef<Project[]>([]);
  const busy=ref(''), progress=ref(0), dirty=ref(false), historyError=ref(''), historyLoading=ref(true);
  const editingId=ref<string|null>(null), pendingSwitch=shallowRef<(()=>void)|null>(null);
  const newOpen=ref(false), newName=ref(''), newOutput=ref<'main'|'detail'>('main'), newCategory=ref<ProductCategory>('quilt'), newBrief=ref('');
  const modelConfigured=ref(false), generationRunning=ref(false), copyBusy=ref(false), helpOpen=ref(false);
  const copyResult=shallowRef<CopyResult|null>(null), lastDownload=ref<{url:string;name:string}|null>(null);
  const notice=ref<{message:string;type:'success'|'error'|'info';id:number}|null>(null);
  let noticeTimer:ReturnType<typeof setTimeout>;
  function notify(message:string,type:'success'|'error'|'info'='info') {
    clearTimeout(noticeTimer); notice.value={message,type,id:Date.now()}; noticeTimer=setTimeout(()=>notice.value=null,6000);
  }
  const toast={success:(s:string)=>notify(s,'success'),error:(s:string)=>notify(s,'error'),info:(s:string)=>notify(s),warning:(s:string)=>notify(s)};
  const setProject=(v:Setter<Project|null>)=>setRef(project,v), setProjects=(v:Setter<Project[]>)=>setRef(projects,v);
  const setView=(v:View)=>view.value=v, setStep=(v:Step)=>step.value=v, setOutputTab=(v:string)=>outputTab.value=v;
  const setBusy=(v:string)=>busy.value=v, setProgress=(v:number)=>progress.value=v, setDirty=(v:boolean)=>dirty.value=v;
  const setPendingSwitch=(v:Setter<(()=>void)|null>)=>setRef(pendingSwitch,v), setEditingId=(v:string|null)=>editingId.value=v;
  const setNewOpen=(v:boolean)=>newOpen.value=v, setNewOutput=(v:'main'|'detail')=>newOutput.value=v, setNewName=(v:string)=>newName.value=v;
  const setCopyResult=(v:CopyResult|null)=>copyResult.value=v, setLastDownload=(v:{url:string;name:string})=>lastDownload.value=v;

  async function loadProjects() {
    historyLoading.value=true;
    try {const response=await fetch('/api/projects');const data=await response.json();if(!response.ok)throw new Error(data.error||'作品读取失败');projects.value=data.projects;historyError.value='';}
    catch(e){historyError.value=(e as Error).message;}finally{historyLoading.value=false;}
  }
  function warn(e:BeforeUnloadEvent) {if(dirty.value){e.preventDefault();e.returnValue='';}}
  onMounted(()=>{void loadProjects();void fetch('/api/model-settings').then(r=>r.json()).then(d=>modelConfigured.value=!!d.configured).catch(()=>{});window.addEventListener('beforeunload',warn);});
  onBeforeUnmount(()=>{window.removeEventListener('beforeunload',warn);clearTimeout(noticeTimer);if(lastDownload.value)URL.revokeObjectURL(lastDownload.value.url);});

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
  async function prepareImage(file:File){
    if(file.size>30*1024*1024)throw new Error(file.name+'超过30MB。');
    const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>80000000){bitmap.close();throw new Error('图片像素过大，请先缩小。');}
    const ratio=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');
    canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图片读取失败')),'image/jpeg',.94));const width=canvas.width,height=canvas.height;canvas.width=canvas.height=1;
    return {file:new File([blob],file.name.replace(/\.[^.]+$/,'.jpg'),{type:'image/jpeg'}),width,height};
  }

function patchProject(p: Project) {
    setProject(p);
    setDirty(true);
}
function requestProjectSwitch(action: () => void) {
    if (busy.value || generationRunning.value || copyBusy.value) {
        toast.info("当前任务正在处理中，完成后即可切换商品。");
        return;
    }
    if (project.value && dirty.value)
        setPendingSwitch(() => action);
    else
        action();
}
function openProject(p: Project) {
    if (project.value?.id === p.id) {
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
function startCreation(output: "main" | "detail", brief = "") {
    if (busy.value)
        return;
    setNewOutput(output);
    newBrief.value = brief.trim();
    setNewName(brief.trim().slice(0, 40));
    setNewOpen(true);
}
async function finishProjectSwitch(saveFirst: boolean) {
    const action = pendingSwitch.value;
    if (!action || busy.value)
        return;
    if (saveFirst && !(await save()))
        return;
    setPendingSwitch(null);
    action();
}
async function generateCopy() {
    if (!project.value || busy.value || copyBusy.value)
        return;
    if (!signedIn || !modelConfigured.value) {
        toast.info("请先在“自定义 API”中配置文案模型。");
        setView("settings");
        return;
    }
    const original = project.value;
    copyBusy.value = true;
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
        const data = (await response.json()) as {
            copies?: GeneratedCopy[];
            model?: string;
            error?: string;
        };
        if (!response.ok || !data.copies)
            throw new Error(data.error || "文案生成失败，请重试。");
        if (project.value !== original) {
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
    }
    catch (e) {
        const message = (e as Error).name === "TimeoutError" ? "文案生成超时，原文案已保留。可稍后重试。" : (e as Error).message;
        setCopyResult({ projectId: original.id, message, error: true });
        toast.error(message);
    }
    finally {
        copyBusy.value = false;
        setBusy("");
    }
}
function undoCopy() {
    if (!project.value || busy.value || copyResult.value?.projectId !== project.value.id || !copyResult.value.before || !copyResult.value.after)
        return;
    const before = copyResult.value.before, after = copyResult.value.after;
    patchProject({ ...project.value, modules: project.value.modules.map((m) => {
            const generated = after.find((c) => c.id === m.id);
            const previous = before.find((c) => c.id === m.id);
            return generated && previous && m.title === generated.title && m.subtitle === generated.subtitle ? { ...m, title: previous.title, subtitle: previous.subtitle } : m;
        }) });
    setCopyResult({ projectId: project.value.id, message: "已撤销本次自动文案，你后续手动修改的内容已保留。" });
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
async function save(p = project.value) {
    if (!p)
        return false;
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
        if (!r.ok)
            throw new Error(data.error || "保存失败");
        setProject(data.project);
        setProjects((old) => [
            data.project,
            ...old.filter((q) => q.id !== data.project.id),
        ]);
        setDirty(false);
        toast.success("作品已保存，下次可以继续编辑。");
        return true;
    }
    catch (e) {
        toast.error((e as Error).message);
        return false;
    }
    finally {
        setBusy("");
    }
}
function createProject() {
    if (!newName.value.trim() || busy.value)
        return;
    setNewOpen(false);
    requestProjectSwitch(() => {
        const p = freshProject();
        p.category = newCategory.value;
        p.info.name = newName.value.trim();
        if (newBrief.value.length > 40) p.info.subtitle = newBrief.value.slice(0, 70);
        p.output = newOutput.value;
        p.generation = "template";
        setProject(p);
        setNewOpen(false);
        setNewName("");
        setStep("materials");
        setOutputTab(newOutput.value);
        setView("editor");
        setDirty(true);
    });
}
function updateInfo(key: keyof ProductInfo, value: string) {
    if (project.value)
        patchProject({ ...project.value, info: { ...project.value.info, [key]: value } });
}
async function importFiles(files: File[]) {
    if (!project.value || !files.length || busy.value)
        return;
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
        const remaining = 40 - project.value.assets.filter((a) => !a.generated).length;
        if (remaining <= 0)
            throw new Error("一款商品最多40张素材。");
        if (expanded.length > remaining)
            toast.warning("本次仅导入前" + remaining + "张图片。");
        const next: Asset[] = [];
        const errors: string[] = [];
        for (const [i, file] of expanded.slice(0, remaining).entries()) {
            setBusy("正在上传 " + (i + 1) + " / " + Math.min(expanded.length, remaining));
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
                if (!r.ok)
                    throw new Error(data.error || "请求失败");
                next.push({
                    ...data,
                    width: prepared.width,
                    height: prepared.height,
                    role: project.value.assets.length + next.length === 0 ? "整体" : "其他",
                });
            }
            catch (e) {
                errors.push(file.name + "：" + (e as Error).message);
            }
            setProgress(Math.round(((i + 1) / Math.min(expanded.length, remaining)) * 100));
        }
        patchProject({ ...project.value, assets: [...project.value.assets, ...next] });
        if (next.length)
            toast.success("已导入" + next.length + "张素材，请标记整体图与细节图。");
        if (errors.length)
            toast.error(errors[0] +
                (errors.length > 1
                    ? "，另有" + (errors.length - 1) + "张未导入"
                    : ""));
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy("");
        setProgress(0);
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
    const data = (await r.json()) as {
        project?: Project;
        error?: string;
    };
    if (!r.ok || !data.project)
        throw new Error(data.error || "保存失败，请保留当前页面。");
    return data.project;
}
async function runAI(initial: Project, onlyId?: string) {
    if (generationRunning.value)
        return;
    const requested = initial.modules.find((m) => m.id === onlyId);
    if (requested && !needsAI(initial, requested)) {
        toast.info("这个模块保留实拍或真实资料，可直接修改文字与选图。");
        return;
    }
    if (!modelConfigured.value) {
        toast.info("请先在“自定义 API”中配置图片编辑接口。");
        setEditingId(null);
        setView("settings");
        return;
    }
    if (!signedIn) {
        toast.error("登录后即可使用自己的模型。");
        return;
    }
    generationRunning.value = true;
    setBusy("正在保存生成任务");
    let p = prepareImageRun(initial, onlyId);
    try {
        p = (await persist(p)) as typeof p;
        setProject(p);
        setView("editor");
        setStep("results");
        setOutputTab(p.output || "main");
        const targets = p.modules.filter((m) => needsAI(p, m) && (onlyId ? m.id === onlyId : m.aiStatus !== "succeeded"));
        for (const [i, target] of targets.entries()) {
            setBusy("AI生成 " + (i + 1) + " / " + targets.length + " · 单张可能需要数分钟，请保持页面打开");
            setProgress(Math.round((i / targets.length) * 100));
            try {
                const a = sourceAsset(p, target);
                if (!a)
                    throw new Error("这张图缺少原始实拍，请回到内容计划重新选图。");
                const form = new FormData();
                const references = referenceAssets(p, target).slice(0, 3);
                let totalBytes = 0;
                for (const [referenceIndex, reference] of references.entries()) {
                    const source = await fetch(reference.url);
                    if (!source.ok)
                        throw new Error("第" + (referenceIndex + 1) + "张商品参考素材读取失败。");
                    const blob = await source.blob();
                    if (!blob.size || blob.size > 8 * 1024 * 1024)
                        throw new Error("每张模型参考图需在8MB以内，请更换或缩小素材。");
                    totalBytes += blob.size;
                    if (totalBytes > 25 * 1024 * 1024)
                        throw new Error("模型参考素材总大小超过25MB，请缩小素材。");
                    const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
                    form.append("image", blob, "product-" + (referenceIndex + 1) + "." + extension);
                }
                form.set("projectId", p.id);
                form.set("moduleId", target.id);
                if (onlyId)
                    form.set("retry", "true");
                const r = await fetch("/api/generate-image", {
                    method: "POST",
                    body: form,
                });
                const data = (await r.json()) as {
                    asset?: Asset;
                    error?: string;
                };
                if (!r.ok || !data.asset)
                    throw new Error(data.error || "模型没有返回图片。");
                const asset = data.asset;
                p = {
                    ...p,
                    assets: [...p.assets.filter((a) => a.id !== asset.id), asset],
                    modules: p.modules.map((m) => m.id === target.id
                        ? {
                            ...m,
                            sourceImageId: a.id,
                            imageId: asset.id,
                            aiStatus: "succeeded",
                            aiError: undefined,
                        }
                        : m),
                };
                setProject(p);
                setDirty(true);
                p = (await persist(p)) as typeof p;
                setProject(p);
                setDirty(false);
            }
            catch (e) {
                const message = (e as Error).message;
                p = {
                    ...p,
                    modules: p.modules.map((m) => m.id === target.id
                        ? { ...m, aiStatus: "failed", aiError: message.slice(0, 400) }
                        : m),
                };
                setProject(p);
                setDirty(true);
                try {
                    p = (await persist(p)) as typeof p;
                    setProject(p);
                    setDirty(false);
                }
                catch { }
                toast.error(message);
                break;
            }
        }
        setProjects((old) => [p, ...old.filter((q) => q.id !== p.id)]);
        if (initial.workflow === "preview" && requested && p.modules.find((m) => m.id === requested.id)?.aiStatus === "succeeded")
            toast.success("首图已完成，确认方向后再继续整套。");
        else if (p.modules.every((m) => m.aiStatus === "succeeded"))
            toast.success("AI素材已生成，请检查商品花色与细节后导出。");
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy("");
        setProgress(0);
        generationRunning.value = false;
    }
}
function preparePlan(rebuild = false) {
    if (!project.value)
        return;
    if (!project.value.info.name.trim()) {
        toast.error("请填写商品名称。");
        return;
    }
    if (!project.value.assets.some((a) => !a.generated)) {
        toast.error("先上传至少 1 张商品实拍，就可以开始制作。");
        return;
    }
    const original = { ...project.value };
    const next = {
        ...original,
        modules: !rebuild && project.value.modules.length ? project.value.modules : preserveHeroCopy(project.value, makeModules(original)),
        workflow: "plan" as const,
        status: "draft" as const,
    };
    patchProject(next);
    setStep("plan");
    setOutputTab(project.value.output || "main");
}
function changeCategory(category: ProductCategory) {
    if (!project.value || categoryFor(project.value).id === category || busy.value)
        return;
    const next = switchCategory(project.value, category);
    patchProject({ ...next, modules: preserveHeroCopy(project.value, next.modules) });
    setEditingId(null);
    toast.success("已切换为" + categoryFor({ category }).name + "方案，请核对资料与实拍用途。");
}
function previewPlan(mode: "template" | "ai") {
    if (!project.value || !project.value.modules.length || busy.value)
        return;
    const original = project.value;
    const next: Project = {
        ...project.value, workflow: "preview", generation: mode,
        generationBatch: crypto.randomUUID(),
        assets: project.value.assets.filter((a) => !a.generated),
        modules: project.value.modules.map((m) => ({ ...m,
            imageId: sourceAsset(original, m)?.id || m.imageId,
            sourceImageId: sourceAsset(original, m)?.id,
            imageId2: m.sourceImageId2 ?? m.imageId2,
            aiStatus: undefined, aiError: undefined, })),
    };
    if (next.modules.some((m) => moduleSection(m) !== "specs" && !sourceAsset(next, m))) {
        toast.error("请先为每个模块选好原始实拍，再预览首图。");
        return;
    }
    patchProject(next);
    setStep("results");
    setOutputTab(next.output || "main");
    if (mode === "ai")
        void runAI(next, next.modules[0].id);
}
function completePlan() {
    if (!project.value || busy.value)
        return;
    const first = project.value.modules[0];
    if (project.value.generation === "ai" && needsAI(project.value, first) && first.aiStatus !== "succeeded") {
        toast.error("请先完成首图，或回到内容计划选择实拍预览。");
        return;
    }
    const next: Project = { ...project.value, workflow: "complete", status: "ready" };
    patchProject(next);
    if (next.generation === "ai")
        void runAI(next);
    else
        toast.success("整套排版已完成，可以逐张检查并导出。");
}
function selectTemplate(id: TemplateId) {
    if (project.value) {
        const next = updateProjectTemplate(project.value, id);
        if (next !== project.value) {
            patchProject(next);
            setStep(next.modules.length ? "plan" : "materials");
        }
        setView("editor");
    }
    else {
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
    if (busy.value)
        return;
    if (project.value && categoryFor(project.value).id === category && (project.value.output || "main") === output) {
        selectTemplate(template);
    }
    else {
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
    if (!project.value || busy.value)
        return;
    const references = project.value.modules.filter(m => [m.imageId, m.imageId2, m.sourceImageId, m.sourceImageId2].includes(asset.id));
    if (references.length) {
        toast.info("这张素材已用于内容计划，请先更换对应图片，再移除素材。现有文案和成图已保留。");
        return;
    }
    patchProject({ ...project.value, assets: project.value.assets.filter(a => a.id !== asset.id) });
}
function updateModule(changes: Partial<DesignModule>) {
    if (project.value && editingId.value && !busy.value)
        patchProject(updatePlanModule(project.value, editingId.value, changes));
}
async function downloadOne(m: DesignModule) {
    if (!project.value)
        return;
    if (project.value.generation === "ai" && needsAI(project.value, m) && m.aiStatus !== "succeeded") {
        toast.error("这张图片还未生成完成，请先重试。");
        return;
    }
    try {
        setBusy("正在导出图片");
        const blob = await renderBlob(project.value, m);
        setLastDownload(downloadBlob(blob, (m.kind === "main" ? "主图" : "详情") +
            String(m.index).padStart(2, "0") +
            ".jpg"));
        toast.success("图片已导出");
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy("");
    }
}
async function downloadAll() {
    if (!project.value || project.value.workflow === "plan" || project.value.workflow === "preview" ||
        project.value.modules.length !==
            (project.value.output === "main" ? 5 : project.value.output === "detail" ? 7 : 12))
        return;
    if (project.value.generation === "ai" &&
        project.value.modules.some((m) => needsAI(project.value!, m) && m.aiStatus !== "succeeded")) {
        toast.error("请先完成剩余图片，再导出。");
        return;
    }
    setBusy("正在导出整套图片");
    setProgress(0);
    try {
        const files: Record<string, Uint8Array> = {};
        for (const [i, m] of project.value.modules.entries()) {
            const d = dimensions(m);
            const name = (m.kind === "main"
                ? "01_主图_1200x1200/主图"
                : "02_详情切片_790/详情") +
                String(m.index).padStart(2, "0") +
                ".jpg";
            const blob = await renderBlob(project.value, m);
            files[name] = new Uint8Array(await blob.arrayBuffer());
            if (d.width !== 1200 && d.width !== 790)
                throw new Error("尺寸校验失败");
            setProgress(Math.round(((i + 1) / (project.value.modules.length + 1)) * 100));
        }
        files["商品资料.txt"] = strToU8("商品：" +
            project.value.info.name +
            "\n品牌：" +
            project.value.info.brand +
            "\n类目：" + categoryFor(project.value).name +
            "\n风格参考：" + categoryFor(project.value).referenceUrl +
            (categoryFor(project.value).id === "bedding-set" && project.value.info.setContents ? "\n套件组成：" + project.value.info.setContents : "") +
            "\n输出：" +
            (project.value.output === "main"
                ? "5张主图，1200×1200"
                : project.value.output === "detail"
                    ? "7张详情切片，宽790"
                    : "主图和详情") +
            "\n\n导出前请检查文字、商品外观及商品参数。");
        const archive = await zipFiles(files);
        setLastDownload(downloadBlob(new Blob([archive as BlobPart], { type: "application/zip" }), project.value.info.name.replace(/[\\/:*?"<>|]/g, "_") +
            (project.value.output === "main"
                ? "_主图.zip"
                : project.value.output === "detail"
                    ? "_详情切片.zip"
                    : "_主图与详情.zip")));
        setProgress(100);
        toast.success(project.value.modules.length + "张图片已按顺序打包导出。");
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy("");
        setProgress(0);
    }
}

  function updatePlan(id:string,changes:Partial<DesignModule>){if(project.value&&!busy.value)patchProject(updatePlanModule(project.value,id,changes));}
  function moveModule(id:string,delta:number){
    if(!project.value||busy.value)return;const modules=[...project.value.modules],index=modules.findIndex(m=>m.id===id),to=index+delta;
    if(index<0||!modules[to]||modules[to].kind!==modules[index].kind||moduleSection(modules[to])==='hero'||moduleSection(modules[index])==='hero')return;
    [modules[index],modules[to]]=[modules[to],modules[index]];const counts={main:0,detail:0};patchProject({...project.value,modules:modules.map(m=>({...m,index:++counts[m.kind]}))});
  }
  const activeModule=computed(()=>project.value?.modules.find(m=>m.id===editingId.value));
  const isAiIncomplete=computed(()=>project.value?.generation==='ai'&&project.value.modules.some(m=>needsAI(project.value!,m)&&m.aiStatus!=='succeeded'));
  const canExport=computed(()=>!!project.value&&project.value.workflow!=='plan'&&project.value.workflow!=='preview'&&project.value.modules.length===(project.value.output==='main'?5:project.value.output==='detail'?7:12)&&!isAiIncomplete.value);
  return {view,step,outputTab,project,projects,busy,progress,dirty,historyError,historyLoading,editingId,pendingSwitch,newOpen,newName,newOutput,newCategory,modelConfigured,copyBusy,copyResult,lastDownload,helpOpen,notice,activeModule,isAiIncomplete,canExport,
    notify,loadProjects,patchProject,requestProjectSwitch,openProject,startCreation,finishProjectSwitch,generateCopy,undoCopy,openSample,navigate,save,createProject,updateInfo,importFiles,runAI,preparePlan,changeCategory,previewPlan,completePlan,selectTemplate,useLibraryTemplate,removeProjectAsset,updateModule,downloadOne,downloadAll,updatePlan,moveModule};
}
export type StudioContext=ReturnType<typeof useStudio>;
