<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";

const props = defineProps<{
  options: string[];
  category: string;
  sub: string;
  store: ToolboxStore;
  /** true=航材清单“类型”模式（调用 mImportStandardSub / mRenameSub）；false/缺省=工具清单“工作”模式。 */
  material?: boolean;
}>();

const query = ref(props.sub);
const open = ref(false);
const activeIndex = ref(0);

/** 工作名外部变更时同步（导入替换后 sub 会变）。 */
watch(() => props.sub, (v) => { query.value = v; });

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

/** 无输入或与当前名相同时显示全部；有输入时按“包含”或“子序列”模糊给出近似名。 */
const filtered = computed(() => {
  const q = normalize(query.value);
  if (!q || q === normalize(props.sub)) return props.options;
  return props.options.filter((key) => {
    const label = normalize(key.replace("||", " "));
    return label.includes(q) || isSubsequence(q, label);
  });
});

/** 选中标准库项：导入替换当前卡片物品，名称变为标准库名。工具的“工作”调 importStandardSub，航材的“类型”调 mImportStandardSub。 */
function choose(key: string | null): void {
  if (key) {
    if (props.material) props.store.mImportStandardSub(props.category, props.sub, key);
    else props.store.importStandardSub(props.category, props.sub, key);
    const sourceSub = key.split("||")[1] || "";
    query.value = sourceSub;
  }
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
    if (filtered.value.length) choose(filtered.value[activeIndex.value] ?? null);
  } else if (event.key === "Escape") {
    open.value = false;
  }
}

/** 失焦时：若未选标准库项且文字与原名不同，则改名（工具 mMaterial 反之亦然）。 */
function onBlur(): void {
  setTimeout(() => {
    open.value = false;
    const name = query.value.trim();
    if (name && name !== props.sub) {
      if (props.material) props.store.mRenameSub(props.category, props.sub, name);
      else props.store.renameSub(props.category, props.sub, name);
    } else if (!name) {
      // 清空则恢复原名
      query.value = props.sub;
    }
  }, 120);
}
</script>

<template>
  <div class="standard-combo">
    <input
      class="standard-input sub-name-input"
      type="text"
      :value="query"
      :placeholder="sub"
      aria-label="名称 / 从标准库替换"
      @focus="open = true; activeIndex = 0"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <div v-if="open && options.length" class="standard-menu">
      <button
        v-for="(key, idx) in filtered"
        :key="key"
        type="button"
        class="standard-option"
        :class="{ active: idx === activeIndex }"
        @mousedown.prevent="choose(key)"
        @mouseenter="activeIndex = idx"
      >{{ key.replace("||", " / ") }}</button>
      <div v-if="!filtered.length" class="standard-empty">无匹配标准项</div>
    </div>
  </div>
</template>
