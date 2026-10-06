<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { LoaderCircle, ImageOff } from "@lucide/vue";
import { dimensions, type DesignModule, type Project } from "../../lib/design-model";
import { drawDesign } from "../../lib/design-renderer";

const props = withDefaults(defineProps<{ project: Project; module: DesignModule; large?: boolean }>(), { large: false });
const canvas = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);
const error = ref("");
const size = computed(() => dimensions(props.module));
let revision = 0;
watch(() => [props.project, props.module, props.large, canvas.value], async () => {
  if (!canvas.value) return;
  const ticket = ++revision;
  loading.value = true;
  error.value = "";
  const buffer = document.createElement("canvas");
  try {
    await drawDesign(buffer, props.project, props.module, props.large ? 1 : 0.55);
    if (ticket !== revision || !canvas.value) return;
    canvas.value.width = buffer.width;
    canvas.value.height = buffer.height;
    canvas.value.getContext("2d")?.drawImage(buffer, 0, 0);
  } catch (e) {
    if (ticket === revision) error.value = e instanceof Error ? e.message : "图片暂时无法排版";
  } finally {
    if (ticket === revision) loading.value = false;
    buffer.width = buffer.height = 1;
  }
}, { deep: true, flush: "post", immediate: true });
onBeforeUnmount(() => { revision++; });
</script>

<template>
  <div class="canvas-preview" :style="{ aspectRatio: `${size.width}/${size.height}` }" :aria-busy="loading">
    <canvas ref="canvas" :aria-label="`${module.kind === 'main' ? '主图' : '详情'} ${module.index}：${module.title}`" />
    <span v-if="loading" class="canvas-state"><LoaderCircle :size="20" class="spin" />正在排版</span>
    <span v-else-if="error" class="canvas-state error" role="alert"><ImageOff :size="20" />{{ error }}</span>
  </div>
</template>

<style scoped>
.canvas-preview{position:relative;overflow:hidden;background:#f7f2e9;width:100%;border-radius:inherit}
canvas{display:block;width:100%;height:100%;object-fit:contain}
.canvas-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;background:rgba(248,246,240,.85);color:#827367;font-size:13px;padding:24px;text-align:center}
.canvas-state.error{color:#a33e35}
.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
</style>
