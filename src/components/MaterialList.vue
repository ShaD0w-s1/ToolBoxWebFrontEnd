<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AIRCRAFT_TYPES, DEFAULT_CATEGORIES, type AircraftType } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import MaterialCategorySection from "./MaterialCategorySection.vue";
import { exportMaterialList, importMaterialList } from "../services/spreadsheet";
import { backend } from "../api";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-image": [element: HTMLElement | null] }>();

const captureRef = ref<HTMLElement | null>(null);
const isLibrary = computed(() => Boolean(props.store.editingMaterialLibrary.value));
const title = computed(() => isLibrary.value ? `${props.store.editingMaterialLibrary.value} 航材标准库` : "航材清单");
const state = computed(() => props.store.materialActive.value);
const cats = computed(() => props.store.materialCategories.value);
const addCatValue = ref("");
// 类型查询：输入或选择类型名，模糊过滤只显示包含匹配类型的部位卡片
const typeQuery = ref("");
watch(() => props.store.editingMaterialLibrary.value, () => { typeQuery.value = ""; });
watch(() => props.store.currentProject.value?.id, () => { typeQuery.value = ""; });
// 项目模式默认只显示 DEFAULT_CATEGORIES 六个部位；其它部位需手动选入(revealed)或有物品才显示。
const defaultMatSet = new Set<string>(DEFAULT_CATEGORIES);
const revealed = ref<string[]>([]);
watch(() => props.store.currentProject.value?.id, () => { revealed.value = []; });
const shownCats = computed(() => {
  const all = cats.value;
  let list: string[];
  if (isLibrary.value) {
    list = all;
  } else if (props.store.currentProject.value?.type === "A检") {
    // A检 严格仅显示 6 部位 + 手动选入的（不因有物品自动显示非默认部位）
    list = all.filter((c) => defaultMatSet.has(c) || revealed.value.includes(c));
  } else {
    const hasItems = new Set((props.store.materialActive.value?.items || []).map((it) => it.cat));
    list = all.filter((c) => defaultMatSet.has(c) || revealed.value.includes(c) || hasItems.has(c));
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
  // 标准库里尚未加入的部位 → 添加并带入数据
  for (const c of props.store.standardMaterialCategories.value) {
    if (!cats.value.includes(c)) opts.push({ value: c, label: c });
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
    // 从航材标准库添加该部位（带入其全部类型与物品）
    props.store.mAddCategoryFromStandard(value);
    if (!revealed.value.includes(value)) revealed.value.push(value);
  }
  addCatValue.value = "";
  select.value = "";
}

function changeAircraft(event: Event): void {
  const type = (event.target as HTMLSelectElement).value as AircraftType;
  props.store.setAircraftType(type);
}

function exportImage(): void { emit("export-image", captureRef.value); }
function exportTableXlsx(): void {
  if (!state.value) return;
  exportMaterialList(state.value, props.store.currentProject.value?.name || "航材清单");
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
    props.store.notify("航材清单导入完成");
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
    props.store.notify(`导入新部位完成：新增部位 ${addedCats} 个，补充航材 ${addedItems} 项`);
  } catch (error) { props.store.notify(error instanceof Error ? error.message : "导入失败"); }
}

/** 导入补充表格.xlsx：相同信息保留、不同信息覆盖、新增信息新增。 */
async function onImportSupplement(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const imported = await importMaterialList(file);
    if (!imported.items.length) { props.store.notify("未解析到航材数据"); return; }
    const { updated, added } = props.store.mergeMaterialImport(imported);
    props.store.notify(`导入补充完成：覆盖 ${updated} 项，新增 ${added} 项`);
  } catch (error) { props.store.notify(error instanceof Error ? error.message : "导入失败"); }
}

/** 航材清单子页「按卡筛选」按钮：调后端筛选模式（不传 cards），再拉取权威结果。 */
async function runMaterialFilterByWorkcard(): Promise<void> {
  if (isLibrary.value) return;
  const project = props.store.currentProject.value;
  if (!project || project.type !== "A检") return;
  try {
    const res = await backend.applyWorkcard(project.id, { aircraft_type: props.store.aircraftTypeFromPrep.value });
    const d = res.data;
    const parts: string[] = [];
    if (d?.tool_deleted) parts.push(`工具删除 ${d.tool_deleted} 个`);
    if (d?.tool_added) parts.push(`工具补充 ${d.tool_added} 个`);
    if (d?.material_deleted) parts.push(`航材删除 ${d.material_deleted} 个`);
    if (d?.material_added) parts.push(`航材补充 ${d.material_added} 个`);
    props.store.notify(parts.length ? `已按卡筛选：${parts.join("、")}` : "航材清单无需变更");
    await props.store.loadRemote();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "按卡筛选失败");
  }
}
</script>

<template>
  <div ref="captureRef" class="material-list">
    <div class="subpage-head">
      <h3>{{ title }}</h3>
      <span v-if="!isLibrary" class="auto-filter-warning">自动模糊筛选，需人工复核</span>
      <div class="subpage-actions">
        <button class="ghost" @click="exportImage">导出图片</button>
        <button class="ghost" @click="exportTableXlsx">导出表格</button>
        <button v-if="isLibrary" class="ghost" @click="finishLibrary">完成</button>
      </div>
    </div>

    <div class="toolbar">
      <select class="primary add-cat" :value="addCatValue" @change="onAddCategory" aria-label="添加部位">
        <option value="" disabled>+ 添加部位</option>
        <option value="__NEW__">新部位</option>
        <option v-for="o in addOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <label v-if="!isLibrary" class="field">机型
        <select :value="store.aircraftTypeFromPrep.value" @change="changeAircraft"><option v-for="type in AIRCRAFT_TYPES" :key="type">{{ type }}</option></select>
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
      <span class="spacer" />
      <div class="summary">全部合计 <b>{{ store.mAllTotal(shownCats) }}</b></div>
    </div>

    <div class="category-list">
      <MaterialCategorySection v-for="category in shownCats" :key="category" :store="store" :category="category" :highlighted="hasTypeQuery ? highlightedCats.has(category) : undefined" />
      <div v-if="!shownCats.length" class="empty-state">当前没有部位，点击“添加部位”开始录入航材。</div>
    </div>
  </div>
</template>

<style scoped>
.material-list { padding: 4px 2px 40px; }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 8px 0 12px; }
.add-cat { min-width: 140px; }
.field { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.summary { font-size: 13px; color: #4a5160; }
.empty-state { padding: 24px; color: #98a2b3; text-align: center; }
.auto-filter-warning { color: #d92020; font-weight: 700; font-size: 13px; margin-left: 4px; }
.clear-btn { border: 0; background: transparent; color: #888; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; margin-left: 2px; }
.clear-btn:hover { color: #d92020; }
</style>
