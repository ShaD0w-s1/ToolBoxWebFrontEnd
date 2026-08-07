<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import { useWorkColumns } from "../composables/useResponsiveGrid";
import { vItemColumns } from "../directives/itemColumns";
import { sectionHex, sectionRgba } from "../utils/sectionColor";
import ItemEditor from "./ItemEditor.vue";

const props = defineProps<{ store: ToolboxStore; category: string }>();
const collapsed = ref(false);
// 部位配色：左侧实色边条覆盖整块，抬头底色为该色 50%
const barColor = computed(() => sectionHex(props.category));
const headBg = computed(() => sectionRgba(props.category, 0.5));
const subNames = computed(() => props.store.subsOf(props.category));
// 导出图片时强制展开（forceExpandAll），否则跟随本地 collapsed 状态
const showBody = computed(() => !collapsed.value || props.store.forceExpandAll.value);
// 工作卡片每行数量由页面宽度决定（1–3），见 useResponsiveGrid
const { workCols } = useWorkColumns();

/** 工作卡片跨列：固定卡片占满整行（1/-1），其余各占一列（由 sub-grid 列数控制，无需 span）。 */
function workSpanStyle(sub: string): Record<string, string> {
  return sub.trim() === "固定" ? { gridColumn: "1 / -1" } : {};
}

/** 全局同名物品配色：名称出现 ≥2 次时，每个名称分配一个稳定颜色，用于卡片左上角三角。 */
const sameNameColors = computed(() => {
  const counts = new Map<string, number>();
  for (const item of props.store.active.value?.items || []) {
    const key = item.name.trim().toLowerCase();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const colors = new Map<string, string>();
  for (const [key, n] of counts) if (n >= 2) colors.set(key, sectionHex(key));
  return colors;
});
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
  <article class="category-card" :style="{ borderLeft: `6px solid ${barColor}` }">
    <header class="category-head" :style="{ background: headBg }" @click.self="collapsed = !collapsed">
      <button class="collapse" :aria-label="collapsed ? '展开' : '收起'" @click="collapsed = !collapsed">{{ collapsed ? '›' : '⌄' }}</button>
      <strong>{{ category }}</strong>
      <span>合计 {{ store.catTotal(category) }}</span>
      <div class="spacer" />
      <button @click="renameCategory">改名</button>
      <button @click="store.addSub(category)">+ 工作</button>
      <button class="danger" @click="deleteCategory">删除</button>
    </header>
    <div v-if="showBody" class="category-body">
      <textarea v-model="categoryNote" class="notes" rows="2" placeholder="部位备注" @input="store.persist" />
      <div class="sub-grid" :style="{ gridTemplateColumns: `repeat(${workCols}, 1fr)` }">
        <section
          v-for="sub in subNames"
          :key="`${category}-${sub}`"
          class="sub-card"
          :class="{ fixed: sub.trim() === '固定' }"
          :style="workSpanStyle(sub)"
        >
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
          <div class="item-grid" v-item-columns>
            <ItemEditor
              v-for="item in store.itemsOf(category, sub)"
              :key="item.id"
              :item="item"
              :duplicate="store.isCartDuplicate(item.name)"
              :same-name="sameNameColors.get(item.name.trim().toLowerCase()) || null"
              @save="store.persist"
              @remove="store.deleteItem(item.id)"
            />
          </div>
        </section>
      </div>
    </div>
  </article>
</template>
