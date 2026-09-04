<script setup lang="ts">
interface CloudStatus {
  text: string;
  state: "ok" | "warn" | "err";
  available: boolean;
}

defineProps<{ cloud: CloudStatus; watchActive: boolean; identityName: string; onlineCount: number }>();
defineEmits<{ "switch-identity": [] }>();
</script>

<template>
  <header class="top">
    <div>
      <h1>工作准备工具站</h1>
      <p>工作项目准备单与标准库统一管理，数据通过 Django API 同步。</p>
    </div>
    <div class="status-group">
      <button class="identity-badge" :title="identityName ? `当前身份：${identityName}（点击切换）` : '点击设置身份'" @click="$emit('switch-identity')">
        <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
        </svg>
        {{ identityName || "未登录" }}
        <span v-if="onlineCount > 0" class="online-badge" :title="`同时在线 ${onlineCount} 人`">{{ onlineCount > 99 ? '99+' : onlineCount }}</span>
      </button>
      <span class="status-badge" :class="cloud.state" :title="cloud.text">
        <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
          <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
        </svg>
        Django
      </span>
      <span class="status-badge" :class="watchActive ? 'on' : 'off'" :title="watchActive ? 'CloudWatch 实时推送已连接' : 'CloudWatch 实时推送未启用'">
        <svg class="badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6.5 19a4.5 4.5 0 1 1 .4-8.98A6 6 0 0 1 18.3 12.4 3.75 3.75 0 0 1 17.5 19h-11z" />
        </svg>
        CloudWatch
      </span>
    </div>
  </header>
</template>
