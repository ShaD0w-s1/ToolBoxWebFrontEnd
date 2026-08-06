function encode(value) {
  const json = encodeURIComponent(JSON.stringify(value));
  return btoa(unescape(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(normalized))));
  } catch {
    return null;
  }
}

export function createShareUrl(payload) {
  return `${location.href.split("#")[0]}#s=${encode(payload)}`;
}

export function readSharePayload() {
  return location.hash.startsWith("#s=") ? decode(location.hash.slice(3)) : null;
}

export async function copyText(value) {
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
