<script setup lang="ts">
import { onMounted, ref, watch, nextTick } from "vue";
import type { ToolItem } from "../domain/toolbox";
import { itemKey } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { createEditLockDirective } from "../utils/editLock";

const props = defineProps<{
  item: ToolItem;
  duplicate?: boolean;
  sameName?: string | null;
  /** 行锁顶层字段：工具清单="data"；空串=不参与协同锁（如标准库编辑）。 */
  store: ToolboxStore;
  lockField?: string;
}>();
defineEmits<{ save: []; remove: [] }>();

const nameEl = ref<HTMLTextAreaElement | null>(null);

/** 名称过长时自动增高并换行，避免横向溢出或遮挡。 */
function autoGrow(): void {
  const el = nameEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

onMounted(autoGrow);
watch(() => props.item.name, () => nextTick(autoGrow));

/** 行锁 key：`field|item|<内容键>|<字段>`（内容键跨端稳定；库模式空串=不锁）。 */
const vLock = createEditLockDirective(props.store);
function lock(prop: "name" | "qty"): string {
  return props.lockField ? `${props.lockField}|item|${itemKey(props.item)}|${prop}` : "";
}
</script>

<template>
  <div class="item-row" :class="{ duplicate, 'has-same': sameName }">
    <span v-if="sameName" class="same-flag" :style="{ borderTopColor: sameName }" aria-hidden="true" />
    <textarea
      ref="nameEl"
      v-model="item.name"
      v-lock="lock('name')"
      rows="1"
      aria-label="物品名称"
      @input="autoGrow(); $emit('save')"
    />
    <div class="quantity">
      <button aria-label="减少数量" @click="item.qty = Math.max(0, item.qty - 1); $emit('save')">−</button>
      <input v-model.number="item.qty" v-lock="lock('qty')" type="number" min="0" aria-label="数量" @input="$emit('save')" />
      <button aria-label="增加数量" @click="item.qty += 1; $emit('save')">+</button>
    </div>
    <button class="icon-danger" aria-label="删除物品" @click="$emit('remove')">×</button>
  </div>
</template>
