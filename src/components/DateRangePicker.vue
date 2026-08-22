<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

/** 联动日期区间选择器：单个日历内点选开始/结束（跨月可翻），跨度上限 30 天，含「重置默认（今日-5~+30）」。 */
const props = defineProps<{ from: string; to: string }>();
const emit = defineEmits<{ "update:from": [v: string]; "update:to": [v: string] }>();

const open = ref(false);
const view = ref<{ y: number; m: number }>(initView());
function initView(): { y: number; m: number } {
  const base = props.from || new Date().toISOString().slice(0, 10);
  const d = new Date(`${base}T00:00:00`);
  return { y: d.getFullYear(), m: d.getMonth() };
}
watch(open, (v) => { if (v) view.value = initView(); });

function fmt(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}
function dayOffset(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return fmt(d);
}
/** 42 格月网格（周一起始），相邻月补格置灰。 */
const days = computed<string[]>(() => {
  const first = new Date(view.value.y, view.value.m, 1);
  const startDow = (first.getDay() + 6) % 7; // 周一=0
  const list: string[] = [];
  const d = new Date(view.value.y, view.value.m, 1 - startDow);
  for (let i = 0; i < 42; i++) {
    list.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return list;
});
function inMonth(s: string): boolean {
  return s.startsWith(`${view.value.y}-${String(view.value.m + 1).padStart(2, "0")}`);
}
const startTs = computed(() => (props.from ? Date.parse(`${props.from}T00:00:00`) : 0));
const endTs = computed(() => (props.to ? Date.parse(`${props.to}T00:00:00`) : 0));
function rangeState(s: string): "start" | "end" | "in" | "none" {
  const t = Date.parse(`${s}T00:00:00`);
  if (startTs.value && t === startTs.value) return "start";
  if (endTs.value && t === endTs.value) return "end";
  if (startTs.value && endTs.value && t > startTs.value && t < endTs.value) return "in";
  return "none";
}
function pick(s: string): void {
  const curStart = props.from;
  const curEnd = props.to;
  // 未开始 / 已完整 → 重新开始
  if (!curStart || (curStart && curEnd)) {
    emit("update:from", s);
    emit("update:to", "");
    return;
  }
  // 点在开始之前 → 重置开始
  if (s < curStart) {
    emit("update:from", s);
    emit("update:to", "");
    return;
  }
  // 跨度上限 30 天：自动收回到 start+30
  const span = (Date.parse(`${s}T00:00:00`) - Date.parse(`${curStart}T00:00:00`)) / 86400000;
  if (span > 30) {
    emit("update:to", dayOffset(curStart, 30));
    return;
  }
  emit("update:to", s);
}
function resetDefault(): void {
  const today = fmt(new Date());
  emit("update:from", dayOffset(today, -5));
  emit("update:to", dayOffset(today, 30));
}
function prevMonth(): void {
  view.value = view.value.m === 0 ? { y: view.value.y - 1, m: 11 } : { y: view.value.y, m: view.value.m - 1 };
}
function nextMonth(): void {
  view.value = view.value.m === 11 ? { y: view.value.y + 1, m: 0 } : { y: view.value.y, m: view.value.m + 1 };
}
function label(): string {
  if (props.from && props.to) return `${props.from} ~ ${props.to}`;
  if (props.from) return `${props.from} ~ 请选结束`;
  return "选择日期范围";
}
function onDocClick(): void { open.value = false; }
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div class="drp" @click.stop>
    <button type="button" class="drp-trigger" :class="{ on: from || to }" @click="open = !open">
      <span class="drp-label">{{ label() }}</span>
      <span class="drp-arrow" :class="{ up: open }">▾</span>
    </button>
    <div v-if="open" class="drp-menu">
      <div class="drp-nav">
        <button type="button" class="drp-nav-btn" @click="prevMonth" aria-label="上一月">‹</button>
        <span class="drp-nav-title">{{ view.y }} 年 {{ view.m + 1 }} 月</span>
        <button type="button" class="drp-nav-btn" @click="nextMonth" aria-label="下一月">›</button>
      </div>
      <div class="drp-week">
        <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w" class="drp-w">{{ w }}</span>
      </div>
      <div class="drp-grid">
        <button v-for="d in days" :key="d" type="button" class="drp-day" :class="[rangeState(d), { dim: !inMonth(d) }]" @click="pick(d)">
          {{ Number(d.slice(8, 10)) }}
        </button>
      </div>
      <div class="drp-foot">
        <button type="button" class="drp-reset" @click="resetDefault">重置默认（今日-5 ~ +30）</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drp { position: relative; display: block; width: 100%; }
.drp-trigger {
  width: 100%; min-height: 38px; padding: 4px 10px;
  border: 1px solid var(--n4); border-radius: var(--r-md); background: #fff;
  font-size: var(--fs-13); color: var(--n9); text-align: left;
  display: flex; align-items: center; gap: 6px;
}
.drp-trigger:hover { border-color: var(--n5); }
.drp-trigger.on { border-color: var(--blue); }
.drp-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.drp-arrow { font-size: var(--fs-10); color: var(--n6); transition: transform var(--t-fast); }
.drp-arrow.up { transform: rotate(180deg); }
.drp-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 60;
  width: 288px; padding: 10px;
  background: #fff; border: 1px solid var(--n3); border-radius: var(--r-lg);
  box-shadow: var(--sh-2);
}
.drp-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.drp-nav-title { font-size: var(--fs-13); font-weight: 600; color: var(--n8); }
.drp-nav-btn {
  width: 26px; height: 26px; padding: 0; border: 1px solid var(--n3); border-radius: var(--r-sm);
  background: var(--n1); color: var(--n8); font-size: var(--fs-14); line-height: 1;
}
.drp-nav-btn:hover { background: var(--blue-bg); color: var(--blue-dark); }
.drp-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px; }
.drp-w { text-align: center; font-size: var(--fs-11); color: var(--n6); padding: 2px 0; }
.drp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.drp-day {
  height: 30px; padding: 0; border: none; border-radius: var(--r-sm);
  background: transparent; color: var(--n8); font-size: var(--fs-12);
}
.drp-day:hover { background: var(--blue-bg); }
.drp-day.dim { color: var(--n5); }
.drp-day.start, .drp-day.end { background: var(--blue); color: #fff; font-weight: 600; }
.drp-day.in { background: var(--blue-bg); color: var(--blue-dark); }
.drp-foot { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--n3); text-align: center; }
.drp-reset {
  border: none; background: none; color: var(--blue); font-size: var(--fs-12);
  padding: 2px 6px;
}
.drp-reset:hover { text-decoration: underline; }
</style>
