<script setup lang="ts">
/** 统一加载态（UI_DESIGN_SPEC §8.3 ⑤）。
 *
 *  `.loading-state` 的样式（含旋转指示器）早已集中在 `main.css`，但标记 `<p class="loading-state">…</p>`
 *  在各页重复了 7 处、文案也不一致。本组件只收敛这段重复标记 ——
 *  **渲染结果与原处完全相同**（同一个 `<p class="loading-state">` + 同一段文案），零视觉变更。
 *
 *  ⚠️ 样式是全局的，因此不要在本组件里加 scoped 样式；旋转动画依赖 `main.css` 的 `.loading-state::before`。
 */
withDefaults(defineProps<{ text?: string }>(), { text: "加载中…" });
</script>

<template>
  <p class="loading-state">{{ text }}</p>
</template>
