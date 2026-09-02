import type { ToolboxStore } from "../composables/useToolbox";

/**
 * 单输入框级协同编辑软锁共享工具。
 *
 * key 约定 `${field}|${kind}|${id}|${sub}`：
 *  - field：顶层 ProjectField（ganttPrep / standalonePrepSheet / prepSheet / workcardAssignment / data / materialList）→ 第 0 段，保存时据此映射
 *  - kind：容器类型（card / sprow / aircraft / work / part / personnel / group / row / docwp…）
 *  - id：容器稳定 id（跨端一致：gantt 用字符串 uuid，standalone/prep 用数字 id）
 *  - sub：输入框字段名（content / owner / note / 机号…）
 * 两端各自拼出相同 key 才会互锁；field 固定在第 0 段。
 */
export function lockKey(field: string, kind: string, id: string, sub: string): string {
  return `${field}|${kind}|${id}|${sub}`;
}

/** v-lock 指令工厂：focus 上报 / input 续期 / blur 结束并保存；他人锁定时 disabled + 黄底 + 悬浮提示。 */
export function createEditLockDirective(store: ToolboxStore): {
  mounted(el: HTMLElement, binding: { value: string }): void;
  updated(el: HTMLElement, binding: { value: string }): void;
  unmounted(el: HTMLElement, binding: { value: string }): void;
} {
  function applyLockState(el: HTMLElement, key: string): void {
    const locked = store.isLockedByOther(key);
    const owner = store.lockOwnerOf(key);
    const inner = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement
      ? el
      : el.querySelector<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>("textarea, input, select");
    if (inner) {
      inner.disabled = locked;
      if (locked) inner.setAttribute("data-locked-owner", owner || "");
      else inner.removeAttribute("data-locked-owner");
    }
    el.classList.toggle("remote-locked", locked);
    if (locked && owner) el.title = `${owner} 正在编辑`;
    else if (!locked) el.title = "";
  }
  return {
    mounted(el: HTMLElement, binding: { value: string }) {
      applyLockState(el, binding.value);
      el.addEventListener("focusin", () => store.beginEdit(binding.value));
      el.addEventListener("input", () => store.touchEdit(binding.value));
      el.addEventListener("focusout", () => store.endEdit(binding.value));
    },
    updated(el: HTMLElement, binding: { value: string }) {
      applyLockState(el, binding.value);
    },
    unmounted(_el: HTMLElement, binding: { value: string }) {
      store.endEdit(binding.value);
    },
  };
}
