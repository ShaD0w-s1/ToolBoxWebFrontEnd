<script setup>
defineProps({ item: { type: Object, required: true }, duplicate: Boolean });
defineEmits(["save", "remove"]);
</script>

<template>
  <div class="item-row" :class="{ duplicate }">
    <textarea v-model="item.name" rows="1" aria-label="物品名称" @change="$emit('save')" />
    <div class="quantity">
      <button aria-label="减少数量" @click="item.qty = Math.max(0, item.qty - 1); $emit('save')">−</button>
      <input v-model.number="item.qty" type="number" min="0" aria-label="数量" @change="$emit('save')" />
      <button aria-label="增加数量" @click="item.qty += 1; $emit('save')">+</button>
    </div>
    <button class="icon-danger" aria-label="删除物品" @click="$emit('remove')">×</button>
  </div>
</template>
