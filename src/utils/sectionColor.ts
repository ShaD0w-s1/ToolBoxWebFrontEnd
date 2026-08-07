/**
 * 部位（category）配色工具。
 *
 * 规则：
 * - 固定部位名 → 指定色值（名称匹配忽略大小写与首尾空白）。
 * - 其它部位 → 按名称 hash 生成 HSL 颜色，保证每个部位都有可区分的色。
 * - 底色透明度统一保持 50%（沿用 rgba(col, 0.5)）。
 */

/** 部位固定配色表：名称（大写/原文）→ 十六进制色值。 */
export const FIXED_SECTION_COLORS: Record<string, string> = {
  ENG: "#4472C4", // 蓝色
  "AV CB": "#ED7D31", // 橙色
  FC: "#C9A227", // 土黄色
  LG: "#548235", // 绿色
  通用: "#7F7F7F", // 灰色
  接机: "#E57373", // 浅红色
};

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(f(0) * 255),
    g: Math.round(f(8) * 255),
    b: Math.round(f(4) * 255),
  };
}

/** 简单字符串散列，用于为未知部位生成稳定且可区分的色相。 */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** 取得部位的 RGB 颜色（固定表优先，否则由名称 hash 推导）。 */
export function sectionRgb(name: string): Rgb {
  const key = (name || "").trim();
  const lower = key.toLowerCase();
  const matched = Object.keys(FIXED_SECTION_COLORS).find((k) => k.toLowerCase() === lower);
  if (matched) return hexToRgb(FIXED_SECTION_COLORS[matched]);
  // 其它部位：hash → HSL，固定饱和度/亮度，得到稳定且可区分的颜色
  const hue = hashString(key) % 360;
  return hslToRgb(hue, 62, 52);
}

/** 部位的十六进制色值（用于实色边条）。 */
export function sectionHex(name: string): string {
  const { r, g, b } = sectionRgb(name);
  const to = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** 部位底色，默认透明度 50%（rgba(col, 0.5)）。 */
export function sectionRgba(name: string, alpha = 0.5): string {
  const { r, g, b } = sectionRgb(name);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
