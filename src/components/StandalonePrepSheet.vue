<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import { backend } from "../api";
import type { StandalonePrepSheet } from "../domain/toolbox";
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

// ===== 单项工作模板（调取/保存双模式，与换发/APU 二级页一致：调取仅加载；保存=新模板+覆盖/改名/删除） =====
const showTplModal = ref(false);
const tplMode = ref<"load" | "save">("load");
const templates = ref<Array<{ _id: string; id: string; name: string; savedAt: string; state: StandalonePrepSheet }>>([]);
const templatesLoading = ref(false);
const saveTplName = ref("");
const saveTplInputRef = ref<HTMLInputElement | null>(null);
async function openTplModal(mode: "load" | "save" = tplMode.value): Promise<void> {
  tplMode.value = mode;
  showTplModal.value = true;
  templatesLoading.value = true;
  try {
    const res = await backend.listStandaloneTemplates();
    templates.value = (Array.isArray(res.data) ? res.data : []).slice().sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板加载失败", "err");
  } finally {
    templatesLoading.value = false;
    if (mode === "save") nextTick(() => saveTplInputRef.value?.focus());
  }
}
function applyTemplate(t: { name: string; state: StandalonePrepSheet }): void {
  if (!sheet.value) return;
  if (!window.confirm(`确认加载模板“${t.name}”？将覆盖当前单项准备单内容（保留基础信息）。`)) return;
  props.store.applyStandaloneTemplate(t.state);
  showTplModal.value = false;
}
async function saveAsTemplate(): Promise<void> {
  if (!sheet.value) return;
  const name = saveTplName.value.trim();
  if (!name) { props.store.notify("请输入模板名称"); return; }
  const id = await props.store.saveStandaloneTemplate(name);
  if (id) { saveTplName.value = ""; await openTplModal(tplMode.value); }
}
async function overwriteTemplate(t: { _id: string; name: string }): Promise<void> {
  if (!sheet.value) return;
  if (!window.confirm(`确认覆盖模板“${t.name}”？当前单项准备单内容将写入该模板。`)) return;
  const id = await props.store.saveStandaloneTemplate(t.name, t._id);
  if (id) await openTplModal(tplMode.value);
}
async function deleteTemplate(t: { _id: string; name: string }): Promise<void> {
  if (!window.confirm(`确认删除模板“${t.name}”？`)) return;
  try {
    await backend.deleteStandaloneTemplate(t._id);
    templates.value = templates.value.filter((x) => x._id !== t._id);
    props.store.notify("模板已删除", "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板删除失败", "err");
  }
}
async function renameTemplate(t: { _id: string; name: string; state: StandalonePrepSheet }): Promise<void> {
  const name = window.prompt("请输入新模板名称", t.name)?.trim();
  if (!name || name === t.name) return;
  try {
    await backend.updateStandaloneTemplate(t._id, { name, state: t.state });
    props.store.notify(`模板已改名为：${name}`, "ok");
    await openTplModal(tplMode.value);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板改名失败", "err");
  }
}

/** 表格单元格 textarea 自动撑高并持久化（需求：表单内容自动换行）。 */
function onRowInput(event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  props.store.persist();
}

// ===== 工序行拖拽排序（参照换发二级页表单工序卡：⠿ 柄拖动，目标位置虚线占位框） =====
const dragGhost = ref<{ left: number; top: number; width: number; height: number } | null>(null);
function clearDragGhost(): void { dragGhost.value = null; }
interface SpRowDrag { groupIdx: number; rowId: number; el: HTMLElement; startY: number; rowH: number; origOrder: number; curOrder: number }
let spRowDrag: SpRowDrag | null = null;
function onSpRowDragMove(e: PointerEvent): void {
  if (!spRowDrag) return;
  const d = spRowDrag;
  const dr = Math.round((e.clientY - d.startY) / d.rowH);
  d.curOrder = Math.max(0, d.origOrder + dr);
  d.el.style.transform = `translateY(${dr * d.rowH}px)`;
  // 占位虚线框：排除自身后，第 curOrder 个卡片的位置（超末尾取最后卡片底边）
  const container = d.el.parentElement;
  if (container) {
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".sp-process-card")).filter((r) => r !== d.el);
    const r0 = d.el.getBoundingClientRect();
    let top: number;
    if (d.curOrder >= rows.length) {
      top = rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom + 3 : r0.top;
    } else {
      top = rows[Math.max(0, d.curOrder)].getBoundingClientRect().top;
    }
    dragGhost.value = { left: r0.left, top, width: r0.width, height: r0.height };
  }
}
function onSpRowDragEnd(): void {
  if (spRowDrag) {
    const d = spRowDrag;
    props.store.spMoveProcessRow(d.groupIdx, d.rowId, d.curOrder);
    d.el.style.opacity = "";
    d.el.style.transform = "";
    d.el.style.zIndex = "";
  }
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onSpRowDragMove);
  window.removeEventListener("pointerup", onSpRowDragEnd);
  spRowDrag = null;
  clearDragGhost();
}
function startSpRowDrag(e: PointerEvent, groupIdx: number, rowId: number): void {
  e.preventDefault();
  const g = sheet.value?.processGroups[groupIdx];
  if (!g) return;
  const idx = g.rows.findIndex((r) => r.id === rowId);
  if (idx < 0) return;
  const el = (e.currentTarget as HTMLElement).closest(".sp-process-card") as HTMLElement;
  spRowDrag = { groupIdx, rowId, el, startY: e.clientY, rowH: el.offsetHeight || 40, origOrder: idx, curOrder: idx };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onSpRowDragMove);
  window.addEventListener("pointerup", onSpRowDragEnd);
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
    <div v-if="dragGhost" class="drag-ghost" :style="{ left: dragGhost.left + 'px', top: dragGhost.top + 'px', width: dragGhost.width + 'px', height: dragGhost.height + 'px' }"></div>
    <div class="subpage-head">
      <h3 v-if="!titleEditing" class="sp-title" @click="startRenameTitle" title="点击修改名称">{{ sheet.title }}</h3>
      <input v-else class="sp-title-input" v-model="titleDraft" @blur="commitRenameTitle" @keydown.enter.prevent="commitRenameTitle" @keydown.esc.prevent="cancelRenameTitle" autofocus />
      <div class="subpage-actions">
        <label v-if="!titleEditing" class="ghost" @click="startRenameTitle">改名称</label>
        <button class="ghost" @click="openTplModal('load')">调取模板</button>
        <button class="ghost" @click="openTplModal('save')">保存模板</button>
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
        <!-- 工序卡片列表（UI 参照换发二级页表单工序卡：黄底标题区 + 白底内容区 + ⠿ 拖拽调序） -->
        <div class="sp-process-list">
          <div v-for="r in g.rows" :key="r.id" class="sp-process-card">
            <div class="sp-card-title">
              <div class="sp-card-drag" title="拖动调整行序" @pointerdown="startSpRowDrag($event, gi, r.id)">⠿</div>
              <textarea rows="1" v-model="r.工作步骤" @input="onRowInput" class="sp-cell" placeholder="工作步骤"></textarea>
            </div>
            <textarea rows="1" v-model="r.人员安排" @input="onRowInput" class="sp-cell sp-assign" placeholder="人员安排"></textarea>
            <textarea rows="1" v-model="r['检测&必检']" @input="onRowInput" class="sp-cell sp-check" placeholder="检测&必检"></textarea>
            <button class="sp-del-x" title="删除该行" @click="store.spRemoveProcessRow(gi, r.id)">×</button>
          </div>
        </div>
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

    <!-- 单项工作模板弹窗（调取/保存共用，与换发/APU 二级页一致：调取=仅加载；保存=新模板+覆盖/改名/删除） -->
    <div v-if="showTplModal" class="tpl-modal" @click.self="showTplModal = false">
      <div class="tpl-modal-card">
        <div class="tpl-modal-head"><h3>{{ tplMode === 'load' ? '调取模板' : '保存模板' }}</h3><button class="icon-btn" @click="showTplModal = false">×</button></div>
        <div v-if="tplMode === 'save'" class="tpl-save-row">
          <input ref="saveTplInputRef" v-model="saveTplName" placeholder="新模板名称" @keydown.enter="saveAsTemplate" />
          <button class="primary" @click="saveAsTemplate">保存为新模板</button>
        </div>
        <p v-if="templatesLoading" class="tpl-empty">加载中…</p>
        <template v-else-if="templates.length">
          <div v-for="t in templates" :key="t._id" class="tpl-row">
            <div class="tpl-info" :class="{ clickable: tplMode === 'load' }" @click="tplMode === 'load' && applyTemplate(t)"><strong>{{ t.name }}</strong><span>工序 {{ (t.state.processGroups || []).length }} 组 · 签署 {{ (t.state.signingRows || []).length }} 行</span></div>
            <div class="tpl-actions">
              <button v-if="tplMode === 'load'" class="ghost" @click="applyTemplate(t)">加载</button>
              <template v-else>
                <button class="ghost" @click="overwriteTemplate(t)">覆盖</button>
                <button class="ghost" @click="renameTemplate(t)">改名</button>
                <button class="ghost danger" @click="deleteTemplate(t)">删除</button>
              </template>
            </div>
          </div>
        </template>
        <p v-else class="tpl-empty">暂无模板。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp-sheet { padding: 4px 2px 40px; }
.sp-title { margin: 0; font-size: var(--fs-18); cursor: pointer; padding: 4px 6px; border-radius: var(--r-sm); }
.sp-title:hover { background: #eef2fa; }
.sp-title-input { font-size: var(--fs-18); padding: 4px 8px; border: 1px solid #6f8ad6; border-radius: var(--r-sm); min-width: 240px; }
.prep-block { margin-bottom: 18px; background: #fff; border: 1px solid var(--n3); border-radius: var(--r-lg); padding: 12px 14px; }
.prep-block h4 { margin: 0 0 10px; font-size: var(--fs-14); background: var(--blue); color: #fff; padding: 8px 12px; border-radius: var(--r-md); }
.sp-sub-h4 { margin: 18px 0 10px; }
.field-label { font-size: var(--fs-13); color: #000; font-weight: 500; }
.prep-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 14px; margin-bottom: 8px; }
.prep-field { display: flex; flex-direction: column; gap: 4px; }
.prep-field input, .prep-field textarea { padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.special-config { color: #c0392b !important; font-weight: 700 !important; }
.prep-personnel-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
.prep-personnel-cell { display: flex; flex-direction: column; gap: 4px; }
.prep-personnel-cell input { padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.prep-personnel-fullrow { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.prep-personnel-fullrow textarea { padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); resize: vertical; }
.prep-extra-grid { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.prep-extra-item { display: flex; gap: 6px; align-items: stretch; }
.extra-title { flex: 0 0 18%; min-width: 80px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.extra-value { flex: 1 1 0; min-width: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.danger-cell { padding: 6px 10px; border: 1px solid #f2cdcd; background: #fdecec; color: #b53a3a; border-radius: var(--r-sm); font-size: var(--fs-12); cursor: pointer; }
.prep-block-actions { margin-top: 10px; display: flex; gap: 8px; }
.sp-works { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.sp-work-row { display: flex; gap: 6px; align-items: stretch; }
.sp-idx { flex: 0 0 24px; display: flex; align-items: center; justify-content: center; color: var(--n6); font-size: var(--fs-13); }
.sp-w-no { flex: 0 0 22%; min-width: 90px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.sp-w-content { flex: 1 1 0; min-width: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.sp-parts { display: flex; flex-direction: column; gap: 10px; }
.sp-part-card { border: 1px solid var(--n3); border-radius: var(--r-md); padding: 10px 12px; background: var(--n1); }
.sp-part-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 600; color: #4a5160; }
.sp-part-body { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sp-subcard { display: flex; flex-direction: column; gap: 6px; }
.sp-sub-title { font-size: var(--fs-13); font-weight: 600; color: #185FA5; }
.sp-group-card { border: 1px solid var(--n3); border-radius: var(--r-md); padding: 10px 12px; margin-bottom: 12px; background: var(--n1); }
/* 工序卡片列表（UI 参照换发二级页表单工序卡：黄底标题区 + 白底内容区 + ⠿ 拖拽调序） */
.sp-process-list { display: flex; flex-direction: column; gap: 6px; }
.sp-process-card { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; border: 1px solid var(--line, #dde2ec); border-radius: var(--r-sm); padding: 3px 6px; background: #fff; }
.sp-process-card .sp-card-title {
  display: flex; align-items: center; gap: 2px;
  background: #FDCA17; border-radius: var(--r-sm);
  border-right: 2px solid #C9A227;
  flex: none; max-width: 85%; min-width: 0;
  padding: 2px 4px 2px 2px;
}
.sp-process-card .sp-card-title .sp-card-drag { cursor: grab; color: #000; font-size: var(--fs-13); flex: 0 0 auto; user-select: none; touch-action: none; }
.sp-process-card .sp-card-title .sp-card-drag:active { cursor: grabbing; }
.sp-process-card .sp-card-title textarea {
  flex: 1; min-width: 0; max-width: 40em; border: none; background: transparent;
  font-size: var(--fs-13); font-weight: 600; color: #000; padding: 2px 4px;
}
.sp-process-card .sp-card-title textarea:focus { background: #fff; border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus); color: var(--blue-dark, #2f5597); }
.sp-process-card .sp-cell { flex: 1; min-width: 90px; }
/* 人员安排/检测&必检：淡灰底，聚焦白底 */
.sp-process-card .sp-assign, .sp-process-card .sp-check { background: var(--n1); }
.sp-process-card .sp-assign:focus, .sp-process-card .sp-check:focus { background: #fff; }
/* 检测&必检：限宽约 8 个中文字符 */
.sp-process-card .sp-check { max-width: 8em; }
/* 删除 ×（紧凑红底圆角小按钮） */
.sp-del-x {
  flex: 0 0 auto; width: 26px; height: 26px; padding: 0;
  border: 1px solid #f2cdcd; border-radius: var(--r-sm);
  background: #fdecec; color: #b53a3a; font-size: var(--fs-16); line-height: 1;
  cursor: pointer;
}
.sp-del-x:hover { background: #f9dcdc; }
/* 拖拽占位虚线框（参照换发 drag-ghost：蓝色虚线 + 淡蓝底） */
.drag-ghost {
  position: fixed; z-index: 998; pointer-events: none;
  border: 1.5px dashed var(--blue, #4472c4); background: rgba(68, 114, 196, .08);
  border-radius: var(--r-sm);
}
.table-wrap { overflow-x: auto; }
.sp-table { width: 100%; border-collapse: collapse; min-width: 520px; }
.sp-table th, .sp-table td { border: 1px solid var(--n3); padding: 4px; text-align: left; font-size: var(--fs-13); vertical-align: top; }
.sp-table th { background: var(--n1); font-weight: 600; color: #000; }
.sp-cell { width: 100%; box-sizing: border-box; padding: 5px 6px; border: 1px solid transparent; border-radius: var(--r-sm); font-size: var(--fs-13); min-width: 0; resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word; line-height: 1.5; font-family: inherit; }
.sp-cell:focus { border-color: var(--focus); background: #fff; }
.sp-group-name { flex: 1 1 0; min-width: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent; font-weight: 600; font-size: var(--fs-14); color: #4a5160; }
.sp-group-name:hover, .sp-group-name:focus { border-color: var(--focus); background: #fff; }
.sp-part-name { flex: 1 1 0; min-width: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent; font-weight: 600; font-size: var(--fs-14); color: #4a5160; }
.sp-part-name:hover, .sp-part-name:focus { border-color: var(--focus); background: #fff; }
/* 单项工作模板弹窗 */
.tpl-modal { position: fixed; inset: 0; z-index: 300; background: rgba(15, 23, 42, .45); display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 24px 20px; }
.tpl-modal-card { background: #fff; border-radius: var(--r-lg); padding: 18px 20px; width: 520px; max-width: 100%; margin: 0 auto; box-shadow: 0 8px 30px rgba(0, 0, 0, .18); }
.tpl-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.tpl-modal-head h3 { font-size: var(--fs-16); margin: 0; color: #222; }
.tpl-save-row { display: flex; gap: 8px; margin-bottom: 12px; }
.tpl-save-row input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); }
.tpl-empty { color: #697386; font-size: var(--fs-13); text-align: center; padding: 14px 0; }
.tpl-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--n3); border-radius: var(--r-md); margin-bottom: 8px; }
.tpl-info { flex: 1; min-width: 0; }
.tpl-info.clickable { cursor: pointer; }
.tpl-info.clickable:hover strong { color: #4472c4; }
.tpl-info strong { display: block; font-size: var(--fs-14); color: #222; }
.tpl-info span { font-size: var(--fs-12); color: #697386; }
.tpl-actions { display: flex; gap: 6px; flex-shrink: 0; }
@media (max-width: 768px) {
  .prep-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .prep-personnel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .sp-part-body { grid-template-columns: 1fr; }
}
</style>
