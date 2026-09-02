<script setup lang="ts">
import type { ToolItem } from "../domain/toolbox";
import { itemKey } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { createEditLockDirective } from "../utils/editLock";

const props = defineProps<{ store: ToolboxStore; partNo: string; name: string; items: ToolItem[] }>();

// 重复梳理视图的物品行软锁：项目模式（materialList）；航材标准库模式不锁。
const vLock = createEditLockDirective(props.store);
function lock(it: ToolItem, prop: string): string {
  return props.store.editingMaterialLibrary.value ? "" : `materialList|item|${itemKey(it)}|${prop}`;
}

function remove(it: ToolItem): void {
  props.store.mDeleteItem(it.id);
}
function commitNote(it: ToolItem): void {
  props.store.markNoteDirty(it);
  props.store.persist();
}
function subLabel(it: ToolItem): string {
  return (it.sub && it.sub.trim()) || "固定";
}
</script>

<template>
  <article class="pnc-card">
    <header class="pnc-head">
      <strong class="pnc-partno">{{ partNo || "无件号" }}</strong>
      <span class="pnc-name">{{ name || "—" }}</span>
      <span class="pnc-count">×{{ items.length }}</span>
    </header>
    <div class="pnc-body">
      <div v-for="it in items" :key="it.id" class="pnc-item">
        <span class="pnc-type">{{ subLabel(it) }}</span>
        <input v-model.number="it.qty" v-lock="lock(it, 'qty')" type="number" min="0" class="pnc-qty" aria-label="数量" @input="store.persist" />
        <button class="pnc-del" title="删除" @click="remove(it)">×</button>
        <textarea v-model="it.note" v-lock="lock(it, 'note')" class="pnc-note" rows="1" placeholder="备注" @input="commitNote(it)" />
      </div>
    </div>
  </article>
</template>

<style scoped>
.pnc-card { border: 1px solid var(--n4); border-radius: var(--r-lg); background: var(--n0); margin-bottom: 10px; overflow: hidden; }
.pnc-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #edf2fc; }
.pnc-partno { font-size: var(--fs-14); color: var(--blue-dark); font-weight: 700; }
.pnc-name { font-size: var(--fs-13); color: #4a5160; }
.pnc-count { margin-left: auto; font-size: var(--fs-12); color: #98a2b3; }
.pnc-body { padding: 6px 10px; display: flex; flex-direction: column; gap: 6px; }
.pnc-item { display: grid; grid-template-columns: 1.2fr 0.5fr auto 2fr; gap: 6px; align-items: center; }
.pnc-type { font-size: var(--fs-13); color: #4a5160; padding: 4px 8px; background: #f4f6fb; border-radius: var(--r-sm); min-height: 24px; }
.pnc-qty { width: 100%; min-height: 30px; padding: 4px 6px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); box-sizing: border-box; }
.pnc-del { width: 26px; height: 26px; padding: 0; border: 1px solid #f2cdcd; border-radius: var(--r-sm); background: #fdecec; color: #b53a3a; font-size: var(--fs-16); line-height: 1; cursor: pointer; }
.pnc-del:hover { background: #f9dcdc; }
.pnc-note { min-height: 30px; padding: 4px 7px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-12); resize: none; overflow: hidden; font-family: inherit; line-height: 1.4; box-sizing: border-box; width: 100%; }
</style>
