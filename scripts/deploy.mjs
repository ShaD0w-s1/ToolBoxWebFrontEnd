#!/usr/bin/env node
/**
 * 一键发布编排：构建 → 上传 → 清理托管孤儿 → 收敛本地快照 → 线上核验。
 *
 * 把「发布后清孤儿」固化进流程，而不是靠人记得手工做。
 *
 * 用法：
 *   node scripts/deploy.mjs                        # 完整发布
 *   node scripts/deploy.mjs --dry-run              # 只构建 + 打印计划，不做任何变更
 *   node scripts/deploy.mjs --skip-build           # 直接用现有 dist 上传
 *   node scripts/deploy.mjs --no-prune             # 跳过托管孤儿清理
 *   node scripts/deploy.mjs --no-snapshot          # 构建前不备份上一个 dist
 *   node scripts/deploy.mjs --keep-snapshots 3     # 本地保留最近 3 个快照（默认 2）
 *   node scripts/deploy.mjs --env <envId> --cloud-path <path>
 *
 * ⚠️ 本机 `npm run <script>` 会死在 `/usr/bin/env: bash`，因此本脚本**全部直接调用 node 二进制**，
 *    不经过 npm，保证本机与 CI 行为一致。
 *
 * 前置：
 *   · `tcb` CLI 已登录（`tcb login --flow device -e <envId>`，凭据在 ~/.config/.cloudbase/auth.json）
 *   · `cos-nodejs-sdk-v5` 已安装（清理孤儿用；未装时仅跳过清理，不影响上传）
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const ENV_ID = arg("env", process.env.TCB_ENV_ID || "da-tool-list-d2g0awsejc0658949");
const CLOUD_PATH = (arg("cloud-path", "workpreparation-01") || "").replace(/^\/+|\/+$/g, "");
const REGION = arg("region", "ap-shanghai");
const DRY = flag("dry-run");
const SKIP_BUILD = flag("skip-build");
const NO_PRUNE = flag("no-prune");
const NO_SNAPSHOT = flag("no-snapshot");
const KEEP_SNAPSHOTS = arg("keep-snapshots", "2");

const log = (s = "") => console.log(s);
const step = (n, s) => console.log(`\n──── ${n}. ${s} ${"─".repeat(Math.max(0, 46 - s.length))}`);
const die = (s) => {
  console.error(`\n✗ ${s}`);
  process.exit(1);
};

// ————————————————————— 工具定位 —————————————————————
const NODE = process.execPath;

/**
 * 定位 tcb CLI。
 *
 * ⚠️ 实测坑：**不要 execFile 那个 `.cmd` 垫片**。新版 Node 已不再允许直接 execFile
 *    `.cmd`/`.bat`（CVE-2024-27980 修复后行为变更），会直接失败且 stdout/stderr 皆空，
 *    表现为「上传未确认成功：<空>」，极难定位。
 *    而 `shell: true` 又会把带空格的参数裸拼进命令行（本项目路径含 `ToolBox 2`，必炸）。
 *    正解：定位垫片背后真正的 **JS 入口**，用 `node <entry> …` 调用 —— 无 shell、无空格问题。
 */
function resolveTcb() {
  const cliRoots = [
    process.env.TCB_CLI_ROOT,
    "C:/Users/cctv1/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli",
    join(REPO, "node_modules/@cloudbase/cli"),
  ].filter(Boolean);
  for (const root of cliRoots) {
    const entry = join(root, "bin", "tcb");
    if (existsSync(entry)) return { mode: "node", entry };
  }
  // 退回 PATH 上的 tcb（此处系统保证可执行）
  return { mode: "bin", entry: process.env.TCB_BIN || "tcb" };
}

const TCB = resolveTcb();

/** 运行命令，返回 stdout。CLI 输出为 GBK，但 JSON 均为 ASCII，不影响解析。 */
function run(bin, args, { cwd = REPO, allowFail = false } = {}) {
  try {
    return execFileSync(bin, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "");
    if (allowFail) return out;
    die(`命令失败：${bin} ${args.join(" ")}\n${out.slice(0, 2000)}`);
  }
}

/** 调 tcb CLI（走 JS 入口，见 resolveTcb 的说明） */
const runTcb = (args, opts) =>
  TCB.mode === "node" ? run(NODE, [TCB.entry, ...args], opts) : run(TCB.entry, args, opts);

/** 从 CLI 输出里抠出 JSON（容忍前置横幅 / 尾部提示 / BOM） */
function extractJson(text) {
  const t = String(text).replace(/^\uFEFF/, "");
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) die(`CLI 未返回 JSON：\n${t.slice(0, 1200)}`);
  return JSON.parse(t.slice(s, e + 1));
}

function sizeofDir(dir) {
  let total = 0, count = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { total += statSync(f).size; count++; }
    }
  };
  walk(dir);
  return { total, count };
}

// ————————————————————— 开始 —————————————————————
log(`══════════ ToolBox 前端发布编排 ══════════`);
log(`  仓库        : ${REPO}`);
log(`  环境        : ${ENV_ID}   路径 /${CLOUD_PATH}/`);
log(`  tcb CLI     : ${TCB.entry}${TCB.mode === "node" ? "  (node 入口)" : "  (PATH)"}`);
log(`  模式        : ${DRY ? "⚠ dry-run（不做任何变更）" : "实际发布"}`);

if (DRY) log(`  说明        : 会执行构建与只读查询，跳过上传、删除、快照备份`);

// ————————— 1. 快照上一个 dist —————————
const DIST = join(REPO, "dist");
step(1, "备份上一个 dist");
if (NO_SNAPSHOT || DRY) {
  log(`  跳过（${DRY ? "dry-run" : "--no-snapshot"}）`);
} else if (existsSync(join(DIST, "index.html"))) {
  const snap = join(REPO, `dist_old_${Math.floor(Date.now() / 1000)}`);
  cpSync(DIST, snap, { recursive: true });
  const { total, count } = sizeofDir(snap);
  log(`  ✓ ${snap.split(/[\\/]/).pop()}  (${count} 文件 / ${(total / 1024 / 1024).toFixed(2)} MB)`);
} else {
  log(`  跳过（dist/index.html 不存在，像是首次构建）`);
}

// ————————— 2. 构建 —————————
step(2, "构建");
if (SKIP_BUILD) {
  log(`  跳过（--skip-build）`);
} else {
  const vite = join(REPO, "node_modules/vite/bin/vite.js");
  if (!existsSync(vite)) die(`找不到 ${vite}，请先 npm install`);
  const out = run(NODE, [vite, "build"]);
  const lines = out.split(/\r?\n/).filter((l) => /\b(dist\/|built in|error|warning)\b/i.test(l));
  lines.slice(-12).forEach((l) => log("  " + l.trim()));
  // 元信息断言（占位符未替换是最阴险的失败模式）
  const meta = join(REPO, "scripts/check-build-meta.mjs");
  if (existsSync(meta)) {
    const r = run(NODE, [meta, "dist"], { allowFail: true });
    log("  " + (r || "").trim().split(/\r?\n/).filter(Boolean).join("\n  "));
    if (/✗|FAIL|失败|错误/.test(r)) die("元信息断言未通过，已中止发布");
  }
}

const idxPath = join(DIST, "index.html");
if (!existsSync(idxPath)) die("构建产物缺少 dist/index.html");
const idxHtml = readFileSync(idxPath, "utf8");
const idxSize = Buffer.byteLength(idxHtml);
const entry = (idxHtml.match(/src="\.\/assets\/(index-[^"]+\.js)"/) || [])[1] || "(未识别)";
const css = (idxHtml.match(/href="\.\/assets\/(index-[^"]+\.css)"/) || [])[1] || "(未识别)";
if (/%VITE_[A-Z_]+%/.test(idxHtml)) die("index.html 仍残留 %VITE_*% 占位符，已中止（分享预览会指向错误地址）");
log(`  index.html  ${idxSize} B    entry=${entry}   css=${css}`);

if (DRY) {
  log(`\n  [dry-run] 到此为止：未上传、未清理、未备份。`);
  log(`  去掉 --dry-run 即执行完整发布。`);
  process.exit(0);
}

// ————————— 3. 上传 —————————
step(3, "上传到静态托管");
const up = runTcb(["hosting", "deploy", DIST, `/${CLOUD_PATH}`, "-e", ENV_ID], { allowFail: true });
const okMatch = /Successfully uploaded (\d+) file\(s\)/.exec(up);
const localCount = readdirSync(DIST, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
if (!okMatch) die(`上传未确认成功：\n${up.slice(-1500)}`);
log(`  ✓ ${okMatch[0]}   本地应有 ${localCount} 个文件`);
if (Number(okMatch[1]) !== localCount) die(`上传数量(${okMatch[1]}) 与本地(${localCount}) 不一致，可能存在漏传（白屏风险）`);

// ————————— 4. 取桶信息与远端清单 —————————
step(4, "读取托管桶信息与远端清单");
const detail = extractJson(runTcb(["hosting", "detail", "--json", "-e", ENV_ID], { allowFail: true }));
const bucket = detail?.data?.bucket;
const cdnDomain = detail?.data?.cdnDomain;
if (!bucket || !cdnDomain) die(`hosting detail 未返回 bucket/cdnDomain：\n${JSON.stringify(detail).slice(0, 800)}`);
log(`  bucket=${bucket}`);
log(`  域名  =${cdnDomain}`);

const manifestRaw = runTcb(["hosting", "list", "--json", "-e", ENV_ID], { allowFail: true });
const manifest = extractJson(manifestRaw);
const tmpManifest = join(tmpdir(), `toolbox-hosting-${Date.now()}.json`);
writeFileSync(tmpManifest, JSON.stringify(manifest), "utf8");
log(`  远端清单 ${manifest?.data?.length ?? "?"} 个 key → ${tmpManifest}`);

// ————————— 5. 清理托管孤儿 —————————
step(5, "清理托管孤儿");
if (NO_PRUNE) {
  log(`  跳过（--no-prune）`);
} else {
  const prune = join(REPO, "scripts/prune-hosting.mjs");
  const out = run(
    NODE,
    [prune, "--remote", tmpManifest, "--apply", "--bucket", bucket, "--region", REGION, "--prefix", CLOUD_PATH, "--local", DIST],
    { allowFail: true },
  );
  const tail = out.split(/\r?\n/).filter((l) => /本次前缀内|孤儿|已删除|结果|拒绝|✗/.test(l));
  tail.forEach((l) => log("  " + l.trim()));
  if (/拒绝执行|✗/.test(out)) die("托管清理被守卫拦下或执行失败，请人工检查");
}

// ————————— 6. 收敛本地快照 —————————
step(6, "收敛本地快照");
const snapOut = run(NODE, [join(REPO, "scripts/prune-snapshots.mjs"), "--apply", "--keep", KEEP_SNAPSHOTS], { allowFail: true });
snapOut.split(/\r?\n/).filter((l) => /快照数量|保留|删除|✓|✗|结果/.test(l)).slice(0, 12).forEach((l) => log("  " + l.trim()));

// ————————— 7. 线上核验 —————————
step(7, "线上核验");
const base = cdnDomain.startsWith("http") ? cdnDomain.replace(/\/+$/, "") : `https://${cdnDomain}`;
const probes = [
  { path: "/", must: 200, why: "存储根跳转桩 —— ⚠️ 若为 500 说明根 index.html 缺失（404→index.html 重定向自循环）" },
  { path: `/${CLOUD_PATH}/`, must: 200, why: "站点入口" },
  { path: `/${CLOUD_PATH}/index.html`, must: 200, why: "index.html" },
  { path: `/${CLOUD_PATH}/assets/${entry}`, must: 200, why: "入口 bundle", type: "javascript" },
];

let verifyFail = 0;
for (const p of probes) {
  let res, body;
  try {
    res = await fetch(base + p.path, { redirect: "manual" });
    body = res.headers.get("content-type") || "";
  } catch (e) {
    log(`  ✗ ${p.path}  请求异常 ${e.message}`);
    verifyFail++;
    continue;
  }
  let extra = "";
  if (res.status === 200) {
    const buf = Buffer.from(await res.arrayBuffer());
    extra = `${buf.length} B`;
    if (p.path.endsWith("index.html") && buf.length !== idxSize) {
      extra += `  ✗ 与本地 ${idxSize} B 不符`;
      verifyFail++;
    }
    if (p.type && !body.includes(p.type)) {
      extra += `  ✗ content-type 期望含 ${p.type}`;
      verifyFail++;
    }
  }
  const ok = res.status === p.must;
  if (!ok) verifyFail++;
  log(`  ${ok ? "✓" : "✗"} ${p.path.padEnd(42)} ${res.status}  ${body.split(";")[0].padEnd(24)} ${extra}`);
}
log(`\n  核验说明：${probes[0].why}`);
if (verifyFail) die(`线上核验有 ${verifyFail} 项未通过`);
log(`\n  ✓ 线上核验全部通过`);

log(`\n══════════ 发布完成 ══════════`);
log(`  站点   : ${base}/${CLOUD_PATH}/`);
log(`  产物   : index.html ${idxSize} B  entry ${entry}`);
log(`  提醒   : 硬刷新（Ctrl/Cmd+Shift+R）确认 UI；本次改动别忘了 commit + push`);
