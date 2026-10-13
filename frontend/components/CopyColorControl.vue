<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TextColor } from "../../lib/design-model";
import { isCustomTextColor } from "../../lib/text-color";

const props = defineProps<{ id: string; label: string; value: TextColor; disabled: boolean }>();
const emit = defineEmits<{ change: [color: TextColor] }>();
const mode = computed(() => isCustomTextColor(props.value) ? "custom" : props.value);
const customColor = computed(() => isCustomTextColor(props.value) ? props.value : "#262626");
const draft = ref<string>(customColor.value);
const invalid = computed(() => mode.value === "custom" && !isCustomTextColor(draft.value));
watch(() => props.value, () => { draft.value = customColor.value; });

function selectColor(event: Event) {
  if (props.disabled) return;
  const value = (event.target as HTMLSelectElement).value;
  if (value === "custom") emit("change", props.value === "light" ? "#FFFFFF" : "#262626");
  else if (value === "auto" || value === "dark" || value === "light") emit("change", value);
}
function editColor(event: Event) {
  if (props.disabled) return;
  draft.value = (event.target as HTMLInputElement).value.trim().toUpperCase();
  if (isCustomTextColor(draft.value)) emit("change", draft.value);
}
</script>

<template>
  <div class="copy-color-control">
    <label :for="`${id}-mode`">{{ label }}颜色</label>
    <select :id="`${id}-mode`" :value="mode" :disabled="disabled" @change="selectColor">
      <option value="auto">自动对比</option>
      <option value="dark">深色文字</option>
      <option value="light">白色文字</option>
      <option value="custom">自定义颜色</option>
    </select>
    <div v-if="mode === 'custom'" class="copy-color-inputs">
      <input type="color" :value="customColor" :disabled="disabled" :aria-label="`${label}取色器`" @input="editColor" />
      <input type="text" :value="draft" :disabled="disabled" maxlength="7" placeholder="#A76645" autocomplete="off" spellcheck="false" :aria-label="`${label}色值`" :aria-invalid="invalid" :aria-describedby="invalid ? `${id}-error` : undefined" @input="editColor" />
    </div>
    <small v-if="invalid" :id="`${id}-error`" role="alert">请输入完整色值，例如 #A76645；当前颜色已保留。</small>
  </div>
</template>

<style scoped>
.copy-color-control{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px 14px;margin:-3px 0 20px;color:#70767c;font-size:12px;line-height:1.65}
label{font-weight:500}input,select{font:inherit;box-sizing:border-box;min-width:0;border:1px solid #e8e8e5;border-radius:7px;background:#fdfdfb;color:#454b50;padding:9px 10px;min-height:40px;outline-offset:1px}
input:focus-visible,select:focus-visible{outline:3px solid #f3aa9570}.copy-color-inputs{grid-column:1/-1;display:flex;gap:10px}.copy-color-inputs input[type=color]{width:46px;height:40px;flex:none;padding:4px;cursor:pointer}.copy-color-inputs input[type=text]{flex:1;font-family:ui-monospace,monospace;letter-spacing:.6px}.copy-color-inputs input[aria-invalid=true]{border-color:#c8664e}small{grid-column:1/-1;font-size:11px;line-height:1.8;color:#b44c35}input:disabled,select:disabled{opacity:.48;cursor:default}
</style>
