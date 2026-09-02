<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolItem } from "../domain/toolbox";
import { FLAT_MATERIAL_CAT, FLAT_TOOL_CAT, itemKey } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { createEditLockDirective } from "../utils/editLock";
import ItemEditor from "./ItemEditor.vue";

/**
 * 单独项目类清单「扁平类型卡」：无部位层，物品按「类型(sub)」合并分组（跨部位同名类型合并），
 * 新物品统一归到隐藏部位（工具=FLAT_TOOL_CAT / 航材=FLAT_MATERIAL_CAT），界面只出现类型概念。
 * 工具行用 ItemEditor（名称/数量/±）；航材行就地 4 字段（件号/名称/数量/备注）。
 */
const props = defineProps<{
  store: ToolboxStore;
  kind: "tool" | "material";
  /** 类型查询：非空时仅匹配的类型卡展开、其余收起。 */
  query?: string;
}>();

const isTool = computed(() => props.kind === "tool");
const flatCat = computed(() => (isTool.value ? FLAT_TOOL_CAT : FLAT_MATERIAL_CAT));
const items = computed<ToolItem[]>(() =>
  isTool.value ? (props.store.active.value?.items || []) : (props.store.materialActive.value?.items || []),
);

/** 按「类型(sub)」聚合（跨部位合并），卡内物品顺序保持原数组顺序。 */
const typeCards = computed<Array<{ sub: string; its: ToolItem[] }>>(() => {
  const m = new Map<string, ToolItem[]>();
  for (const it of items.value) {
    const s = (it.sub || "").trim() || "固定";
    let arr = m.get(s);
    if (!arr) { arr = []; m.set(s, arr); }
    arr.push(it);
  }
  return [...m.entries()].map(([sub, its]) => ({ sub, its })).sort((a, b) => a.sub.localeCompare(b.sub, "zh-CN"));
});

// —— 折叠/查询 ——
const collapsedSubs = ref<Set<string>>(new Set());
const q = computed(() => (props.query || "").trim().toLowerCase());
/** 查询非空：匹配类型展开、其他收起；无查询：按手动折叠状态。 */
function isOpen(sub: string): boolean {
  if (q.value) return sub.toLowerCase().includes(q.value);
  return !collapsedSubs.value.has(sub);
}
function toggle(sub: string): void {
  const s = new Set(collapsedSubs.value);
  if (s.has(sub)) s.delete(sub); else s.add(sub);
  collapsedSubs.value = s;
}
watch(q, () => { collapsedSubs.value = new Set(); });

function sumQty(its: ToolItem[]): number {
  return its.reduce((n, it) => n + (Number(it.qty) || 0), 0);
}

// —— 物品行锁（跨组件黄锁；库模式此组件不渲染） ——
const vLock = createEditLockDirective(props.store);
function lock(it: ToolItem, prop: string): string {
  return `${isTool.value ? "data" : "materialList"}|item|${itemKey(it)}|${prop}`;
}

// —— 类型操作：重命名/删除/添加物品 ——
function renameType(card: { sub: string }, event: Event): void {
  const input = event.target as HTMLInputElement;
  const name = input.value.trim();
  if (!name || name === card.sub) { input.value = card.sub; return; }
  const arr = items.value;
  for (const it of arr) if (it.sub === card.sub) it.sub = name;
  const s = new Set(collapsedSubs.value);
  if (s.has(card.sub)) { s.delete(card.sub); s.add(name); }
  collapsedSubs.value = s;
  props.store.persist();
}
function deleteType(sub: string): void {
  if (!window.confirm(`删除类型“${sub}”及其全部物品？\n（仅影响当前清单）`)) return;
  const arr = items.value;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].sub === sub) arr.splice(i, 1);
  const s = new Set(collapsedSubs.value);
  s.delete(sub);
  collapsedSubs.value = s;
  props.store.persist();
}
function addItemOf(sub: string): void {
  if (isTool.value) props.store.addItem(flatCat.value, sub);
  else props.store.mAddItem(flatCat.value, sub);
}
function removeItem(it: ToolItem): void {
  if (isTool.value) props.store.deleteItem(it.id);
  else props.store.mDeleteItem(it.id);
}

// —— 航材行备注展开 ——
const noteExpanded = ref<Set<number>>(new Set());
function toggleNote(it: ToolItem): void {
  const s = new Set(noteExpanded.value);
  if (s.has(it.id)) s.delete(it.id); else s.add(it.id);
  noteExpanded.value = s;
}
function commitNote(it: ToolItem): void {
  props.store.markNoteDirty(it);
  props.store.persist();
  if (!(it.note || "").trim()) {
    const s = new Set(noteExpanded.value);
    s.delete(it.id);
    noteExpanded.value = s;
  }
}
function removeNote(it: ToolItem): void {
  it.note = "";
  props.store.markNoteDirty(it);
  const s = new Set(noteExpanded.value);
  s.delete(it.id);
  noteExpanded.value = s;
  props.store.persist();
}
function noteVisible(it: ToolItem): boolean {
  return Boolean(it.note) || noteExpanded.value.has(it.id);
}
</script>

<template>
  <div class="flat-type-list">
    <template v-if="typeCards.length">
      <section v-for="card in typeCards" :key="card.sub" class="flat-card">
        <header class="flat-head">
          <button class="flat-fold" :aria-label="isOpen(card.sub) ? '收起' : '展开'" @click="toggle(card.sub)">{{ isOpen(card.sub) ? '⌄' : '›' }}</button>
          <input class="flat-type-name" :value="card.sub" aria-label="类型名称" :class="{ dim: q && !card.sub.toLowerCase().includes(q) }" title="改类型名（同名类型将合并）" @change="renameType(card, $event)" />
          <span class="flat-meta">{{ card.its.length }} 项 · {{ sumQty(card.its) }}</span>
          <div class="spacer" />
          <button @click="addItemOf(card.sub)">+ 物品</button>
          <button class="danger" title="删除该类型及其全部物品" @click="deleteType(card.sub)">删除</button>
        </header>
        <div v-if="isOpen(card.sub)" class="flat-body">
          <!-- 工具行：ItemEditor -->
          <template v-if="isTool">
            <div v-for="it in card.its" :key="it.id" class="flat-tool-row">
              <ItemEditor :item="it" :store="store" lock-field="data" @save="store.persist" @remove="removeItem(it)" />
            </div>
          </template>
          <!-- 航材行：件号/名称/数量/备注 -->
          <div v-else v-for="it in card.its" :key="it.id" class="m-item">
            <label class="m-field m-field-no"><span>件号</span><textarea rows="1" v-model="it.partNo" v-lock="lock(it, 'partNo')" class="m-name m-partno"></textarea></label>
            <label class="m-field m-field-name"><span>名称</span><textarea rows="1" v-model="it.name" v-lock="lock(it, 'name')" class="m-name"></textarea></label>
            <label class="m-field m-field-qty"><span>数量</span><input v-model.number="it.qty" v-lock="lock(it, 'qty')" type="number" min="0" @input="store.persist" /></label>
            <div class="m-ops">
              <button class="m-op m-op-del" title="删除" @click="removeItem(it)">×</button>
              <button class="m-op" :title="it.note ? '编辑备注' : '添加备注'" @click="toggleNote(it)">+</button>
            </div>
            <div v-if="noteVisible(it)" class="m-note-row">
              <label class="m-field"><span>备注</span><textarea rows="1" v-model="it.note" v-lock="lock(it, 'note')" placeholder="输入备注" class="m-name" @blur="commitNote(it)"></textarea></label>
              <button class="m-op m-op-del" title="删除备注" @click="removeNote(it)">×</button>
            </div>
          </div>
        </div>
      </section>
    </template>
    <div v-else class="empty-state">暂无类型，点击上方「＋添加类型」开始录入。</div>
  </div>
</template>

<style scoped>
.flat-type-list { display: flex; flex-direction: column; gap: 10px; }
.flat-card { border: 1.5px solid var(--n3); border-radius: var(--r-lg); background: var(--n0); overflow: hidden; }
.flat-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #edf2fc; flex-wrap: wrap; }
.flat-fold { width: 24px; height: 24px; padding: 0; border: 0; background: transparent; cursor: pointer; font-size: var(--fs-16); line-height: 1; color: #4a5160; }
.flat-type-name { flex: 0 1 auto; min-width: 110px; max-width: 260px; padding: 4px 8px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent; font-weight: 700; font-size: var(--fs-15); color: inherit; }
.flat-type-name:hover, .flat-type-name:focus { border-color: var(--focus); background: var(--n0); }
.flat-type-name.dim { color: var(--n6); font-weight: 400; }
.flat-meta { font-size: var(--fs-12); color: #98a2b3; white-space: nowrap; }
.spacer { flex: 1; }
.flat-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.flat-tool-row { display: block; }
/* —— 航材行（就地 4 字段 + 备注，同航材类型卡样式） —— */
.m-item { display: grid; grid-template-columns: 1.1fr 2fr 0.6fr auto; gap: 6px; align-items: stretch; border: 1px solid var(--n3); border-radius: var(--r-md); padding: 6px 8px; background: var(--n0); word-break: break-word; }
.m-field { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-12); color: var(--n7); min-width: 0; }
.m-field input, .m-name { padding: 5px 7px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); min-width: 0; width: 100%; box-sizing: border-box; }
.m-name { padding: 5px 7px; font-size: var(--fs-12); line-height: 1.4; resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; font-family: inherit; min-height: 30px; }
.m-ops { display: flex; flex-direction: column; gap: 4px; }
.m-op { flex: 1; min-width: 26px; min-height: 22px; padding: 0 6px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--n0); color: var(--n7); font-size: var(--fs-14); line-height: 1; cursor: pointer; }
.m-op:hover { background: var(--blue-light); }
.m-op-del { border-color: #f2cdcd; background: #fdecec; color: #b53a3a; }
.m-op-del:hover { background: #f9dcdc; }
.m-note-row { grid-column: 1 / -1; display: flex; gap: 6px; align-items: flex-end; }
.m-note-row .m-field { flex: 1; }
.m-note-row .m-op { flex: 0 0 auto; min-height: 30px; }
@media (max-width: 768px) {
  .m-item { grid-template-columns: 1fr 1fr auto; }
  .m-field-name { grid-column: span 2; }
  .m-note-row { grid-column: 1 / -1; }
}
</style>
