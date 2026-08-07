import { ref } from "vue";

/**
 * 工作卡片每行数量：由页面（视口）宽度决定，最少 1 个、最多 3 个。
 * 用模块级单例 + 单个 resize 监听，所有 CategorySection 共享，避免重复挂监听。
 */
const workCols = ref<number>(1);
let initialized = false;

function update(): void {
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

export function useWorkColumns(): { workCols: typeof workCols } {
  ensure();
  return { workCols };
}
