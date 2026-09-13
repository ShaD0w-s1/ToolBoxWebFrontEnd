<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import type { StandardLibRow } from "../domain/toolbox";
import AircraftRegSuggest from "./AircraftRegSuggest.vue";

/**
 * 飞机查询卡片（项目列表子页左侧功能区，位于「新建工作项目」按钮之下）。
 *
 * 定位：只读查询。复用二级页「飞机信息」的字段与展示口径（机号 / FSN / MSN / 发动机 / 机型 / ETOPS / ELT-DT），
 * 数据源为飞机信息标准库本地常驻缓存（loadRemote 无条件全量拉取），
 * 不新增机号输入弹窗、不写回标准库、不参与项目同步。
 */
const props = defineProps<{ store: ToolboxStore }>();

/** 查询输入（组件内部状态，不与任何项目/标准库同步）。 */
const query = ref("");
/** 查询结果行；null 表示尚未查出（未输入或该机号不在库中）。 */
const row = ref<StandardLibRow | null>(null);
/** 已规范化并完成查询的机号，用于展示与"库中无此机号"提示。 */
const resolved = ref("");
const missing = ref(false);

const suggestions = computed<string[]>(() => props.store.aircraftNumbers.value);

/** 机号字段：输入非空时即时在本地标准库中做包含匹配，取首个命中行（无需回车/失焦）。 */
function onQueryChange(): void {
  const raw = (query.value || "").trim();
  missing.value = false;
  if (!raw) {
    row.value = null;
    resolved.value = "";
    return;
  }
  // 规范化机号（B-XXXX / XXXX）优先精确命中；未成完整机号时退化为包含匹配，便于边输边查。
  const exact = props.store.normalizeAircraftReg(raw);
  const hit =
    (exact ? props.store.lookupAircraftRow(exact) : null) ||
    lookupByPartial(raw) ||
    null;
  if (hit) {
    row.value = hit;
    resolved.value = String(hit["飞机号"] || exact || raw);
    return;
  }
  // 本地未命中：若已构成完整机号，走公开单机接口兜底（只读，不写回标准库）。
  if (exact && exact === raw.toUpperCase()) {
    void props.store.fetchAircraftInfo(exact).then((remote) => {
      if (query.value.trim().toUpperCase() !== exact) return; // 期间输入已变，丢弃过期结果
      row.value = remote;
      resolved.value = exact;
      missing.value = !remote;
    });
    return;
  }
  row.value = null;
  resolved.value = raw;
}

/** 部分匹配：按"飞机号"包含输入串取首个命中（稳定顺序，与联想列表同源）。 */
function lookupByPartial(text: string): StandardLibRow | null {
  const w = text.toLowerCase();
  const rows = props.store.app.value.standardLibraries.aircraft_info?.rows || [];
  return rows.find((item) => String(item["飞机号"] || "").toLowerCase().includes(w)) || null;
}

/** 联想选中机号 → 用完整机号重查。 */
function onPick(): void {
  const raw = (query.value || "").trim();
  if (!raw) return;
  const exact = props.store.normalizeAircraftReg(raw) || raw;
  query.value = exact;
  onQueryChange();
}

function clearQuery(): void {
  query.value = "";
  row.value = null;
  resolved.value = "";
  missing.value = false;
}

function field(key: string): string {
  return row.value ? String(row.value[key] || "") : "";
}

/** ETOPS / ELT-DT 有非 N/A 数据时红色加粗（与准备单一致）。 */
function hasSpecialConfig(value: string): boolean {
  const v = (value || "").trim().toUpperCase();
  return Boolean(v) && v !== "N/A";
}
</script>

<template>
  <section class="aq-card">
    <header class="aq-head">
      <h3 class="aq-title">飞机查询</h3>
      <span class="aq-tag">只读</span>
    </header>

    <div class="aq-search">
      <AircraftRegSuggest
        v-model="query"
        :suggestions="suggestions"
        placeholder="输入机号，如 B-1234"
        :max-match="6"
        @input="onQueryChange"
        @change="onPick"
      />
      <button v-if="query" class="aq-clear" title="清空查询" @click="clearQuery">×</button>
    </div>

    <p v-if="missing" class="aq-hint aq-miss">库中无此机号：{{ resolved }}</p>

    <dl v-else class="aq-body">
      <div class="aq-pair">
        <div class="aq-cell">
          <dt>FSN</dt>
          <dd>{{ field("FSN") || "—" }}</dd>
        </div>
        <div class="aq-cell">
          <dt>MSN</dt>
          <dd>{{ field("MSN") || "—" }}</dd>
        </div>
      </div>
      <div class="aq-block">
        <dt>发动机</dt>
        <dd>{{ field("发动机") || "—" }}</dd>
      </div>
      <div class="aq-block">
        <dt>机型</dt>
        <dd>{{ field("机型") || "—" }}</dd>
      </div>
      <div class="aq-pair">
        <div class="aq-cell">
          <dt>ETOPS</dt>
          <dd :class="{ 'aq-special': hasSpecialConfig(field('ETOPS')) }">{{ field("ETOPS") || "—" }}</dd>
        </div>
        <div class="aq-cell">
          <dt>ELT-DT</dt>
          <dd :class="{ 'aq-special': hasSpecialConfig(field('ELT-DT')) }">{{ field("ELT-DT") || "—" }}</dd>
        </div>
      </div>
    </dl>
  </section>
</template>

<style scoped>
/* 与筛选条件卡片同级：白底 + 同款边框/圆角/内边距，独立成一卡。 */
.aq-card {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px; border: 1px solid var(--line); border-radius: var(--r-lg);
  background: var(--n0);
}
.aq-head { display: flex; align-items: center; gap: 8px; }
.aq-title { margin: 0; font-size: var(--fs-14); font-weight: 700; color: var(--n9); }
.aq-tag {
  margin-left: auto; padding: 1px 8px; border-radius: var(--r-pill);
  background: var(--n3); color: var(--n7); font-size: var(--fs-10); font-weight: 700;
}
.aq-search { position: relative; display: flex; align-items: center; }
.aq-search :deep(.ars-input) { padding-right: 34px; }
/* 清空 ×：方形（非圆形），高度随所在输入格高度自适应（.aq-search 高 = .ars-input 30px）。
   ⚠️ 必须 min-height:0：main.css 全局 button{min-height:36px} 会把固定宽按钮撑成椭圆。 */
.aq-clear {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  height: calc(100% - 8px); aspect-ratio: 1 / 1; width: auto; min-width: 18px;
  min-height: 0; padding: 0; border: none; border-radius: var(--r-sm);
  background: var(--danger-bg); color: var(--danger); font-size: var(--fs-14); line-height: 1;
  cursor: pointer; z-index: 2;
  display: flex; align-items: center; justify-content: center;
}
.aq-clear:hover { background: #f9dcdc; }
.aq-hint { margin: 0; font-size: var(--fs-12); color: var(--n6); }
.aq-miss { color: var(--danger); font-weight: 600; }
.aq-body { display: flex; flex-direction: column; gap: 8px; margin: 0; }
.aq-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.aq-cell, .aq-block {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--n0); min-width: 0;
}
.aq-body dt { font-size: var(--fs-10); font-weight: 700; color: var(--n7); letter-spacing: .3px; }
.aq-body dd {
  margin: 0; font-size: var(--fs-14); font-weight: 600; color: var(--n10);
  overflow-wrap: anywhere; word-break: break-all;
}
.aq-special { color: var(--danger) !important; font-weight: 700 !important; }
</style>
