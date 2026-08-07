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

/**
 * 第三方短链：把长链接交给短链服务，返回短网址。
 * 仅影响"分享出去的链接"外观——接收方经短链 302 跳回原长链接后，
 * 前端照常按 #s= 解析，无需改动解码逻辑。
 * 注意：长链接里的项目数据会经过短链服务商服务器（隐私提示）。
 * 失败（网络/CORS/被墙）时返回 null，由调用方回退为原长链接。
 */
const SHORTEN_PROVIDER = "isgd";

function jsonpRequest<T>(url: string, timeoutMs = 6000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cb = "__jscb_" + Math.random().toString(36).slice(2);
    let settled = false;
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const cleanup = () => {
      if ((window as unknown as Record<string, unknown>)[cb]) delete (window as unknown as Record<string, unknown>)[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);
    const script = document.createElement("script");
    (window as unknown as Record<string, unknown>)[cb] = (data: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("network"));
    };
    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${cb}`;
    document.body.appendChild(script);
  });
}

export async function shortenUrl(longUrl: string): Promise<string | null> {
  try {
    if (SHORTEN_PROVIDER === "isgd") {
      const api = `https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}`;
      const data = await jsonpRequest<{ shorturl?: string }>(api);
      return data?.shorturl || null;
    }
  } catch {
    /* 忽略，回退长链 */
  }
  return null;
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
