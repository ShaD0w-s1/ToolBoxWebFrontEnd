<script setup lang="ts">
import type { ToolItem } from "../domain/toolbox";
import { itemKey } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { createEditLockDirective } from "../utils/editLock";
import { growTextarea } from "../utils/dom";

const props = defineProps<{ store: ToolboxStore; partNo: string; name: string; items: ToolItem[] }>();

// 重复梳理视图的物品行软锁：项目模式（materialList）；航材标准库模式不锁。
const vLock = createEditLockDirective(props.store);
function lock(it: ToolItem, prop: string): string {
  return props.store.editingMaterialLibrary.value ? "" : `materialList|item|${itemKey(it)}|${prop}`;
}

function remove(it: ToolItem): void {
  props.store.mDeleteItem(it.id);
}
/** 数量步进：−/+ 增减 1，下限 0。 */
function stepQty(it: ToolItem, d: number): void {
  it.qty = Math.max(0, (Number(it.qty) || 0) + d);
  props.store.persist();
}
function commitNote(it: ToolItem, event: Event): void {
  growTextarea(event.target as HTMLTextAreaElement);
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
      <div class="itg" style="grid-template-columns: 1.4fr 0.6fr 2.2fr auto">
        <div class="itg-head"><span>类型</span><span>数量</span><span class="itg-note-cell">备注</span><span></span></div>
        <div v-for="it in items" :key="it.id" class="itg-row">
          <span class="itg-tag">{{ subLabel(it) }}</span>
          <div class="itg-qty">
            <button type="button" class="qty-step" title="减 1" @click="stepQty(it, -1)">−</button>
            <input v-model.number="it.qty" v-lock="lock(it, 'qty')" type="number" min="0" placeholder="数量" @input="store.queuePersist" />
            <button type="button" class="qty-step" title="加 1" @click="stepQty(it, 1)">+</button>
          </div>
          <textarea v-model="it.note" v-lock="lock(it, 'note')" rows="1" class="cell-inp is-note" placeholder="备注" @input="commitNote(it, $event)" />
          <div class="itg-ops"><button class="del" title="删除" @click="remove(it)">×</button></div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* .pnc-* 卡壳样式已上移 main.css 全局共享（与 GanttPrep 重复梳理卡同源）。 */
</style>
