/** 统一日期展示格式，避免各组件重复拼接。 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDay(timestamp: number): string {
  return formatDate(timestamp).slice(0, 10);
}

/** 只接受真实存在的年月日，避免 Date 自动进位造成错误筛选。 */
export function parseDay(value: string): Date | null {
  const match = String(value || "").trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function download(blob: Blob, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
}

/**
 * 移动端可靠保存文件：优先用系统分享面板（可“存储到文件”），不支持则退回 blob 下载。
 * 移动端浏览器（尤其中文 xlsx）对 <a download> + blob: 直接点击基本不触发下载，
 * 而 navigator.share({ files }) 在 iOS/Android 上能唤起系统分享，是最稳的“下载”路径。
 */
export async function saveFile(file: File): Promise<void> {
  const nav = navigator as unknown as {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return;
    } catch (error) {
      // 用户取消（AbortError）不算失败；其它分享异常继续走兜底下载
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
