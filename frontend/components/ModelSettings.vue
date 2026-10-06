<script setup lang="ts">
import { appPath } from '../../lib/app-path';
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, CircleHelp, FlaskConical, KeyRound, LoaderCircle, PlugZap, Save, ShieldCheck } from "@lucide/vue";
import type { ImageQuality, ImageResolution } from "../../lib/model-connection";

type Configuration = {
  configured: boolean;
  protocol?: "custom";
  baseUrl?: string;
  model?: string;
  textModel?: string;
  imageQuality?: ImageQuality;
  imageResolution?: ImageResolution;
  keyHint?: string;
};

const props = withDefaults(defineProps<{ signedIn?: boolean; busy?: boolean }>(), {
  signedIn: true,
  busy: false,
});
const emit = defineEmits<{
  configured: [configured: boolean];
  busy: [busy: boolean];
  notice: [message: string];
}>();

const baseUrl = ref("");
const imageModel = ref("");
const textModel = ref("");
const imageQuality = ref<ImageQuality>("auto");
const imageResolution = ref<ImageResolution>("1k");
const apiKey = ref("");
const keyHint = ref("");
const configured = ref(false);
const busyMessage = ref("");
const loading = ref(true);
const error = ref("");
const connectionMessage = ref("");
const savedMessage = ref("");
const testImage = ref("");
const controller = new AbortController();
const locked = computed(() => props.busy || !!busyMessage.value || loading.value);
const imageSizeHint = computed(() => {
  const square = imageResolution.value === "2k" ? "2048 × 2048" : "1024 × 1024";
  try {
    if (new URL(baseUrl.value).hostname === "api.b.ai" && imageModel.value.toLowerCase() === "gpt-image-2") {
      const portrait = imageResolution.value === "2k" ? "1536 × 2048" : "1024 × 1536";
      return `主图 ${square}，详情摄影素材 ${portrait}。实际返回尺寸以服务商为准。`;
    }
  } catch { /* An unfinished URL is still editable. */ }
  return `摄影素材请求 ${square}；自定义服务商需支持所选尺寸。`;
});
let disposed = false;

function clearResults() {
  testImage.value = "";
  connectionMessage.value = "";
  savedMessage.value = "";
  error.value = "";
}

function setBusy(message: string) {
  busyMessage.value = message;
  if (!disposed) emit("busy", !!message);
}

function changeBaseUrl() {
  apiKey.value = "";
  keyHint.value = "";
  configured.value = false;
  emit("configured", false);
  clearResults();
}

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

async function responseJSON<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`接口返回格式异常（HTTP ${response.status}），请检查 API 地址。`);
  }
}

async function loadConfiguration() {
  if (!props.signedIn) {
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const response = await fetch(appPath("/api/model-settings"), { signal: controller.signal });
    const data = await responseJSON<Configuration & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "读取模型配置失败");
    configured.value = data.configured;
    baseUrl.value = data.configured ? data.baseUrl || "" : "";
    imageModel.value = data.configured ? data.model || "" : "";
    textModel.value = data.configured ? data.textModel || "" : "";
    imageQuality.value = data.imageQuality || "auto";
    imageResolution.value = data.imageResolution || "1k";
    keyHint.value = data.configured ? data.keyHint || "" : "";
    emit("configured", data.configured);
  } catch (caught) {
    if (!controller.signal.aborted) error.value = errorMessage(caught, "读取模型配置失败");
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<boolean> {
  if (locked.value) return false;
  if (!props.signedIn) {
    error.value = "请登录后配置自定义 API。";
    return false;
  }
  clearResults();
  if (!apiKey.value.trim() && !configured.value) {
    error.value = "请填写当前服务商的 API Key 后保存或测试。";
    return false;
  }
  setBusy("正在加密保存配置…");
  try {
    const response = await fetch(appPath("/api/model-settings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        baseUrl: baseUrl.value,
        model: imageModel.value,
        textModel: textModel.value,
        imageQuality: imageQuality.value,
        imageResolution: imageResolution.value,
        apiKey: apiKey.value,
      }),
    });
    const data = await responseJSON<Configuration & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "保存失败");
    configured.value = true;
    baseUrl.value = data.baseUrl || "";
    imageModel.value = data.model || "";
    textModel.value = data.textModel || "";
    imageQuality.value = data.imageQuality || "auto";
    imageResolution.value = data.imageResolution || "1k";
    keyHint.value = data.keyHint || "";
    apiKey.value = "";
    emit("configured", true);
    savedMessage.value = "自定义 API 配置已加密保存";
    emit("notice", savedMessage.value);
    return true;
  } catch (caught) {
    if (!controller.signal.aborted) error.value = errorMessage(caught, "保存失败");
    return false;
  } finally {
    setBusy("");
  }
}

async function checkConnection() {
  if (!(await save())) return;
  setBusy("正在检测接口和模型列表…");
  try {
    const response = await fetch(appPath("/api/model-settings/test"), { method: "POST", signal: controller.signal });
    const data = await responseJSON<{ message?: string; error?: string }>(response);
    if (!response.ok) throw new Error(data.error || "连接检测失败");
    connectionMessage.value = data.message || "连接检测完成";
  } catch (caught) {
    if (!controller.signal.aborted) error.value = errorMessage(caught, "连接检测失败");
  } finally {
    setBusy("");
  }
}

async function testSingleImage() {
  if (!(await save())) return;
  setBusy("正在试生成 1 张图片，请保持页面打开…");
  try {
    const source = await fetch(appPath("/samples/00224.jpg"), { signal: controller.signal });
    if (!source.ok) throw new Error("测试素材读取失败");
    const form = new FormData();
    form.append("image", await source.blob(), "sample-quilt.jpg");
    form.set("test", "true");
    const response = await fetch(appPath("/api/generate-image"), {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const data = await responseJSON<{ asset?: { url: string }; error?: string }>(response);
    if (!response.ok || !data.asset) throw new Error(data.error || "接口未返回可用图片");
    testImage.value = data.asset.url;
    emit("notice", "图片接口已真实返回结果，请检查商品还原效果。");
  } catch (caught) {
    if (!controller.signal.aborted) error.value = errorMessage(caught, "试生成失败");
  } finally {
    setBusy("");
  }
}

onMounted(() => void loadConfiguration());
watch(() => props.signedIn, (value, oldValue) => {
  if (value && !oldValue) void loadConfiguration();
});
onBeforeUnmount(() => {
  disposed = true;
  controller.abort();
  // Only release a configuration task owned by this panel. Navigating away
  // from the panel must not clear an image/copy task already running elsewhere.
  if (busyMessage.value) emit("busy", false);
});
</script>

<template>
  <section class="model-settings">
    <header class="settings-heading">
      <div>
        <p class="settings-eyebrow">MODEL CONNECTION</p>
        <h1>让模型成为你的设计助手</h1>
        <p>连接自己的 API，分别为商品图片和文案选择合适的模型。</p>
      </div>
      <span class="connection-badge" :class="{ connected: configured }">
        <span />{{ configured ? "已保存配置" : "等待连接" }}
      </span>
    </header>

    <div class="settings-layout">
      <form class="configuration-card" @submit.prevent="save">
        <div class="card-heading">
          <span class="card-icon"><KeyRound :size="20" /></span>
          <div><h2>自定义 API</h2><p>使用兼容 OpenAI 的服务商接口</p></div>
        </div>

        <div v-if="loading" class="settings-feedback" role="status"><LoaderCircle :size="16" class="spin" />正在读取已保存配置…</div>
        <a v-if="!signedIn" class="button secondary" :href="appPath('/login')" target="_top">登录后配置 API</a>

        <label class="settings-field">
          <span>API Base URL</span>
          <input v-model="baseUrl" type="url" :disabled="locked" autocomplete="off" :spellcheck="false" placeholder="https://api.example.com/v1" required @input="changeBaseUrl" />
          <small>只填域名会补上 /v1，也可以填写完整的 /images/edits 地址。</small>
        </label>

        <div class="model-fields">
          <label class="settings-field">
            <span>图像模型</span>
            <input v-model="imageModel" :disabled="locked" maxlength="100" :spellcheck="false" placeholder="支持图片编辑的模型 ID" required @input="clearResults" />
            <small>用于优化实拍、制作商品主图和场景图。</small>
          </label>
          <label class="settings-field">
            <span>文案模型</span>
            <input v-model="textModel" :disabled="locked" maxlength="100" :spellcheck="false" placeholder="例如 deepseek-v4.1-flash" @input="clearResults" />
            <small>首图由你填写，其余图片可自动编写文案。</small>
          </label>
        </div>

        <div class="model-fields">
          <label class="settings-field">
            <span>图片质量</span>
            <select v-model="imageQuality" :disabled="locked" @change="clearResults">
              <option value="auto">自动 · 服务商默认</option>
              <option value="high">高 · 细节优先</option>
              <option value="medium">中 · 平衡质量与速度</option>
              <option value="low">低 · 快速预览</option>
            </select>
            <small>自动档不额外发送 quality；其余档位需服务商支持。</small>
          </label>
          <label class="settings-field">
            <span>摄影素材尺寸</span>
            <select v-model="imageResolution" :disabled="locked" @change="clearResults">
              <option value="1k">1K · 常规</option>
              <option value="2k">2K · 精细</option>
            </select>
            <small>{{ imageSizeHint }}</small>
          </label>
        </div>
        <p class="quality-note">高质量与 2K 素材可能需要数分钟，也会增加费用，请保持页面打开。更换服务商后，请确认其支持所选 quality 和 size 参数。</p>

        <label class="settings-field">
          <span>API Key <span v-if="configured && keyHint" class="saved-key">已保存 · 末四位 {{ keyHint }}</span></span>
          <input v-model="apiKey" type="password" :disabled="locked" autocomplete="new-password" :spellcheck="false" :placeholder="configured ? '留空即可保留当前密钥' : '输入服务商提供的 API Key'" @input="clearResults" />
          <small><ShieldCheck :size="13" />密钥由后端加密保存；更换接口地址时，请重新填写对应密钥。</small>
        </label>

        <div class="settings-actions">
          <button type="submit" class="button primary" :disabled="locked"><Save :size="16" />保存配置</button>
          <button type="button" class="button secondary" :disabled="locked || !imageModel || !baseUrl" @click="checkConnection"><PlugZap :size="16" />检测连接</button>
        </div>
        <p class="action-hint">保存配置不会生成内容。连接检测只读取模型列表。</p>

        <div v-if="busyMessage" class="settings-feedback" role="status"><LoaderCircle :size="16" class="spin" />{{ busyMessage }}</div>
        <div v-else-if="connectionMessage || savedMessage" class="settings-feedback success" role="status"><Check :size="16" />{{ connectionMessage || savedMessage }}</div>
        <div v-if="error" class="settings-feedback error" role="alert">{{ error }}</div>

        <div class="single-image-test">
          <div><h3>试试看商品还原效果</h3><p>使用内置被子实拍生成 1 张图片，可能产生服务商费用。</p></div>
          <button type="button" class="button secondary" :disabled="locked || !imageModel || !baseUrl" @click="testSingleImage"><FlaskConical :size="16" />生成 1 张测试图</button>
        </div>
        <figure v-if="testImage" class="test-result"><img :src="appPath(testImage)" alt="API 实际返回的被子试生成结果" /><figcaption>真实接口返回结果 · 检查材质、颜色与商品形态</figcaption></figure>
      </form>

      <aside class="settings-guide">
        <div class="guide-icon"><CircleHelp :size="22" /></div>
        <h2>连接前，准备这三项</h2>
        <ol>
          <li><span>01</span><div><strong>接口地址</strong><p>从服务商复制 API 地址。图片和文案使用同一个服务商及密钥。</p></div></li>
          <li><span>02</span><div><strong>准确的模型 ID</strong><p>图片模型需要支持 /images/edits，文案模型需要支持 /chat/completions。</p></div></li>
          <li><span>03</span><div><strong>你的 API Key</strong><p>生成费用由对应服务商账户承担。页面只展示已保存密钥的末四位。</p></div></li>
        </ol>
        <div class="guide-note"><ShieldCheck :size="17" /><p>你的首图文案始终由你掌握。自动文案会保留首图标题和说明，其他图片也能逐张调整。</p></div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.model-settings { max-width: 1240px; margin: 0 auto; color: var(--ink, #242422); }
.settings-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
.settings-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--accent, #e77843); margin: 0 0 12px; }
.settings-heading h1 { font-size: clamp(24px, 2vw, 32px); letter-spacing: -0.04em; font-weight: 600; margin: 0 0 12px; }
.settings-heading p:not(.settings-eyebrow) { color: var(--muted, #858581); margin: 0; font-size: 14px; line-height: 1.7; }
.connection-badge { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 24px; border: 1px solid var(--border, #e9e8e4); background: var(--surface, #fff); font-size: 12px; white-space: nowrap; color: var(--muted, #858581); }
.connection-badge > span { width: 6px; height: 6px; border-radius: 50%; background: #aca9a0; }
.connection-badge.connected { color: #53816c; }
.connection-badge.connected > span { background: #75a78c; }
.settings-layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; align-items: start; gap: 24px; }
.configuration-card { background: var(--surface, #fff); border: 1px solid var(--border, #e9e8e4); border-radius: 20px; padding: 30px; box-shadow: 0 4px 24px #21201d03; }
.card-heading { display: flex; align-items: center; gap: 14px; padding-bottom: 25px; margin-bottom: 25px; border-bottom: 1px solid var(--border, #e9e8e4); }
.card-icon, .guide-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; color: var(--accent, #e77843); background: #fff1e9; }
.card-heading h2, .settings-guide h2 { font-size: 17px; font-weight: 600; margin: 0 0 6px; }
.card-heading p { margin: 0; color: var(--muted, #858581); font-size: 12px; }
.settings-field { display: grid; gap: 9px; margin-bottom: 23px; }
.settings-field > span { font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.settings-field input, .settings-field select { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; color: var(--ink, #242422); border: 1px solid var(--border, #e9e8e4); border-radius: 9px; background: #fcfcfa; padding: 13px 14px; outline: none; transition: border-color .15s, box-shadow .15s; }
.settings-field input:focus, .settings-field select:focus { border-color: var(--accent, #e77843); box-shadow: 0 0 0 3px #e7784310; }
.settings-field input::placeholder { color: #aba9a3; }
.settings-field input:disabled, .settings-field select:disabled { opacity: .6; cursor: not-allowed; }
.settings-field small { display: flex; align-items: flex-start; gap: 5px; font-size: 11px; color: var(--muted, #858581); line-height: 1.6; }
.settings-field small svg { flex-shrink: 0; margin-top: 2px; }
.saved-key { color: #7c8c80; font-size: 11px; font-weight: 400; }
.model-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.quality-note { margin: -8px 0 23px; padding: 10px 12px; border-radius: 8px; background: #f7f6f2; color: var(--muted, #858581); font-size: 11px; line-height: 1.7; }
.settings-actions { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 4px; }
.button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; border-radius: 9px; padding: 12px 18px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; line-height: 1.4; text-decoration: none; transition: background .15s, transform .15s; }
.button.primary { color: #fff; background: var(--accent, #e77843); }
.button.primary:hover:not(:disabled) { filter: brightness(.96); }
.button.secondary { color: var(--ink, #242422); background: #fff; border-color: var(--border, #e9e8e4); }
.button.secondary:hover:not(:disabled) { background: #f7f6f2; }
.button:disabled { opacity: .45; cursor: not-allowed; }
.button:focus-visible { outline: 2px solid var(--accent, #e77843); outline-offset: 3px; }
.action-hint { color: var(--muted, #858581); font-size: 11px; margin: 12px 0 0; line-height: 1.6; }
.settings-feedback { display: flex; align-items: center; gap: 9px; border-radius: 9px; background: #f7f6f2; padding: 12px 14px; margin: 18px 0 0; color: var(--muted, #858581); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.settings-feedback.success { background: #f0f7f2; color: #53816c; }
.settings-feedback.error { background: #fff0ed; color: #b35e47; }
.single-image-test { display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px solid var(--border, #e9e8e4); padding-top: 25px; margin-top: 28px; }
.single-image-test h3 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
.single-image-test p { max-width: 300px; color: var(--muted, #858581); font-size: 11px; line-height: 1.7; margin: 0; }
.single-image-test button { flex-shrink: 0; }
.test-result { margin: 24px 0 0; }
.test-result img { width: min(100%, 360px); display: block; border-radius: 12px; }
.test-result figcaption { color: var(--muted, #858581); font-size: 11px; margin-top: 10px; }
.settings-guide { padding: 25px 5px; }
.guide-icon { margin-bottom: 18px; }
.settings-guide h2 { font-size: 16px; margin-bottom: 25px; }
.settings-guide ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 23px; }
.settings-guide li { display: flex; gap: 13px; }
.settings-guide li > span { font-size: 10px; font-weight: 600; color: var(--accent, #e77843); padding-top: 3px; }
.settings-guide li strong { font-size: 12px; font-weight: 600; }
.settings-guide li p { font-size: 11px; line-height: 1.9; color: var(--muted, #858581); margin: 7px 0 0; overflow-wrap: anywhere; }
.guide-note { display: flex; align-items: flex-start; gap: 10px; background: #f0efe9; border-radius: 12px; padding: 16px; margin-top: 27px; }
.guide-note svg { color: #97958b; flex-shrink: 0; margin-top: 3px; }
.guide-note p { color: #838176; font-size: 11px; line-height: 1.9; margin: 0; }
.spin { animation: settings-spin 1s linear infinite; flex-shrink: 0; }
@keyframes settings-spin { to { transform: rotate(360deg); } }
@media (max-width: 1050px) { .settings-layout { grid-template-columns: minmax(0, 1fr); } .settings-guide { padding: 10px 8px; } .settings-guide ol { grid-template-columns: repeat(3, 1fr); } .guide-note { max-width: 650px; } }
@media (max-width: 680px) { .settings-heading { align-items: flex-start; gap: 14px; } .settings-heading h1 { font-size: 24px; line-height: 1.35; } .connection-badge { padding: 8px 10px; } .configuration-card { padding: 22px 18px; border-radius: 14px; } .model-fields { grid-template-columns: 1fr; gap: 0; } .single-image-test { align-items: flex-start; flex-direction: column; } .settings-guide ol { grid-template-columns: 1fr; } }
</style>
