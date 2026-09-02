<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolItem } from "../domain/toolbox";
import { FLAT_MATERIAL_CAT, FLAT_TOOL_CAT, itemKey } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { createEditLockDirective } from "../utils/editLock";

/**
 * 单独项目类清单「类型卡」：无部位层，物品按「类型(sub)」合并分组（跨部位同名类型合并），
 * 新物品统一归到隐藏部位（工具=FLAT_TOOL_CAT / 航材=FLAT_MATERIAL_CAT），界面只出现类型概念。
 * 卡片视觉对齐换发类型「串件工具/航材清单(pt-card)」：左侧色条 + 底色、渐变卡头、蓝色描边卡片名、
 * 双列物品网格（航材=件号/名称/数量/×/+备注；工具=名称/数量/×/+备注）、卡底「+ 增加物品」。
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

/** 按「类型(sub)」聚合（跨部位同名合并）；顺序=物品数组首次出现顺序（稳定：不随内容变更轮换，
 *  新增类型通过 addItem/mAddItem 的 prepend=true 插到数组首 → 新卡自然置顶）。 */
const typeCards = computed<Array<{ sub: string; its: ToolItem[] }>>(() => {
  const m = new Map<string, ToolItem[]>();
  for (const it of items.value) {
    const s = (it.sub || "").trim() || "固定";
    let arr = m.get(s);
    if (!arr) { arr = []; m.set(s, arr); }
    arr.push(it);
  }
  return [...m.entries()].map(([sub, its]) => ({ sub, its }));
});

/** 卡片取色（与换发串件清单一致：列表序号取 5 色调色板）。 */
const CARD_PALETTE = ["#4472C4", "#ED7D31", "#548235", "#C9A227", "#7F7F7F"];
const cardColorOf = (idx: number): string => CARD_PALETTE[idx % CARD_PALETTE.length];
const cardBgOf = (idx: number): string => `${cardColorOf(idx)}33`;   // 20% 透明

// —— 折叠/查询 ——
const collapsedSubs = ref<Set<string>>(new Set());
const q = computed(() => (props.query || "").trim().toLowerCase());
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

// —— 物品行软锁（与换发一致行内锁；库模式不渲染本组件） ——
const vLock = createEditLockDirective(props.store);
function lock(it: ToolItem, prop: string): string {
  return `${isTool.value ? "data" : "materialList"}|item|${itemKey(it)}|${prop}`;
}

// —— 类型操作：重命名/删除/添加物品 ——
function renameType(card: { sub: string }, event: Event): void {
  const input = event.target as HTMLInputElement;
  const name = input.value.trim();
  if (!name || name === card.sub) { input.value = card.sub; return; }
  for (const it of items.value) if (it.sub === card.sub) it.sub = name;
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

// —— 备注展开 ——
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

/** 文本区自动撑高（对齐换发 pt 卡 onPartAutoSize）。 */
function autoGrow(event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
</script>

<template>
  <div class="ft-list">
    <template v-if="typeCards.length">
      <section
        v-for="(card, idx) in typeCards"
        :key="card.sub"
        class="gp-card ft-card"
        :style="{ borderLeft: `6px solid ${cardColorOf(idx)}`, background: cardBgOf(idx) }"
      >
        <div class="ft-card-head">
          <button class="pt-collapse" :title="isOpen(card.sub) ? '折叠卡片' : '展开卡片'" @click="toggle(card.sub)">{{ isOpen(card.sub) ? '▾' : '▸' }}</button>
          <input
            class="pt-card-name ft-card-name"
            :value="card.sub"
            aria-label="类型名称"
            :class="{ dim: q && !card.sub.toLowerCase().includes(q) }"
            placeholder="类型名称（改名后同名类型自动合并）"
            title="改类型名"
            @change="renameType(card, $event)"
          />
          <span class="pt-count">{{ card.its.length }} 项 · {{ sumQty(card.its) }}</span>
          <button class="icon-btn" :title="'删除类型：' + card.sub" @click="deleteType(card.sub)">×</button>
        </div>
        <template v-if="isOpen(card.sub)">
          <div v-if="card.its.length" class="pt-items" :class="{ 'ft-items-tool': isTool, 'ft-items-air': !isTool }">
            <!-- 航材行：件号/名称/数量/×/+备注（对齐换发串件航材 pt-item-air） -->
            <div v-if="!isTool" v-for="it in card.its" :key="it.id" class="pt-item pt-item-air">
              <label class="m-field m-field-no"><span>件号</span><textarea rows="1" v-model="it.partNo" v-lock="lock(it, 'partNo')" class="m-name" @input="autoGrow"></textarea></label>
              <label class="m-field m-field-name"><span>名称</span><textarea rows="1" v-model="it.name" v-lock="lock(it, 'name')" class="m-name" @input="autoGrow"></textarea></label>
              <label class="m-field m-field-qty"><span>数量</span><input v-model.number="it.qty" v-lock="lock(it, 'qty')" type="number" min="0" @input="store.persist" /></label>
              <div class="m-ops">
                <button class="m-op m-op-del" title="删除物品" @click="removeItem(it)">×</button>
                <button class="m-op" :title="it.note ? '编辑备注' : '添加备注'" @click="toggleNote(it)">+</button>
              </div>
              <div v-if="noteVisible(it)" class="pt-note-row">
                <textarea v-model="it.note" v-lock="lock(it, 'note')" class="pt-note" placeholder="备注" rows="1" @input="autoGrow" @blur="commitNote(it)"></textarea>
                <button class="m-op m-op-del ft-note-del" title="删除备注" @click="removeNote(it)">×</button>
              </div>
            </div>
            <!-- 工具行：名称/数量/×/+备注（对齐换发串件工具 pt-item-tool） -->
            <div v-else v-for="it in card.its" :key="it.id" class="pt-item pt-item-tool">
              <label class="m-field m-field-name"><span>名称</span><textarea rows="1" v-model="it.name" v-lock="lock(it, 'name')" class="m-name" @input="autoGrow"></textarea></label>
              <label class="m-field m-field-qty"><span>数量</span><input v-model.number="it.qty" v-lock="lock(it, 'qty')" type="number" min="0" @input="store.persist" /></label>
              <div class="m-ops">
                <button class="m-op m-op-del" title="删除物品" @click="removeItem(it)">×</button>
                <button class="m-op" :title="it.note ? '编辑备注' : '添加备注'" @click="toggleNote(it)">+</button>
              </div>
              <div v-if="noteVisible(it)" class="pt-note-row">
                <textarea v-model="it.note" v-lock="lock(it, 'note')" class="pt-note" placeholder="备注" rows="1" @input="autoGrow" @blur="commitNote(it)"></textarea>
                <button class="m-op m-op-del ft-note-del" title="删除备注" @click="removeNote(it)">×</button>
              </div>
            </div>
          </div>
          <div v-else class="pt-empty">暂无物品 — 点击「+ 增加物品」</div>
          <button class="gp-add" @click="addItemOf(card.sub)">+ 增加物品</button>
        </template>
      </section>
    </template>
    <div v-else class="pt-empty-all">暂无类型 — 点上方「+ 添加类型」开始录入。</div>
  </div>
</template>

<style scoped>
.ft-list { display: flex; flex-direction: column; gap: 6px; }
/* 卡片容器（对齐换发 .gp-card + pt-card：白底 padding、色条与底色由内联 style 提供） */
.ft-card { border: 1px solid var(--n4); border-radius: var(--r-lg); padding: 12px 14px; margin-bottom: 0; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
/* 卡片头（对齐 .pt-card-head 渐变 + 蓝色描边可编辑名） */
.ft-card-head { display: flex; align-items: center; gap: 10px; padding: 4px 0 10px; background: linear-gradient(90deg, #edf2fc, transparent); border-radius: 11px 11px 0 0; border-bottom: 1px solid var(--line); margin: -2px -4px 8px; }
.ft-card-name { flex: 1; min-width: 120px; height: 32px; padding: 0 8px; border: 1.5px solid var(--blue); border-radius: var(--r-sm); font-size: var(--fs-14); font-weight: 700; color: var(--blue-dark); background: var(--n0); }
.ft-card-name:focus { outline: none; border-color: var(--focus); }
.ft-card-name.dim { font-weight: 400; color: var(--n6); }
.pt-collapse { flex-shrink: 0; width: 24px; height: 24px; padding: 0; border: 1px solid var(--line); border-radius: var(--r-sm); background: rgba(255,255,255,.8); color: var(--n7); font-size: var(--fs-13); line-height: 1; cursor: pointer; }
.pt-collapse:hover { border-color: var(--blue); color: var(--blue-dark); }
.pt-count { font-size: var(--fs-12); color: var(--n7); flex-shrink: 0; }
.icon-btn { border: none; background: transparent; color: var(--danger); font-size: var(--fs-16); cursor: pointer; flex-shrink: 0; }
/* 物品双列网格（对齐换发 .pt-items） */
.pt-items { padding: 4px 0 8px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.pt-item { display: grid; grid-template-columns: 1.1fr 2fr 0.6fr auto; gap: 6px; align-items: stretch; border: 1px solid var(--n3); border-radius: var(--r-md); padding: 6px 8px; background: var(--n0); word-break: break-word; }
.pt-item:hover { border-color: var(--blue); }
.pt-item-tool { grid-template-columns: 2fr 0.6fr auto; }
.m-field { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-12); color: var(--n7); min-width: 0; }
.m-field input, .m-name { padding: 5px 7px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); min-width: 0; width: 100%; box-sizing: border-box; }
.m-name { padding: 5px 7px; font-size: var(--fs-12); line-height: 1.4; resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; font-family: inherit; min-height: 30px; }
.m-ops { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
.m-op { flex: 1; min-width: 26px; min-height: 22px; padding: 0 6px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--n0); color: var(--n7); font-size: var(--fs-14); line-height: 1; cursor: pointer; }
.m-op:hover { background: var(--blue-light); }
.m-op-del { border-color: #f2cdcd; background: #fdecec; color: #b53a3a; }
.m-op-del:hover { background: #f9dcdc; }
.pt-note-row { grid-column: 1 / -1; display: flex; gap: 6px; align-items: flex-end; }
.pt-note { min-height: 28px; font-size: var(--fs-12); color: var(--danger); outline: none; background: var(--blue-bg); border: 1px dashed var(--line); border-radius: var(--r-sm); padding: 4px 8px; resize: none; width: 100%; font-family: inherit; }
.ft-note-del { flex: 0 0 auto; min-height: 28px; }
.pt-empty { color: var(--n7); font-size: var(--fs-12); text-align: center; padding: 10px 0; }
.pt-empty-all { text-align: center; color: var(--n7); padding: 40px 0; font-size: var(--fs-13); }
.gp-add { margin-top: 8px; }
@media (max-width: 768px) {
  .pt-items { grid-template-columns: 1fr; }
}
</style>
