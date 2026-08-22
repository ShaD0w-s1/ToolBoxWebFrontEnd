<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  PREP_PERSONNEL_LAYOUT,
  PREP_PERSONNEL_FULL_ROWS,
  type PrepSheet as PrepSheetType,
} from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { exportPrepSheetSingle } from "../services/spreadsheet";
import { exportFileName } from "../utils/format";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-image": [element: HTMLElement | null] }>();

const project = computed(() => props.store.currentProject.value);
const prep = computed<PrepSheetType | null>(() => project.value?.prepSheet || null);

const captureRef = ref<HTMLElement | null>(null);

// ----- 标题改名 -------------------------------------------------------------
const titleEditing = ref(false);
const titleDraft = ref("");
function startRenameTitle(): void {
  if (!prep.value) return;
  titleDraft.value = prep.value.title || "";
  titleEditing.value = true;
}
async function commitRenameTitle(): Promise<void> {
  if (!prep.value) return;
  props.store.renamePrepTitle(titleDraft.value || "工作准备单");
  titleEditing.value = false;
  await nextTick();
}
function cancelRenameTitle(): void { titleEditing.value = false; }

// ----- 基础信息：机号变更 → 规范化(XXXX→B-XXXX) + 自动回填 FSN/MSN/发动机/机型/ETOPS/ELT-DT；
//      回填后若库中索引不到该机号，弹「更新机型标准库」（新增场景，无需 AIRNAV 授权） -----
async function onAircraftChange(): Promise<void> {
  if (!prep.value) return;
  const raw = prep.value.base.机号.trim();
  if (!raw) return;
  const target = props.store.normalizeAircraftReg(raw);
  if (!target) { props.store.persist(); return; }
  prep.value.base.机号 = target;
  const match = await props.store.fetchAircraftInfo(target);
  if (match) {
    prep.value.base.FSN = String(match["FSN"] || "");
    prep.value.base.MSN = String(match["MSN"] || "");
    prep.value.base.机型 = String(match["机型"] || "");
    prep.value.base.发动机 = String(match["发动机"] || "");
    prep.value.base.ETOPS = String(match["ETOPS"] || "");
    prep.value.base["ELT-DT"] = String(match["ELT-DT"] || "");
  }
  props.store.maybePromptAircraftUpdate(prep.value.base);
  props.store.persist();
}

/** 机型字段（FSN/MSN/机型/发动机/ETOPS/ELT-DT）编辑后：检测与库中差异 → 弹「更新机型标准库」（更新场景，不再标脏走需授权的 autoSync）。 */
function onAircraftFieldEdited(): void {
  if (!prep.value) return;
  props.store.maybePromptAircraftDiff(prep.value.base);
}

// ETOPS / ELT-DT 有非 N/A 数据时字体红色加粗（需求 4）
function hasSpecialConfig(value: string): boolean {
  const v = (value || "").trim().toUpperCase();
  return Boolean(v) && v !== "N/A";
}

// 第一组：机号 + 飞机参数
const baseFields1: Array<{ key: keyof PrepSheetType["base"]; label: string }> = [
  { key: "机号", label: "机号" }, { key: "FSN", label: "FSN" }, { key: "MSN", label: "MSN" },
  { key: "发动机", label: "发动机" }, { key: "机型", label: "机型" },
];
// 第二组：指令号/工作内容/地点
const baseFields2: Array<{ key: keyof PrepSheetType["base"]; label: string }> = [
  { key: "指令号", label: "指令号" }, { key: "工作内容", label: "工作内容" }, { key: "地点", label: "地点" },
];

// ----- 杂项 4 列布局 -----
const miscLayout: Array<Array<{ key: string; cols: number }>> = [
  [{ key: "接机(挥棒 & 停止线)", cols: 3 }, { key: "接机放行", cols: 1 }],
  [{ key: "拖机备份", cols: 3 }, { key: "换轮&刹车 备份", cols: 1 }],
  [{ key: "试车耳机", cols: 1 }, { key: "试车监护", cols: 3 }],
  [{ key: "废油处理", cols: 1 }, { key: "定检TLB填写", cols: 1 }, { key: "收尾现场清洁", cols: 1 }, { key: "编辑完工微信", cols: 1 }],
];

// ----- 动态新增/删除 -----
function addTo(group: "extraBase" | "roleExtras" | "miscExtras" | "extra"): void { props.store.addPrepItem(group); }
function removeAt(group: "extraBase" | "roleExtras" | "miscExtras" | "extra", index: number): void { props.store.removePrepItem(group, index); }

// ----- 导出图片：委托给 App.vue 处理（需求 6，参考工具清单的导出图片） -----
function exportImage(): void { emit("export-image", captureRef.value); }

// ----- 导出表格：单 Sheet，与网页格式相同（需求 7） -----
function exportTableXlsx(): void {
  if (!prep.value) return;
  exportPrepSheetSingle(prep.value, exportFileName(project.value?.name || "", "工作准备单"));
  props.store.notify("表格已导出");
}
</script>

<template>
  <div v-if="prep" ref="captureRef" class="prep-sheet">
    <!-- 标题 + 导出按钮 -->
    <div class="subpage-head">
      <h3 v-if="!titleEditing" class="prep-title" @click="startRenameTitle" title="点击修改名称">{{ prep.title }}</h3>
      <input v-else class="prep-title-input" v-model="titleDraft" @blur="commitRenameTitle" @keydown.enter.prevent="commitRenameTitle" @keydown.esc.prevent="cancelRenameTitle" autofocus />
      <div class="subpage-actions">
        <label v-if="!titleEditing" class="ghost" @click="startRenameTitle">改名称</label>
        <button class="ghost" @click="exportImage">导出图片</button>
        <button class="ghost" @click="exportTableXlsx">导出表格</button>
      </div>
    </div>

    <!-- 基础信息 -->
    <section class="prep-block">
      <h4>基础信息</h4>
      <!-- 第一组：机号 + 飞机参数（label 黑色） -->
      <div class="prep-grid">
        <label v-for="field in baseFields1" :key="field.key" class="prep-field">
          <span class="field-label">{{ field.label }}</span>
          <input v-if="field.key === '机号'" v-model="prep.base.机号" list="aircraft-numbers" :placeholder="`输入或选择（共 ${store.aircraftNumbers.value.length} 架）`" @change="onAircraftChange" @input="store.persist" />
          <input v-else v-model="prep.base[field.key]" @change="onAircraftFieldEdited" @input="store.persist" />
        </label>
        <!-- ETOPS / ELT-DT：有非 N/A 数据时红色加粗 -->
        <label class="prep-field">
          <span class="field-label">ETOPS</span>
          <input v-model="prep.base.ETOPS" :class="{ 'special-config': hasSpecialConfig(prep.base.ETOPS) }" @change="onAircraftFieldEdited" @input="store.persist" />
        </label>
        <label class="prep-field">
          <span class="field-label">ELT-DT</span>
          <input v-model="prep.base['ELT-DT']" :class="{ 'special-config': hasSpecialConfig(prep.base['ELT-DT']) }" @change="onAircraftFieldEdited" @input="store.persist" />
        </label>
      </div>
      <datalist id="aircraft-numbers">
        <option v-for="num in store.aircraftNumbers.value" :key="num" :value="num" />
      </datalist>
      <div class="prep-divider" aria-hidden="true"></div>
      <!-- 第二组：指令号/工作内容/地点 -->
      <div class="prep-grid">
        <label v-for="field in baseFields2" :key="field.key" class="prep-field">
          <span class="field-label">{{ field.label }}</span>
          <input v-model="prep.base[field.key]" @input="store.persist" />
        </label>
      </div>
      <div class="prep-divider" aria-hidden="true"></div>
      <!-- 落地航班 + 落地时间 + 次日起飞时间 + 后三天过夜航班3格（6列行，修复 4） -->
      <div class="prep-grid prep-grid-6">
        <label class="prep-field"><span class="field-label">落地航班</span><input v-model="prep.base.落地航班" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">落地时间</span><input v-model="prep.base.落地时间" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">次日起飞时间</span><input v-model="prep.base.次日起飞时间" @input="store.persist" /></label>
        <div class="prep-field prep-overnight" style="grid-column: span 3">
          <span class="field-label">后三天过夜航班</span>
          <div class="prep-overnight-inputs">
            <input v-model="prep.base.后三天过夜航班1" @input="store.persist" />
            <span class="connector">—</span>
            <input v-model="prep.base.后三天过夜航班2" @input="store.persist" />
            <span class="connector">—</span>
            <input v-model="prep.base.后三天过夜航班3" @input="store.persist" />
          </div>
        </div>
      </div>
      <!-- 动态新增内容（需求 3：名称 0.7 列，内容 1.3→3.7 列） -->
      <div class="prep-extra-grid">
        <div v-for="(item, index) in prep.extraBase" :key="`xbase-${index}`" class="prep-extra-item">
          <input v-model="item.title" @input="store.persist" placeholder="名称" class="extra-title" />
          <input v-model="item.value" @input="store.persist" placeholder="内容" class="extra-value" />
          <button class="ghost danger-cell" @click="removeAt('extraBase', index)">删除</button>
        </div>
      </div>
      <div class="prep-block-actions"><button class="ghost" @click="addTo('extraBase')">+ 新增内容</button></div>
    </section>

    <!-- 人员安排：4 列网格 -->
    <section class="prep-block">
      <h4>人员安排</h4>
      <div class="prep-personnel-grid">
        <template v-for="(row, rowIndex) in PREP_PERSONNEL_LAYOUT" :key="`pp-${rowIndex}`">
          <label v-for="cell in row" :key="cell.key" class="prep-personnel-cell" :style="{ gridColumn: `span ${cell.cols}` }">
            <span class="field-label">{{ cell.key }}</span>
            <input v-model="prep.roles[cell.key]" @input="store.persist" />
          </label>
          <!-- Divider：起落架区域放行行后（航材负责人前）、工卡负责人行后（航后负责前） -->
          <div v-if="rowIndex === 1 || rowIndex === 4" class="prep-divider" aria-hidden="true"></div>
        </template>
      </div>
      <label v-for="key in PREP_PERSONNEL_FULL_ROWS" :key="key" class="prep-personnel-fullrow">
        <span class="field-label">{{ key }}</span>
        <input v-model="prep.roles[key]" @input="store.persist" />
      </label>
      <div class="prep-extra-grid">
        <div v-for="(item, index) in prep.roleExtras" :key="`xrole-${index}`" class="prep-extra-item">
          <input v-model="item.title" @input="store.persist" placeholder="安排" class="extra-title" />
          <input v-model="item.value" @input="store.persist" placeholder="人员" class="extra-value" />
          <button class="ghost danger-cell" @click="removeAt('roleExtras', index)">删除</button>
        </div>
      </div>
      <div class="prep-block-actions"><button class="ghost" @click="addTo('roleExtras')">+ 新增安排</button></div>
    </section>

    <!-- 杂项 -->
    <section class="prep-block">
      <h4>杂项</h4>
      <div class="prep-misc-grid">
        <template v-for="(row, rowIndex) in miscLayout" :key="`mr-${rowIndex}`">
          <label v-for="cell in row" :key="cell.key" class="prep-misc-cell" :style="{ gridColumn: `span ${cell.cols}` }">
            <span class="field-label">{{ cell.key }}</span>
            <input v-model="prep.misc[cell.key]" @input="store.persist" />
          </label>
        </template>
      </div>
      <div class="prep-extra-grid">
        <div v-for="(item, index) in prep.miscExtras" :key="`xmisc-${index}`" class="prep-extra-item">
          <input v-model="item.title" @input="store.persist" placeholder="安排" class="extra-title" />
          <input v-model="item.value" @input="store.persist" placeholder="内容" class="extra-value" />
          <button class="ghost danger-cell" @click="removeAt('miscExtras', index)">删除</button>
        </div>
      </div>
      <div class="prep-block-actions"><button class="ghost" @click="addTo('miscExtras')">+ 新增安排</button></div>
    </section>

    <!-- 保留项目：默认一行"新增"格式，无固定 DD/FC（修复 5） -->
    <section class="prep-block">
      <h4>保留项目</h4>
      <div class="prep-extra-grid">
        <div v-for="(item, index) in prep.extra" :key="`xkeep-${index}`" class="prep-extra-item">
          <input v-model="item.title" @input="store.persist" placeholder="编号" class="extra-title" />
          <input v-model="item.value" @input="store.persist" placeholder="内容" class="extra-value" />
          <button class="ghost danger-cell" @click="removeAt('extra', index)">删除</button>
        </div>
      </div>
      <div class="prep-block-actions"><button class="ghost" @click="addTo('extra')">+ DD/FC 新增</button></div>
    </section>
  </div>
</template>

<style scoped>
.prep-sheet { padding: 4px 2px 40px; }
.prep-title { margin: 0; font-size: 18px; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
.prep-title:hover { background: #eef2fa; }
.prep-title-input { font-size: 18px; padding: 4px 8px; border: 1px solid #6f8ad6; border-radius: 6px; min-width: 240px; }

.prep-block { margin-bottom: 18px; background: #fff; border: 1px solid #e6e9f0; border-radius: 10px; padding: 12px 14px; }
.prep-block h4 { margin: 0 0 10px; font-size: 14px; background: var(--blue); color: #fff; padding: 8px 12px; border-radius: 8px; }

/* 需求 1：固定命名字体颜色为黑色 */
.field-label { font-size: 13px; color: #000; font-weight: 500; }

.prep-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 14px; margin-bottom: 8px; }
.prep-grid-6 { grid-template-columns: repeat(6, 1fr); }
.prep-field { display: flex; flex-direction: column; gap: 4px; }
.prep-field input { padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
/* Divider 分隔线：基础信息各组之间；人员安排网格内跨 4 列（起落架行后、工卡负责人行后） */
.prep-divider { height: 1px; background: #dde2ec; grid-column: 1 / -1; margin: 4px 0 10px; }

/* 需求 4：ETOPS/ELT-DT 有非 N/A 数据时红色加粗 */
.special-config { color: #c0392b !important; font-weight: 700 !important; }

/* 后三天过夜航班 — 缩小输入格宽度避免 6 列行超宽（修复 1） */
.prep-grid-6 .prep-field input { padding: 4px 6px; font-size: 13px; }
.prep-overnight-inputs { display: flex; align-items: center; gap: 2px; }
.prep-overnight-inputs input { flex: 1; min-width: 0; padding: 4px 4px; border: 1px solid #d7dbe4; border-radius: 5px; font-size: 12px; }
.connector { color: #8a93a6; font-size: 12px; flex: 0 0 auto; }

/* 人员安排 4 列 */
.prep-personnel-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
.prep-personnel-cell { display: flex; flex-direction: column; gap: 4px; }
.prep-personnel-cell input { padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.prep-personnel-fullrow { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.prep-personnel-fullrow input { padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }

/* 杂项 4 列 */
.prep-misc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.prep-misc-cell { display: flex; flex-direction: column; gap: 4px; }
.prep-misc-cell input { padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }

/* 需求 3：动态新增格子 — 名称 0.7 列，内容 1.3→3.7 列（flex 让内容可扩展） */
.prep-extra-grid { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.prep-extra-item { display: flex; gap: 6px; align-items: stretch; }
.extra-title { flex: 0 0 14%; min-width: 70px; max-width: 120px; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.extra-value { flex: 1 1 0; min-width: 0; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.danger-cell { flex: 0 0 auto; padding: 6px 10px; border: 1px solid #f2cdcd; background: #fdecec; color: #b53a3a; border-radius: 6px; font-size: 12px; cursor: pointer; }

.prep-block-actions { margin-top: 10px; display: flex; gap: 8px; }
.prep-text { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.prep-text textarea { min-height: 56px; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; resize: vertical; }

/* 移动端/平板适配（≤1024px）：4 列行显示 2 列，6 列行显示 3 列；填字格宽度不超过网页一半（2列=半宽，3列=1/3） */
@media (max-width: 1024px) {
  .prep-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .prep-grid-6 { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  .prep-personnel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .prep-misc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  /* 6 列行"后三天过夜航班"跨 3 列，内部 3 个输入格各占 1/3（< 半宽） */
  .prep-overnight { grid-column: span 3 !important; }
  /* 输入格防溢出，确保长内容不撑破列宽 */
  .prep-field input,
  .prep-personnel-cell input,
  .prep-misc-cell input { min-width: 0; width: 100%; box-sizing: border-box; }
}</style>
