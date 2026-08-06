<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import ItemEditor from "./ItemEditor.vue";

const props = defineProps<{ store: ToolboxStore; category: string }>();
const collapsed = ref(false);
const subNames = computed(() => props.store.subsOf(props.category));
const categoryNote = computed({
  get: () => props.store.active.value?.notes[props.category] || "",
  set: (value: string) => {
    if (props.store.active.value) props.store.active.value.notes[props.category] = value;
  },
});
const standardSubs = computed(() => {
  const type = props.store.currentProject.value?.aircraftType || props.store.editingLibrary.value || "A320";
  const library = props.store.app.value.libraries[type];
  return [...new Set(library.items.map((item) => `${item.cat}||${item.sub}`))];
});

function renameCategory() {
  const name = window.prompt("部位名称：", props.category);
  if (name?.trim()) props.store.renameCategory(props.category, name.trim());
}

function deleteCategory() {
  if (window.confirm(`确认删除部位“${props.category}”及其全部物品？`)) props.store.deleteCategory(props.category);
}

function renameSub(oldName: string, event: Event): void {
  props.store.renameSub(props.category, oldName, (event.target as HTMLInputElement).value.trim());
}

function deleteSub(sub: string): void {
  if (window.confirm(`确认删除工作“${sub}”？`)) props.store.deleteSub(props.category, sub);
}

function importStandard(sub: string, event: Event): void {
  const select = event.target as HTMLSelectElement;
  props.store.importStandardSub(props.category, sub, select.value);
  select.value = "";
}
</script>

<template>
  <article class="category-card">
    <header class="category-head" @click.self="collapsed = !collapsed">
      <button class="collapse" :aria-label="collapsed ? '展开' : '收起'" @click="collapsed = !collapsed">{{ collapsed ? '›' : '⌄' }}</button>
      <strong>{{ category }}</strong>
      <span>合计 {{ store.catTotal(category) }}</span>
      <div class="spacer" />
      <button @click="renameCategory">改名</button>
      <button @click="store.addSub(category)">+ 工作</button>
      <button class="danger" @click="deleteCategory">删除</button>
    </header>
    <div v-if="!collapsed" class="category-body">
      <textarea v-model="categoryNote" class="notes" rows="2" placeholder="部位备注" @input="store.persist" />
      <div class="sub-grid">
        <section v-for="sub in subNames" :key="`${category}-${sub}`" class="sub-card">
          <header class="sub-head">
            <input :value="sub" aria-label="工作名称" @change="renameSub(sub, $event)" />
            <span>合计 {{ store.subTotal(category, sub) }}</span>
            <div class="spacer" />
            <button @click="store.addItem(category, sub)">+ 物品</button>
            <button class="danger" @click="deleteSub(sub)">删除</button>
          </header>
          <select v-if="!store.editingLibrary.value" class="standard-picker" value="" @change="importStandard(sub, $event)">
            <option value="">从标准库替换此工作…</option>
            <option v-for="key in standardSubs" :key="key" :value="key">{{ key.replace('||', ' / ') }}</option>
          </select>
          <div class="item-grid">
            <ItemEditor
              v-for="item in store.itemsOf(category, sub)"
              :key="item.id"
              :item="item"
              :duplicate="store.isCartDuplicate(item.name)"
              @save="store.persist"
              @remove="store.deleteItem(item.id)"
            />
          </div>
        </section>
      </div>
    </div>
  </article>
</template>
