<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";

/** 下拉多选组件：含「全部」选项（选中全部=清空筛选）；右侧红色 × 清空；外部点击关闭。
 *  无障碍：触发器为 disclosure（aria-expanded + aria-controls），浮层为 role=group、
 *  各选项为原生 button + aria-pressed（多选筛选的准确语义：N 个独立开关，
 *  键盘原生可用，无需自造 listbox/option 的 tabindex 管理）。 */
const props = defineProps<{
  options: string[];
  modelValue: string[];
  placeholder?: string;
  /** 浮层分组无障碍名（同页多个 MultiSelect 时用于区分）。 */
  label?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [v: string[]] }>();

const open = ref(false);
const sel = computed(() => props.modelValue);
const isAll = computed(() => sel.value.length === 0);

const uid = useId();
const triggerId = `${uid}-trigger`;
const menuId = `${uid}-menu`;
const groupLabel = computed(() => props.label || "筛选项");

function toggle(opt: string): void {
  if (opt === "__ALL__") { emit("update:modelValue", []); return; }
  const s = new Set(sel.value);
  if (s.has(opt)) s.delete(opt); else s.add(opt);
  emit("update:modelValue", [...s]);
}
function clearAll(): void {
  emit("update:modelValue", []);
}
function label(): string {
  if (isAll.value) return props.placeholder || "全部";
  return `${sel.value.length} 项已选`;
}
function onDocClick(): void { open.value = false; }
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div class="ms" @click.stop>
    <button
      :id="triggerId"
      type="button"
      class="ms-trigger"
      :class="{ on: !isAll }"
      :aria-expanded="open"
      :aria-controls="menuId"
      @click="open = !open"
    >
      <span class="ms-label">{{ label() }}</span>
      <span v-if="!isAll" class="ms-count">{{ sel.length }}</span>
      <span class="ms-arrow" :class="{ up: open }" aria-hidden="true">▾</span>
    </button>
    <button v-if="!isAll" type="button" class="ms-clear" title="清空选择" aria-label="清空选择" @click="clearAll">×</button>
    <div v-if="open" :id="menuId" class="ms-menu" role="group" :aria-label="groupLabel">
      <button type="button" class="ms-opt" :class="{ on: isAll }" :aria-pressed="isAll" @click="toggle('__ALL__')">
        <span>全部</span><span v-if="isAll" class="ms-check" aria-hidden="true">✓</span>
      </button>
      <button v-for="o in options" :key="o" type="button" class="ms-opt" :class="{ on: sel.includes(o) }" :aria-pressed="sel.includes(o)" @click="toggle(o)">
        <span>{{ o }}</span><span v-if="sel.includes(o)" class="ms-check" aria-hidden="true">✓</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ms { position: relative; display: inline-flex; align-items: center; width: 100%; }
.ms-trigger {
  flex: 1; min-width: 0; min-height: 34px; padding: 4px 10px;
  border: 1px solid var(--n4); border-radius: var(--r-sm); background: var(--n0);
  font-size: var(--fs-13); color: var(--n9); text-align: left;
  display: flex; align-items: center; gap: 6px;
}
.ms-trigger:hover { border-color: var(--n5); }
.ms-trigger.on { border-color: var(--blue); }
.ms-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ms-count { font-size: var(--fs-11); background: var(--blue); color: var(--n0); border-radius: var(--r-pill); padding: 0 7px; line-height: 16px; }
.ms-arrow { font-size: var(--fs-10); color: var(--n6); transition: transform var(--t-fast); }
.ms-arrow.up { transform: rotate(180deg); }
/* 清空 ×：方形（非圆形），高度随所在格（.ms 高 = .ms-trigger 34px）自适应。
   ⚠️ 必须 min-height:0：main.css 全局 button{min-height:36px} 会把固定宽按钮撑成椭圆。 */
.ms-clear {
  position: absolute; right: 26px; top: 50%; transform: translateY(-50%);
  height: calc(100% - 8px); aspect-ratio: 1 / 1; width: auto; min-width: 18px;
  min-height: 0; padding: 0; border: none; border-radius: var(--r-sm);
  background: var(--danger-bg); color: var(--danger); font-size: var(--fs-13); line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.ms-clear:hover { background: var(--danger-bg-hover); }
.ms-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 60;
  max-height: 220px; overflow-y: auto; padding: 4px;
  background: var(--n0); border: 1px solid var(--n3); border-radius: var(--r-md);
  box-shadow: var(--sh-2);
}
.ms-opt {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-height: 30px; padding: 4px 10px; border: none; border-radius: var(--r-sm);
  background: transparent; color: var(--n8); font-size: var(--fs-13); text-align: left;
}
.ms-opt:hover { background: var(--blue-bg); }
.ms-opt.on { color: var(--blue-dark); font-weight: 600; }
.ms-check { color: var(--blue); font-size: var(--fs-12); }
</style>
