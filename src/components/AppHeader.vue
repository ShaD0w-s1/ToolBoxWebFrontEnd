<script setup lang="ts">
interface CloudStatus {
  text: string;
  state: "ok" | "warn" | "err";
  available: boolean;
}

defineProps<{ cloud: CloudStatus }>();
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
