<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, ArrowUpRight, Check, Clock3, FileImage, FolderOpen, LayoutTemplate, LoaderCircle, Plus, RefreshCw, Sparkles } from '@lucide/vue';
import { categoryFor, moduleSection, needsAI, type Project } from '../../lib/design-model';

const props = defineProps<{
  projects: Project[];
  currentProject: Project | null;
  dirty: boolean;
  busy: boolean;
  historyLoading: boolean;
  historyError: string;
}>();
const emit = defineEmits<{
  create: [output: 'main' | 'detail', brief?: string];
  templates: [];
  open: [project: Project];
  resume: [];
  sample: [output: 'main' | 'detail'];
  retry: [];
  allWorks: [];
}>();
const brief = ref('');
const output = ref<'main' | 'detail'>('main');
const recent = computed(() => [...props.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3));
const currentSave = computed(() => props.currentProject?.sample ? '样例作品' : props.dirty ? '有未保存修改' : props.projects.some(p => p.id === props.currentProject?.id) ? '已保存' : '尚未保存');
function createFromBrief() {
  if (!props.busy) emit('create', output.value, brief.value.trim());
}
function cover(project: Project) {
  const hero = project.modules.find(m => moduleSection(m) === 'hero');
  return project.assets.find(a => a.id === hero?.imageId) || project.assets.find(a => !a.generated);
}
function status(project: Project) {
  if (!project.modules.length) return '完善商品资料';
  if (project.workflow === 'plan') return '待确认计划';
  if (project.modules.some(m => m.aiStatus === 'failed')) return '部分图片需重试';
  if (project.workflow === 'preview') return '待确认首图';
  if (project.generation === 'ai' && project.modules.some(m => needsAI(project, m) && m.aiStatus !== 'succeeded')) return '图片待生成';
  return project.workflow === 'complete' || project.status === 'ready' ? '已完成排版' : '继续制作';
}
function outputName(project: Project) {
  if (project.output === 'main') return '商品主图';
  if (project.output === 'detail') return '商品详情';
  const kinds = new Set(project.modules.map(module => module.kind));
  return kinds.size > 1 ? '主图 + 详情' : kinds.has('detail') ? '商品详情' : '商品主图';
}
function date(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '已保存' : d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
</script>

<template>
  <div class="studio-home">
    <header class="page-heading">
      <div><span class="eyebrow">YOUR CREATIVE SPACE</span><h1>把商品，做成好作品。</h1><p>从一张实拍开始，让主图和详情都更有说服力。</p></div>
      <span class="workspace-label"><i /> 本地工作空间</span>
    </header>

    <section class="creative-banner" aria-labelledby="creative-title">
      <div class="banner-copy">
        <span class="banner-tag"><Sparkles :size="13" /> 家纺商品视觉创作</span>
        <h2 id="creative-title">真实的质感，<br />值得更好的表达。</h2>
        <p>商品实拍、准确文案、统一排版。<br />把每个细节放到合适的位置。</p>
        <button class="primary-button" :disabled="busy" @click="emit('create', 'main')"><Plus :size="17" /> 开始新作品 <ArrowRight :size="17" /></button>
        <span class="banner-foot"><Check :size="13" /> 首图文案由你决定 · 其余文案 AI 辅助</span>
      </div>
      <div class="banner-visual"><img src="/samples/00224.jpg" alt="米白色绗缝被的真实家居场景" /><span class="photo-label">SOFT TEXTURE <span>触得到的温柔</span></span></div>
    </section>

    <form class="brief-composer" @submit.prevent="createFromBrief">
      <div class="composer-heading"><span class="small-icon"><Sparkles :size="17" /></span><label for="creative-brief">用一句话开始</label><span>填写商品名称或一句话定位</span></div>
      <textarea id="creative-brief" v-model="brief" :disabled="busy" maxlength="70" rows="2" placeholder="例如：奶油色格纹大豆被，展示绗缝细节与柔软质感。" />
      <div class="composer-footer"><div class="segmented" aria-label="选择创作类型"><button type="button" :aria-pressed="output === 'main'" @click="output = 'main'"><FileImage :size="14" /> 商品主图</button><button type="button" :aria-pressed="output === 'detail'" @click="output = 'detail'"><LayoutTemplate :size="14" /> 商品详情</button></div><button type="submit" class="primary-button compact" :disabled="busy">开始创作 <ArrowUpRight :size="16" /></button></div>
    </form>

    <section class="section" aria-labelledby="home-tools-title">
      <div class="section-heading"><div><h2 id="home-tools-title">你的创作工具</h2><p>选对入口，让好想法直接开始。</p></div><span class="section-caption">素材 → 文案 → 排版 → 导出</span></div>
      <div class="task-grid">
        <button class="task-card" :disabled="busy" @click="emit('create', 'main')"><span class="task-top"><span class="task-icon main-icon"><FileImage :size="23" /></span><ArrowUpRight :size="18" /></span><strong>商品主图</strong><p>第一眼看清商品，五张图说透卖点。</p><span class="task-bottom">5 张方形主图 <span>1200 × 1200</span></span></button>
        <button class="task-card" :disabled="busy" @click="emit('create', 'detail')"><span class="task-top"><span class="task-icon detail-icon"><LayoutTemplate :size="23" /></span><ArrowUpRight :size="18" /></span><strong>商品详情</strong><p>从整体到细节，让每一个优点有据可看。</p><span class="task-bottom">7 张详情图片 <span>宽 790 px</span></span></button>
        <button class="task-card" :disabled="busy" @click="emit('templates')"><span class="task-top"><span class="task-icon template-icon"><Sparkles :size="23" /></span><ArrowUpRight :size="18" /></span><strong>视觉模板</strong><p>先预览真实排版，再挑选适合商品的风格。</p><span class="task-bottom">4 款完整模板 <span>自由编辑</span></span></button>
      </div>
    </section>

    <section v-if="currentProject" class="resume-card" aria-label="继续当前作品">
      <div class="resume-cover"><img v-if="cover(currentProject)" :src="cover(currentProject)!.url" alt="当前作品的商品素材" /><FileImage v-else :size="24" /></div>
      <div class="resume-copy"><span>当前作品 <i /> <em :class="{ unsaved: dirty }">{{ currentSave }}</em></span><h2>{{ currentProject.info.name || '未命名商品' }}</h2><p>{{ categoryFor(currentProject).name }} · {{ status(currentProject) }}</p></div>
      <button class="secondary-button" :disabled="busy" @click="emit('resume')">继续编辑 <ArrowRight :size="16" /></button>
    </section>

    <section class="section" aria-labelledby="recent-title">
      <div class="section-heading"><div><h2 id="recent-title">最近作品</h2><p>保存你的进度，灵感随时接着做。</p></div><button class="text-button" @click="emit('allWorks')">查看全部 <ArrowRight :size="15" /></button></div>
      <div v-if="historyLoading" class="state-panel" role="status"><LoaderCircle class="spin" :size="23" /><span>正在读取本地作品…</span></div>
      <div v-else-if="historyError" class="state-panel error" role="alert"><FolderOpen :size="24" /><div><strong>作品暂时无法加载</strong><p>{{ historyError }}</p></div><button class="secondary-button" :disabled="busy" @click="emit('retry')"><RefreshCw :size="15" /> 重试</button></div>
      <div v-else-if="recent.length" class="works-grid"><button v-for="project in recent" :key="project.id" class="work-card" :disabled="busy" @click="emit('open', project)"><span class="work-art"><img v-if="cover(project)" :src="cover(project)!.url" :alt="project.info.name || '商品素材'" /><FileImage v-else :size="30" /><span class="work-kind">{{ outputName(project) }}</span><span class="work-arrow"><ArrowUpRight :size="18" /></span></span><span class="work-info"><strong>{{ project.info.name || '未命名商品' }}</strong><span>{{ categoryFor(project).name }} · {{ status(project) }}</span><small><Clock3 :size="12" /> {{ date(project.updatedAt) }}保存</small></span></button></div>
      <div v-else class="state-panel"><span class="empty-icon"><FolderOpen :size="25" /></span><div><strong>让第一件作品，在这里发生</strong><p>上传商品实拍开始制作，保存后即可随时继续。</p></div><button class="secondary-button" :disabled="busy" @click="emit('create', 'main')"><Plus :size="15" /> 新建作品</button></div>
    </section>

    <section class="sample-section"><div><span class="eyebrow">START WITH A SAMPLE</span><h2>还没准备好素材？先试一试。</h2><p>用内置商品样例，体验完整编辑与排版。</p></div><div class="sample-actions"><button class="secondary-button" :disabled="busy" @click="emit('sample', 'main')">体验主图样例 <ArrowUpRight :size="15" /></button><button class="secondary-button" :disabled="busy" @click="emit('sample', 'detail')">体验详情样例 <ArrowUpRight :size="15" /></button></div></section>
  </div>
</template>

<style scoped>
.studio-home{max-width:1320px;margin:0 auto;color:#212522;--muted:#858982;--orange:#e96b4d;--line:#e9e8e3}button,textarea{font:inherit}button{cursor:pointer;transition:background .18s,border-color .18s,transform .18s}button:disabled{opacity:.5;cursor:wait}button:focus-visible,textarea:focus-visible{outline:3px solid #f3aa94;outline-offset:3px}h1,h2,p{margin:0}.page-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;gap:20px}.eyebrow{color:#858982;font-size:10px;letter-spacing:2px;font-weight:600}.page-heading h1{font-size:29px;line-height:1.45;letter-spacing:-1px;font-weight:650;margin:8px 0}.page-heading p{font-size:13px;color:#858982}.workspace-label{font-size:11px;display:flex;align-items:center;gap:8px;color:#737a72;white-space:nowrap}.workspace-label i{width:6px;height:6px;background:#74977b;border-radius:50%}.creative-banner{display:grid;grid-template-columns:1fr 1fr;min-height:338px;background:#eeeae2;border-radius:18px;overflow:hidden;position:relative}.banner-copy{padding:37px 42px;position:relative;z-index:1}.banner-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#7b756b}.banner-copy h2{font-size:37px;line-height:1.35;font-weight:630;letter-spacing:-1.5px;margin:19px 0 15px}.banner-copy p{font-size:13px;line-height:1.8;color:#7c796f;margin-bottom:24px}.primary-button{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:var(--orange);border:1px solid var(--orange);border-radius:8px;color:white;padding:12px 18px;font-size:13px;font-weight:600;min-height:43px}.primary-button:hover:enabled{background:#d95d41;border-color:#d95d41;transform:translateY(-1px)}.primary-button.compact{padding:10px 16px;min-height:38px}.banner-foot{display:flex;align-items:center;gap:5px;color:#8a8174;font-size:10px;margin-top:18px}.banner-visual{position:relative;min-width:0}.banner-visual:before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#eeeae2,transparent 24%);z-index:1}.banner-visual img{width:100%;height:100%;object-fit:cover;object-position:center}.photo-label{position:absolute;right:25px;bottom:25px;z-index:2;font-size:9px;letter-spacing:2px;text-align:right;color:#665e51}.photo-label span{display:block;letter-spacing:0;font-size:12px;margin-top:7px}.brief-composer{background:white;border:1px solid var(--line);border-radius:14px;margin-top:20px;padding:20px 22px;box-shadow:0 5px 20px #24292203}.composer-heading{display:flex;align-items:center;gap:9px}.small-icon{color:var(--orange);display:flex}.composer-heading label{font-size:13px;font-weight:600}.composer-heading>span:last-child{font-size:11px;color:#a1a49c;margin-left:auto}.brief-composer textarea{display:block;resize:vertical;width:100%;min-height:65px;box-sizing:border-box;border:0;background:transparent;outline:none;font-size:13px;line-height:1.8;color:#343a33;padding:15px 0 12px}.brief-composer textarea::placeholder{color:#a1a49c}.composer-footer{display:flex;align-items:center;justify-content:space-between;gap:15px;border-top:1px solid #f2f1ed;padding-top:14px}.segmented{display:flex;gap:4px}.segmented button{display:flex;align-items:center;gap:6px;background:transparent;border:1px solid transparent;padding:7px 10px;border-radius:6px;color:#8c9087;font-size:11px}.segmented button[aria-pressed=true]{background:#f6f3ed;color:#464b40;border-color:#eee9df}.section{margin-top:33px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:17px}.section-heading h2,.sample-section h2{font-size:18px;font-weight:650;letter-spacing:-.3px}.section-heading p,.sample-section p{font-size:11px;color:#969b91;margin-top:6px}.section-caption{font-size:10px;color:#a2a699}.task-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.task-card{background:white;border:1px solid var(--line);border-radius:12px;padding:22px;text-align:left;color:inherit}.task-card:hover:enabled{border-color:#ed9d87;box-shadow:0 5px 20px #3a322106;transform:translateY(-2px)}.task-top{display:flex;align-items:center;justify-content:space-between;color:#b4b7af;margin-bottom:19px}.task-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:12px}.main-icon{background:#fff0e9;color:#dd7656}.detail-icon{background:#ecf3ef;color:#68907c}.template-icon{background:#eeedf4;color:#8a82a1}.task-card strong{font-size:17px;font-weight:600}.task-card p{font-size:11px;color:#979b92;margin-top:8px;line-height:1.7}.task-bottom{display:flex;justify-content:space-between;margin-top:23px;padding-top:14px;border-top:1px solid #f2f1ed;color:#6f7569;font-size:10px;gap:10px}.task-bottom>span{color:#a9afa2}.resume-card{display:flex;align-items:center;gap:17px;background:#f3f0e9;border:1px solid #e9e5dc;border-radius:12px;padding:16px 20px;margin-top:25px}.resume-cover{height:65px;width:65px;border-radius:8px;overflow:hidden;background:#e8e2d7;display:grid;place-items:center;color:#a89984;flex-shrink:0}.resume-cover img{width:100%;height:100%;object-fit:cover}.resume-copy{min-width:0;flex:1}.resume-copy>span{display:flex;align-items:center;gap:8px;font-size:10px;color:#969383}.resume-copy i{height:3px;width:3px;background:#b5b19d;border-radius:50%}.resume-copy em{font-style:normal}.resume-copy em.unsaved{color:#ce7c44}.resume-copy h2{font-size:15px;font-weight:600;margin:6px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resume-copy p{font-size:10px;color:#8c917f}.secondary-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-size:11px;font-weight:550;background:white;border:1px solid #e3e5de;color:#4d5548;padding:10px 14px;border-radius:7px;white-space:nowrap}.secondary-button:hover:enabled{background:#f7f7f2;border-color:#c8cfbe}.text-button{display:inline-flex;align-items:center;gap:7px;font-size:11px;color:#7e8477;background:none;border:0;padding:6px}.text-button:hover{color:var(--orange)}.works-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.work-card{display:block;text-align:left;background:white;border:1px solid var(--line);border-radius:12px;overflow:hidden;color:inherit}.work-card:hover:enabled{border-color:#d5ccbd;transform:translateY(-2px)}.work-art{display:grid;place-items:center;position:relative;aspect-ratio:1.7;background:#efede5;color:#b2a893;overflow:hidden}.work-art>img{width:100%;height:100%;object-fit:cover;transition:transform .35s}.work-card:hover .work-art>img{transform:scale(1.025)}.work-kind{position:absolute;left:14px;top:14px;background:#fffffff0;padding:5px 8px;border-radius:4px;font-size:9px;color:#5b5c51}.work-arrow{display:grid;place-items:center;position:absolute;bottom:12px;right:12px;background:#ffffffd9;width:29px;height:29px;border-radius:50%;color:#565b50}.work-info{display:flex;flex-direction:column;padding:16px 18px}.work-info strong{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.work-info>span{font-size:10px;color:#939788;margin-top:6px}.work-info small{display:flex;align-items:center;gap:5px;font-size:9px;color:#acb0a4;margin-top:14px}.state-panel{display:flex;align-items:center;justify-content:center;gap:16px;min-height:175px;padding:24px;border:1px dashed #dddcd3;border-radius:12px;color:#93998a;font-size:12px;background:#f8f7f2}.state-panel strong{font-size:13px;font-weight:550;color:#676f5d}.state-panel p{font-size:11px;line-height:1.6;margin-top:6px}.state-panel.error{border-color:#edd1c8;background:#fef9f6}.empty-icon{display:grid;place-items:center;background:#eeebe1;padding:14px;border-radius:14px}.sample-section{display:flex;align-items:center;justify-content:space-between;gap:24px;border-top:1px solid #e9e8e1;padding:28px 0 8px;margin-top:35px}.sample-section h2{font-size:16px;margin-top:9px}.sample-actions{display:flex;gap:10px}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.work-card{padding:0}.page-heading p{font-size:14px}.banner-copy p{font-size:14px}.banner-foot{font-size:11px}.composer-heading label{font-size:14px}.composer-heading>span:last-child{font-size:12px}.section-heading p,.sample-section p{font-size:12px}.task-card p{font-size:12px;color:#858d7e}.task-bottom{font-size:11px}.work-info strong{font-size:15px}.work-info>span{font-size:11px;color:#89917e}.work-info small{font-size:10px}.resume-copy h2{font-size:16px}.resume-copy p{font-size:11px}.resume-copy>span{font-size:11px}
@media(min-width:1600px){.creative-banner{min-height:380px}.banner-copy{padding:43px 50px}.banner-copy h2{font-size:42px}}
@media(max-width:1050px){.banner-copy{padding:30px}.banner-copy h2{font-size:31px}.task-card{padding:18px}.task-bottom{flex-direction:column;gap:5px}.sample-section{align-items:flex-start}.sample-actions{flex-direction:column}.section-caption{display:none}}
@media(max-width:700px){.page-heading h1{font-size:24px}.workspace-label{display:none}.creative-banner{grid-template-columns:1.25fr 1fr;min-height:300px}.banner-copy{padding:25px}.banner-copy h2{font-size:27px}.banner-copy p{font-size:11px}.banner-copy .primary-button{font-size:11px;padding:10px}.banner-foot{font-size:8px}.banner-tag{font-size:10px}.photo-label{display:none}.task-grid{grid-template-columns:1fr}.task-card{padding:18px 20px}.task-top{margin-bottom:13px}.task-bottom{flex-direction:row;margin-top:16px}.works-grid{grid-template-columns:1fr 1fr}.work-card:last-child{display:none}.composer-heading>span:last-child{display:none}.resume-card{gap:12px;padding:14px}.resume-cover{width:50px;height:50px}.resume-copy h2{font-size:13px}.resume-card .secondary-button{font-size:10px;padding:9px}.sample-section{flex-direction:column}.sample-actions{flex-direction:row}.state-panel{flex-wrap:wrap;text-align:center}}
@media(max-width:700px){.creative-banner{display:block;min-height:310px;isolation:isolate}.banner-copy{width:min(440px,85%);padding:28px 25px;position:relative;z-index:2}.banner-copy h2{font-size:28px;line-height:1.4;margin-top:18px}.banner-visual{position:absolute;inset:0 0 0 auto;width:70%;height:100%;opacity:.65;z-index:0}.banner-visual:before{background:linear-gradient(90deg,#eeeae2 0%,#eeeae2db 35%,#eeeae244 75%,transparent 100%)}.banner-visual img{object-position:62% center}.banner-copy p{color:#766f62}.banner-foot{font-size:9px;white-space:nowrap}}
@media(max-width:440px){.banner-copy{width:100%;padding:28px 26px}.banner-copy h2{font-size:27px}.banner-visual{display:block;width:80%;opacity:.46}.banner-visual:before{background:linear-gradient(90deg,#eeeae2 0%,#eeeae2e0 36%,#eeeae266 82%,#eeeae23b 100%)}.works-grid{grid-template-columns:1fr}.composer-footer{align-items:stretch;flex-direction:column}.segmented{justify-content:center}.resume-cover{display:none}}
</style>
