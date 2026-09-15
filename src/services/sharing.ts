import type { Project } from "../domain/toolbox";

export interface SharePayload {
  v: number;
  scope: "app" | "cart" | "detail";
  data?: unknown;
  library?: string | null;
  project?: unknown;
}

// 链接前缀：C1=压缩(deflate-raw)，R1=未压缩(降级)。无前缀的旧链接按未压缩解析。
const COMPRESSED_PREFIX = "C1:";
const RAW_PREFIX = "R1:";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 优先用浏览器原生 CompressionStream 压缩；不支持或变大时降级为原始 base64。 */
async function encode(value: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const g = globalThis as { CompressionStream?: unknown; DecompressionStream?: unknown };
  const CS = g.CompressionStream as (new (format: string) => TransformStream) | undefined;
  if (CS) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CS("deflate-raw"));
      const out = new Uint8Array(await new Response(stream).arrayBuffer());
      if (out.length < bytes.length) return COMPRESSED_PREFIX + bytesToBase64Url(out);
    } catch {
      /* 压缩失败则走降级 */
    }
  }
  return RAW_PREFIX + bytesToBase64Url(bytes);
}

async function decode(value: string): Promise<SharePayload | null> {
  try {
    const g = globalThis as { DecompressionStream?: unknown };
    const DS = g.DecompressionStream as (new (format: string) => TransformStream) | undefined;
    if (value.startsWith(COMPRESSED_PREFIX) && DS) {
      const bytes = base64UrlToBytes(value.slice(COMPRESSED_PREFIX.length));
      const stream = new Blob([bytes]).stream().pipeThrough(new DS("deflate-raw"));
      const out = new Uint8Array(await new Response(stream).arrayBuffer());
      return JSON.parse(new TextDecoder().decode(out)) as SharePayload;
    }
    const raw = value.startsWith(RAW_PREFIX) ? value.slice(RAW_PREFIX.length) : value;
    const bytes = base64UrlToBytes(raw);
    return JSON.parse(new TextDecoder().decode(bytes)) as SharePayload;
  } catch {
    return null;
  }
}

export async function createShareUrl(payload: SharePayload): Promise<string> {
  return `${location.href.split("#")[0]}#s=${await encode(payload)}`;
}

export async function readSharePayload(): Promise<SharePayload | null> {
  return location.hash.startsWith("#s=") ? decode(location.hash.slice(3)) : null;
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.top = "-1000px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

/**
 * 二级页面（某个工作项目）深链：`?pid=<项目 id>`（**走查询串，不走 hash**）。
 *
 * 用 id 而非名称/日期：改名后仍有效、同名同日的项目不会串。
 *
 * ⚠️ 为什么必须是查询串 —— 实测结论，勿改回 hash：
 * CloudBase **测试域名**在首次访问时会先显示「风险提醒」中间页，点「确定访问」后
 * 它把 hash 强制替换为 `#/`，**但完整保留查询串**。实测五种 URL 形态：
 *   A `#/project/<id>`            → 变成 `#/`                        ❌
 *   B `?pid=<id>`                 → `?pid=<id>` 保留、hash 变 `#/`    ✅ 目标 id 存活
 *   C `?pid=<id>#/project/<id>`   → `?pid=<id>` 保留、hash 变 `#/`    ✅（hash 仍丢）
 *   D `index.html#/project/<id>`  → hash 变 `#/`                     ❌
 *   E 无尾斜杠 + hash             → 连应用都没进                      ❌
 * 所以「首次点击分享链接」时 hash 深链必被吞掉、只能落到一级页；只有查询串能穿透中间页。
 * 待 ICP 备案完成、绑定自定义域名后中间页消失，本格式依然可用（App.vue `openFromQuery`
 * 会把它收敛为 `#/project/<id>`），**无需再改回 hash**。
 *
 * 注：更旧的 `?p=名称/创建日期` 已不再生成（改名即失效、同名同日会串项目），
 * 但 App.vue `openFromQuery` 仍保留解析，用于兼容此前已分享出去的历史链接。
 */
export function projectDeepLink(project: Project): string {
  const base = location.origin + location.pathname.replace(/index\.html$/i, "");
  return `${base}?pid=${encodeURIComponent(project.id)}`;
}
