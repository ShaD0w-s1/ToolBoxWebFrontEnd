import { ref, computed } from "vue";

/**
 * 工作卡片每行数量：由页面（视口）宽度决定，最少 1 个、最多 3 个。
 * 用模块级单例 + 单个 resize 监听，所有 CategorySection 共享，避免重复挂监听。
 */
const workCols = ref<number>(1);
/** 导出图片时强制桌面多列布局（3 列），让移动端截出“网页宽屏”长截图。 */
const forceDesktop = ref<boolean>(false);
/** 是否为手机视口（<768px）。 */
const isMobile = ref<boolean>(false);
/** 布局意义上的“移动端”：手机视口且未强制桌面布局（导出宽屏时按桌面处理）。 */
const layoutIsMobile = computed(() => isMobile.value && !forceDesktop.value);
let initialized = false;

function update(): void {
  isMobile.value = window.innerWidth < 768;
  if (forceDesktop.value) { workCols.value = 3; return; }
  const w = window.innerWidth;
  // 窄屏（手机）<700 → 1 列；700–1100 → 2 列；≥1100（内容宽≈1068）→ 3 列，且不超过 3。
  // 阈值取在 main 最大宽度(1100)附近，保证每行卡片 ≥ ~340px，工作抬头不被挤换行。
  workCols.value = w >= 1100 ? 3 : w >= 700 ? 2 : 1;
}

function ensure(): void {
  if (initialized) return;
  initialized = true;
  update();
  window.addEventListener("resize", update);
}

/** 临时切换桌面/移动布局（导出图片用）。 */
export function setForceDesktop(value: boolean): void {
  forceDesktop.value = value;
  update();
}

export function useWorkColumns(): { workCols: typeof workCols; layoutIsMobile: typeof layoutIsMobile } {
  ensure();
  return { workCols, layoutIsMobile };
}
