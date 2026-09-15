#!/usr/bin/env node
/**
 * 构建后断言：index.html 的社交/SEO 元信息必须已正确注入。
 *
 * 背景：canonical / og:url / og:image 曾是**硬编码绝对地址**，任何人都可能忘记在换域名时同步修改。
 * 更糟的失败模式是「占位符没被替换」——产物里留着字面量 `%VITE_SITE_URL%`，
 * 页面照常打开、不报任何错，但分享预览卡片悄悄指向一个不存在的地址。
 * 本脚本把这两类问题变成**会失败的构建**。
 *
 * 用法：node scripts/check-build-meta.mjs [distDir=dist]
 * 退出码：0 = 通过；1 = 有问题
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve(process.argv[2] || "dist");
const INDEX = join(DIST, "index.html");

const problems = [];
const info = [];

if (!existsSync(INDEX)) {
  console.error(`✗ 找不到构建产物：${INDEX}`);
  process.exit(1);
}

const html = readFileSync(INDEX, "utf8");

/** 取某个 meta/link 的 content（或 href）值 */
function attr(re, label) {
  const m = html.match(re);
  if (!m) {
    problems.push(`缺少 ${label}`);
    return null;
  }
  return m[1];
}

// 1) 占位符必须已被替换（防「静默漏替换」）
const leftovers = html.match(/%VITE_[A-Z0-9_]+%/g);
if (leftovers) {
  problems.push(`产物中仍残留未替换的占位符：${[...new Set(leftovers)].join(", ")}`);
}

// 2) 抓取器要求的四个地址必须齐全且是**绝对**地址
const canonical = attr(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/, "canonical");
const ogUrl = attr(/<meta[^>]+property="og:url"[^>]+content="([^"]*)"/, "og:url");
const ogImage = attr(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/, "og:image");
const twImage = attr(/<meta[^>]+name="twitter:image"[^>]+content="([^"]*)"/, "twitter:image");

const absChecks = [
  ["canonical", canonical],
  ["og:url", ogUrl],
  ["og:image", ogImage],
  ["twitter:image", twImage],
];
for (const [label, value] of absChecks) {
  if (!value) continue;
  if (!/^https?:\/\//i.test(value)) {
    problems.push(`${label} 必须是绝对地址（抓取器不解析相对路径），实际：${value}`);
  }
  info.push(`${label.padEnd(14)} = ${value}`);
}

// 3) og:image 指向的文件必须真的在产物里（否则预览卡片空白）
if (ogImage && /^https?:\/\//i.test(ogImage)) {
  try {
    const fileName = decodeURIComponent(new URL(ogImage).pathname.split("/").pop() || "");
    if (fileName) {
      if (existsSync(join(DIST, fileName))) {
        info.push(`${"og:image 文件".padEnd(14)} ✓ ${fileName} 存在于产物中`);
      } else {
        problems.push(`og:image 指向 ${fileName}，但该文件不在产物目录中（预览卡片会空白）`);
      }
    }
  } catch {
    problems.push(`og:image 不是可解析的 URL：${ogImage}`);
  }
}

// 4) 一致性：canonical 与 og:url 应同源同路径
if (canonical && ogUrl && canonical !== ogUrl) {
  problems.push(`canonical 与 og:url 不一致：${canonical} vs ${ogUrl}`);
}

// 5) 一致性：og:image / twitter:image 应位于 canonical 之下
if (canonical && ogImage && !ogImage.startsWith(canonical)) {
  problems.push(`og:image 不在 canonical 基址之下：${ogImage}（canonical 为 ${canonical}）`);
}

console.log("── 产物元信息检查 ──");
info.forEach((l) => console.log("  " + l));

if (problems.length) {
  console.error("\n✗ 发现 " + problems.length + " 个问题：");
  problems.forEach((p) => console.error("  · " + p));
  process.exit(1);
}
console.log("\n✓ 元信息检查通过");
