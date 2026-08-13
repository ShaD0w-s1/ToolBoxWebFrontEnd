<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AIRCRAFT_TYPES, DEFAULT_CATEGORIES, PROJECT_TYPES, type AircraftType } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { formatDate } from "../utils/format";
import CategorySection from "./CategorySection.vue";
import PrepSheet from "./PrepSheet.vue";
import WorkcardAssignment from "./WorkcardAssignment.vue";
import StandalonePrepSheet from "./StandalonePrepSheet.vue";
import MaterialList from "./MaterialList.vue";
import { parseWorkCardList } from "../services/workcard";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{
  "export-sheet": [displayCats: string[]];
  "export-image": [element: HTMLElement | null];
  "import-sheet": [file: File];
  "import-new-sections": [file: File];
  share: [];
}>();
const capture = ref<HTMLElement | null>(null);

/** A检项目：二级页拆为 工作准备单 / 工卡分配清单 / 工具清单 三个子页面。 */
const isAcheck = computed(() => {
  const project = props.store.currentProject.value;
  return Boolean(project) && !props.store.editingLibrary.value && project!.type === "A检";
});
/** 单独项目：二级页拆为 单项准备单 / 航材清单 / 工具清单 三个子页面。 */
const isStandalone = computed(() => {
  const project = props.store.currentProject.value;
  return Boolean(project) && !props.store.editingLibrary.value && project!.type === "单独项目";
});
const subPage = ref<"prep" | "workcard" | "material" | "tools">("prep");
watch(() => props.store.currentProject.value?.id, () => { subPage.value = "prep"; });

// 子页 → 顶层字段映射：切换子页时同步「正在编辑的字段」，供字段级 dirty 追踪 / 合并使用。
function fieldForSubPage(): "data" | "materialList" | "prepSheet" | "workcardAssignment" | "standalonePrepSheet" {
  if (subPage.value === "material") return "materialList";
  if (subPage.value === "tools") return "data";
  if (subPage.value === "workcard") return "workcardAssignment";
  return isStandalone.value ? "standalonePrepSheet" : "prepSheet";
}
watch([subPage, isAcheck, isStandalone], () => props.store.setEditingField(fieldForSubPage()), { immediate: true });

// 修复 2：工作准备单机号/机型变化 → 自动切换工具清单机型并覆盖数据（无需弹窗确认）。
watch(
  () => props.store.aircraftTypeFromPrep.value,
  (newType) => {
    const project = props.store.currentProject.value;
    if (!project || project.aircraftType === newType) return;
    props.store.setAircraftType(newType);
  },
);

// “添加部位”下拉：默认占位项；选“新部位”添加未命名新部位；选标准部位则从标准库带入该部位卡片
const addCatValue = ref("");
// 项目（二级）页默认只显示 DEFAULT_CATEGORIES 中的部位；其余已有部位需手动选入后才显示。
// revealed 记录用户从下拉中“选入显示”的非默认部位；切换项目时清空。
const revealed = ref<string[]>([]);
watch(() => props.store.currentProject.value?.id, () => { revealed.value = []; });
const isLibrary = computed(() => Boolean(props.store.editingLibrary.value));
// 标准库（工具标准库）部位查询：输入或选择部位名，模糊过滤显示的部位卡片。
const libQuery = ref("");
watch(() => props.store.editingLibrary.value, () => { libQuery.value = ""; });
// 工作查询：输入或选择工作名，模糊过滤只显示包含匹配工作的部位卡片
const workQuery = ref("");
watch(() => props.store.currentProject.value?.id, () => { workQuery.value = ""; });
// 集中显示要渲染的部位：标准库页显示全部；A检 项目页严格仅显示 DEFAULT_CATEGORIES 六个部位 + 手动选入(revealed)；
// 其它项目页显示默认 6 个 + 被手动选入 或 已有物品 的部位。
const defaultSet = new Set<string>(DEFAULT_CATEGORIES);
const displayCats = computed<string[]>(() => {
  const state = props.store.active.value;
  if (!state) return [];
  let cats: string[];
  if (isLibrary.value) cats = state.categories;
  else if (isAcheck.value) {
    // A检 严格仅显示 6 部位 + 手动选入的（不因有物品自动显示非默认部位）
    const present = new Set(state.categories);
    const defaults = DEFAULT_CATEGORIES.filter((cat) => present.has(cat));
    const extras = state.categories.filter((cat) => !defaultSet.has(cat) && revealed.value.includes(cat));
    cats = [...defaults, ...extras];
  } else {
    const present = new Set(state.categories);
    const defaults = DEFAULT_CATEGORIES.filter((cat) => present.has(cat));
    const hasItems = new Set(state.items.map((it) => it.cat));
    const extras = state.categories.filter((cat) => !defaultSet.has(cat) && (revealed.value.includes(cat) || hasItems.has(cat)));
    cats = [...defaults, ...extras];
  }
  // 标准库部位查询：模糊匹配部位名（不区分大小写）
  const q = libQuery.value.trim().toLowerCase();
  if (q) cats = cats.filter((c) => c.toLowerCase().includes(q));
  // 工作查询：只显示包含匹配工作名的部位
  const wq = workQuery.value.trim().toLowerCase();
  if (wq) {
    cats = cats.filter((cat) => state.items.some((it) => it.cat === cat && (it.sub || "").toLowerCase().includes(wq)));
  }
  return cats;
});
// 所有工作名（去重，供工作查询下拉选择）
const allWorks = computed<string[]>(() => {
  const items = props.store.active.value?.items || [];
  return [...new Set(items.map((it) => it.sub || "").filter(Boolean))].sort();
});
// 是否有工作查询——有则 highlighted 控制部位展开/折叠
const hasWorkQuery = computed(() => workQuery.value.trim().length > 0);
const highlightedCats = computed<Set<string>>(() => {
  if (!hasWorkQuery.value) return new Set();
  const wq = workQuery.value.trim().toLowerCase();
  const items = props.store.active.value?.items || [];
  return new Set(items.filter((it) => (it.sub || "").toLowerCase().includes(wq)).map((it) => it.cat));
});
// 项目页“添加部位”下拉可选项：被隐藏的已有部位（选入显示）+ 标准库里尚未加入的部位（添加并带入数据）。
// 单独项目工具清单去除 ENG / FC / AV CB / LG 选项（这些部位由航材/工卡流程管理，不在工具清单添加）。
const STANDALONE_HIDDEN_CATS = new Set(["ENG", "FC", "AV CB", "LG"]);
const projectAddOptions = computed<Array<{ value: string; label: string }>>(() => {
  const state = props.store.active.value;
  const opts: Array<{ value: string; label: string }> = [];
  if (!state) return opts;
  const isStandaloneProject = props.store.currentProject.value?.type === "单独项目";
  const shown = displayCats.value;
  for (const cat of state.categories) {
    if (!shown.includes(cat)) opts.push({ value: cat, label: `显示：${cat}` });
  }
  for (const cat of props.store.standardCategories.value) {
    if (isStandaloneProject && STANDALONE_HIDDEN_CATS.has(cat)) continue;
    if (state.categories.includes(cat)) continue;
    opts.push({ value: cat, label: `添加：${cat}` });
  }
  return opts;
});

function onAddCategory(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const value = select.value;
  const state = props.store.active.value;
  if (value === "__NEW__") {
    const name = props.store.addNewCategory();
    if (name && !isLibrary.value && !revealed.value.includes(name)) revealed.value.push(name);
  } else if (!isLibrary.value && state && state.categories.includes(value)) {
    // 项目页：选入一个被隐藏的已有部位
    if (!revealed.value.includes(value)) revealed.value.push(value);
  } else {
    // 库内补充 或 项目页从标准库添加（非默认部位需同时加入显示集合）
    props.store.addCategoryFromStandard(value);
    if (!isLibrary.value && !revealed.value.includes(value)) revealed.value.push(value);
  }
  addCatValue.value = "";
  select.value = "";
}

function changeAircraft(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const type = select.value as AircraftType;
  // 修复 2：自动覆盖无需弹窗人工确认。
  props.store.setAircraftType(type);
}

function importFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) emit("import-sheet", file);
  input.value = "";
}

function importNewSectionsFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) emit("import-new-sections", file);
}

/** 需求 8：修改项目类型，弹窗确认。 */
function onTypeChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const newType = select.value as typeof PROJECT_TYPES[number] | "";
  const project = props.store.currentProject.value;
  if (!project || project.type === newType) return;
  if (!window.confirm(`确认将项目类型从"${project.type || "未选择"}"修改为"${newType || "未选择"}"？`)) {
    select.value = project.type;
    return;
  }
  props.store.updateProjectType(project, newType);
}

/** 需求 12：清空当前项目所有数据（含工作准备单/工卡分配清单/工具清单）。修复 2：调 clearProjectAllData。 */
function clearProjectAll(): void {
  const project = props.store.currentProject.value;
  if (!project) return;
  if (!window.confirm(`确认清空"${project.name}"的所有数据（工作准备单、工卡分配清单、工具清单）？此操作不可撤销！`)) return;
  props.store.clearProjectAllData();
}

/** 数据库（工具标准库）页内"完成"：保存到云端并提示后返回列表（替代原一级卡片上的完成按钮）。 */
async function finishLibrary(): Promise<void> {
  const type = props.store.editingLibrary.value;
  if (type) {
    try {
      await props.store.saveLibraryNow(type);
      props.store.notify(`${type} 工具标准库已完成保存`);
    } catch {
      props.store.notify("保存失败，但已留存本地");
    }
  }
  props.store.backToList();
}

/** 二级页首行「依据工卡清单」：导入工卡清单后——
 *  1) 填充工作准备单/工卡分配清单（工卡号）；
 *  2) A检 项目激活工具清单/航材清单：用工卡分配清单里的「工卡名称」按 3连续字匹配，从对应机型标准库
 *     增删 ENG/AV CB/FC/LG 部位卡片；通用/接机（工具）/通用（航材）完整引用；各部位「固定」完整引用+置顶。
 *  反馈合并为一条提示。 */
async function applyWorkCardListFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = await parseWorkCardList(file);
    if (!parsed.cards.length) { props.store.notify("未从表格 B 列解析到工卡号"); return; }
    const written = props.store.applyWorkCardList(parsed);
    let msg = `已写入 ${written} 条工卡，并填充工作准备单/工卡分配清单`;
    if (isAcheck.value) {
      const t = props.store.applyAcheckToolByWorkcard();
      const m = props.store.applyAcheckMaterialByWorkcard();
      const tp: string[] = [];
      if (t.deleted > 0) tp.push(`工具删除 ${t.deleted} 个`);
      if (t.added > 0) tp.push(`工具补充 ${t.added} 个`);
      if (tp.length) msg += `；${tp.join("、")}`;
      const mp: string[] = [];
      if (m.deleted > 0) mp.push(`航材删除 ${m.deleted} 个`);
      if (m.added > 0) mp.push(`航材补充 ${m.added} 个`);
      if (mp.length) msg += `；${mp.join("、")}`;
    }
    subPage.value = "tools";
    props.store.notify(msg);
    // 依据工卡清单后立即推送+拉取，触发全项目强制同步一次（不等 autoSync/轮询）。
    void props.store.forceSync();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "解析表格失败");
  }
}

/** 工具清单子页「按卡筛选」按钮：手动激活一次，按工卡分配清单的工卡名称做筛选与增减。 */
function runToolFilterByWorkcard(): void {
  if (!isAcheck.value || isLibrary.value) return;
  const t = props.store.applyAcheckToolByWorkcard();
  const parts: string[] = [];
  if (t.deleted > 0) parts.push(`删除 ${t.deleted} 个`);
  if (t.added > 0) parts.push(`补充 ${t.added} 个`);
  props.store.notify(parts.length ? `工具清单已按卡筛选：${parts.join("、")}` : "工具清单无需变更");
}
</script>

<template>
  <section v-if="store.active.value || store.editingMaterialLibrary.value" ref="capture">
    <div class="detail-sticky">
      <header class="detail-head">
        <button @click="store.backToList">← 返回</button>
        <div><strong>{{ store.detailTitle.value }}</strong><span>{{ store.currentProject.value ? formatDate(store.currentProject.value.createdAt) : '机型标准数据库' }}</span></div>
      </header>

      <!-- 二级页首行共享按钮（所有项目类型公用，修复 3）。单独项目隐藏「依据工卡清单」（不走工卡流程）。 -->
      <div v-if="store.currentProject.value && !store.editingLibrary.value" class="toolbar top-row">
        <label v-if="!isStandalone" class="button primary">依据工卡清单<input hidden type="file" accept=".xlsx,.xls" @change="applyWorkCardListFile" /></label>
        <select v-if="store.currentProject.value" :value="store.currentProject.value.type" @change="onTypeChange" aria-label="项目类型" class="type-select" :class="{ 'type-acheck': store.currentProject.value.type === 'A检' }">
          <option value="">类型：未选择</option>
          <option v-for="t in PROJECT_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
        <button @click="emit('share')">分享本页</button>
        <button @click="store.refresh()">刷新</button>
        <span class="spacer" />
        <span class="hint">导入 AMES线控平台-打印其他 中的《例行工卡清单》</span>
        <button class="danger" @click="clearProjectAll">清空数据</button>
      </div>

      <!-- A检：子页面切换 -->
      <nav v-if="isAcheck" class="tabs">
        <button class="tab" :class="{ active: subPage === 'prep' }" @click="subPage = 'prep'">工作准备单</button>
        <button class="tab" :class="{ active: subPage === 'workcard' }" @click="subPage = 'workcard'">工卡分配清单</button>
        <button class="tab" :class="{ active: subPage === 'material' }" @click="subPage = 'material'">航材清单</button>
        <button class="tab" :class="{ active: subPage === 'tools' }" @click="subPage = 'tools'">工具清单</button>
      </nav>

      <!-- 单独项目：子页面切换 -->
      <nav v-if="isStandalone" class="tabs">
        <button class="tab" :class="{ active: subPage === 'prep' }" @click="subPage = 'prep'">单项准备单</button>
        <button class="tab" :class="{ active: subPage === 'material' }" @click="subPage = 'material'">航材清单</button>
        <button class="tab" :class="{ active: subPage === 'tools' }" @click="subPage = 'tools'">工具清单</button>
      </nav>

      <!-- A检子页面 -->
      <PrepSheet v-if="isAcheck && subPage === 'prep'" :store="store" @export-image="emit('export-image', $event)" />
      <WorkcardAssignment v-else-if="isAcheck && subPage === 'workcard'" :store="store" @export-image="emit('export-image', $event)" />

      <!-- 单独项目子页面 -->
      <StandalonePrepSheet v-if="isStandalone && subPage === 'prep'" :store="store" @export-image="emit('export-image', $event)" />
      <MaterialList v-else-if="isStandalone && subPage === 'material'" :store="store" @export-image="emit('export-image', $event)" />

      <!-- A检 航材清单子页面 -->
      <MaterialList v-else-if="isAcheck && subPage === 'material'" :store="store" @export-image="emit('export-image', $event)" />

      <!-- 航材标准库编辑（库模式） -->
      <MaterialList v-else-if="store.editingMaterialLibrary.value" :store="store" @export-image="emit('export-image', $event)" />

      <!-- 工具清单子页（统一布局：子页抬头 + 工具栏 + 红色提醒） -->
      <template v-if="store.active.value && ((!isAcheck && !isStandalone && !store.editingMaterialLibrary.value) || subPage === 'tools')">
        <div class="subpage-head">
          <h3>{{ isLibrary ? `${store.editingLibrary.value} 工具标准库` : '工具清单' }}</h3>
          <span v-if="!isLibrary" class="auto-filter-warning">自动模糊筛选，需人工复核</span>
          <div class="subpage-actions">
            <button v-if="isLibrary" class="ghost" @click="finishLibrary">完成</button>
            <button class="ghost" @click="emit('export-image', capture)">导出图片</button>
            <button class="ghost" @click="emit('export-sheet', displayCats)">导出表格</button>
          </div>
        </div>
        <div class="toolbar">
          <select class="primary add-cat" :value="addCatValue" @change="onAddCategory" aria-label="添加部位">
            <option value="" disabled>+ 添加部位</option>
            <option value="__NEW__">新部位</option>
            <template v-if="isLibrary">
              <option v-for="cat in store.standardCategories.value" :key="cat" :value="cat">{{ cat }}</option>
            </template>
            <template v-else>
              <option v-for="opt in projectAddOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </template>
          </select>
          <label v-if="store.currentProject.value" class="field">机型
            <select :value="store.aircraftTypeFromPrep.value" @change="changeAircraft"><option v-for="type in AIRCRAFT_TYPES" :key="type">{{ type }}</option></select>
          </label>
          <label v-if="store.editingLibrary.value" class="button">导入 xlsx<input hidden type="file" accept=".xlsx,.xls" @change="importFile" /></label>
          <label v-if="store.editingLibrary.value" class="button">导入新部位.xlsx<input hidden type="file" accept=".xlsx,.xls" @change="importNewSectionsFile" /></label>
          <button v-if="isAcheck && !isLibrary" class="button primary" @click="runToolFilterByWorkcard">按卡筛选</button>
          <label v-if="!isLibrary" class="field">工作查询
            <input list="tool-works" v-model="workQuery" placeholder="输入/选择工作" />
            <datalist id="tool-works"><option v-for="w in allWorks" :key="w" :value="w" /></datalist>
            <button v-if="workQuery" class="clear-btn" type="button" @click="workQuery = ''" aria-label="清空">×</button>
          </label>
          <label v-if="!isLibrary" class="check"><input v-model="store.active.value.useCart" type="checkbox" @change="store.persist" /> 使用工具车</label>
          <label v-if="isLibrary" class="field">部位查询
            <input list="lib-cats" v-model="libQuery" placeholder="输入/选择部位" />
            <datalist id="lib-cats"><option v-for="c in store.active.value?.categories || []" :key="c" :value="c" /></datalist>
          </label>
          <span class="spacer" />
          <div class="summary">全部合计 <b>{{ store.allTotal(displayCats) }}</b></div>
        </div>

        <div class="category-list">
          <CategorySection v-for="category in displayCats" :key="category" :category="category" :store="store" :highlighted="hasWorkQuery ? highlightedCats.has(category) : undefined" />
          <div v-if="!displayCats.length" class="empty-state">当前没有部位，点击"添加部位"开始录入。</div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* 项目类型选择框：白底蓝字（全局 .type-select 已定义，此处仅保留 option 兜底） */
.type-select option { background: #fff; color: #333; }
/* 工具清单子页：红色提醒（标题后内联） */
.auto-filter-warning {
  color: #d92020;
  font-weight: 700;
  font-size: 13px;
  margin-left: 4px;
}
.clear-btn { border: 0; background: transparent; color: #888; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; margin-left: 2px; }
.clear-btn:hover { color: #d92020; }
</style>
