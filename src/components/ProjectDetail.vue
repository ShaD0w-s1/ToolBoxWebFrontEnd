<script setup lang="ts">
import { ref } from "vue";
import { AIRCRAFT_TYPES, type AircraftType } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { formatDate } from "../utils/format";
import CategorySection from "./CategorySection.vue";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{
  "export-sheet": [];
  "export-image": [element: HTMLElement | null];
  "import-sheet": [file: File];
  share: [];
}>();
const capture = ref<HTMLElement | null>(null);

function addCategory() {
  const name = window.prompt("请输入新部位名称：");
  if (name?.trim()) props.store.addCategory(name.trim());
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

function clear() {
  if (window.confirm(`确认清空“${props.store.detailTitle.value}”的全部数据？`)) props.store.clearActive();
}
</script>

<template>
  <section v-if="store.active.value" ref="capture">
    <header class="detail-head">
      <button @click="store.backToList">← 返回</button>
      <div><strong>{{ store.detailTitle.value }}</strong><span>{{ store.currentProject.value ? formatDate(store.currentProject.value.createdAt) : '机型标准数据库' }}</span></div>
      <div class="summary">全部合计 <b>{{ store.allTotal() }}</b></div>
    </header>

    <div class="toolbar">
      <button class="primary" @click="addCategory">+ 添加部位</button>
      <label v-if="store.currentProject.value" class="field">机型
        <select :value="store.currentProject.value.aircraftType" @change="changeAircraft"><option v-for="type in AIRCRAFT_TYPES" :key="type">{{ type }}</option></select>
      </label>
      <label v-if="store.editingLibrary.value" class="button">导入 xlsx<input hidden type="file" accept=".xlsx,.xls" @change="importFile" /></label>
      <label class="check"><input v-model="store.active.value.useCart" type="checkbox" @change="store.persist" /> 使用工具车</label>
      <button @click="emit('export-sheet')">导出表格</button>
      <button @click="emit('export-image', capture)">导出图片</button>
      <button @click="emit('share')">分享本页</button>
      <span class="spacer" />
      <button class="danger" @click="clear">清空数据</button>
    </div>

    <nav class="tabs">
      <button class="tab" :class="{ active: store.detailTab.value === 'display' }" @click="store.detailTab.value = 'display'">集中显示</button>
      <button class="tab" :class="{ active: store.detailTab.value === 'database' }" @click="store.detailTab.value = 'database'">数据库</button>
    </nav>

    <div v-if="store.detailTab.value === 'display'" class="category-list">
      <CategorySection v-for="category in store.active.value.categories" :key="category" :category="category" :store="store" />
      <div v-if="!store.active.value.categories.length" class="empty-state">当前没有部位，点击“添加部位”开始录入。</div>
    </div>

    <div v-else>
      <div class="toolbar"><button class="primary" @click="store.addItem(store.active.value.categories[0] || 'A', '新工作')">+ 添加行</button></div>
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
