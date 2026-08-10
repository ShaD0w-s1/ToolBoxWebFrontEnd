<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AIRCRAFT_TYPES, DEFAULT_CATEGORIES, type AircraftType } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { formatDate } from "../utils/format";
import CategorySection from "./CategorySection.vue";
import { parseWorkCardXlsx } from "../services/workcard";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{
  "export-sheet": [];
  "export-image": [element: HTMLElement | null];
  "import-sheet": [file: File];
  "import-new-sections": [file: File];
  share: [];
}>();
const capture = ref<HTMLElement | null>(null);

// “添加部位”下拉：默认占位项；选“新部位”添加未命名新部位；选标准部位则从标准库带入该部位卡片
const addCatValue = ref("");
// 项目（二级）页默认只显示 DEFAULT_CATEGORIES 中的部位；其余已有部位需手动选入后才显示。
// revealed 记录用户从下拉中“选入显示”的非默认部位；切换项目时清空。
const revealed = ref<string[]>([]);
watch(() => props.store.currentProject.value?.id, () => { revealed.value = []; });
const isLibrary = computed(() => Boolean(props.store.editingLibrary.value));
// 集中显示要渲染的部位：标准库页显示全部；项目页只显示默认 6 个 + 被手动选入的部位。
const defaultSet = new Set<string>(DEFAULT_CATEGORIES);
const displayCats = computed<string[]>(() => {
  const state = props.store.active.value;
  if (!state) return [];
  if (isLibrary.value) return state.categories;
  const present = new Set(state.categories);
  const defaults = DEFAULT_CATEGORIES.filter((cat) => present.has(cat));
  const extras = state.categories.filter((cat) => !defaultSet.has(cat) && revealed.value.includes(cat));
  return [...defaults, ...extras];
});
// 项目页“添加部位”下拉可选项：被隐藏的已有部位（选入显示）+ 标准库里尚未加入的部位（添加并带入数据）。
const projectAddOptions = computed<Array<{ value: string; label: string }>>(() => {
  const state = props.store.active.value;
  const opts: Array<{ value: string; label: string }> = [];
  if (!state) return opts;
  const shown = displayCats.value;
  for (const cat of state.categories) {
    if (!shown.includes(cat)) opts.push({ value: cat, label: `显示：${cat}` });
  }
  for (const cat of props.store.standardCategories.value) {
    if (!state.categories.includes(cat)) opts.push({ value: cat, label: `添加：${cat}` });
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
  if (!window.confirm(`切换到 ${type} 会用对应标准库重置当前项目，是否继续？`)) {
    if (props.store.currentProject.value) select.value = props.store.currentProject.value.aircraftType;
    return;
  }
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

function clear() {
  if (window.confirm(`确认清空“${props.store.detailTitle.value}”的全部数据？`)) props.store.clearActive();
}

async function applyWorkCard(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const { workContents, rowCount } = await parseWorkCardXlsx(file);
    if (!rowCount) { props.store.notify("表格的 E/G 列中未找到有效内容"); return; }
    const toDelete = props.store.previewFilterByWorkCard(workContents);
    const toAdd = props.store.previewAddFromStandard(workContents);
    if (toDelete === 0 && toAdd === 0) { props.store.notify("没有需要变更的工作卡片"); return; }
    const lines: string[] = [];
    if (toDelete > 0) lines.push(`· 删除 ${toDelete} 个不相关的工作卡片（保留“固定”工作及“通用”“接机”部位）`);
    if (toAdd > 0) lines.push(`· 从标准库补充 ${toAdd} 个相关工作卡片到对应部位`);
    if (!window.confirm(`依据工卡清单（E/G 列），将：\n${lines.join("\n")}\n\n确认执行？`)) return;
    const deleted = props.store.filterByWorkCard(workContents);
    const added = props.store.addMissingFromStandard(workContents);
    const parts: string[] = [];
    if (deleted > 0) parts.push(`删除 ${deleted} 个`);
    if (added > 0) parts.push(`补充 ${added} 个`);
    props.store.notify(`已依据工卡清单${parts.join("、")}工作卡片`);
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "解析表格失败");
  }
}
</script>

<template>
  <section v-if="store.active.value" ref="capture">
    <div class="detail-sticky">
      <header class="detail-head">
        <button @click="store.backToList">← 返回</button>
        <div><strong>{{ store.detailTitle.value }}</strong><span>{{ store.currentProject.value ? formatDate(store.currentProject.value.createdAt) : '机型标准数据库' }}</span></div>
      </header>

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
          <select :value="store.currentProject.value.aircraftType" @change="changeAircraft"><option v-for="type in AIRCRAFT_TYPES" :key="type">{{ type }}</option></select>
        </label>
        <label v-if="store.editingLibrary.value" class="button">导入 xlsx<input hidden type="file" accept=".xlsx,.xls" @change="importFile" /></label>
        <label v-if="store.editingLibrary.value" class="button">导入新部位.xlsx<input hidden type="file" accept=".xlsx,.xls" @change="importNewSectionsFile" /></label>
        <label v-if="store.currentProject.value" class="button">依据工卡清单<input hidden type="file" accept=".xlsx,.xls" @change="applyWorkCard" /></label>
        <label class="check"><input v-model="store.active.value.useCart" type="checkbox" @change="store.persist" /> 使用工具车</label>
        <button @click="emit('export-sheet')">导出表格</button>
        <button @click="emit('export-image', capture)">导出图片</button>
        <button @click="emit('share')">分享本页</button>
        <span class="spacer" />
        <div class="summary">全部合计 <b>{{ store.allTotal() }}</b></div>
        <button class="danger" @click="clear">清空数据</button>
      </div>
    </div>

    <nav class="tabs">
      <button class="tab" :class="{ active: store.detailTab.value === 'display' }" @click="store.detailTab.value = 'display'">集中显示</button>
      <button class="tab" :class="{ active: store.detailTab.value === 'database' }" @click="store.detailTab.value = 'database'">数据库</button>
    </nav>

    <div v-if="store.detailTab.value === 'display'" class="category-list">
      <CategorySection v-for="category in displayCats" :key="category" :category="category" :store="store" />
      <div v-if="!displayCats.length" class="empty-state">当前没有部位，点击“添加部位”开始录入。</div>
    </div>

    <div v-else>
      <div class="toolbar"><button class="primary" @click="store.addItem(store.active.value.categories[0] || 'A', '新工作', true)">+ 添加行</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>部位</th><th>工作</th><th>物品</th><th>数量</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="item in store.active.value.items" :key="item.id" :class="{ duplicate: store.isCartDuplicate(item.name) }">
            <td><select v-model="item.cat" @change="store.persist"><option v-for="category in store.active.value.categories" :key="category">{{ category }}</option></select></td>
            <td><input v-model="item.sub" @input="store.persist" /></td>
            <td><input v-model="item.name" @input="store.persist" /></td>
            <td><input v-model.number="item.qty" type="number" min="0" @input="store.persist" /></td>
            <td><button class="danger" @click="store.deleteItem(item.id)">删除</button></td>
          </tr>
        </tbody>
      </table></div>
      <p class="list-status">数据库为“部位 → 工作 → 物品 × 数量”的关系数据，可直接编辑；修改后集中显示会同步更新。</p>
    </div>
  </section>
</template>
