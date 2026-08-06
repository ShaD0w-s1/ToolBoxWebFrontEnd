<script setup lang="ts">
import type { ToolItem } from "../domain/toolbox";

defineProps<{ item: ToolItem; duplicate?: boolean }>();
defineEmits<{ save: []; remove: [] }>();
</script>

<template>
  <div class="item-row" :class="{ duplicate }">
    <textarea v-model="item.name" rows="1" aria-label="物品名称" @input="$emit('save')" />
    <div class="quantity">
      <button aria-label="减少数量" @click="item.qty = Math.max(0, item.qty - 1); $emit('save')">−</button>
      <input v-model.number="item.qty" type="number" min="0" aria-label="数量" @input="$emit('save')" />
      <button aria-label="增加数量" @click="item.qty += 1; $emit('save')">+</button>
    </div>
    <button class="icon-danger" aria-label="删除物品" @click="$emit('remove')">×</button>
  </div>
</template>
