<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import { useWorkColumns } from "../composables/useResponsiveGrid";
import { sectionHex, sectionRgba } from "../utils/sectionColor";
import ItemEditor from "./ItemEditor.vue";
import StandardPicker from "./StandardPicker.vue";

const props = defineProps<{ store: ToolboxStore; category: string }>();
const collapsed = ref(false);
// 部位配色：左侧实色边条覆盖整块，抬头底色为该色 50%
const barColor = computed(() => sectionHex(props.category));
const headBg = computed(() => sectionRgba(props.category, 0.5));
const subNames = computed(() => props.store.subsOf(props.category));
// 导出图片时强制展开（forceExpandAll），否则跟随本地 collapsed 状态
const showBody = computed(() => !collapsed.value || props.store.forceExpandAll.value);
// 工作卡片每行数量由页面宽度决定（1–3），见 useResponsiveGrid；layoutIsMobile 用于区分移动端
const { workCols, layoutIsMobile } = useWorkColumns();

/**
 * 某工作卡片的物品列数（同时决定该卡片在 sub-grid 中的跨列数与内部 item-grid 列数）：
 *   物品 ≤5 → 1 列；6–10 → 2 列；>10 → 3 列（上限 3）。
 * 仅网页端（非移动布局）按物品数拓展；移动端保持 1 列（原有情况）。
 * 跨列数再被 sub-grid 实际列数(workCols) 钳制，避免 span 超出网格。
 * 例外：“固定”卡片占满整行（默认 3 列宽），其内部物品卡片须保持单列页面宽度，
 *   故直接按 sub-grid 列数(workCols) 分列，使每个物品卡 ≈ 1 个页面列宽，不会被拉伸到整行 3 列宽。
 */
function itemColsFor(sub: string): number {
  const count = props.store.itemsOf(props.category, sub).length;
  if (sub.trim() === "固定") return layoutIsMobile.value ? 1 : workCols.value;
  let n = count > 10 ? 3 : count > 5 ? 2 : 1;
  if (layoutIsMobile.value) n = 1;
  return Math.min(n, workCols.value);
}

/** 工作卡片跨列：固定卡片占满整行（1/-1）；其余按物品数量跨 1–3 列。 */
function workSpanStyle(sub: string): Record<string, string> {
  if (sub.trim() === "固定") return { gridColumn: "1 / -1" };
  const n = itemColsFor(sub);
  return n > 1 ? { gridColumn: `span ${n}` } : {};
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
          <StandardPicker
            v-if="!store.editingLibrary.value"
            :options="standardSubs"
            :category="category"
            :sub="sub"
            :store="store"
          />
          <div class="item-grid" :style="{ gridTemplateColumns: `repeat(${itemColsFor(sub)}, minmax(0, 1fr))` }">
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
