<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ArrowLeft, ArrowUpRight, Check, CircleHelp, FolderOpen, Image, Layers3, LayoutDashboard, LayoutTemplate, LoaderCircle, LogOut, Menu, Plus, Settings2, ShieldCheck, X } from '@lucide/vue';
import { useStudio, type View } from './useStudio';
import { categories } from '../lib/design-model';
import StudioHome from './components/StudioHome.vue';
import TemplateLibrary from './components/TemplateLibrary.vue';
import WorksLibrary from './components/WorksLibrary.vue';
import AssetsLibrary from './components/AssetsLibrary.vue';
import ProductEditor from './components/ProductEditor.vue';
import ModelSettings from './components/ModelSettings.vue';

const studio=useStudio();
const {view,project,projects,dirty,busy,progress,historyLoading,historyError,modelConfigured,newOpen,newName,newOutput,newCategory,pendingSwitch,pendingIntent,localMode,helpOpen,notice,lastDownload}=studio;
const mobileOpen=ref(false),newDialog=ref<HTMLDialogElement|null>(null),switchDialog=ref<HTMLDialogElement|null>(null),helpDialog=ref<HTMLDialogElement|null>(null);
const nav=[{id:'home',label:'创作工作台',icon:LayoutDashboard},{id:'templates',label:'风格模板',icon:LayoutTemplate},{id:'works',label:'我的作品',icon:FolderOpen},{id:'assets',label:'素材库',icon:Image},{id:'settings',label:'自定义 API',icon:Settings2}] as const;
const title=computed(()=>view.value==='editor'?'商品创作':nav.find(n=>n.id===view.value)?.label||'创作工作台');
watch([view, studio.step], () => { mobileOpen.value=false; window.scrollTo({top:0}); }, {flush:'post'});
function navigate(next:View){view.value=next;mobileOpen.value=false;}
function begin(output:'main'|'detail',brief?:string){studio.startCreation(output,brief);mobileOpen.value=false;}
for(const [state,dialog] of [[newOpen,newDialog],[pendingSwitch,switchDialog],[helpOpen,helpDialog]] as const){
  watch(state,async value=>{await nextTick();if(value&&!dialog.value?.open)dialog.value?.showModal();else if(!value&&dialog.value?.open)dialog.value.close();});
}
function cancelSwitch(){if(!busy.value){pendingSwitch.value=null;navigate('editor');}}
function setConfigBusy(value:boolean){if(value)busy.value='正在处理 API 配置';else if(busy.value==='正在处理 API 配置')busy.value='';}
</script>

<template>
  <div class="studio-layout">
    <button v-if="mobileOpen" class="nav-backdrop" aria-label="收起导航" @click="mobileOpen=false"></button>
    <aside class="studio-sidebar" :class="{'is-open':mobileOpen}">
      <button class="studio-brand" aria-label="织境工作台首页" @click="navigate('home')"><span class="brand-symbol"><Layers3 :size="24" :stroke-width="1.8" /></span><span><b>织境<span class="brand-dot">.</span></b><small>HOME TEXTILE STUDIO</small></span></button>
      <button class="button button-primary sidebar-create" :disabled="!!busy" @click="begin('main')"><Plus :size="18" />新建商品作品</button>
      <span class="nav-caption">工作空间</span>
      <nav class="studio-nav" aria-label="工作台导航"><button v-for="item in nav" :key="item.id" :class="{active:view===item.id}" :aria-current="view===item.id?'page':undefined" @click="navigate(item.id)"><component :is="item.icon" :size="19" :stroke-width="1.7" /><span>{{ item.label }}</span><span v-if="item.id==='works'&&projects.length" class="nav-count">{{ projects.length }}</span></button></nav>
      <div v-if="project" class="sidebar-current"><span>当前作品 <i :class="{unsaved:dirty}"></i></span><button @click="navigate('editor')"><b>{{ project.info.name||'未命名商品' }}</b><ArrowUpRight :size="15" /></button><small>{{ dirty?'有修改尚未保存':project.sample?'内置样例':'继续上次创作' }}</small></div>
      <div class="sidebar-bottom"><button class="sidebar-help" @click="helpOpen=true"><CircleHelp :size="17" />使用帮助<ArrowUpRight :size="14" /></button><button v-if="!localMode" class="sidebar-help" :disabled="!!busy" @click="studio.requestLogout"><LogOut :size="17" />退出登录</button><div class="local-profile"><span class="profile-mark">织</span><span><b>{{ localMode ? '本地工作空间' : '服务器工作空间' }}</b><small><i></i>{{ localMode ? '作品保存在这台电脑' : '作品保存在服务器' }}</small></span></div></div>
    </aside>
    <div class="studio-main">
      <header class="studio-topbar"><div class="topbar-title"><button class="icon-button mobile-toggle" aria-label="打开导航" @click="mobileOpen=!mobileOpen"><Menu :size="21" /></button><span class="topbar-parent">工作空间</span><span class="breadcrumb-slash">/</span><b>{{ title }}</b></div><div class="topbar-tools"><button v-if="project&&view!=='editor'" class="resume-button" @click="navigate('editor')"><ArrowLeft :size="15" />继续编辑<span v-if="dirty" class="unsaved-dot"></span></button><button class="api-status" @click="navigate('settings')"><span :class="{connected:modelConfigured}"></span>{{ modelConfigured?'API 已配置':'配置 API' }}</button><span class="local-badge"><ShieldCheck :size="14" />{{ localMode ? '本地运行' : '服务器运行' }}</span><button class="topbar-avatar" aria-label="使用帮助" @click="helpOpen=true">织</button></div></header>
      <div v-if="busy&&view!=='editor'" class="global-progress" role="status"><LoaderCircle :size="16" class="spin" /><span>{{ busy }}</span><progress v-if="progress>0" :value="progress" max="100"></progress></div>
      <main class="studio-content" :class="{'editor-content':view==='editor'}">
        <StudioHome v-if="view==='home'" :projects="projects" :current-project="project" :dirty="dirty" :busy="!!busy" :history-loading="historyLoading" :history-error="historyError" @create="begin" @templates="navigate('templates')" @open="studio.openProject" @resume="navigate('editor')" @sample="studio.openSample" @retry="studio.loadProjects" @all-works="navigate('works')" />
        <TemplateLibrary v-else-if="view==='templates'" :current-project="project" :busy="!!busy" @use="studio.useLibraryTemplate" />
        <WorksLibrary v-else-if="view==='works'" :projects="projects" :loading="historyLoading" :error="historyError" :busy="!!busy" @open="studio.openProject" @create="begin('main')" @retry="studio.loadProjects" />
        <AssetsLibrary v-else-if="view==='assets'" :projects="projects" :busy="!!busy" @create="begin('main')" />
        <ModelSettings v-else-if="view==='settings'" :busy="!!busy" @configured="modelConfigured=$event" @busy="setConfigBusy" @notice="studio.notify($event)" />
        <ProductEditor v-else-if="view==='editor'&&project" :studio="studio" />
      </main>
    </div>
    <Transition name="toast"><div v-if="notice" :key="notice.id" class="notice-toast" :class="notice.type" role="status"><Check v-if="notice.type==='success'" :size="19" /><CircleHelp v-else :size="19" /><p>{{ notice.message }}</p><button class="icon-button" aria-label="关闭提示" @click="notice=null"><X :size="16" /></button></div></Transition>
    <div v-if="lastDownload" class="download-ready"><Check :size="17" /><span>文件已准备好</span><a :href="lastDownload.url" :download="lastDownload.name">下载 {{ lastDownload.name }}</a><button class="icon-button" aria-label="收起下载提示" @click="lastDownload=null"><X :size="15" /></button></div>

    <dialog ref="newDialog" class="studio-dialog" aria-labelledby="new-product-title" @cancel="busy?$event.preventDefault():newOpen=false"><form @submit.prevent="studio.createProject"><div class="dialog-heading"><span class="dialog-icon"><Plus :size="25" /></span><button type="button" class="icon-button" aria-label="关闭新建商品" :disabled="!!busy" @click="newOpen=false"><X :size="21" /></button></div><p class="eyebrow">开始创作</p><h2 id="new-product-title">先认识这款好商品</h2><p class="dialog-description">选择制作内容，上传实拍，再让商品的细节说话。</p><label class="field-label">商品名称<input v-model="newName" autofocus required maxlength="40" placeholder="例如：华夫格大豆被" /></label><span class="field-label">商品类目</span><div class="dialog-choices"><button v-for="category in categories" :key="category.id" type="button" :class="{selected:newCategory===category.id}" :aria-pressed="newCategory===category.id" @click="newCategory=category.id"><span>{{ category.name }}</span><Check v-if="newCategory===category.id" :size="16" /></button></div><span class="field-label">这次制作</span><div class="dialog-choices"><button type="button" :class="{selected:newOutput==='main'}" :aria-pressed="newOutput==='main'" @click="newOutput='main'"><span>商品主图<small>5 张 · 1200 × 1200</small></span><Check v-if="newOutput==='main'" :size="16" /></button><button type="button" :class="{selected:newOutput==='detail'}" :aria-pressed="newOutput==='detail'" @click="newOutput='detail'"><span>商品详情<small>7 张 · 宽 790</small></span><Check v-if="newOutput==='detail'" :size="16" /></button></div><button class="button button-primary dialog-submit" :disabled="!newName.trim()||!!busy">创建并导入素材<ArrowUpRight :size="17" /></button><button type="button" class="sample-link" :disabled="!!busy" @click="newOpen=false;studio.openSample(newOutput)">先用内置样例体验一下</button></form></dialog>
    <dialog ref="switchDialog" class="studio-dialog switch-dialog" aria-labelledby="switch-title" @cancel="busy?$event.preventDefault():pendingSwitch=null"><p class="eyebrow">保留创作</p><h2 id="switch-title">保存当前修改？</h2><p class="dialog-description">「{{ project?.info.name||'当前商品' }}」有未保存的修改。保存后，下次还能接着做。</p><div class="dialog-actions"><button class="button" :disabled="!!busy" @click="cancelSwitch">继续编辑</button><button class="button" :disabled="!!busy" @click="studio.finishProjectSwitch(false)">{{ pendingIntent === 'logout' ? '不保存，退出' : '不保存，切换' }}</button><button class="button button-primary" :disabled="!!busy" @click="studio.finishProjectSwitch(true)">{{ pendingIntent === 'logout' ? '保存并退出' : '保存并切换' }}</button></div></dialog>
    <dialog ref="helpDialog" class="studio-dialog help-dialog" aria-labelledby="help-title" @cancel="helpOpen=false"><div class="dialog-heading"><span class="eyebrow">从实拍到一套好图</span><button class="icon-button" aria-label="关闭使用帮助" @click="helpOpen=false"><X :size="21" /></button></div><h2 id="help-title">四步完成商品创作</h2><ol class="help-steps"><li><b>导入真实商品素材</b><p>一张照片就能开始；整体与细节照片越充分，表达越完整。</p></li><li><b>选择风格，安排内容</b><p>填写真实卖点，首图文案自己写，其余文案可交给模型生成。</p></li><li><b>先确认首图，再做整套</b><p>可选实拍排版或 AI 优化；换图、改字、裁切都可调整。</p></li><li><b>保存作品，导出上新</b><p>主图 1200 × 1200，详情宽 790。已保存作品可随时继续编辑。</p></li></ol><button class="button button-primary dialog-submit" @click="helpOpen=false">开始创作</button></dialog>
  </div>
</template>
