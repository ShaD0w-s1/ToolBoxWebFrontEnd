#!/usr/bin/env node
/**
 * 静态托管孤儿文件检测与清理（默认**只报告、不删除**）。
 *
 * 背景：Vite 每次构建都生成带内容哈希的新文件名，而 CloudBase 静态托管上传是
 * **增量覆盖**语义、不回收旧文件。于是多代产物在同一目录下持续累积。
 *
 * 2026-09-15 实测本项目（环境 da-tool-list-d2g0awsejc0658949）：
 *   · `/workpreparation-01/` 下有 1122 个对象，其中只有 25 个属于当次构建
 *   · 即 **1096 个旧构建孤儿 / 266.08 MB**（约 44 代 × 25 文件）
 *   · 整个桶 1251 个对象 / 282.00 MB，清理后 32 个对象 / 3.20 MB
 *
 * 风险：旧 bundle 含早期接口路径与业务字段名（被动信息暴露），且**旧版本应用仍可
 * 完整运行并写入同一个生产后端**（旧业务逻辑会污染数据），不只是存储浪费。
 *
 * ⚠️ 删除是**不可逆的生产变更**，误删当前引用的文件会立刻白屏。
 *    因此默认只输出清单与"待执行计划"，实际删除必须显式加 --apply。
 *
 * 用法：
 *   # 1) 只报告（默认，零副作用）
 *   node scripts/prune-hosting.mjs --remote <远端清单文件>
 *
 *   # 2) 生成删除计划 JSON
 *   node scripts/prune-hosting.mjs --remote <清单> --json prune-plan.json
 *
 *   # 3) 实际批量删除孤儿（零停机；需要 cos-nodejs-sdk-v5 + 本机 CLI 登录凭据）
 *   node scripts/prune-hosting.mjs --remote <清单> --apply \
 *        --bucket 6f02-static-<envId>-<appId> --region ap-shanghai
 *
 * 远端清单来源（任一格式均可）：
 *   · CloudBase MCP `queryHosting(action="listFiles")` 的完整 JSON 响应
 *   · 纯字符串数组 JSON：["a/b.js", ...]
 *   · 每行一个 key 的纯文本
 *
 * 关键坑（2026-09-15 实测，务必先读）：
 *   1. `tcb hosting list` 的条目数**不含目录标记对象**（每个前缀差 1 个），
 *      COS 全量列举才包含。做增删比对请以 **COS 列举为权威**。
 *   2. `tcb storage rm` 作用的是**云存储**桶，与静态托管桶**不是同一个**；
 *      对托管文件执行会返回 FILE_NOT_FOUND。删除托管文件必须走 COS 直连托管桶。
 *   3. 不要用「`tcb hosting delete <dir> --dir` 删整个 assets/ 再重传」来做清理 ——
 *      那会造成 10~20 秒线上白屏。用本脚本的 --apply（deleteMultipleObject 批量、
 *      1000/批）可做到**零停机**：全程不触碰当前版本引用的文件。
 *   4. **存储根的 `index.html` 是跳转桩，必须保留**。本站路由规则为
 *      「404 → /index.html」；根 index.html 一旦缺失，会形成
 *      `404 → /index.html → 404 → …` 的重定向自循环，站点返回
 *      HTTP 500 · STATIC_RESOURCE_TOO_MANY_REDIRECTS。
 *      本脚本只清理 --prefix 内的孤儿，**不会**动前缀外的任何文件；
 *      若要清理前缀外路径，必须单独显式指定（见 --include-outside）。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";

// ————————————————————— 参数解析 —————————————————————
const argv = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
function flag(name) {
  return argv.includes(`--${name}`);
}

const remotePath = arg("remote");
const localDir = resolve(arg("local", "dist"));
const prefix = (arg("prefix", "workpreparation-01") || "").replace(/^\/+|\/+$/g, "");
const jsonOut = arg("json");
const doApply = flag("apply");
const bucket = arg("bucket");
const region = arg("region", "ap-shanghai");
// 前缀外路径默认**一律不处理**；只有显式列出才纳入删除范围
const includeOutside = (arg("include-outside", "") || "")
  .split(",")
  .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
  .filter(Boolean);

// 平台自带资源：任何情况下都不允许删除
const PLATFORM_PREFIXES = ["__auth", "cloud-admin"];

if (!remotePath && !doApply) {
  console.error(
    "用法：node scripts/prune-hosting.mjs --remote <远端清单文件> [--local dist] [--prefix workpreparation-01] [--json <输出>]",
  );
  process.exit(2);
}
if (!remotePath) {
  console.error("✗ --apply 也需同时提供 --remote <远端清单文件>（避免清单与桶状态不一致）。");
  process.exit(2);
}

// ————————————————————— 读取远端清单 —————————————————————
function normalizeRemote(raw) {
  // ⚠️ 必须先剥 BOM：PowerShell `Out-File -Encoding utf8` 会写入 U+FEFF，
  //    不剥的话 `startsWith("{")` 判定失败 → JSON 被当成纯文本按行切，
  //    每行（含 `"key": "xxx",`）都被当成一个路径，静默产出垃圾结果。
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return [];

  const looksJson = text.startsWith("{") || text.startsWith("[");
  if (looksJson) {
    let j = null;
    let parseError = null;
    try {
      j = JSON.parse(text);
    } catch (e) {
      parseError = e;
    }
    if (j !== null) {
      const candidates = [
        Array.isArray(j) ? j : null,
        // CloudBase CLI `hosting list --json`：{ data: [ { key, size, ... } ], meta: {...} }
        Array.isArray(j?.data) ? j.data : null,
        // MCP queryHosting(listFiles)：{ data: { files: [...] } }
        j?.data?.files,
        j?.files,
        j?.Contents,
        j?.list,
      ].find((x) => Array.isArray(x));
      if (candidates) {
        const keys = candidates
          .map((it) => (typeof it === "string" ? it : it?.key || it?.Key || it?.name || it?.path))
          .filter(Boolean);
        if (keys.length) return keys;
        console.error("✗ 清单 JSON 可解析，但条目里找不到 key/Key/name/path 字段。");
        process.exit(2);
      }
      console.error("✗ 清单 JSON 可解析，但结构不认识（期望数组，或 data / data.files / files / Contents / list）。");
      process.exit(2);
    }
    // 看起来是 JSON 却解析失败 → 明确报错，绝不退化成纯文本
    console.error(`✗ 清单像是 JSON 但解析失败：${parseError?.message ?? "unknown"}`);
    process.exit(2);
  }

  // 纯文本，每行一个 key
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  // 防呆：纯文本模式下出现 JSON 片段特征，说明格式判断错了
  const suspicious = lines.filter((l) => /^["']?key["']?\s*:/.test(l) || l === "{" || l === "}" || l === "]" || l === "[");
  if (suspicious.length) {
    console.error(`✗ 清单被判定为纯文本，但有 ${suspicious.length} 行像 JSON 片段（如 ${suspicious[0]}）。`);
    console.error("  请确认传入的是完整 JSON，或改用「每行一个 key」的纯文本格式（不要混用）。");
    process.exit(2);
  }
  return lines;
}

const remoteKeys = [...new Set(normalizeRemote(readFileSync(remotePath, "utf8")))].map((k) =>
  String(k).replace(/^\/+/, ""),
);
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
// 白名单：本地 dist 全部文件 → 当前线上版本，永不删除
const keep = new Set(localFiles.map((f) => `${prefix}/${f}`));
const localBytes = localFiles.reduce((n, f) => n + statSync(join(localDir, f)).size, 0);

// ————————————————————— 计算 —————————————————————
const isMarker = (k) => k.endsWith("/");
const inPrefix = remoteKeys.filter((k) => k === prefix || k.startsWith(`${prefix}/`));
const outside = remoteKeys.filter((k) => !(k === prefix || k.startsWith(`${prefix}/`)));

const orphans = inPrefix.filter((k) => !keep.has(k) && !isMarker(k)).sort();

// 前缀外分类：平台资源 / 跳转桩 / 其他历史部署
const classifyOutside = (k) => {
  const top = k.includes("/") ? k.split("/")[0] : "(根文件)";
  if (!k.includes("/") && k === "index.html") return { top, kind: "跳转桩", keep: true };
  if (PLATFORM_PREFIXES.includes(top)) return { top, kind: "平台资源", keep: true };
  return { top, kind: "历史部署", keep: false };
};
const outsideInfo = new Map();
for (const k of outside) {
  const c = classifyOutside(k);
  const g = outsideInfo.get(c.top) || { kind: c.kind, keep: c.keep, count: 0 };
  g.count++;
  outsideInfo.set(c.top, g);
}

// 显式要求清理的前缀外路径
const outsideToDelete = outside.filter((k) =>
  includeOutside.some((p) => k === p || k.startsWith(`${p}/`) || (p === "(根文件)" && !k.includes("/"))),
);
const platformBlocked = outsideToDelete.filter((k) => {
  const top = k.includes("/") ? k.split("/")[0] : "";
  return PLATFORM_PREFIXES.includes(top) || (!k.includes("/") && k === "index.html");
});

// 缺失检查：本地有、远端没有 → 上传不完整（会导致白屏）
const missing = localFiles.filter((f) => !remoteKeys.includes(`${prefix}/${f}`)).sort();

// ————————————————————— 报告 —————————————————————
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log("══════════ 静态托管孤儿检测 ══════════");
console.log(`  远端清单        : ${remotePath}（${remoteKeys.length} 个 key）`);
console.log(`  本地产物        : ${localDir}（${localFiles.length} 个文件 / ${kb(localBytes)}）`);
console.log(`  比对前缀        : ${prefix}/`);
console.log(`  模式            : ${doApply ? "⚠ 实际删除（--apply）" : "只报告（未做任何改动）"}`);

console.log(
  `\n  【本次前缀内】远端 ${inPrefix.length} 个 —— 保留 ${inPrefix.length - orphans.length} / 孤儿 ${orphans.length}`,
);

if (missing.length) {
  console.log(`\n  ⚠️ 有 ${missing.length} 个本地文件**尚未上传**（会导致白屏）：`);
  missing.slice(0, 20).forEach((f) => console.log(`      ✗ ${prefix}/${f}`));
  if (missing.length > 20) console.log(`      … 另 ${missing.length - 20} 个`);
}

if (orphans.length) {
  console.log(`\n  ── 可删除的孤儿文件（${orphans.length} 个）──`);
  orphans.slice(0, 30).forEach((k) => console.log(`      ${k}`));
  if (orphans.length > 30) console.log(`      … 另 ${orphans.length - 30} 个`);
} else {
  console.log("\n  ✓ 前缀内没有孤儿文件");
}

console.log(`\n  【前缀外】${outside.length} 个`);
[...outsideInfo.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([top, g]) => {
    const tag = g.kind === "平台资源" ? "🔒 平台资源，勿删" : g.kind === "跳转桩" ? "🪧 跳转桩，必须保留" : "⚠️ 历史部署";
    console.log(`      ${top.padEnd(24)} ${String(g.count).padStart(5)} 个   ${tag}`);
  });
if ([...outsideInfo.values()].some((g) => g.kind === "历史部署")) {
  console.log("      ⚠️「历史部署」路径各自挂着一份旧站点，任何人访问对应 URL 都会看到旧应用。");
  console.log("         要清理需显式指定：--include-outside <路径>[,<路径>...]");
}

// ————————————————————— 输出计划 —————————————————————
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
  outsidePrefixGroups: Object.fromEntries([...outsideInfo.entries()].map(([k, v]) => [k, { ...v }])),
  includeOutsideRequested: includeOutside,
  outsideToDeleteCount: outsideToDelete.length,
};
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(plan, null, 2), "utf8");
  console.log(`\n  计划已写入：${jsonOut}`);
}

// ————————————————————— 执行删除 —————————————————————
if (!doApply) {
  if (orphans.length) {
    console.log("\n  ── 确认后执行删除（零停机批量方式）──");
    console.log("      node scripts/prune-hosting.mjs --remote <清单> --apply \\");
    console.log(`           --bucket <6f02-static-<envId>-<appId>> --region ${region}`);
    console.log("      桶名/地域获取方式： tcb hosting detail --json -e <envId>");
  }
  process.exit(0);
}

// ---- --apply 分支 ----
if (platformBlocked.length) {
  console.error(`\n  ✗ 拒绝执行：--include-outside 中命中了 ${platformBlocked.length} 个受保护对象（平台资源 / 存储根跳转桩）。`);
  console.error("    这些对象被删除会破坏站点（平台登录页丢失 / 触发 500 重定向自循环）。请从参数中移除。");
  process.exit(1);
}

const targets = [...orphans, ...outsideToDelete].filter((k) => !isMarker(k));
if (!targets.length) {
  console.log("\n  ✓ 没有需要删除的对象。");
  process.exit(0);
}
if (!bucket) {
  console.error("\n  ✗ --apply 需要 --bucket。获取方式： tcb hosting detail --json -e <envId>");
  process.exit(2);
}

const credPath = arg("cred", join(homedir(), ".config", ".cloudbase", "auth.json"));
if (!existsSync(credPath)) {
  console.error(`\n  ✗ 找不到 CLI 登录凭据：${credPath}`);
  console.error("    先执行： tcb login --flow device   （或 --apiKeyId/--apiKey）");
  process.exit(2);
}

let COS;
try {
  COS = (await import("cos-nodejs-sdk-v5")).default;
} catch {
  console.error("\n  ✗ 缺少依赖 cos-nodejs-sdk-v5。安装（任选其一）：");
  console.error("      npm i -D cos-nodejs-sdk-v5");
  console.error("      （若不想污染本项目依赖，可装在外部环境并用 NODE_PATH 指向其 node_modules）");
  process.exit(2);
}

const cred = JSON.parse(readFileSync(credPath, "utf8")).credential;
const cos = new COS({
  SecretId: cred.tmpSecretId,
  SecretKey: cred.tmpSecretKey,
  SecurityToken: cred.tmpToken,
});

const chunks = [];
for (let i = 0; i < targets.length; i += 1000) chunks.push(targets.slice(i, i + 1000));

const deleted = new Set();
const failed = [];
for (const [i, chunk] of chunks.entries()) {
  const Objects = chunk.map((o) => ({ Key: o }));
  try {
    const res = await cos.deleteMultipleObject({ Bucket: bucket, Region: region, Objects });
    const errs = res.Error || [];
    Objects.forEach((o) => deleted.add(o.Key));
    for (const e of errs) {
      deleted.delete(e.Key);
      failed.push(`${e.Key} -> ${e.Code}`);
    }
    console.log(`\n  [批 ${i + 1}/${chunks.length}] 提交 ${Objects.length}，返回错误 ${errs.length}`);
  } catch (e) {
    failed.push(`BATCH ${i + 1}: ${e.message}`);
    console.log(`\n  [批 ${i + 1}/${chunks.length}] 失败: ${e.message}`);
  }
}

console.log(`\n  [结果] 已删除 ${deleted.size} / ${targets.length}`);
if (failed.length) {
  console.log(`  [结果] 失败 ${failed.length} 条：`);
  failed.slice(0, 10).forEach((f) => console.log(`      ${f}`));
  process.exit(1);
}
console.log("\n  请复核线上：");
console.log(`      · 站点入口应返回 200 且体积等于本地 dist/index.html`);
console.log(`      · 存储根 / 应返回 200（跳转桩），**不应**返回 500`);
