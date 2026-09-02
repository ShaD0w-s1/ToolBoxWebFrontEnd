<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AIRCRAFT_TYPES, FLAT_MATERIAL_CAT, type ToolItem } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import MaterialCategorySection from "./MaterialCategorySection.vue";
import FlatTypeList from "./FlatTypeList.vue";
import PartNoGroupCard from "./PartNoGroupCard.vue";
import { exportMaterialList, exportMaterialFlat, importMaterialList, importStateFlat } from "../services/spreadsheet";
import { backend } from "../api";
import { exportFileName } from "../utils/format";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-image": [element: HTMLElement | null] }>();

const captureRef = ref<HTMLElement | null>(null);
const isLibrary = computed(() => Boolean(props.store.editingMaterialLibrary.value));
// 单独项目类：航材清单与标准库脱钩 → 添加部位下拉不再提供「从航材标准库带入」选项。
const isStandalone = computed(() => props.store.currentProject.value?.type === "单独项目");
const title = computed(() => isLibrary.value ? `${props.store.editingMaterialLibrary.value} 航材标准库` : "航材清单");
const state = computed(() => props.store.materialActive.value);
const cats = computed(() => props.store.materialCategories.value);
const addCatValue = ref("");
// 「重复航材梳理」开关：开启后按件号合并，重复(≥2)件号归入「重复航材」，单件归入「单件航材」，取消部位卡片。
const dedupeMode = ref(false);
// 类型查询：输入或选择类型名，模糊过滤只显示包含匹配类型的部位卡片
const typeQuery = ref("");
watch(() => props.store.editingMaterialLibrary.value, () => { typeQuery.value = ""; });
watch(() => props.store.currentProject.value?.id, () => { typeQuery.value = ""; });
// 项目模式：仅显示有物品的部位 + 手动选入(revealed)的部位；无数据时不展示默认部位卡片。
const revealed = ref<string[]>([]);
watch(() => props.store.currentProject.value?.id, () => { revealed.value = []; });
const shownCats = computed(() => {
  const all = cats.value;
  let list: string[];
  if (isLibrary.value) {
    list = all;
  } else {
    const hasItems = new Set((props.store.materialActive.value?.items || []).map((it) => it.cat));
    list = all.filter((c) => hasItems.has(c) || revealed.value.includes(c));
  }
  // 类型查询：只显示包含匹配类型名的部位
  const tq = typeQuery.value.trim().toLowerCase();
  if (tq) {
    const items = props.store.materialActive.value?.items || [];
    list = list.filter((cat) => items.some((it) => it.cat === cat && (it.sub || "").toLowerCase().includes(tq)));
  }
  return list;
});
// 所有类型名（去重，供类型查询下拉选择）
const allTypes = computed<string[]>(() => {
  const items = props.store.materialActive.value?.items || [];
  return [...new Set(items.map((it) => it.sub || "").filter(Boolean))].sort();
});
// 是否有类型查询——有则 highlighted 控制部位展开/折叠
const hasTypeQuery = computed(() => typeQuery.value.trim().length > 0);
// 类型查询匹配的部位集合（用于 highlighted）
const highlightedCats = computed<Set<string>>(() => {
  if (!hasTypeQuery.value) return new Set();
  const tq = typeQuery.value.trim().toLowerCase();
  const items = props.store.materialActive.value?.items || [];
  return new Set(items.filter((it) => (it.sub || "").toLowerCase().includes(tq)).map((it) => it.cat));
});

// —— 重复航材梳理：按件号合并分组 ——
interface PartNoGroup { partNo: string; name: string; items: ToolItem[] }
const partGroups = computed<PartNoGroup[]>(() => {
  const items = props.store.materialActive.value?.items || [];
  const map = new Map<string, PartNoGroup>();
  for (const it of items) {
    const partNo = (it.partNo || "").trim();
    const key = partNo || `__nopart__${it.id}`; // 无件号：每件独立一组
    let g = map.get(key);
    if (!g) { g = { partNo, name: it.name, items: [] }; map.set(key, g); }
    if (!g.name && it.name) g.name = it.name;
    g.items.push(it);
  }
  return [...map.values()].sort((a, b) => (a.partNo || "\uffff").localeCompare(b.partNo || "\uffff"));
});
const duplicateGroups = computed(() => partGroups.value.filter((g) => g.items.length >= 2));
const singleGroups = computed(() => partGroups.value.filter((g) => g.items.length === 1));

// 添加部位下拉：被隐藏的已有部位（选入显示）+ 航材标准库里尚未加入的部位（添加并带入数据）+ 新部位
const addOptions = computed<Array<{ value: string; label: string }>>(() => {
  const opts: Array<{ value: string; label: string }> = [];
  if (isLibrary.value) {
    const present = new Set(cats.value);
    return props.store.standardMaterialCategories.value.filter((c) => !present.has(c)).map((c) => ({ value: c, label: c }));
  }
  const shown = new Set(shownCats.value);
  // 已有但被隐藏的部位 → 选入显示
  for (const c of cats.value) {
    if (!shown.has(c)) opts.push({ value: `__SHOW__::${c}`, label: `显示：${c}` });
  }
  // 标准库里尚未加入的部位 → 添加并带入数据（单独项目已与标准库脱钩，不提供带入）
  if (!isStandalone.value) {
    for (const c of props.store.standardMaterialCategories.value) {
      if (!cats.value.includes(c)) opts.push({ value: c, label: c });
    }
  }
  return opts;
});

function onAddCategory(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const value = select.value;
  if (value === "__NEW__") {
    const name = props.store.mAddNewCategory();
    if (name && !revealed.value.includes(name)) revealed.value.push(name);
  } else if (value.startsWith("__SHOW__::")) {
    const name = value.slice("__SHOW__::".length);
    if (name && !revealed.value.includes(name)) revealed.value.push(name);
  } else if (value) {
    // 从航材标准库添加该部位（带入其全部类型与物品）；单独项目已脱钩，忽略标准库名直选。
    if (!isStandalone.value) props.store.mAddCategoryFromStandard(value);
    if (!revealed.value.includes(value)) revealed.value.push(value);
  }
  addCatValue.value = "";
  select.value = "";
}

function exportImage(): void { emit("export-image", captureRef.value); }
/** 单独项目航材清单「添加类型」：不弹窗，直接新增一张默认名「新类型」的卡片（重名自动加序号），并自动置顶。 */
function addMaterialFlatType(): void {
  const active = props.store.materialActive.value;
  const used = new Set((active?.items || []).map((it) => (it.sub || "").trim()).filter(Boolean));
  let name = "新类型";
  for (let k = 2; used.has(name); k++) name = `新类型${k}`;
  props.store.mAddItem(FLAT_MATERIAL_CAT, name);
}
function exportTableXlsx(): void {
  if (!state.value) return;
  const name = exportFileName(props.store.currentProject.value?.name || "", "航材清单");
  // 单独项目清单无部位概念：导出扁平表（类型 | 件号 | 名称 | 数量 | 备注），不体现部位信息
  if (isStandalone.value) exportMaterialFlat(state.value, name);
  else exportMaterialList(state.value, name);
  props.store.notify("表格已导出");
}

async function finishLibrary(): Promise<void> {
  const type = props.store.editingMaterialLibrary.value;
  if (type) {
    try { await props.store.saveMaterialLibraryNow(type); props.store.notify(`${type} 航材标准库已完成保存`); }
    catch { props.store.notify("保存失败，但已留存本地"); }
  }
  props.store.backToList();
}

/** 导入 xlsx：整体替换当前航材清单。 */
async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const imported = await importMaterialList(file);
    if (!imported.items.length) { props.store.notify("未解析到航材数据"); return; }
    if (!window.confirm(`确认用导入的 ${imported.items.length} 项覆盖当前航材清单？`)) return;
    props.store.replaceMaterialActive(imported);
    props.store.notify("航材清单导入完成", "ok");
  } catch (error) { props.store.notify(error instanceof Error ? error.message : "导入失败"); }
}

/** 导入部位.xlsx：合并新部位 / 补充缺失物品（只补不覆盖）。 */
async function onImportNewSections(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const imported = await importMaterialList(file);
    const { addedCats, addedItems } = props.store.mergeMaterialSections(imported);
    props.store.notify(`导入新部位完成：新增部位 ${addedCats} 个，补充航材 ${addedItems} 项`, "ok");
  } catch (error) { props.store.notify(error instanceof Error ? error.message : "导入失败"); }
}

/** 导入补充表格.xlsx：相同信息保留、不同信息覆盖、新增信息新增。单独项目按扁平导入（无部位列兼容）。 */
async function onImportSupplement(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const imported = isStandalone.value
      ? await importStateFlat(file, FLAT_MATERIAL_CAT)
      : await importMaterialList(file);
    if (!imported.items.length) { props.store.notify("未解析到航材数据"); return; }
    const { updated, added } = props.store.mergeMaterialImport(imported);
    props.store.notify(`导入补充完成：覆盖 ${updated} 项，新增 ${added} 项`, "ok");
  } catch (error) { props.store.notify(error instanceof Error ? error.message : "导入失败"); }
}

/** 航材清单子页「清空清单」：弹窗确认后清空航材清单所有数据并立即同步后端。 */
async function clearMaterialList(): Promise<void> {
  const project = props.store.currentProject.value;
  if (!project) return;
  if (!window.confirm("确认清空航材清单的所有部位与航材？此操作不可撤销！")) return;
  await props.store.clearMaterialListNow();
  props.store.notify("航材清单已清空并同步", "ok");
}

/** 单独项目 + 无机型信息时，开放航材清单机型选择（两子页同步手动选机型）。 */
const canEditAircraft = computed(() => {
  const project = props.store.currentProject.value;
  return Boolean(project) && project!.type === "单独项目" && !props.store.aircraftTypeFromPrep.value;
});
function onAircraftChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const type = select.value as (typeof AIRCRAFT_TYPES)[number];
  if (!AIRCRAFT_TYPES.includes(type)) return;
  props.store.setAircraftType(type);
}

/** 航材清单子页「按卡筛选」按钮：调后端筛选模式（不传 cards），再拉取权威结果。 */
async function runMaterialFilterByWorkcard(): Promise<void> {
  if (isLibrary.value) return;
  const project = props.store.currentProject.value;
  if (!project || project.type !== "A检") return;
  try {
    const res = await backend.applyWorkcard(project.id, { aircraft_type: props.store.aircraftTypeFromPrep.value ?? undefined });
    const d = res.data;
    const parts: string[] = [];
    if (d?.tool_deleted) parts.push(`工具删除 ${d.tool_deleted} 个`);
    if (d?.tool_added) parts.push(`工具补充 ${d.tool_added} 个`);
    if (d?.material_deleted) parts.push(`航材删除 ${d.material_deleted} 个`);
    if (d?.material_added) parts.push(`航材补充 ${d.material_added} 个`);
    props.store.notify(parts.length ? `已按卡筛选：${parts.join("、")}` : "航材清单无需变更");
    await props.store.loadRemote();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "按卡筛选失败", "err");
  }
}
</script>

<template>
  <div ref="captureRef" class="material-list">
    <div class="subpage-head">
      <h3>{{ title }}</h3>
      <span v-if="!isLibrary && !isStandalone" class="auto-filter-warning">自动模糊筛选，需人工复核</span>
      <div class="subpage-actions">
        <button class="ghost" @click="exportImage">导出图片</button>
        <button class="ghost" @click="exportTableXlsx">导出表格</button>
        <button v-if="isLibrary" class="ghost" @click="finishLibrary">完成</button>
        <button v-if="!isLibrary" class="danger" @click="clearMaterialList">清空清单</button>
      </div>
    </div>

    <div class="toolbar">
      <select v-if="!isStandalone" class="primary add-cat" :value="addCatValue" @change="onAddCategory" aria-label="添加部位">
        <option value="" disabled>+ 添加部位</option>
        <option value="__NEW__">新部位</option>
        <option v-for="o in addOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <button v-else class="primary" @click="addMaterialFlatType" title="新增类型（默认名“新类型”，新类型卡片将显示在清单顶端）">+ 添加类型</button>
      <label v-if="!isLibrary && !isStandalone" class="field">机型
        <select :value="store.effectiveAircraftType.value ?? ''" :disabled="!canEditAircraft" @change="onAircraftChange" :aria-label="canEditAircraft ? '机型（可手动选择）' : '机型（由工作准备单推断）'"><option value="">无</option><option v-for="type in AIRCRAFT_TYPES" :key="type" :value="type">{{ type }}</option></select>
      </label>
      <label v-if="isLibrary" class="button">导入 xlsx<input hidden type="file" accept=".xlsx,.xls" @change="onImportFile" /></label>
      <label v-if="isLibrary" class="button">导入部位.xlsx<input hidden type="file" accept=".xlsx,.xls" @change="onImportNewSections" /></label>
      <label v-if="!isLibrary" class="button">导入补充表格<input hidden type="file" accept=".xlsx,.xls" @change="onImportSupplement" /></label>
      <button v-if="!isLibrary && store.currentProject.value?.type === 'A检'" class="button primary" @click="runMaterialFilterByWorkcard">按卡筛选</button>
      <label class="field">类型查询
        <input list="m-types" v-model="typeQuery" placeholder="输入/选择类型" />
        <datalist id="m-types"><option v-for="t in allTypes" :key="t" :value="t" /></datalist>
        <button v-if="typeQuery" class="clear-btn" type="button" @click="typeQuery = ''" aria-label="清空">×</button>
      </label>
      <label v-if="!isLibrary" class="field dedupe-toggle"><input type="checkbox" v-model="dedupeMode" /> 重复航材梳理</label>
      <span class="spacer" />
      <div class="summary">全部合计 <b>{{ store.mAllTotal(shownCats) }}</b></div>
    </div>

    <!-- 重复航材梳理：按件号合并，重复(≥2)与单件分开 -->
    <div v-if="dedupeMode" class="dedupe-view">
      <section class="dedupe-group">
        <h4 class="dedupe-title">重复航材（{{ duplicateGroups.length }} 种件号）</h4>
        <PartNoGroupCard v-for="g in duplicateGroups" :key="g.partNo || String(g.items[0].id)" :store="store" :part-no="g.partNo" :name="g.name" :items="g.items" />
        <div v-if="!duplicateGroups.length" class="empty-state">暂无重复航材。</div>
      </section>
      <section class="dedupe-group">
        <h4 class="dedupe-title">单件航材（{{ singleGroups.length }} 种件号）</h4>
        <PartNoGroupCard v-for="g in singleGroups" :key="g.partNo || String(g.items[0].id)" :store="store" :part-no="g.partNo" :name="g.name" :items="g.items" />
        <div v-if="!singleGroups.length" class="empty-state">暂无单件航材。</div>
      </section>
    </div>

    <div v-else-if="isStandalone" class="category-list">
      <FlatTypeList :store="store" kind="material" :query="typeQuery" />
    </div>

    <div v-else class="category-list">
      <MaterialCategorySection v-for="category in shownCats" :key="category" :store="store" :category="category" :highlighted="hasTypeQuery ? highlightedCats.has(category) : undefined" />
      <div v-if="!shownCats.length" class="empty-state">当前没有部位，点击“添加部位”开始录入航材。</div>
    </div>
  </div>
</template>

<style scoped>
.material-list { padding: 4px 2px 40px; }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 8px 0 12px; }
.add-cat { min-width: 140px; }
.field { display: flex; align-items: center; gap: 6px; font-size: var(--fs-13); }
.dedupe-toggle { cursor: pointer; user-select: none; white-space: nowrap; }
.dedupe-toggle input { accent-color: var(--blue); cursor: pointer; }
.summary { font-size: var(--fs-13); color: #4a5160; }
.empty-state { padding: 24px; color: #98a2b3; text-align: center; }
.auto-filter-warning { color: #d92020; font-weight: 700; font-size: var(--fs-13); margin-left: 4px; }
.clear-btn { border: 0; background: transparent; color: var(--n6); cursor: pointer; font-size: var(--fs-16); line-height: 1; padding: 0 2px; margin-left: 2px; }
.clear-btn:hover { color: #d92020; }
.dedupe-view { display: flex; flex-direction: column; gap: 18px; }
.dedupe-group { display: flex; flex-direction: column; gap: 8px; }
.dedupe-title { margin: 0 0 4px; font-size: var(--fs-16); color: var(--n8); }
</style>
