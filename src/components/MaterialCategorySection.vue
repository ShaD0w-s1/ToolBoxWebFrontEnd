<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import { sectionHex, sectionRgba } from "../utils/sectionColor";
import type { ToolItem } from "../domain/toolbox";
import StandardPicker from "./StandardPicker.vue";

const props = defineProps<{ store: ToolboxStore; category: string; highlighted?: boolean }>();
const collapsed = ref(false);
const cardEl = ref<HTMLElement | null>(null);
// 记录「正在展开备注行」的物品 id（点 + 展开，输入后 note 非空则保持，清空则收起）
const noteExpanded = ref<Set<number>>(new Set());
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

/** 撑高卡片内所有 textarea（初始渲染/数据加载后也要正确换行显示）。 */
function autoSizeAll(): void {
  for (const el of cardEl.value?.querySelectorAll<HTMLTextAreaElement>(".m-name") || []) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
}
onMounted(() => { nextTick(autoSizeAll); });

/** 展开/收起物品备注行。 */
function toggleNote(it: ToolItem): void {
  const s = new Set(noteExpanded.value);
  if (s.has(it.id)) s.delete(it.id);
  else s.add(it.id);
  noteExpanded.value = s;
}

/** 备注输入后持久化；清空则收起备注行。 */
function commitNote(it: ToolItem): void {
  props.store.markNoteDirty(it);
  props.store.persist();
  if (!(it.note || "").trim()) {
    const s = new Set(noteExpanded.value);
    s.delete(it.id);
    noteExpanded.value = s;
  }
}

/** 删除备注（清空并收起）。 */
function removeNote(it: ToolItem): void {
  it.note = "";
  props.store.markNoteDirty(it);
  const s = new Set(noteExpanded.value);
  s.delete(it.id);
  noteExpanded.value = s;
  props.store.persist();
}

/** 物品是否显示备注行（已有备注，或点 + 展开）。 */
function noteVisible(it: ToolItem): boolean {
  return Boolean(it.note) || noteExpanded.value.has(it.id);
}

const catNote = computed({
  get: () => props.store.materialActive.value?.notes[props.category] || "",
  set: (value: string) => { if (props.store.materialActive.value) props.store.materialActive.value.notes[props.category] = value; },
});
// 类型名联想源：合并「航材标准库 ∪ 工具标准库」的 部位||类型 键（共享检索；不跨库取物品）。
const matStdSubs = computed(() => {
  const type = props.store.editingMaterialLibrary.value ?? props.store.aircraftTypeFromPrep.value;
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
 *  其它情况（含仅工具标准库有的部位名）仅改名、不跨标准库取。 */
function onRenameCat(event: Event): void {
  const input = event.target as HTMLInputElement;
  const name = input.value.trim();
  if (!name || name === props.category) { input.value = props.category; return; }
  const matStd = props.store.standardMaterialCategories.value;
  if (matStd.includes(name)) {
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
  if (window.confirm(`确认删除部位“${props.category}”及其全部航材？`)) props.store.mDeleteCategory(props.category);
}
function renameSub(oldName: string, event: Event): void {
  props.store.mRenameSub(props.category, oldName, (event.target as HTMLInputElement).value.trim());
}
function deleteSub(sub: string): void {
  if (window.confirm(`确认删除类型“${sub}”？`)) props.store.mDeleteSub(props.category, sub);
}
/** 部位卡片"补充标准库"：把该部位下所有类型整体同步到对应机型航材标准库。 */
async function supplementPart(): Promise<void> {
  if (!window.confirm(`确认将部位“${props.category}”的全部航材补充/删减到对应航材标准库？`)) return;
  try {
    let type: string | null = null;
    for (const sub of subNames.value) type = await props.store.mSyncSubToMaterialLib(props.category, sub);
    props.store.notify(type ? `已补充「${props.category}」到 ${type} 航材标准库` : "航材标准库未找到，补充失败");
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
      <button @click="store.mAddSub(category)">+ 类型</button>
      <button v-if="!isLibrary" class="ghost" @click="supplementPart">补充标准库</button>
      <button class="danger" @click="deleteCategory">删除</button>
    </header>
    <div v-if="showBody" class="category-body">
      <textarea v-model="catNote" class="notes" rows="2" placeholder="部位备注" @input="store.persist" />
      <div class="sub-grid" :style="{ gridTemplateColumns: `repeat(${subCols()}, 1fr)` }">
        <section v-for="sub in subNames" :key="`${category}-${sub}`" class="sub-card">
          <header class="sub-head">
            <button class="collapse sub-collapse" :aria-label="collapsedSubs.has(sub) ? '展开' : '收起'" @click="toggleSub(sub)">{{ collapsedSubs.has(sub) ? '›' : '⌄' }}</button>
            <StandardPicker v-if="!isLibrary" :options="matStdSubs" :category="category" :sub="sub" :store="store" :material="true" />
            <input v-else class="type-name" :value="sub" aria-label="类型名称" @change="renameSub(sub, $event)" />
            <div class="spacer" />
            <button @click="store.mAddItem(category, sub)">+ 物品</button>
            <button class="danger" @click="deleteSub(sub)">删除</button>
          </header>
          <div v-if="!collapsedSubs.has(sub)" class="item-grid" :style="{ gridTemplateColumns: 'repeat(2, 1fr)' }">
            <div v-for="it in store.mItemsOf(category, sub)" :key="it.id" class="m-item" :class="{ 'flash-update': store.isFlashing(it) }">
              <label class="m-field m-field-no"><span>件号</span><textarea rows="1" v-model="it.partNo" @input="onAutoSize" class="m-name m-partno"></textarea></label>
              <label class="m-field m-field-name"><span>名称</span><textarea rows="1" v-model="it.name" @input="onAutoSize" class="m-name"></textarea></label>
              <label class="m-field m-field-qty"><span>数量</span><input v-model.number="it.qty" type="number" min="0" @input="store.persist" /></label>
              <div class="m-ops">
                <button class="m-op m-op-del" title="删除" @click="store.mDeleteItem(it.id)">×</button>
                <button class="m-op" :title="it.note ? '编辑备注' : '添加备注'" @click="toggleNote(it)">+</button>
              </div>
              <div v-if="noteVisible(it)" class="m-note-row">
                <label class="m-field"><span>备注</span><textarea rows="1" v-model="it.note" placeholder="输入备注" @input="onAutoSize" @blur="commitNote(it)" class="m-name"></textarea></label>
                <button class="m-op m-op-del" title="删除备注" @click="removeNote(it)">×</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </article>
</template>

<style scoped>
.category-card { background: #fff; border: 1px solid #e6e9f0; border-radius: 10px; margin-bottom: 14px; overflow: hidden; }
.category-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; font-size: 14px; }
.collapse { background: transparent; border: none; cursor: pointer; font-size: 14px; color: #4a5160; }
.category-head strong { font-size: 15px; }
.cat-name { flex: 0 1 auto; min-width: 90px; max-width: 220px; padding: 4px 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-weight: 700; font-size: 15px; color: inherit; }
.cat-name:hover, .cat-name:focus { border-color: #8eaadb; background: #fff; }
.category-body { padding: 10px 12px; }
.notes { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 13px; margin-bottom: 10px; resize: vertical; }
.sub-grid { display: grid; gap: 10px; }
.sub-card { border: 1.5px solid #8eaadb; border-radius: 8px; padding: 8px 10px; background: #fff; }
.sub-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sub-collapse { width: 22px; height: 22px; padding: 0; border: 0; background: transparent; cursor: pointer; font-size: 16px; line-height: 1; color: #4a5160; flex: 0 0 auto; }
.type-name { flex: 1 1 0; min-width: 0; padding: 5px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-weight: 700; font-size: 14px; }
.type-name:hover, .type-name:focus { border-color: #8eaadb; background: #fff; }
/* 合并后：StandardPicker 在 sub-head 内作为类型名输入框，占满可用宽度、外观与 .type-name 一致 */
.sub-head :deep(.standard-combo) { flex: 1 1 0; min-width: 0; margin: 0; }
.sub-head :deep(.standard-input) {
  width: 100%; margin: 0; padding: 5px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-weight: 700; font-size: 14px; color: inherit;
}
.sub-head :deep(.standard-input:hover),
.sub-head :deep(.standard-input:focus) { border-color: #8eaadb; background: #fff; }
.item-grid { display: grid; gap: 8px; }
.m-item { display: grid; grid-template-columns: 1.1fr 2fr 0.6fr auto; gap: 6px; align-items: stretch; border: 1px solid #e6e9f0; border-radius: 8px; padding: 6px 8px; background: #fff; word-break: break-word; }
.m-field { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: #6b7280; min-width: 0; }
.m-field input, .m-name { padding: 5px 7px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 13px; min-width: 0; width: 100%; box-sizing: border-box; }
/* 件号/名称/备注 textarea：与数量栏等高（默认单行），字体保持 12px，自动换行并随内容撑高 */
.m-name { padding: 5px 7px; font-size: 12px; line-height: 1.4; resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; font-family: inherit; min-height: 30px; }
/* 操作按钮组：删除(x)+备注(+) 上下排列，占满卡片高度 */
.m-ops { display: flex; flex-direction: column; gap: 4px; }
.m-op { flex: 1; min-width: 26px; min-height: 22px; padding: 0 6px; border: 1px solid #d7dbe4; border-radius: 6px; background: #fff; color: #5a6b85; font-size: 14px; line-height: 1; cursor: pointer; }
.m-op:hover { background: var(--blue-light); }
.m-op-del { border-color: #f2cdcd; background: #fdecec; color: #b53a3a; }
.m-op-del:hover { background: #f9dcdc; }
/* 备注行：横跨整行，含删除按钮 */
.m-note-row { grid-column: 1 / -1; display: flex; gap: 6px; align-items: flex-end; }
.m-note-row .m-field { flex: 1; }
.m-note-row .m-op { flex: 0 0 auto; min-height: 30px; }
@media (max-width: 768px) {
  .sub-grid { grid-template-columns: 1fr !important; }
  .item-grid { grid-template-columns: 1fr !important; }
  .m-item { grid-template-columns: 1fr 1fr auto; }
  .m-field-name { grid-column: span 2; }
  .m-note-row { grid-column: 1 / -1; }
}
</style>
