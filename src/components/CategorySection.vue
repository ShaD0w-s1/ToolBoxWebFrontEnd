<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import { useWorkColumns } from "../composables/useResponsiveGrid";
import { sectionHex, sectionRgba } from "../utils/sectionColor";
import ItemEditor from "./ItemEditor.vue";
import StandardPicker from "./StandardPicker.vue";

const props = defineProps<{ store: ToolboxStore; category: string; highlighted?: boolean }>();
const collapsed = ref(false);
// 部位配色：左侧实色边条覆盖整块，抬头底色为该色 50%，整卡底色 20%（80% 透明）
const barColor = computed(() => sectionHex(props.category));
const headBg = computed(() => sectionRgba(props.category, 0.5));
const cardBg = computed(() => sectionRgba(props.category, 0.2));
const subNames = computed(() => props.store.subsOf(props.category));
// 单独项目类：工具清单与标准库脱钩（不再整体替换导入 / 隐藏标准库工作替换下拉）。
const isStandalone = computed(() => props.store.currentProject.value?.type === "单独项目");
// highlighted 由父组件工作查询控制：有查询时 highlighted 部位强制展开，非 highlighted 强制折叠
const showBody = computed(() => {
  if (props.highlighted === true) return true;
  if (props.highlighted === false) return false;
  return !collapsed.value || props.store.forceExpandAll.value;
});
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
/** 工作名联想源：合并「工具标准库 ∪ 航材标准库」的 部位||工作 键（共享检索；不跨库取物品）。 */
const standardSubs = computed(() => {
  const type = props.store.editingLibrary.value || props.store.effectiveAircraftType.value;
  const keys = new Set<string>();
  if (!type) return [...keys];
  for (const item of props.store.app.value.libraries[type]?.items || []) keys.add(`${item.cat}||${item.sub}`);
  for (const item of props.store.app.value.materialLibraries[type]?.items || []) keys.add(`${item.cat}||${item.sub}`);
  return [...keys];
});
/** 部位名模糊搜索/选择的数据源：项目模式合并「工具标准库 ∪ 航材标准库」的部位名（部位名称共享，
 *  搜索可命中任一标准库里已有的部位）；库模式用当前库自身部位。 */
const stdCats = computed<string[]>(() => {
  if (props.store.editingLibrary.value) return props.store.active.value?.categories || [];
  const set = new Set<string>([...props.store.standardCategories.value, ...props.store.standardMaterialCategories.value]);
  return [...set];
});

/** 部位名输入框：失焦/回车时改名。
 *  项目模式：仅当名称命中本机型「工具标准库」部位名时，才整体替换为该标准部位并导入其物品；
 *  其它情况（含仅航材标准库有的部位名）仅改名、不跨标准库取。库模式仅改名。单独项目类已与标准库脱钩 → 仅改名。 */
function onRenameCat(event: Event): void {
  const input = event.target as HTMLInputElement;
  const name = input.value.trim();
  if (!name || name === props.category) { input.value = props.category; return; }
  if (props.store.editingLibrary.value) {
    props.store.renameCategory(props.category, name);
    return;
  }
  const toolStd = props.store.standardCategories.value;
  if (!isStandalone.value && toolStd.includes(name)) {
    if (!window.confirm(`将部位“${props.category}”替换为标准部位“${name}”并导入工具标准库中的物品？\n（原有物品将被替换）`)) { input.value = props.category; return; }
    props.store.replaceCategoryFromStandard(props.category, name);
  } else {
    props.store.renameCategory(props.category, name);
  }
}

function deleteCategory() {
  if (window.confirm(`删除部位引用：移除部位“${props.category}”及其全部物品？\n（仅影响当前清单，标准库与其他项目不受影响）`)) props.store.deleteCategory(props.category);
}

function renameSub(oldName: string, event: Event): void {
  props.store.renameSub(props.category, oldName, (event.target as HTMLInputElement).value.trim());
}

function deleteSub(sub: string): void {
  if (window.confirm(`确认删除工作“${sub}”？`)) props.store.deleteSub(props.category, sub);
}

/** 工具清单工作卡片“补充标准库”：确认后将本工作卡片物品补充/删减到对应机型标准库，并立即推送云端。 */
async function supplementStdLib(sub: string): Promise<void> {
  if (!window.confirm(`确认将“${props.category} / ${sub}”工作卡片的物品补充/删减到对应标准库？`)) return;
  try {
    const type = await props.store.syncSubToLibrary(props.category, sub);
    props.store.notify(type ? `已补充「${sub}」到 ${type} 工具标准库` : "标准库未找到，补充失败");
  } catch {
    props.store.notify("补充标准库失败，请重试");
  }
}
</script>

<template>
  <article class="category-card" :style="{ borderLeft: `6px solid ${barColor}`, background: cardBg }">
    <header class="category-head" :style="{ background: headBg }" @click.self="collapsed = !collapsed">
      <button class="collapse" :aria-label="collapsed ? '展开' : '收起'" @click="collapsed = !collapsed">{{ collapsed ? '›' : '⌄' }}</button>
      <input class="cat-name" :value="category" list="cat-std-list" aria-label="部位名称" @change="onRenameCat" />
      <datalist id="cat-std-list"><option v-for="c in stdCats" :key="c" :value="c" /></datalist>
      <span>合计 {{ store.catTotal(category) }}</span>
      <div class="spacer" />
      <button @click="store.addSub(category)">+ 工作</button>
      <button class="danger" title="删除部位引用（仅当前清单，标准库与他项目不受影响）" @click="deleteCategory">删除</button>
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
            <StandardPicker
              v-if="!store.editingLibrary.value && !isStandalone"
              :options="standardSubs"
              :category="category"
              :sub="sub"
              :store="store"
            />
            <input v-else :value="sub" aria-label="工作名称" @change="renameSub(sub, $event)" />
            <div class="spacer" />
            <button v-if="!store.editingLibrary.value" class="ghost" @click="supplementStdLib(sub)">补充标准库</button>
            <button @click="store.addItem(category, sub)">+ 物品</button>
            <button class="danger" @click="deleteSub(sub)">删除</button>
          </header>
          <div class="item-grid" :style="{ gridTemplateColumns: `repeat(${itemColsFor(sub)}, minmax(0, 1fr))` }">
            <ItemEditor
              v-for="item in store.itemsOf(category, sub)"
              :key="item.id"
              :item="item"
              :store="store"
              :lock-field="store.editingLibrary.value ? '' : 'data'"
              :class="{ 'flash-update': store.isFlashing(item) }"
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

<style scoped>
/* 部位名行内输入框（与“工作”名输入栏一致：透明底、悬停/聚焦显边框、加粗） */
.cat-name { flex: 0 1 auto; min-width: 90px; max-width: 220px; padding: 4px 7px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent; font-weight: 700; font-size: var(--fs-16); color: inherit; }
.cat-name:hover, .cat-name:focus { border-color: var(--focus); background: var(--n0); }
/* 合并后：StandardPicker 在 sub-head 内作为工作名输入框，占满可用宽度 */
.sub-head :deep(.standard-combo) {
  flex: 1 1 140px;
  width: auto;
  min-width: 0;
  margin: 0;
}
.sub-head :deep(.standard-input) {
  width: 100%;
  margin: 0;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  font-weight: 700;
  font-size: var(--fs-14);
  color: inherit;
}
.sub-head :deep(.standard-input:hover),
.sub-head :deep(.standard-input:focus) {
  border-color: var(--focus);
  background: var(--n0);
}
</style>
