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
 * 二级页面（某个工作项目）深链：裸域名 + hash 路由 + **项目 id**。
 * 用 id 而非名称/日期：项目改名后仍有效、同名同日的项目不会串、刷新可保持（与 App.vue 分享一致）。
 *
 * 注：旧版 `?p=名称/创建日期` 格式已不再生成（改名即失效、同名同日会串项目）；
 * 但 App.vue `openFromQuery` 仍保留解析，用于兼容此前已分享出去的历史链接。
 */
export function projectDeepLink(project: Project): string {
  const base = location.origin + location.pathname.replace(/index\.html$/i, "");
  return `${base}#/project/${encodeURIComponent(project.id)}`;
}
