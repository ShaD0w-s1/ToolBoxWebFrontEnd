<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";

const props = defineProps<{
  options: string[];
  category: string;
  sub: string;
  store: ToolboxStore;
}>();

const query = ref("");
const open = ref(false);
const activeIndex = ref(0);

/** 比对归一化：小写 + 仅保留中文/字母/数字，与工卡匹配一致的口径。 */
function normalize(text: string): string {
  return (text || "").toLowerCase().replace(/[^一-鿿a-z0-9]/g, "");
}
/** needle 字符按出现顺序全部能在 hay 中找到（不要求连续），用于“近似”匹配。 */
function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/** 无输入时显示全部；有输入时按“包含”或“子序列”模糊给出近似工作名。 */
const filtered = computed(() => {
  const q = normalize(query.value);
  if (!q) return props.options;
  return props.options.filter((key) => {
    const label = normalize(key.replace("||", " "));
    return label.includes(q) || isSubsequence(q, label);
  });
});

function choose(key: string | null): void {
  if (key) props.store.importStandardSub(props.category, props.sub, key);
  query.value = "";
  activeIndex.value = 0;
  open.value = false;
}

function onInput(event: Event): void {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  activeIndex.value = 0;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    open.value = true;
    activeIndex.value = Math.min(filtered.value.length - 1, activeIndex.value + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(0, activeIndex.value - 1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    choose(filtered.value[activeIndex.value] ?? null);
  } else if (event.key === "Escape") {
    open.value = false;
  }
}

function onBlur(): void {
  // 延迟关闭，避免在点击选项（mousedown）前先失焦导致菜单收起
  setTimeout(() => { open.value = false; }, 120);
}
</script>

<template>
  <div class="standard-combo">
    <input
      class="standard-input"
      type="text"
      :value="query"
      placeholder="从标准库替换此工作（输入可模糊搜索）"
      aria-label="从标准库替换此工作"
      @focus="open = true"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <div v-if="open" class="standard-menu">
      <button
        v-for="(key, idx) in filtered"
        :key="key"
        type="button"
        class="standard-option"
        :class="{ active: idx === activeIndex }"
        @mousedown.prevent="choose(key)"
        @mouseenter="activeIndex = idx"
      >{{ key.replace("||", " / ") }}</button>
      <div v-if="!filtered.length" class="standard-empty">无匹配标准工作</div>
    </div>
  </div>
</template>
