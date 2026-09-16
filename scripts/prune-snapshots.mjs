#!/usr/bin/env node
/**
 * 收敛本地构建快照目录：只保留最近 N 个 `dist_old_*` / `dist.bak`。
 *
 * 背景：每次发布前把上一个 dist 复制成 `dist_old_<unix秒>` 作本地回滚点，
 * 累积起来既占空间又淹没目录列表。本脚本按 mtime 排序，保留最近 N 个，其余移入**回收站**
 * （默认，可恢复）；`--permanent` 才真删。
 *
 * 用法：
 *   node scripts/prune-snapshots.mjs                        # 只报告
 *   node scripts/prune-snapshots.mjs --keep 3               # 只报告，保留 3 个
 *   node scripts/prune-snapshots.mjs --apply                # 移入回收站
 *   node scripts/prune-snapshots.mjs --apply --permanent    # 永久删除
 *
 * 安全约定：
 *   · 默认只报告，`--apply` 才动文件
 *   · 只处理仓库根目录下、名字匹配 `dist_old_*` 或 `dist.bak` 的**目录**
 *   · 只删 mtime 排名在保留集合之外的；保留集合永不动
 *   · 默认走回收站，不硬删
 */
import { readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const ROOT = resolve(arg("root", process.cwd()));
const KEEP = Math.max(0, Number(arg("keep", "2")));
const APPLY = flag("apply");
const PERMANENT = flag("permanent");

const isSnapshotName = (n) => /^dist_old_/.test(n) || n === "dist.bak";

const dirSize = (p) => {
  let total = 0;
  let files = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        total += statSync(f).size;
        files++;
      }
    }
  };
  walk(p);
  return { total, files };
};

const entries = existsSync(ROOT)
  ? readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isSnapshotName(e.name))
      .map((e) => {
        const full = join(ROOT, e.name);
        const st = statSync(full);
        const { total, files } = dirSize(full);
        return { name: e.name, path: full, mtime: st.mtimeMs, bytes: total, files };
      })
      .sort((a, b) => b.mtime - a.mtime)
  : [];

const fmt = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const keepList = entries.slice(0, KEEP);
const dropList = entries.slice(KEEP);

console.log(`══════════ 本地构建快照收敛 ══════════`);
console.log(`  目录      : ${ROOT}`);
console.log(`  快照数量  : ${entries.length}   保留最近 ${KEEP} 个`);
console.log(`  模式      : ${APPLY ? (PERMANENT ? "⚠ 永久删除" : "移入回收站") : "只报告（未改动）"}`);

if (!entries.length) {
  console.log(`\n  ✓ 没有快照目录。`);
  process.exit(0);
}

console.log("");
entries.forEach((e, i) => {
  const keep = i < KEEP;
  console.log(
    `  ${String(i + 1).padStart(2)}  ${e.name.padEnd(28)} ${fmt(e.mtime)}  ${String(e.files).padStart(4)} 文件 ` +
      `${(e.bytes / 1024 / 1024).toFixed(2).padStart(6)} MB  ${keep ? "✅ 保留" : "🗑 删除"}`,
  );
});

const sum = (a) => a.reduce((x, y) => x + y.bytes, 0);
console.log("");
console.log(`  保留 ${keepList.length} 个 / ${(sum(keepList) / 1024 / 1024).toFixed(2)} MB`);
console.log(`  删除 ${dropList.length} 个 / ${(sum(dropList) / 1024 / 1024).toFixed(2)} MB`);

if (!dropList.length) {
  console.log(`\n  ✓ 快照数量未超限，无需处理。`);
  process.exit(0);
}

if (!APPLY) {
  console.log(`\n  [只报告] 加 --apply 执行（默认移入回收站，可恢复）。`);
  process.exit(0);
}

// ————————————————————— 执行 —————————————————————
/**
 * Windows：走 shell API 移入回收站（可恢复）。
 *
 * ⚠️ 实测坑：`DeleteDirectory(..., SendToRecycleBin)` 在**成功**移入回收站后仍可能抛
 *    `FileNotFoundException`，使 PowerShell 退出码为 1 —— 典型的「操作成功、自报失败」。
 *    因此这里 try/catch 吞掉该异常，并**以后置状态（目录是否还在）作为唯一判据**，
 *    不信退出码也不信 stderr。（同项目一贯教训：中间层的自报状态会骗人。）
 * 路径通过环境变量传入，避免引号/空格/盘符转义问题。
 */
const PS_RECYCLE = `
Add-Type -AssemblyName Microsoft.VisualBasic
try { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:WB_TARGET,'OnlyErrorDialogs','SendToRecycleBin') } catch { }
if (Test-Path -LiteralPath $env:WB_TARGET) { exit 1 } else { exit 0 }
`;

const toRecycleBin = (p) => {
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_RECYCLE], {
    stdio: "pipe",
    env: { ...process.env, WB_TARGET: p.replace(/\//g, "\\") },
  });
};

const hardDelete = (p) => rmSync(p, { recursive: true, force: true });

let ok = 0;
const failed = [];
for (const e of dropList) {
  try {
    if (PERMANENT) hardDelete(e.path);
    else toRecycleBin(e.path);

    // 权威判据：以后置状态为准，不采信子进程退出码
    if (existsSync(e.path)) {
      failed.push(`${e.name}: 调用后目录仍然存在`);
      console.log(`  ✗ ${e.name} 仍然存在，删除未生效`);
      continue;
    }
    ok++;
    console.log(`  ✓ ${PERMANENT ? "已删除" : "已移入回收站"}  ${e.name}`);
  } catch (err) {
    if (!existsSync(e.path)) {
      ok++;
      console.log(`  ✓ ${PERMANENT ? "已删除" : "已移入回收站"}  ${e.name}（子进程报错但已生效）`);
    } else {
      failed.push(`${e.name}: ${String(err.message).split("\n")[0]}`);
      console.log(`  ✗ ${e.name} 失败：${String(err.message).split("\n")[0]}`);
    }
  }
}

console.log(`\n  [结果] 成功 ${ok} / ${dropList.length}`);
if (failed.length) {
  console.log(`  [结果] 失败 ${failed.length} 条：`);
  failed.forEach((f) => console.log(`      ${f}`));
  process.exit(1);
}
console.log(`\n  ${PERMANENT ? "（永久删除，不可恢复）" : "（已移入回收站，可恢复）"}`);
