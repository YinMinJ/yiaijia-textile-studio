<script setup lang="ts">
import { computed } from "vue";
import { builtInTextFonts, isTextFont, type TextFont } from "../../lib/design-fonts";

const props = defineProps<{ id: string; label: string; value: TextFont; disabled: boolean; fonts: { id: string; name: string }[] }>();
const emit = defineEmits<{ change: [font: TextFont]; upload: [] }>();
const missing = computed(() => props.value.startsWith("custom:") && !props.fonts.some(font => `custom:${font.id}` === props.value));
function selectFont(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (!props.disabled && isTextFont(value)) emit("change", value);
}
</script>

<template>
  <div class="copy-font-control">
    <label :for="id">{{ label }}字体</label>
    <div class="font-options">
      <select :id="id" :value="value" :disabled="disabled" @change="selectFont">
        <option v-for="font in builtInTextFonts" :key="font.value" :value="font.value">{{ font.label }}</option>
        <option v-if="missing" :value="value">已选自定义字体</option>
        <optgroup v-if="fonts.length" label="我的字体">
          <option v-for="font in fonts" :key="font.id" :value="`custom:${font.id}`">{{ font.name }}</option>
        </optgroup>
      </select>
      <button type="button" :disabled="disabled" :aria-label="`上传${label}字体`" @click="emit('upload')">上传字体</button>
    </div>
  </div>
</template>

<style scoped>
.copy-font-control{display:grid;gap:7px;margin:-3px 0 16px;font-size:12px;color:#70767c;line-height:1.65}label{font-weight:500}.font-options{display:flex;gap:8px}select,button{font:inherit;box-sizing:border-box;border:1px solid #e8e8e5;border-radius:7px;background:#fdfdfb;color:#454b50;min-height:40px;padding:9px 10px}select{min-width:0;flex:1}button{flex:none;color:#a86047;background:#fff7f2;cursor:pointer}select:focus-visible,button:focus-visible{outline:3px solid #f3aa9570;outline-offset:1px}select:disabled,button:disabled{opacity:.48;cursor:default}
</style>
