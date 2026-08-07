import type { Directive } from "vue";

/**
 * v-item-columns：物品卡片列数由"工作卡片实际宽度"决定（最少 1、最多 3）。
 * 直接测量绑定元素（.item-grid）自身的宽度——它等于工作卡片内部可用宽度，
 * 因此列数随工作卡片宽度自适应。阈值保证每列至少 ~280px，避免窄屏互相挤压。
 *   < 600px → 1 列；600–900px → 2 列；≥ 900px → 3 列。
 * 普通工作卡片（每行 1–3 个）宽度有限，通常落在 1 列；只有够宽的工作卡片（如"固定"整行）才会扩到 2–3 列。
 */
interface ElWithRO extends HTMLElement {
  __itemColsRO__?: ResizeObserver;
}

function colsForWidth(w: number): number {
  if (w >= 900) return 3;
  if (w >= 600) return 2;
  return 1;
}

function apply(el: HTMLElement): void {
  const cols = colsForWidth(el.clientWidth);
  el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
}

export const vItemColumns: Directive<HTMLElement> = {
  mounted(el: ElWithRO) {
    apply(el);
    const ro = new ResizeObserver(() => apply(el));
    ro.observe(el);
    el.__itemColsRO__ = ro;
  },
  unmounted(el: ElWithRO) {
    el.__itemColsRO__?.disconnect();
    delete el.__itemColsRO__;
  },
};
