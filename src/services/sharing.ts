export interface SharePayload {
  v: number;
  scope: "app" | "cart" | "detail";
  data?: unknown;
  library?: string | null;
  project?: unknown;
}

/** 分享内容放在 hash 中，不会被浏览器作为请求参数发送给服务器。 */
function encode(value: SharePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(value: string): SharePayload | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as SharePayload;
  } catch {
    return null;
  }
}

export function createShareUrl(payload: SharePayload): string {
  return `${location.href.split("#")[0]}#s=${encode(payload)}`;
}

export function readSharePayload(): SharePayload | null {
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
