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
    // 本端正在编辑该输入框（focus 未 blur）→ 优先保持输入，不应用他人锁（防“编辑 <2s 被秒锁强踢并保存”）。
    const editingHere = store.isEditingHere(key);
    // 焦点硬豁免：只要输入框此刻拥有真实焦点（含 IME 选词/长输入停顿），任何同步轮询都不得禁用/黄锁它，
    // 否则失焦→endEdit 自动保存并脱离编辑，输入被“同步打断”。锁延后到真正 blur 后的下一轮再显示。
    const inner = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement
      ? el
      : el.querySelector<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>("textarea, input, select");
    const activeEl = document.activeElement;
    const focusedNow = Boolean(inner && activeEl && (activeEl === inner || activeEl === el || (inner.contains(activeEl))));
    const effective = locked && !editingHere && !focusedNow;
    if (inner) {
      inner.disabled = effective;
      if (effective) inner.setAttribute("data-locked-owner", owner || "");
      else inner.removeAttribute("data-locked-owner");
    }
    el.classList.toggle("remote-locked", effective);
    if (effective && owner) el.title = `${owner} 正在编辑`;
    else if (!effective) el.title = "";
  }
  return {
    mounted(el: HTMLElement, binding: { value: string }) {
      applyLockState(el, binding.value);
      const state = el as HTMLElement & { __lockKey?: string; __focusTimer?: number };
      const keyOf = (): string => state.__lockKey || binding.value;
      el.addEventListener("focusin", () => {
        // 会话 key 以 focus 瞬间快照为准：编辑中改名/改件号导致内容键漂移时，
        // blur 仍按同一 key 结束会话并触发保存（否则快速编辑会丢/滞留会话）。
        state.__lockKey = binding.value;
        store.beginEdit(binding.value);
        // 焦点保活：只要输入框保持焦点（含 IME 拼音选词、长输入停顿），每 25s 续期一次编辑会话，
        // 使「会话超时自动保存并脱离编辑」不会发生在正在输入的格子上（超时只对失焦后生效）。
        if (!state.__focusTimer) {
          state.__focusTimer = window.setInterval(() => store.touchEdit(keyOf()), 25_000);
        }
      });
      const touch = (): void => store.touchEdit(keyOf());
      el.addEventListener("input", touch);
      // IME 拼音组合期间不发 input，按键也会触发 keydown → 用 keydown 兜底续期，防选词空窗被超时解除。
      el.addEventListener("keydown", touch);
      el.addEventListener("focusout", () => {
        if (state.__focusTimer !== undefined) { clearInterval(state.__focusTimer); state.__focusTimer = undefined; }
        state.__lockKey = undefined;
        store.endEdit(binding.value);
      });
    },
    updated(el: HTMLElement, binding: { value: string }) {
      applyLockState(el, binding.value);
    },
    unmounted(el: HTMLElement, binding: { value: string }) {
      const state = el as HTMLElement & { __lockKey?: string; __focusTimer?: number };
      if (state.__focusTimer !== undefined) { clearInterval(state.__focusTimer); state.__focusTimer = undefined; }
      store.endEdit(state.__lockKey || binding.value);
    },
  };
}
