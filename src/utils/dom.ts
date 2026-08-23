/** 表单 textarea 自动撑高（rows=1 + overflow:hidden 时 scrollHeight 会按单行算，必须先复位 height）。 */
export function growTextarea(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** 批量撑高 root 内所有 textarea（加载已有数据/增删行后调用）。 */
export function growAllTextareas(root: HTMLElement | null, selector = "textarea"): void {
  if (!root) return;
  root.querySelectorAll<HTMLTextAreaElement>(selector).forEach(growTextarea);
}
