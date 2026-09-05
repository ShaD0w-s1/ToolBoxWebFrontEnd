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
  if (!window.confirm(`删除工作“${sub}”及其全部物品？\n（仅影响当前清单）`)) return;
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

/** 数量步进：−/+ 增减 1，下限 0。 */
function stepQty(it: ToolItem, d: number): void {
  it.qty = Math.max(0, (Number(it.qty) || 0) + d);
  props.store.persist();
}

// —— 备注列失焦提交（标记字段级脏，参与合并）——
function commitNote(it: ToolItem): void {
  props.store.markNoteDirty(it);
  props.store.persist();
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
            aria-label="工作名称"
            :class="{ dim: q && !card.sub.toLowerCase().includes(q) }"
            placeholder="工作名称（改名后同名工作自动合并）"
            title="改工作名"
            @change="renameType(card, $event)"
          />
          <span class="pt-count">{{ card.its.length }} 项 · {{ sumQty(card.its) }}</span>
          <button class="icon-btn" :title="'删除工作：' + card.sub" @click="deleteType(card.sub)">×</button>
        </div>
        <template v-if="isOpen(card.sub)">
          <!-- 物品表：行间水平实线、列间垂直虚线；字段名以 placeholder 呈现（维持卡片框架与配色） -->
          <div v-if="card.its.length" class="itg" :style="{ gridTemplateColumns: isTool ? '2fr 0.6fr 2.2fr auto' : '1.55fr 1.55fr 0.6fr 2.2fr auto' }">
            <div class="itg-head">
              <template v-if="!isTool"><span>件号</span></template>
              <span>名称</span><span>数量</span><span class="itg-note-cell">备注</span><span></span>
            </div>
            <div v-for="it in card.its" :key="it.id" class="itg-row">
              <template v-if="!isTool">
                <textarea rows="1" v-model="it.partNo" v-lock="lock(it, 'partNo')" placeholder="件号" @input="autoGrow"></textarea>
              </template>
              <textarea rows="1" v-model="it.name" v-lock="lock(it, 'name')" placeholder="名称" @input="autoGrow"></textarea>
              <div class="itg-qty">
                <button type="button" class="qty-step" title="减 1" @click="stepQty(it, -1)">−</button>
                <input v-model.number="it.qty" v-lock="lock(it, 'qty')" type="number" min="0" placeholder="数量" @input="store.queuePersist" />
                <button type="button" class="qty-step" title="加 1" @click="stepQty(it, 1)">+</button>
              </div>
              <textarea rows="1" class="cell-inp is-note" v-model="it.note" v-lock="lock(it, 'note')" placeholder="备注" @input="autoGrow" @blur="commitNote(it)"></textarea>
              <div class="itg-ops"><button class="del" title="删除物品" @click="removeItem(it)">×</button></div>
            </div>
          </div>
          <div v-else class="pt-empty">暂无物品 — 点击「+ 增加物品」</div>
          <button class="gp-add" @click="addItemOf(card.sub)">+ 增加物品</button>
        </template>
      </section>
    </template>
    <div v-else class="pt-empty-all">暂无工作 — 点上方「+ 添加工作」开始录入。</div>
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
/* 折叠按钮/计数/删除图标/空态样式已上移 main.css 共享卡壳基元（.pt-collapse/.pt-count/.icon-btn/.pt-empty*） */
.gp-add { margin-top: 8px; }

</style>
