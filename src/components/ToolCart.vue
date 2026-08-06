<script setup>
const props = defineProps({ store: { type: Object, required: true } });
const emit = defineEmits(["import-sheet", "share"]);

function add() {
  props.store.app.value.toolCart.push({ name: "新物品", qty: 1 });
  props.store.persist();
}

function remove(index) {
  props.store.app.value.toolCart.splice(index, 1);
  props.store.persist();
}

function importFile(event) {
  const file = event.target.files?.[0];
  if (file) emit("import-sheet", file);
  event.target.value = "";
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
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>物品</th><th>数量</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="(item, index) in store.app.value.toolCart" :key="index">
            <td><input v-model="item.name" @change="store.persist" /></td>
            <td><input v-model.number="item.qty" type="number" min="0" @change="store.persist" /></td>
            <td><button class="danger" @click="remove(index)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!store.app.value.toolCart.length" class="empty-state">工具车数据库为空。</div>
    </div>
  </section>
</template>
