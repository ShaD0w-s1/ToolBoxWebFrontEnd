<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import { exportStandalonePrep } from "../services/spreadsheet";
import { exportFileName } from "../utils/format";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-image": [element: HTMLElement | null] }>();

const project = computed(() => props.store.currentProject.value);
const sheet = computed(() => project.value?.standalonePrepSheet || null);
const captureRef = ref<HTMLElement | null>(null);

// 标题改名
const titleEditing = ref(false);
const titleDraft = ref("");
function startRenameTitle(): void { if (!sheet.value) return; titleDraft.value = sheet.value.title || ""; titleEditing.value = true; }
async function commitRenameTitle(): Promise<void> { if (!sheet.value) return; props.store.spRenameTitle(titleDraft.value || "单项准备单"); titleEditing.value = false; await nextTick(); }
function cancelRenameTitle(): void { titleEditing.value = false; }

// 机号变更回填
function onAircraftChange(): void { props.store.spOnAircraftChange(); }
/** 机型字段（FSN/MSN/机型/发动机/ETOPS/ELT-DT）编辑后：检测与库中差异 → 弹「更新机型标准库」。 */
function onAircraftFieldEdited(): void {
  if (!sheet.value) return;
  props.store.maybePromptAircraftDiff(sheet.value.base);
}
function hasSpecialConfig(v: string): boolean { const x = (v || "").trim().toUpperCase(); return Boolean(x) && x !== "N/A"; }

// 人员安排固定角色布局
const personnelLayout: Array<Array<{ key: string; cols: number }>> = [
  [{ key: "项目负责人", cols: 1 }, { key: "值班组", cols: 1 }, { key: "主卡签署", cols: 1 }, { key: "必检", cols: 1 }],
  [{ key: "工具负责", cols: 1 }, { key: "工具参与", cols: 3 }],
  [{ key: "航材负责", cols: 1 }, { key: "航材参与", cols: 3 }],
  [{ key: "工卡负责", cols: 1 }, { key: "工卡打印", cols: 3 }],
  [{ key: "试车人员", cols: 1 }, { key: "报工/完工反馈", cols: 1 }, { key: "运输跟踪", cols: 1 }, { key: "飞机监护", cols: 1 }],
];

function exportImage(): void { emit("export-image", captureRef.value); }
function exportTableXlsx(): void {
  if (!sheet.value) return;
  exportStandalonePrep(sheet.value, exportFileName(project.value?.name || "", "单项准备单"));
  props.store.notify("表格已导出");
}

/** 表格单元格 textarea 自动撑高并持久化（需求：表单内容自动换行）。 */
function onRowInput(event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  props.store.persist();
}
/** 撑高所有表格单元格 textarea：加载已有数据时（无 input 事件）也要正确换行显示。 */
function autoSizeAll(): void {
  const root = captureRef.value;
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLTextAreaElement>(".sp-cell")) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
}
onMounted(() => { nextTick(autoSizeAll); });
watch(() => props.store.currentProject.value?.id, () => { nextTick(autoSizeAll); });
// 数据从云端异步加载/增删行后，重新撑高所有单元格（保证已有内容正确换行显示）。
watch(sheet, () => { nextTick(autoSizeAll); }, { deep: true });
</script>

<template>
  <div v-if="sheet" ref="captureRef" class="sp-sheet">
    <div class="subpage-head">
      <h3 v-if="!titleEditing" class="sp-title" @click="startRenameTitle" title="点击修改名称">{{ sheet.title }}</h3>
      <input v-else class="sp-title-input" v-model="titleDraft" @blur="commitRenameTitle" @keydown.enter.prevent="commitRenameTitle" @keydown.esc.prevent="cancelRenameTitle" autofocus />
      <div class="subpage-actions">
        <label v-if="!titleEditing" class="ghost" @click="startRenameTitle">改名称</label>
        <button class="ghost" @click="exportImage">导出图片</button>
        <button class="ghost" @click="exportTableXlsx">导出表格</button>
      </div>
    </div>

    <!-- 基础信息 -->
    <section class="prep-block">
      <h4>基础信息</h4>
      <div class="prep-grid">
        <label class="prep-field"><span class="field-label">机号</span><input v-model="sheet.base.机号" list="sp-aircraft" @change="onAircraftChange" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">FSN</span><input v-model="sheet.base.FSN" @change="onAircraftFieldEdited" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">MSN</span><input v-model="sheet.base.MSN" @change="onAircraftFieldEdited" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">发动机</span><input v-model="sheet.base.发动机" @change="onAircraftFieldEdited" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">机型</span><input v-model="sheet.base.机型" @change="onAircraftFieldEdited" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">ETOPS</span><input v-model="sheet.base.ETOPS" :class="{ 'special-config': hasSpecialConfig(sheet.base.ETOPS) }" @change="onAircraftFieldEdited" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">ELT-DT</span><input v-model="sheet.base['ELT-DT']" :class="{ 'special-config': hasSpecialConfig(sheet.base['ELT-DT']) }" @change="onAircraftFieldEdited" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">地点</span><input v-model="sheet.base.地点" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">落地航班</span><input v-model="sheet.base.落地航班" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">落地时间</span><input v-model="sheet.base.落地时间" @input="store.persist" /></label>
        <label class="prep-field"><span class="field-label">起飞时间</span><input v-model="sheet.base.起飞时间" @input="store.persist" /></label>
      </div>
      <datalist id="sp-aircraft"><option v-for="num in store.aircraftNumbers.value" :key="num" :value="num" /></datalist>
      <!-- 工作列表：指令号 + 工作内容 -->
      <div class="sp-works">
        <div v-for="(w, idx) in sheet.works" :key="w.id" class="sp-work-row">
          <span class="sp-idx">{{ idx + 1 }}</span>
          <input v-model="w.指令号" class="sp-w-no" placeholder="指令号" @input="store.persist" />
          <input v-model="w.工作内容" class="sp-w-content" placeholder="工作内容" @input="store.persist" />
          <button class="ghost danger-cell" @click="store.spRemoveWork(w.id)">删除</button>
        </div>
      </div>
      <div class="prep-block-actions"><button class="ghost" @click="store.spAddWork">+ 新增工作</button></div>
    </section>

    <!-- 部件信息 -->
    <section class="prep-block">
      <h4>部件信息</h4>
      <div class="sp-parts">
        <div v-for="(p, idx) in sheet.parts" :key="p.id" class="sp-part-card">
          <header class="sp-part-head">
            <input class="sp-part-name" v-model="p.name" @input="store.persist" :placeholder="`部件 ${idx + 1}`" />
            <button class="ghost danger-cell" @click="store.spRemovePart(p.id)">删除</button>
          </header>
          <div class="sp-part-body">
            <div class="sp-subcard">
              <div class="sp-sub-title">拆下件</div>
              <label class="prep-field"><span class="field-label">件号</span><input v-model="p.拆下件号" @input="store.persist" /></label>
              <label class="prep-field"><span class="field-label">序号</span><input v-model="p.拆下序号" @input="store.persist" /></label>
            </div>
            <div class="sp-subcard">
              <div class="sp-sub-title">装上件</div>
              <label class="prep-field"><span class="field-label">件号</span><input v-model="p.装上件号" @input="store.persist" /></label>
              <label class="prep-field"><span class="field-label">序号</span><input v-model="p.装上序号" @input="store.persist" /></label>
            </div>
          </div>
        </div>
      </div>
      <div class="prep-block-actions"><button class="ghost" @click="store.spAddPart">+ 新增信息</button></div>
    </section>

    <!-- 人员安排 -->
    <section class="prep-block">
      <h4>人员安排</h4>
      <div class="prep-personnel-grid">
        <label v-for="cell in personnelLayout[0]" :key="cell.key" class="prep-personnel-cell" :style="{ gridColumn: `span ${cell.cols}` }">
          <span class="field-label">{{ cell.key }}</span><input v-model="(sheet.personnel as unknown as Record<string, string>)[cell.key]" @input="store.persist" />
        </label>
      </div>
      <label class="prep-personnel-fullrow"><span class="field-label">参与人员</span><textarea v-model="sheet.personnel.参与人员" rows="2" @input="store.persist" /></label>
      <div class="prep-personnel-grid">
        <template v-for="(row, ri) in personnelLayout.slice(1)" :key="`pr-${ri}`">
          <label v-for="cell in row" :key="cell.key" class="prep-personnel-cell" :style="{ gridColumn: `span ${cell.cols}` }">
            <span class="field-label">{{ cell.key }}</span><input v-model="(sheet.personnel as unknown as Record<string, string>)[cell.key]" @input="store.persist" />
          </label>
        </template>
      </div>
      <div class="prep-extra-grid">
        <div v-for="item in sheet.personnel.extra" :key="item.id" class="prep-extra-item">
          <input v-model="item.内容" @input="store.persist" placeholder="内容" class="extra-title" />
          <input v-model="item.人员" @input="store.persist" placeholder="人员" class="extra-value" />
          <button class="ghost danger-cell" @click="store.spRemoveArrange(item.id)">删除</button>
        </div>
      </div>
      <div class="prep-block-actions"><button class="ghost" @click="store.spAddArrange">+ 新增安排</button></div>
    </section>

    <!-- 工序安排 -->
    <section class="prep-block">
      <h4>工序安排</h4>
      <div class="prep-block-actions"><button class="ghost" @click="store.spAddProcessGroup">+ 新增工序组</button></div>
      <div v-for="(g, gi) in sheet.processGroups" :key="g.id" class="sp-group-card">
        <header class="sp-part-head">
          <input class="sp-group-name" v-model="g.name" @input="store.persist" :placeholder="`工序组 ${gi + 1}`" />
          <button class="ghost danger-cell" @click="store.spRemoveProcessGroup(g.id)">删除</button>
        </header>
        <div class="table-wrap"><table class="sp-table">
          <thead><tr><th>工作步骤</th><th>人员安排</th><th>检测&必检</th><th>功能</th></tr></thead>
          <tbody>
            <tr v-for="r in g.rows" :key="r.id">
              <td><textarea rows="1" v-model="r.工作步骤" @input="onRowInput" class="sp-cell"></textarea></td>
              <td><textarea rows="1" v-model="r.人员安排" @input="onRowInput" class="sp-cell"></textarea></td>
              <td><textarea rows="1" v-model="r['检测&必检']" @input="onRowInput" class="sp-cell"></textarea></td>
              <td><button class="ghost danger-cell" @click="store.spRemoveProcessRow(gi, r.id)">删除</button></td>
            </tr>
          </tbody>
        </table></div>
        <div class="prep-block-actions"><button class="ghost" @click="store.spAddProcessRow(gi)">+ 新增行</button></div>
      </div>
      <h4 class="sp-sub-h4">工卡签署安排</h4>
      <div class="table-wrap"><table class="sp-table">
        <thead><tr><th>手册号</th><th>工卡名</th><th>签署人</th><th>功能</th></tr></thead>
        <tbody>
          <tr v-for="r in sheet.signingRows" :key="r.id">
            <td><textarea rows="1" v-model="r.手册号" @input="onRowInput" class="sp-cell"></textarea></td>
            <td><textarea rows="1" v-model="r.工卡名" @input="onRowInput" class="sp-cell"></textarea></td>
            <td><textarea rows="1" v-model="r.签署人" @input="onRowInput" class="sp-cell"></textarea></td>
            <td><button class="ghost danger-cell" @click="store.spRemoveSigningRow(r.id)">删除</button></td>
          </tr>
        </tbody>
      </table></div>
      <div class="prep-block-actions"><button class="ghost" @click="store.spAddSigningRow">+ 新增行</button></div>
    </section>
  </div>
</template>

<style scoped>
.sp-sheet { padding: 4px 2px 40px; }
.sp-title { margin: 0; font-size: 18px; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
.sp-title:hover { background: #eef2fa; }
.sp-title-input { font-size: 18px; padding: 4px 8px; border: 1px solid #6f8ad6; border-radius: 6px; min-width: 240px; }
.prep-block { margin-bottom: 18px; background: #fff; border: 1px solid #e6e9f0; border-radius: 10px; padding: 12px 14px; }
.prep-block h4 { margin: 0 0 10px; font-size: 14px; background: var(--blue); color: #fff; padding: 8px 12px; border-radius: 8px; }
.sp-sub-h4 { margin: 18px 0 10px; }
.field-label { font-size: 13px; color: #000; font-weight: 500; }
.prep-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 14px; margin-bottom: 8px; }
.prep-field { display: flex; flex-direction: column; gap: 4px; }
.prep-field input, .prep-field textarea { padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.special-config { color: #c0392b !important; font-weight: 700 !important; }
.prep-personnel-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
.prep-personnel-cell { display: flex; flex-direction: column; gap: 4px; }
.prep-personnel-cell input { padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.prep-personnel-fullrow { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.prep-personnel-fullrow textarea { padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; resize: vertical; }
.prep-extra-grid { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.prep-extra-item { display: flex; gap: 6px; align-items: stretch; }
.extra-title { flex: 0 0 18%; min-width: 80px; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.extra-value { flex: 1 1 0; min-width: 0; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.danger-cell { padding: 6px 10px; border: 1px solid #f2cdcd; background: #fdecec; color: #b53a3a; border-radius: 6px; font-size: 12px; cursor: pointer; }
.prep-block-actions { margin-top: 10px; display: flex; gap: 8px; }
.sp-works { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.sp-work-row { display: flex; gap: 6px; align-items: stretch; }
.sp-idx { flex: 0 0 24px; display: flex; align-items: center; justify-content: center; color: #8a93a6; font-size: 13px; }
.sp-w-no { flex: 0 0 22%; min-width: 90px; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.sp-w-content { flex: 1 1 0; min-width: 0; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.sp-parts { display: flex; flex-direction: column; gap: 10px; }
.sp-part-card { border: 1px solid #e6e9f0; border-radius: 8px; padding: 10px 12px; background: #fafbff; }
.sp-part-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 600; color: #4a5160; }
.sp-part-body { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sp-subcard { display: flex; flex-direction: column; gap: 6px; }
.sp-sub-title { font-size: 13px; font-weight: 600; color: #185FA5; }
.sp-group-card { border: 1px solid #e6e9f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; background: #fafbff; }
.table-wrap { overflow-x: auto; }
.sp-table { width: 100%; border-collapse: collapse; min-width: 520px; }
.sp-table th, .sp-table td { border: 1px solid #e6e9f0; padding: 4px; text-align: left; font-size: 13px; vertical-align: top; }
.sp-table th { background: #f5f7fb; font-weight: 600; color: #000; }
.sp-cell { width: 100%; box-sizing: border-box; padding: 5px 6px; border: 1px solid transparent; border-radius: 5px; font-size: 13px; min-width: 0; resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word; line-height: 1.5; font-family: inherit; }
.sp-cell:focus { border-color: #8eaadb; background: #fff; }
.sp-group-name { flex: 1 1 0; min-width: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-weight: 600; font-size: 14px; color: #4a5160; }
.sp-group-name:hover, .sp-group-name:focus { border-color: #8eaadb; background: #fff; }
.sp-part-name { flex: 1 1 0; min-width: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-weight: 600; font-size: 14px; color: #4a5160; }
.sp-part-name:hover, .sp-part-name:focus { border-color: #8eaadb; background: #fff; }
@media (max-width: 768px) {
  .prep-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .prep-personnel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .sp-part-body { grid-template-columns: 1fr; }
}
</style>
