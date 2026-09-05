<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import { sectionHex, sectionRgba } from "../utils/sectionColor";
import type { ToolItem } from "../domain/toolbox";
import { itemKey } from "../domain/toolbox";
import { createEditLockDirective } from "../utils/editLock";
import StandardPicker from "./StandardPicker.vue";

const props = defineProps<{ store: ToolboxStore; category: string; highlighted?: boolean }>();
const collapsed = ref(false);
const cardEl = ref<HTMLElement | null>(null);
const barColor = computed(() => sectionHex(props.category));
const headBg = computed(() => sectionRgba(props.category, 0.5));
const cardBg = computed(() => sectionRgba(props.category, 0.2));
const subNames = computed(() => props.store.mSubsOf(props.category));
// 记录「收起的类型卡片」子类型名集合（点击类型卡片收起按钮切换）。
const collapsedSubs = ref<Set<string>>(new Set());
function toggleSub(sub: string): void {
  const s = new Set(collapsedSubs.value);
  if (s.has(sub)) s.delete(sub);
  else s.add(sub);
  collapsedSubs.value = s;
}
// highlighted 由父组件类型查询控制：有查询时 highlighted 部位强制展开，非 highlighted 强制折叠
const showBody = computed(() => {
  if (props.highlighted === true) return true;
  if (props.highlighted === false) return false;
  return !collapsed.value || props.store.forceExpandAll.value;
});
const isLibrary = computed(() => Boolean(props.store.editingMaterialLibrary.value));
// 单独项目类：航材清单与标准库脱钩（不再整体替换导入 / 隐藏标准库类型替换下拉 / 添加部位不再从库带入）。
const isStandalone = computed(() => props.store.currentProject.value?.type === "单独项目");
/** 物品行软锁 key（项目模式 materialList；库模式空串=不锁）。 */
const vLock = createEditLockDirective(props.store);
function lock(it: ToolItem, prop: string): string {
  return isLibrary.value ? "" : `materialList|item|${itemKey(it)}|${prop}`;
}

/** 类型卡片列数：始终 1 列（类型卡片全宽），与其他部位 sub-grid 布局一致，
 *  物品卡 4 字段（件号/名称/数量/删除）有足够横向空间，避免 ENG 等多类型部位拥挤显示。 */
function subCols(): number {
  return 1;
}
/** 件号/名称 textarea 自动撑高：默认单行（与“数量”等高），文字超出宽度时自动换行。 */
function onAutoSize(event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  props.store.persist();
}

/** 撑高卡片内所有物品 textarea（初始渲染/数据加载后也要正确换行显示）。 */
function autoSizeAll(): void {
  for (const el of cardEl.value?.querySelectorAll<HTMLTextAreaElement>(".itg textarea") || []) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
}
onMounted(() => { nextTick(autoSizeAll); });

/** 备注列失焦提交（标记字段级脏，参与合并）。 */
function commitNote(it: ToolItem): void {
  props.store.markNoteDirty(it);
  props.store.persist();
}

/** 数量步进：−/+ 增减 1，下限 0。 */
function stepQty(it: ToolItem, d: number): void {
  it.qty = Math.max(0, (Number(it.qty) || 0) + d);
  props.store.persist();
}

const catNote = computed({
  get: () => props.store.materialActive.value?.notes[props.category] || "",
  set: (value: string) => { if (props.store.materialActive.value) props.store.materialActive.value.notes[props.category] = value; },
});
// 类型名联想源：合并「航材标准库 ∪ 工具标准库」的 部位||类型 键（共享检索；不跨库取物品）。
const matStdSubs = computed(() => {
  const type = props.store.editingMaterialLibrary.value ?? props.store.effectiveAircraftType.value;
  const keys = new Set<string>();
  if (!type) return [...keys];
  for (const it of props.store.app.value.materialLibraries[type]?.items || []) keys.add(`${it.cat}||${it.sub}`);
  for (const it of props.store.app.value.libraries[type]?.items || []) keys.add(`${it.cat}||${it.sub}`);
  return [...keys];
});

/** 部位名输入：选择标准库部位时改名为标准部位并替换其物品（参考「添加部位」选项）；否则仅改名。
 *  命中「工具标准库 ∪ 航材标准库」任一部位名即触发导入（部位名称共享）。 */
/** 部位名输入框：失焦/回车时改名。
 *  仅当名称命中本机型「航材标准库」部位名时，才整体替换为该标准部位并导入其物品；
 *  其它情况（含仅工具标准库有的部位名）仅改名、不跨标准库取。单独项目类已与标准库脱钩 → 仅改名。 */
function onRenameCat(event: Event): void {
  const input = event.target as HTMLInputElement;
  const name = input.value.trim();
  if (!name || name === props.category) { input.value = props.category; return; }
  const matStd = props.store.standardMaterialCategories.value;
  if (!isStandalone.value && matStd.includes(name)) {
    if (!window.confirm(`将部位“${props.category}”替换为标准部位“${name}”并导入航材标准库中的物品？\n（原有物品将被替换）`)) { input.value = props.category; return; }
    props.store.mReplaceCategoryFromStandard(props.category, name);
  } else {
    props.store.mRenameCategory(props.category, name);
  }
}
/** 部位名模糊搜索/选择数据源：项目模式合并「航材标准库 ∪ 工具标准库」的部位名（部位名称共享，
 *  搜索可命中任一标准库里已有的部位）；库模式用当前航材库自身部位。 */
const stdCats = computed<string[]>(() => {
  if (props.store.editingMaterialLibrary.value) return props.store.app.value.materialLibraries[props.store.editingMaterialLibrary.value]?.categories || [];
  const set = new Set<string>([...props.store.standardMaterialCategories.value, ...props.store.standardCategories.value]);
  return [...set];
});
function deleteCategory() {
  if (window.confirm(`删除部位引用：移除部位“${props.category}”及其全部航材？\n（仅影响当前清单，标准库与其他项目不受影响）`)) props.store.mDeleteCategory(props.category);
}
function renameSub(oldName: string, event: Event): void {
  props.store.mRenameSub(props.category, oldName, (event.target as HTMLInputElement).value.trim());
}
function deleteSub(sub: string): void {
  if (window.confirm(`确认删除工作“${sub}”？`)) props.store.mDeleteSub(props.category, sub);
}
/** “工作”卡片“补充标准库”：确认后将本工作卡片航材补充/删减到对应机型航材标准库，并立即推送云端。 */
async function supplementWork(sub: string): Promise<void> {
  if (!window.confirm(`确认将“${props.category} / ${sub}”工作卡片的航材补充/删减到对应机型航材标准库？`)) return;
  try {
    const type = await props.store.mSyncSubToMaterialLib(props.category, sub);
    props.store.notify(type ? `已补充「${sub}」到 ${type} 航材标准库` : "航材标准库未找到，补充失败");
  } catch { props.store.notify("补充标准库失败，请重试"); }
}
</script>

<template>
  <article ref="cardEl" class="category-card" :style="{ borderLeft: `6px solid ${barColor}`, background: cardBg }">
    <header class="category-head" :style="{ background: headBg }" @click.self="collapsed = !collapsed">
      <button class="collapse" @click="collapsed = !collapsed">{{ collapsed ? '›' : '⌄' }}</button>
      <input class="cat-name" :value="category" list="mcat-std-list" aria-label="部位名称" @change="onRenameCat" />
      <datalist id="mcat-std-list"><option v-for="c in stdCats" :key="c" :value="c" /></datalist>
      <span>合计 {{ store.mCatTotal(category) }}</span>
      <div class="spacer" />
      <button @click="store.mAddSub(category)">+ 工作</button>
      <button class="danger" title="删除部位引用（仅当前清单，标准库与他项目不受影响）" @click="deleteCategory">删除</button>
    </header>
    <div v-if="showBody" class="category-body">
      <textarea v-model="catNote" class="notes" rows="2" placeholder="部位备注" @input="onAutoSize" />
      <div class="sub-grid" :style="{ gridTemplateColumns: `repeat(${subCols()}, 1fr)` }">
        <section v-for="sub in subNames" :key="`${category}-${sub}`" class="sub-card">
          <header class="sub-head">
            <button class="collapse sub-collapse" :aria-label="collapsedSubs.has(sub) ? '展开' : '收起'" @click="toggleSub(sub)">{{ collapsedSubs.has(sub) ? '›' : '⌄' }}</button>
            <StandardPicker v-if="!isLibrary && !isStandalone" :options="matStdSubs" :category="category" :sub="sub" :store="store" :material="true" />
            <input v-else class="type-name" :value="sub" aria-label="工作名称" @change="renameSub(sub, $event)" />
            <div class="spacer" />
            <button v-if="!isLibrary" class="ghost" @click="supplementWork(sub)">补充标准库</button>
            <button @click="store.mAddItem(category, sub)">+ 物品</button>
            <button class="danger" @click="deleteSub(sub)">删除</button>
          </header>
          <div v-if="!collapsedSubs.has(sub)" class="itg" style="grid-template-columns: 1.55fr 1.55fr 0.6fr 2.2fr auto">
            <div class="itg-head"><span>件号</span><span>名称</span><span>数量</span><span class="itg-note-cell">备注</span><span></span></div>
            <div v-for="it in store.mItemsOf(category, sub)" :key="it.id" class="itg-row" :class="{ 'flash-update': store.isFlashing(it) }">
              <textarea rows="1" v-model="it.partNo" v-lock="lock(it, 'partNo')" placeholder="件号" @input="onAutoSize"></textarea>
              <textarea rows="1" v-model="it.name" v-lock="lock(it, 'name')" placeholder="名称" @input="onAutoSize"></textarea>
              <div class="itg-qty">
                <button type="button" class="qty-step" title="减 1" @click="stepQty(it, -1)">−</button>
                <input v-model.number="it.qty" v-lock="lock(it, 'qty')" type="number" min="0" placeholder="数量" @input="store.persist" />
                <button type="button" class="qty-step" title="加 1" @click="stepQty(it, 1)">+</button>
              </div>
              <textarea rows="1" class="cell-inp is-note" v-model="it.note" v-lock="lock(it, 'note')" placeholder="备注" @input="onAutoSize" @blur="commitNote(it)"></textarea>
              <div class="itg-ops"><button class="del" title="删除物品" @click="store.mDeleteItem(it.id)">×</button></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* 卡壳（.category-card/.category-head/.category-body/.cat-name/.collapse/.notes/.sub-grid/
 * .sub-card/.sub-head 及 StandardPicker 外观）已上移 main.css 全局共享，与工具清单部位卡共用一套；
 * 此处仅保留航材子卡特有：子卡折叠按钮与「工作名」输入框。 */
.sub-collapse { width: 22px; height: 22px; padding: 0; border: 0; background: transparent; cursor: pointer; font-size: var(--fs-16); line-height: 1; color: #4a5160; flex: 0 0 auto; }
.type-name { flex: 1 1 0; min-width: 0; padding: 5px 8px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent; font-weight: 700; font-size: var(--fs-14); }
.type-name:hover, .type-name:focus { border-color: var(--focus); background: var(--n0); }
@media (max-width: 768px) {
  .sub-grid { grid-template-columns: 1fr !important; }
}
</style>
