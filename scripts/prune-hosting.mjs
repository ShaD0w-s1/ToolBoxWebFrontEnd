#!/usr/bin/env node
/**
 * 静态托管孤儿文件检测（默认**只报告、不删除**）。
 *
 * 背景：Vite 每次构建都生成带内容哈希的新文件名，而 CloudBase 上传是**增量覆盖**、
 * 不清理旧文件。于是多代产物在同一目录下持续累积 —— 实测本项目 `/workpreparation-01/`
 * 下并存 5 代 `index-*.js`，整个环境共 1251 个托管文件（单次部署只有 25 个）。
 *
 * 风险：旧 bundle 含早期接口路径与业务字段名（被动信息暴露）。若旧文件名曾出现在
 * 历史分享链接或企业微信消息里，就成了可长期访问的「影子资产」。
 *
 * 本脚本做的是「部署后对比」：把远端清单与本地 dist 清单求差集，列出可安全删除的孤儿。
 *
 * ⚠️ 删除是**不可逆的生产变更**，且若误删当前引用的文件会立刻白屏。
 *    因此本脚本只输出清单与待执行的删除参数，实际删除需人工确认后执行。
 *
 * 用法：
 *   node scripts/prune-hosting.mjs --remote <远端清单文件> [--local dist] [--prefix workpreparation-01] [--json <输出>]
 *
 * 远端清单来源（任一格式均可）：
 *   · CloudBase MCP `queryHosting(action="listFiles")` 的完整 JSON 响应
 *   · 纯字符串数组 JSON：["a/b.js", ...]
 *   · 每行一个 key 的纯文本
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// ————————————————————— 参数解析 —————————————————————
const argv = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const remotePath = arg("remote");
const localDir = resolve(arg("local", "dist"));
const prefix = (arg("prefix", "workpreparation-01") || "").replace(/^\/+|\/+$/g, "");
const jsonOut = arg("json");

if (!remotePath) {
  console.error("用法：node scripts/prune-hosting.mjs --remote <远端清单文件> [--local dist] [--prefix workpreparation-01]");
  process.exit(2);
}

// ————————————————————— 读取远端清单 —————————————————————
function normalizeRemote(raw) {
  const text = raw.trim();
  if (!text) return [];
  // 1) JSON（MCP 响应 / 数组 / 对象）
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const j = JSON.parse(text);
      const candidates = [
        j?.data?.files,
        j?.files,
        Array.isArray(j) ? j : null,
      ].find((x) => Array.isArray(x));
      if (candidates) {
        return candidates
          .map((it) => (typeof it === "string" ? it : it?.key || it?.Key))
          .filter(Boolean);
      }
    } catch {
      /* 落到纯文本分支 */
    }
  }
  // 2) 纯文本，每行一个 key
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

const remoteKeys = [...new Set(normalizeRemote(readFileSync(remotePath, "utf8")))]
  .map((k) => String(k).replace(/^\/+/, ""));
if (!remoteKeys.length) {
  console.error(`✗ 远端清单为空或格式无法解析：${remotePath}`);
  process.exit(2);
}

// ————————————————————— 读取本地产物 —————————————————————
function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, acc);
    else acc.push(relative(base, full).split("\\").join("/"));
  }
  return acc;
}

if (!existsSync(localDir)) {
  console.error(`✗ 本地产物目录不存在：${localDir}（先执行构建）`);
  process.exit(2);
}

const localFiles = walk(localDir).sort();
const keep = new Set(localFiles.map((f) => `${prefix}/${f}`));
const localBytes = localFiles.reduce((n, f) => n + statSync(join(localDir, f)).size, 0);

// ————————————————————— 计算 —————————————————————
const inPrefix = remoteKeys.filter((k) => k === prefix || k.startsWith(`${prefix}/`));
const outside = remoteKeys.filter((k) => !(k === prefix || k.startsWith(`${prefix}/`)));

const orphans = inPrefix.filter((k) => !keep.has(k) && !k.endsWith("/")).sort();

// 缺失检查：本地有、远端没有 → 上传不完整（会导致白屏）
const missing = localFiles.filter((f) => !remoteKeys.includes(`${prefix}/${f}`)).sort();

// 前缀外按顶层目录聚合（这些属于**其他历史部署**，不属于本次清理范围）
const outsideGroups = new Map();
for (const k of outside) {
  const top = k.includes("/") ? k.split("/")[0] + "/" : "(根目录文件)";
  const g = outsideGroups.get(top) || { count: 0 };
  g.count++;
  outsideGroups.set(top, g);
}

// ————————————————————— 报告 —————————————————————
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log("══════════ 静态托管孤儿检测 ══════════");
console.log(`  远端清单        : ${remotePath}（${remoteKeys.length} 个 key）`);
console.log(`  本地产物        : ${localDir}（${localFiles.length} 个文件 / ${kb(localBytes)}）`);
console.log(`  比对前缀        : ${prefix}/`);

console.log(`\n  【本次前缀内】远端 ${inPrefix.length} 个 —— 保留 ${inPrefix.length - orphans.length} / 孤儿 ${orphans.length}`);

if (missing.length) {
  console.log(`\n  ⚠️ 有 ${missing.length} 个本地文件**尚未上传**（会导致白屏）：`);
  missing.slice(0, 20).forEach((f) => console.log(`      ✗ ${prefix}/${f}`));
  if (missing.length > 20) console.log(`      … 另 ${missing.length - 20} 个`);
}

if (orphans.length) {
  console.log(`\n  ── 可删除的孤儿文件（${orphans.length} 个）──`);
  orphans.forEach((k) => console.log(`      ${k}`));
} else {
  console.log("\n  ✓ 前缀内没有孤儿文件");
}

console.log(`\n  【前缀外】${outside.length} 个 —— 属于其他历史部署，本脚本不处理，仅提示：`);
[...outsideGroups.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([top, g]) => console.log(`      ${top.padEnd(24)} ${g.count} 个`));
if (outside.length) {
  console.log("      ⚠️ 这些路径（含存储根 /）各自挂着一份旧站点，任何人访问对应 URL 都会看到旧应用。");
  console.log("         建议单独评估后清理，避免误删仍在使用的历史入口。");
}

// ————————————————————— 输出待执行计划 —————————————————————
if (jsonOut) {
  const plan = {
    generatedAt: new Date().toISOString(),
    prefix: `${prefix}/`,
    localFileCount: localFiles.length,
    remoteKeyCount: remoteKeys.length,
    keepCount: inPrefix.length - orphans.length,
    orphanCount: orphans.length,
    orphans,
    missingOnRemote: missing.map((f) => `${prefix}/${f}`),
    outsidePrefixCount: outside.length,
    outsidePrefixGroups: Object.fromEntries(outsideGroups),
  };
  writeFileSync(jsonOut, JSON.stringify(plan, null, 2), "utf8");
  console.log(`\n  计划已写入：${jsonOut}`);
  if (orphans.length) {
    console.log("\n  ── 确认后执行删除（isDir=false、逐个、间隔 ≥100ms 避免限流）──");
    console.log(`      manageHosting(action="delete", cloudPath="<上面的 key>", confirm=true)`);
  }
}
