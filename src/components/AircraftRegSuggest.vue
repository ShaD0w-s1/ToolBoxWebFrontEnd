<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  modelValue: string;
  /** 候选机号全量列表（组件内做包含匹配 + 前缀命中优先）。 */
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  /** 联想最多显示条数（默认 6）。 */
  maxMatch?: number;
}>();
const emit = defineEmits<{ "update:modelValue": [string]; input: []; change: [] }>();

const inp = ref<HTMLInputElement | null>(null);
const show = ref(false);
const active = ref(-1);

/** 联想结果：包含匹配、前缀命中优先、稳定排序，最多 maxMatch 条（机号格需求=6）。 */
const matched = computed<string[]>(() => {
  const w = (props.modelValue || "").trim().toLowerCase();
  if (!w) return [];
  const pool = props.suggestions || [];
  const hit = pool.filter((s) => s && s.toLowerCase().includes(w));
  hit.sort((a, b) => {
    const ap = a.toLowerCase().startsWith(w) ? 0 : 1;
    const bp = b.toLowerCase().startsWith(w) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b);
  });
  const top = Math.max(1, props.maxMatch ?? 6);
  return hit.slice(0, top);
});

function onInput(): void {
  emit("update:modelValue", inp.value?.value ?? "");
  emit("input"); // 透传宿主 @input（防抖落盘 queuePersist 等）
  show.value = true;
  active.value = -1;
}
/** 内层 input 原生 change（失焦且值变化）→ 透传给宿主触发机号回填。 */
function onNativeChange(): void {
  emit("change");
}
function pick(s: string): void {
  emit("update:modelValue", s);
  show.value = false;
  active.value = -1;
  // 选完即失焦：触发 native change → 宿主机号回填（与手输后点走一致）
  inp.value?.blur();
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") { show.value = false; active.value = -1; return; }
  if (!matched.value.length) return;
  if (e.key === "ArrowDown") { e.preventDefault(); active.value = (active.value + 1) % matched.value.length; }
  else if (e.key === "ArrowUp") { e.preventDefault(); active.value = active.value <= 0 ? matched.value.length - 1 : active.value - 1; }
  else if (e.key === "Enter") {
    if (active.value >= 0) { e.preventDefault(); pick(matched.value[active.value]); }
    else show.value = false;
  }
}
function blurHide(): void {
  // 延迟隐藏：浮层项用 mousedown.prevent（不触发 blur）先完成选择
  setTimeout(() => { show.value = false; active.value = -1; }, 160);
}
</script>

<template>
  <div class="ars-wrap">
    <input
      ref="inp"
      class="ars-input"
      type="text"
      autocomplete="off"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @focus="show = true"
      @keydown="onKeydown"
      @change="onNativeChange"
      @blur="blurHide"
    />
    <ul v-if="show && matched.length" class="ars-list">
      <li
        v-for="(s, i) in matched"
        :key="s"
        :class="{ active: i === active }"
        @mousedown.prevent="pick(s)"
      >{{ s }}</li>
    </ul>
  </div>
</template>

<style scoped>
.ars-wrap { position: relative; width: 100%; min-width: 0; display: block; }
.ars-input {
  width: 100%; box-sizing: border-box; padding: 6px 8px; min-height: 30px;
  border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm);
  font-size: var(--fs-13, 13px); font-family: inherit; color: inherit;
  background: var(--n0); line-height: 1.4;
}
.ars-input:focus { border-color: var(--focus); outline: none; }
.ars-input:disabled { opacity: .7; }
.ars-list {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 3000;
  margin: 2px 0 0; padding: 4px; list-style: none; background: var(--n0);
  border: 1px solid var(--line, var(--n4)); border-radius: var(--r-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .12); max-height: 230px; overflow-y: auto;
  text-align: left;
}
.ars-list li {
  padding: 6px 10px; font-size: var(--fs-13); color: var(--blue-dark);
  border-radius: var(--r-sm); cursor: pointer; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.ars-list li:hover,
.ars-list li.active { background: var(--blue-light, #eaf1fa); }
</style>
