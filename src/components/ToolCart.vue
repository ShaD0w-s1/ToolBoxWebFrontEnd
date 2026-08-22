<script setup lang="ts">
import type { ToolboxStore } from "../composables/useToolbox";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "import-sheet": [file: File]; share: [] }>();

function add() {
  props.store.app.value.toolCart.push({ name: "新物品", qty: 1 });
  props.store.persist();
}

function remove(index: number): void {
  props.store.app.value.toolCart.splice(index, 1);
  props.store.persist();
}

function importFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) emit("import-sheet", file);
  input.value = "";
}

/** 数据库页内"完成"：保存到云端并提示后返回列表（替代原一级卡片上的完成按钮）。 */
async function finishCart(): Promise<void> {
  try {
    await props.store.saveCartNow();
    props.store.notify("工具车数据库已完成保存");
  } catch {
    props.store.notify("保存失败，但已留存本地");
  }
  props.store.backToList();
}
</script>

<template>
  <section>
    <header class="detail-head">
      <button @click="store.backToList">← 返回</button>
      <div><strong>工具车数据库</strong><span>用于在工作项目中标记工具车已有物品</span></div>
      <div class="summary">共 <b>{{ store.app.value.toolCart.length }}</b> 项</div>
    </header>
    <div class="toolbar">
      <button class="primary" @click="add">+ 添加物品</button>
      <label class="button">导入 xlsx<input hidden type="file" accept=".xlsx,.xls" @change="importFile" /></label>
      <button @click="emit('share')">分享本页</button>
      <button title="强制同步数据" @click="store.refresh()">刷新</button>
      <span class="spacer" />
      <button class="ghost" @click="finishCart">完成</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>物品</th><th>数量</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="(item, index) in store.app.value.toolCart" :key="index">
            <td><input v-model="item.name" @input="store.persist" /></td>
            <td><input v-model.number="item.qty" type="number" min="0" @input="store.persist" /></td>
            <td><button class="danger" @click="remove(index)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!store.app.value.toolCart.length" class="empty-state">工具车数据库为空。</div>
    </div>
  </section>
</template>
