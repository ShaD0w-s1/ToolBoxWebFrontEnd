<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AIRCRAFT_TYPES, DEFAULT_CATEGORIES, type Project, type ToolItem } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import CategorySection from "./CategorySection.vue";
import PrepSheet from "./PrepSheet.vue";
import WorkcardAssignment from "./WorkcardAssignment.vue";
import StandalonePrepSheet from "./StandalonePrepSheet.vue";
import MaterialList from "./MaterialList.vue";
import GanttPrep from "./GanttPrep.vue";
import ProjectFormModal from "./ProjectFormModal.vue";
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
// 修订弹窗目标项目：null=隐藏，否则为该项目的修订弹窗。
const editTarget = ref<Project | null>(null);

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
/** 换发/APU 项目：二级页拆为 工作准备单(甘特) / 航材清单 / 工具清单 三个子页面。 */
const isEngApu = computed(() => {
  const project = props.store.currentProject.value;
  return Boolean(project) && !props.store.editingLibrary.value && project!.type === "换发/APU";
});
const subPage = ref<"prep" | "workcard" | "material" | "tools" | "gantt">("prep");
watch(() => props.store.currentProject.value?.id, () => {
  subPage.value = props.store.currentProject.value?.type === "换发/APU" ? "gantt" : "prep";
}, { immediate: true });
/** 面包屑：当前子页标签（UI/UX 审计规范新增）。 */
const subPageLabel = computed(() => {
  if (props.store.editingLibrary.value || props.store.editingMaterialLibrary.value) return "机型标准数据库";
  const map: Record<string, string> = { prep: "工作准备单", workcard: "工卡分配清单", material: "航材清单", tools: "工具清单", gantt: "换发/APU 准备单" };
  return map[subPage.value] || "";
});

// 子页 → 顶层字段映射：切换子页时同步「正在编辑的字段」，供字段级 dirty 追踪 / 合并使用。
function fieldForSubPage(): "data" | "materialList" | "prepSheet" | "workcardAssignment" | "standalonePrepSheet" | "ganttPrep" {
  if (subPage.value === "material") return "materialList";
  if (subPage.value === "tools") return "data";
  if (subPage.value === "workcard") return "workcardAssignment";
  if (subPage.value === "gantt") return "ganttPrep";
  return isStandalone.value ? "standalonePrepSheet" : "prepSheet";
}

// —— 工具清单「重复工具梳理」（对齐 A检 重复航材梳理）：按名称分组聚拢，重复≥2 归重复组、单件归单件组；数量/备注可编辑、可删除。——
const toolDedupeMode = ref(false);
interface ToolDedupeGroup { key: string; items: ToolItem[] }
const toolDedupeGroups = computed<ToolDedupeGroup[]>(() => {
  const items = props.store.active.value?.items || [];
  const map = new Map<string, ToolDedupeGroup>();
  for (const it of items) {
    const key = (it.name || "").trim() || `__no__${it.id}`; // 无名称：每件独立一组
    let g = map.get(key);
    if (!g) { g = { key, items: [] }; map.set(key, g); }
    g.items.push(it);
  }
  return [...map.values()].sort((a, b) => (a.key.startsWith("__no__") ? 1 : b.key.startsWith("__no__") ? -1 : a.key.localeCompare(b.key, "zh-CN")));
});
const toolDuplicates = computed(() => toolDedupeGroups.value.filter((g) => g.items.length >= 2));
const toolSingles = computed(() => toolDedupeGroups.value.filter((g) => g.items.length === 1));
function onToolDedupeNote(it: ToolItem): void {
  props.store.markNoteDirty(it);
  props.store.persist();
}
watch([subPage, isAcheck, isStandalone, isEngApu], () => props.store.setEditingField(fieldForSubPage()), { immediate: true });

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

/** 需求 12：清空当前项目所有数据（含工作准备单/工卡分配清单/工具清单）。修复 2：调 clearProjectAllData。 */
function clearProjectAll(): void {
  const project = props.store.currentProject.value;
  if (!project) return;
  if (!window.confirm(`确认清空"${project.name}"的所有数据（工作准备单、工卡分配清单、工具清单）？此操作不可撤销！`)) return;
  props.store.clearProjectAllData();
}

/** 工具清单子页「清空清单」：弹窗确认后清空工具清单所有数据并立即同步后端。 */
async function clearToolList(): Promise<void> {
  const project = props.store.currentProject.value;
  if (!project) return;
  if (!window.confirm("确认清空工具清单的所有部位与物品？此操作不可撤销！")) return;
  await props.store.clearToolListNow();
  props.store.notify("工具清单已清空并同步", "ok");
}

/** 单独项目 + 无机型信息时，开放工具/航材清单机型选择（两子页同步手动选机型）。 */
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
    props.store.notify(error instanceof Error ? error.message : "下载失败", "err");
  }
}

/** 数据库（工具标准库）页内"完成"：保存到云端并提示后返回列表（替代原一级卡片上的完成按钮）。 */
async function finishLibrary(): Promise<void> {
  const type = props.store.editingLibrary.value;
  if (type) {
    try {
      await props.store.saveLibraryNow(type);
      props.store.notify(`${type} 工具标准库已完成保存`, "ok");
    } catch {
      props.store.notify("保存失败，但已留存本地", "err");
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
    const typeText = d?.aircraft_type ? `识别机型：${d.aircraft_type}` : "未识别机型";
    let msg = `共解析 ${parsed.cards.length} 条工卡，已写入 ${d?.written ?? 0} 条，${typeText}，并填充工作准备单/工卡分配清单`;
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
    props.store.notify(error instanceof Error ? error.message : "解析表格失败", "err");
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
    props.store.notify(error instanceof Error ? error.message : "按卡筛选失败", "err");
  }
}
</script>

<template>
  <section v-if="store.active.value || store.editingMaterialLibrary.value" ref="capture">
    <div class="detail-sticky">
      <div v-if="store.currentProject.value" class="breadcrumb">
        <span class="cur" style="cursor:pointer" @click="store.backToList">项目列表</span>
        <span class="sep">/</span>
        <span>{{ store.detailTitle.value }}</span>
        <span class="sep">/</span>
        <span class="cur">{{ subPageLabel }}</span>
      </div>
      <header class="detail-head">
        <button @click="store.backToList">← 返回</button>
        <div>
          <strong>{{ store.detailTitle.value }}</strong>
          <span v-if="store.currentProject.value">{{ store.currentProject.value.aircraftType }} · {{ store.currentProject.value.executeDate || "未设置执行日期" }}</span>
          <span v-else>机型标准数据库</span>
        </div>
        <template v-if="store.currentProject.value">
          <span class="card-meta">{{ store.currentProject.value.type || "未选择类型" }}</span>
          <span class="card-meta">{{ store.currentProject.value.team || "未分配班组" }}</span>
          <button @click="editTarget = store.currentProject.value">修订</button>
        </template>
      </header>

      <!-- 二级页首行共享按钮（所有项目类型公用，修复 3）。单独项目/换发·APU 隐藏「依据工卡清单」（不走工卡流程）；
           换发/APU 的 分享/保存/刷新/清空数据 已并入 GanttPrep 自身 L1 工具条（输入框靠左、功能按钮靠右）。 -->
      <div v-if="store.currentProject.value && !store.editingLibrary.value && !isEngApu" class="toolbar top-row">
        <label v-if="!isStandalone && !isEngApu" class="button primary" title="导入 AMES线控平台-打印其他 中的《例行工卡清单》（八大件的工卡清单），网页会根据表单自动导入工卡并关联工具、航材">依据工卡清单<input hidden type="file" accept=".xlsx,.xls" @change="applyWorkCardListFile" /></label>
        <button @click="emit('share')">分享本页</button>
        <button title="强制推送后台" @click="store.saveNow()">保存</button>
        <button title="强制同步数据" @click="store.refresh()">刷新</button>
        <span v-if="!isEngApu" class="spacer" />
        <span v-if="!isEngApu" class="hint">导入 AMES线控平台-打印其他 中的《例行工卡清单》</span>
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

      <!-- 换发/APU：甘特准备单直接作为二级页主体（含 表单/甘特/手册/串件航材/串件工具 五子页） -->
      <GanttPrep v-if="isEngApu" :store="store" @share="emit('share')" />

      <!-- A检 航材清单子页面 -->
      <MaterialList v-else-if="isAcheck && subPage === 'material'" :store="store" @export-image="(el) => emit('export-image', el, '航材清单')" />

      <!-- 航材标准库编辑（库模式） -->
      <MaterialList v-else-if="store.editingMaterialLibrary.value" :store="store" @export-image="(el) => emit('export-image', el, '航材标准库')" />

      <!-- 工具清单子页（统一布局：子页抬头 + 工具栏 + 红色提醒） -->
      <template v-if="store.active.value && ((!isAcheck && !isStandalone && !isEngApu && !store.editingMaterialLibrary.value) || subPage === 'tools')">
        <div class="subpage-head">
          <h3>{{ isLibrary ? `${store.editingLibrary.value} 工具标准库` : '工具清单' }}</h3>
          <span v-if="!isLibrary" class="auto-filter-warning">自动模糊筛选，需人工复核</span>
          <div class="subpage-actions">
            <button v-if="isLibrary" class="ghost" @click="finishLibrary">完成</button>
            <button v-if="!isLibrary" class="ghost" @click="downloadControlDoc">下载现场管控单</button>
            <button class="ghost" @click="emit('export-image', capture, isLibrary ? '工具标准库' : '工具清单')">导出图片</button>
            <button class="ghost" @click="emit('export-sheet', displayCats)">导出表格</button>
            <button v-if="!isLibrary" class="danger" @click="clearToolList">清空清单</button>
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
            <select :value="store.effectiveAircraftType.value ?? ''" :disabled="!canEditAircraft" @change="onAircraftChange" :aria-label="canEditAircraft ? '机型（可手动选择）' : '机型（由工作准备单推断）'"><option value="">无</option><option v-for="type in AIRCRAFT_TYPES" :key="type" :value="type">{{ type }}</option></select>
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
          <label v-if="!isLibrary" class="field dedupe-toggle"><input type="checkbox" v-model="toolDedupeMode" /> 重复工具梳理</label>
          <label v-if="isLibrary" class="field">部位查询
            <input list="lib-cats" v-model="libQuery" placeholder="输入/选择部位" />
            <datalist id="lib-cats"><option v-for="c in store.active.value?.categories || []" :key="c" :value="c" /></datalist>
          </label>
          <span class="spacer" />
          <div class="summary">全部合计 <b>{{ store.allTotal(displayCats) }}</b></div>
        </div>

        <!-- 重复工具梳理：按名称分组聚拢，重复≥2 归重复组、单件归单件组；数量/备注可编辑、可删除 -->
        <div v-if="toolDedupeMode" class="dedupe-view">
          <section class="dedupe-group">
            <h4 class="dedupe-title">重复工具（{{ toolDuplicates.length }} 种名称）</h4>
            <div v-for="g in toolDuplicates" :key="g.key" class="tool-dedupe-card">
              <header class="tool-dedupe-head">
                <strong>{{ g.key }}</strong>
                <span class="tool-dedupe-count">× {{ g.items.length }}</span>
              </header>
              <div v-for="it in g.items" :key="it.id" class="tool-dedupe-row">
                <span class="tool-dedupe-type" :title="it.cat">{{ it.sub || "固定" }}</span>
                <input v-model.number="it.qty" type="number" min="0" class="tool-dedupe-qty" aria-label="数量" @input="store.persist" />
                <button class="tool-dedupe-del" title="删除该工具" @click="store.deleteItem(it.id)">×</button>
                <textarea v-model="it.note" rows="1" class="tool-dedupe-note" placeholder="备注" @input="onToolDedupeNote(it)"></textarea>
              </div>
            </div>
            <div v-if="!toolDuplicates.length" class="empty-state">暂无重复工具。</div>
          </section>
          <section class="dedupe-group">
            <h4 class="dedupe-title">单件工具（{{ toolSingles.length }} 种名称）</h4>
            <div v-for="g in toolSingles" :key="g.key" class="tool-dedupe-card">
              <header class="tool-dedupe-head">
                <strong>{{ g.key }}</strong>
                <span class="tool-dedupe-count">× 1</span>
              </header>
              <div v-for="it in g.items" :key="it.id" class="tool-dedupe-row">
                <span class="tool-dedupe-type" :title="it.cat">{{ it.sub || "固定" }}</span>
                <input v-model.number="it.qty" type="number" min="0" class="tool-dedupe-qty" aria-label="数量" @input="store.persist" />
                <button class="tool-dedupe-del" title="删除该工具" @click="store.deleteItem(it.id)">×</button>
                <textarea v-model="it.note" rows="1" class="tool-dedupe-note" placeholder="备注" @input="onToolDedupeNote(it)"></textarea>
              </div>
            </div>
            <div v-if="!toolSingles.length" class="empty-state">暂无单件工具。</div>
          </section>
        </div>

        <div class="category-list">
          <CategorySection v-for="category in displayCats" :key="category" :category="category" :store="store" :highlighted="hasWorkQuery ? highlightedCats.has(category) : undefined" />
          <div v-if="!displayCats.length" class="empty-state">当前没有部位，点击"添加部位"开始录入。</div>
        </div>
      </template>
    </div>

    <ProjectFormModal v-if="editTarget" :store="store" mode="edit" :project="editTarget" @close="editTarget = null" />
  </section>
  <section v-else class="detail-loading">
    <div class="sync-spinner" aria-hidden="true"></div>
    <p class="loading-state">数据加载中…</p>
    <button class="ghost" @click="store.backToList">← 返回列表</button>
  </section>
</template>

<style scoped>
/* 项目类型选择框：白底蓝字（全局 .type-select 已定义，此处仅保留 option 兜底） */
.type-select option { background: var(--n0); color: #333; }
/* 深链直开/数据未就绪时的加载空态 */
.detail-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; min-height: 60vh; color: var(--n7);
}
.detail-loading p { margin: 0; font-size: var(--fs-16); }
.detail-loading .sync-spinner {
  width: 30px; height: 30px; border: 3px solid #e5e7eb; border-top-color: #2563eb;
  border-radius: 50%; animation: detail-spin .8s linear infinite;
}
@keyframes detail-spin { to { transform: rotate(360deg); } }

/* 工具清单子页：红色提醒（标题后内联） */
.auto-filter-warning {
  color: #d92020;
  font-weight: 700;
  font-size: var(--fs-13);
  margin-left: 4px;
}
.clear-btn { border: 0; background: transparent; color: var(--n6); cursor: pointer; font-size: var(--fs-16); line-height: 1; padding: 0 2px; margin-left: 2px; }
.clear-btn:hover { color: #d92020; }
/* 重复工具梳理：按名称分组聚拢，数量/备注可编辑、可删除 */
.dedupe-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--fs-13); color: var(--n8); cursor: pointer; user-select: none; white-space: nowrap; }
.dedupe-toggle input { width: 15px; height: 15px; accent-color: var(--blue); }
.dedupe-view { display: flex; flex-direction: column; gap: 18px; margin-top: 4px; }
.dedupe-group { display: flex; flex-direction: column; gap: 8px; }
.dedupe-title { margin: 0 0 4px; font-size: var(--fs-16); color: var(--n8); }
.tool-dedupe-card { border: 1px solid #f0d9b8; background: #fff6e8; border-radius: var(--r-lg); overflow: hidden; }
.tool-dedupe-head { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: #fbead2; }
.tool-dedupe-head strong { font-size: var(--fs-14); color: var(--blue-dark); }
.tool-dedupe-count { font-size: var(--fs-12); font-weight: 700; color: #b45309; }
.tool-dedupe-row { display: grid; grid-template-columns: 1.2fr 0.5fr auto 2fr; gap: 6px; align-items: center; padding: 6px 10px; border-top: 1px dashed #f0d9b8; }
.tool-dedupe-type { font-size: var(--fs-13); color: var(--n8); padding: 4px 8px; background: #f4f6fb; border-radius: var(--r-sm); min-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tool-dedupe-qty { width: 100%; min-height: 30px; padding: 4px 6px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); box-sizing: border-box; }
.tool-dedupe-del { width: 26px; height: 26px; padding: 0; border: 1px solid #f2cdcd; border-radius: var(--r-sm); background: #fdecec; color: #b53a3a; font-size: var(--fs-16); line-height: 1; cursor: pointer; }
.tool-dedupe-del:hover { background: #f9dcdc; }
.tool-dedupe-note { min-height: 30px; padding: 4px 7px; border: 1px dashed var(--line); border-radius: var(--r-sm); font-size: var(--fs-12); resize: none; overflow: hidden; font-family: inherit; line-height: 1.4; box-sizing: border-box; width: 100%; background: var(--n0); }
</style>
