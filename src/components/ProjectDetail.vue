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
import { backend } from "../api";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{
  "export-sheet": [displayCats: string[]];
  "export-image": [element: HTMLElement | null, subPageName?: string];
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
    if (!newType) return;
    const project = props.store.currentProject.value;
    if (!project || project.aircraftType === newType) return;
    props.store.setAircraftType(newType);
  },
  { immediate: true },
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

/** 工具清单子页「下载现场管控单」：按当前项目类型下载云端对应文件。 */
async function downloadControlDoc(): Promise<void> {
  const project = props.store.currentProject.value;
  if (!project) return;
  const docType = project.type || "";
  try {
    const res = await backend.listControlDocs();
    const doc = (res.data || []).find((d) => d.type === docType);
    if (!doc) { props.store.notify(`尚未上传「${docType || "当前类型"}」的现场管控单`); return; }
    const urlRes = await backend.getControlDocUrl(doc._id);
    const url = urlRes.data?.downloadUrl;
    if (!url) { props.store.notify("未获取到下载链接"); return; }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = doc.fileName || "";
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "下载失败");
  }
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

/** 二级页首行「依据工卡清单」：前端解析 xlsx → 后端计算（工卡分配 + 工具/航材筛选）→
 *  拉取云端权威结果显示。反馈合并为一条提示。 */
async function applyWorkCardListFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = await parseWorkCardList(file);
    if (!parsed.cards.length) { props.store.notify("未从表格 B 列解析到工卡号"); return; }
    const project = props.store.currentProject.value;
    if (!project) return;
    const res = await backend.applyWorkcard(project.id, {
      机号: parsed.机号,
      工作内容: parsed.工作内容,
      地点: parsed.地点,
      cards: parsed.cards.map((c) => ({ 项次: c.项次, 工卡号: c.工卡号, 工卡名称: c.工卡名称 })),
      aircraft_type: props.store.aircraftTypeFromPrep.value ?? undefined,
    });
    const d = res.data;
    let msg = `已写入 ${d?.written ?? 0} 条工卡，并填充工作准备单/工卡分配清单`;
    const parts: string[] = [];
    if (d?.tool_deleted) parts.push(`工具删除 ${d.tool_deleted} 个`);
    if (d?.tool_added) parts.push(`工具补充 ${d.tool_added} 个`);
    if (d?.material_deleted) parts.push(`航材删除 ${d.material_deleted} 个`);
    if (d?.material_added) parts.push(`航材补充 ${d.material_added} 个`);
    if (parts.length) msg += `；${parts.join("、")}`;
    subPage.value = "tools";
    props.store.notify(msg);
    // 后端已写入云端并 _bump_revision，拉取权威结果（其它端由轮询/watch 同步）。
    await props.store.loadRemote();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "解析表格失败");
  }
}

/** 工具清单子页「按卡筛选」按钮：调后端同一端点（筛选模式，不传 cards），再拉取权威结果。 */
async function runToolFilterByWorkcard(): Promise<void> {
  if (!isAcheck.value || isLibrary.value) return;
  const project = props.store.currentProject.value;
  if (!project) return;
  try {
    const res = await backend.applyWorkcard(project.id, { aircraft_type: props.store.aircraftTypeFromPrep.value ?? undefined });
    const d = res.data;
    const parts: string[] = [];
    if (d?.tool_deleted) parts.push(`工具删除 ${d.tool_deleted} 个`);
    if (d?.tool_added) parts.push(`工具补充 ${d.tool_added} 个`);
    if (d?.material_deleted) parts.push(`航材删除 ${d.material_deleted} 个`);
    if (d?.material_added) parts.push(`航材补充 ${d.material_added} 个`);
    props.store.notify(parts.length ? `已按卡筛选：${parts.join("、")}` : "清单无需变更");
    await props.store.loadRemote();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "按卡筛选失败");
  }
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
        <button @click="store.saveNow()">保存</button>
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
      <PrepSheet v-if="isAcheck && subPage === 'prep'" :store="store" @export-image="(el) => emit('export-image', el, '工作准备单')" />
      <WorkcardAssignment v-else-if="isAcheck && subPage === 'workcard'" :store="store" @export-image="(el) => emit('export-image', el, '工卡分配清单')" />

      <!-- 单独项目子页面 -->
      <StandalonePrepSheet v-if="isStandalone && subPage === 'prep'" :store="store" @export-image="(el) => emit('export-image', el, '单项准备单')" />
      <MaterialList v-else-if="isStandalone && subPage === 'material'" :store="store" @export-image="(el) => emit('export-image', el, '航材清单')" />

      <!-- A检 航材清单子页面 -->
      <MaterialList v-else-if="isAcheck && subPage === 'material'" :store="store" @export-image="(el) => emit('export-image', el, '航材清单')" />

      <!-- 航材标准库编辑（库模式） -->
      <MaterialList v-else-if="store.editingMaterialLibrary.value" :store="store" @export-image="(el) => emit('export-image', el, '航材标准库')" />

      <!-- 工具清单子页（统一布局：子页抬头 + 工具栏 + 红色提醒） -->
      <template v-if="store.active.value && ((!isAcheck && !isStandalone && !store.editingMaterialLibrary.value) || subPage === 'tools')">
        <div class="subpage-head">
          <h3>{{ isLibrary ? `${store.editingLibrary.value} 工具标准库` : '工具清单' }}</h3>
          <span v-if="!isLibrary" class="auto-filter-warning">自动模糊筛选，需人工复核</span>
          <div class="subpage-actions">
            <button v-if="isLibrary" class="ghost" @click="finishLibrary">完成</button>
            <button v-if="!isLibrary" class="ghost" @click="downloadControlDoc">下载现场管控单</button>
            <button class="ghost" @click="emit('export-image', capture, isLibrary ? '工具标准库' : '工具清单')">导出图片</button>
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
            <select :value="store.aircraftTypeFromPrep.value ?? ''" @change="changeAircraft"><option value="">无</option><option v-for="type in AIRCRAFT_TYPES" :key="type" :value="type">{{ type }}</option></select>
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
