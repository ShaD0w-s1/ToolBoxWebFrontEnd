<script setup lang="ts">
interface CloudStatus {
  text: string;
  state: "ok" | "warn" | "err";
  available: boolean;
}

defineProps<{ cloud: CloudStatus; watchActive: boolean }>();
</script>

<template>
  <header class="top">
    <div>
      <h1>吉祥定检工作项目准备单组合</h1>
      <p>工作项目准备单与标准库统一管理，数据通过 Django API 同步。</p>
    </div>
    <div class="status-group">
      <span class="cloud-status" :class="cloud.state">{{ cloud.text }}</span>
      <span class="watch-status" :class="watchActive ? 'on' : 'off'" :title="watchActive ? 'CloudWatch 实时推送已连接' : 'CloudWatch 实时推送未启用'">
        <svg class="cw-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.5 19a4.5 4.5 0 1 1 .4-8.98A6 6 0 0 1 18.3 12.4 3.75 3.75 0 0 1 17.5 19h-11z" />
        </svg>
        CloudWatch
      </span>
    </div>
  </header>
</template>
