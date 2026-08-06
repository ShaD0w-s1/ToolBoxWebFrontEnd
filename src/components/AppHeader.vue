<script setup>
defineProps({ cloud: { type: Object, required: true } });
</script>

<template>
  <header class="top">
    <div>
      <h1>吉祥定检工具清单</h1>
      <p>工作项目与标准库统一管理，数据通过 Django API 同步。</p>
    </div>
    <span class="cloud-status" :class="cloud.state">{{ cloud.text }}</span>
  </header>
</template>
