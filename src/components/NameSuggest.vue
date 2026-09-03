<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

const props = defineProps<{
  modelValue: string;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  /** 追加到内部 textarea 的 class（供宿主按布局微调，如 sp-cell 系列）。 */
  textareaClass?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [string] }>();

const ta = ref<HTMLTextAreaElement | null>(null);
const show = ref(false);
const cur = ref(""); // 当前正在输入的词（光标前最后一个名字）

const matched = computed<string[]>(() => {
  const w = cur.value.trim().toLowerCase();
  if (!w) return [];
  return props.suggestions
    .filter((s) => s && s.toLowerCase().includes(w) && s !== cur.value.trim())
    .slice(0, 8);
});

function updateWord(val: string): void {
  const el = ta.value;
  if (!el) return;
  const pos = el.selectionStart ?? val.length;
  const before = val.slice(0, pos);
  const m = before.match(/[^\s,、，/]+$/);
  cur.value = m ? m[0] : "";
  show.value = matched.value.length > 0;
}

function onInput(e: Event): void {
  const val = (e.target as HTMLTextAreaElement).value;
  emit("update:modelValue", val);
  updateWord(val);
}

function onFocus(e: Event): void {
  updateWord((e.target as HTMLTextAreaElement).value);
}

function pick(name: string): void {
  const el = ta.value;
  if (!el) return;
  const val = props.modelValue;
  const pos = el.selectionStart ?? val.length;
  const before = val.slice(0, pos);
  const after = val.slice(pos);
  const m = before.match(/[^\s,、，/]+$/);
  const start = m ? pos - m[0].length : pos;
  const next = before.slice(0, start) + name + after;
  emit("update:modelValue", next);
  cur.value = "";
  show.value = false;
  nextTick(() => {
    el.focus();
    const p = before.slice(0, start).length + name.length;
    el.setSelectionRange(p, p);
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") show.value = false;
}

function blurHide(): void {
  // 延迟隐藏，让点击下拉项先触发
  setTimeout(() => { show.value = false; }, 180);
}
</script>

<template>
  <div class="ns-wrap">
    <textarea
      ref="ta"
      class="ns-input textwrap"
      :class="textareaClass"
      rows="1"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @focus="onFocus"
      @keydown="onKeydown"
      @blur="blurHide"
    ></textarea>
    <ul v-if="show && matched.length" class="ns-list">
      <li v-for="s in matched" :key="s" @mousedown.prevent="pick(s)">{{ s }}</li>
    </ul>
  </div>
</template>

<style scoped>
.ns-wrap { position: relative; flex: 1 1 0; min-width: 0; width: 100%; }
.ns-input {
  width: 100%; min-height: 28px; padding: 0 6px; border: 1px solid var(--line, var(--n4));
  border-radius: var(--r-sm); font-size: var(--fs-13); background: var(--n0); resize: none; overflow: hidden;
  line-height: 1.4; word-break: break-word; overflow-wrap: break-word; white-space: pre-wrap;
  font-family: inherit; box-sizing: border-box; field-sizing: content; display: block;
}
.ns-input:focus { border-color: var(--focus); outline: none; }
.ns-list {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 3000; margin: 2px 0 0; padding: 4px;
  list-style: none; background: var(--n0); border: 1px solid var(--line, var(--n4)); border-radius: var(--r-md);
  box-shadow: 0 8px 24px rgba(0,0,0,.12); max-height: 220px; overflow-y: auto;
}
.ns-list li { padding: 6px 10px; font-size: var(--fs-13); color: var(--blue-dark, var(--blue-dark)); border-radius: var(--r-sm); cursor: pointer; }
.ns-list li:hover { background: var(--blue-light, var(--blue-light)); }
</style>
