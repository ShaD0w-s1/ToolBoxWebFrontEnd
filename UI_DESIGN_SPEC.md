# ToolBox 云端协作版 · UI 设计规范（UI_DESIGN_SPEC）

> 来源：`F:\ToolBox 2\ToolBoxEval\ui-ux-audit-2026-08-22.html`（2026-08-22 UI/UX 审计样板，5 分区）。
> 生效日期：2026-08-22。**后续所有前端改动须遵守本规范**；新增页面/组件优先复用下列令牌与全局类，禁止再引入新的散落硬编码色值/圆角/字号/间距。
> 合规状态：✅ 已落地 · ⚠️ 待补齐 · ⏸ 待排期。

---

## 1. 设计令牌（✅ 已落地 main.css `:root`）

```css
/* 品牌主色 */
--blue:#4472c4; --blue-dark:#2f5597; --blue-light:#d9e1f2; --blue-bg:#eef3fb; --focus:#8eaadb;
/* 语义色 */
--danger:#c0392b; --danger-bg:#fdecea; --warn:#b07d10; --warn-bg:#fff7e0; --ok:#2e7d32; --ok-bg:#e8f5e9;
/* 中性色阶 n0~n10 */
--n0:#ffffff; --n1:#f7f9fc; --n2:#f0f3f8; --n3:#e6eaf2; --n4:#dde2ec; --n5:#b9c1cf;
--n6:#8a93a6; --n7:#697386; --n8:#3d4657; --n9:#1f2a44; --n10:#141b2e;
/* 字号 fs-11~24 */
--fs-11:11px; --fs-12:12px; --fs-13:13px; --fs-14:14px; --fs-15:15px; --fs-16:16px; --fs-18:18px; --fs-21:21px; --fs-24:24px;
/* 间距 sp-1~7（8px 基准） */
--sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px; --sp-6:24px; --sp-7:32px;
/* 圆角 4 级 */
--r-sm:6px; --r-md:8px; --r-lg:12px; --r-pill:999px;
/* 阴影 3 级 */
--sh-1:0 1px 2px rgba(20,27,46,.05); --sh-2:0 2px 8px rgba(20,27,46,.07); --sh-3:0 8px 24px rgba(20,27,46,.12);
/* 动效 */
--t-fast:.15s; --t-med:.2s;
/* 业务语义色（换发/APU 定稿） */
--proc-yellow:#FDCA17; --proc-yellow-line:#C9A227; --sp-orange:#E8A44D; --sp-orange-deep:#c2701a; --day-bg:#E8F1FC;
```

使用规则：正文主文字 `--n9`；次要文字 `--n7`；边框 `--n4`（兼容旧 `--line`）；页面底 `--n1`；hover 底 `--n2`。圆角按层级取 r-sm/md/lg/pill，禁止出现 5/7/10/11px 等非刻度值。

## 2. 组件规范

### 2.1 按钮 4 级（✅ 全局统一）
| 级别 | 类 | 视觉 |
|------|-----|------|
| 主要 | `primary` | 蓝底白字，hover `--blue-dark` |
| 次要 | 默认 `button`/`ghost` 蓝框白底 | 白底蓝框（≈sec），hover `--blue-bg` |
| 幽灵 | `ghost`（透明场景） | 无边框透明，hover `--n2` |
| 危险 | `danger` | 白底红字红框，hover `--danger-bg` |

统一：min-height 36px；圆角 `--r-md`；focus-visible 光环 `--focus`；active 微下压 1px。小按钮（卡片内操作）用 `--r-sm` + 26~30px 高度。

### 2.2 输入框统一 `.inp`（✅ 已落地 2026-08-22）
全局统一类 `.inp`（常规/`.inp-err` 错误/`.inp-lg` 大号/`.inp-sm` 小号 4 变体）已加入 main.css：
- 36px 高、`--n4` 边框、`--r-md`、hover 边框 `--n5`、focus 蓝边 + 3px 蓝色光环
- 另加全局单行 input / date 输入兜底收敛（`input:not([type=checkbox/radio/file/range])` 族），组件 scoped 特殊样式优先级更高不受影响
- 新增代码一律使用 `.inp` 族；组件内旧重复定义可逐步清理

### 2.3 Tab vs Segmented（✅ 已区分）
- **Tab**（二级导航）：下划线式，active 蓝字 + 蓝色底边（`.tabs/.tab`）
- **Segmented**（三级选择/筛选）：药丸式，active 白底胶囊 + 轻阴影（工卡分配 waSegment、换发 splitbutton 菜单同族）
- 换发 5 子 tab 与 A检 5 子页同为 Tab 语义，不得混用 Segmented 充当导航

### 2.4 卡片 / 表格（✅ 大体一致）
- 卡片：白底、`--n4` 边框、`--r-lg`、`--sh-1`；卡头 12-16px 内边距 + 底部 `--n3` 分隔线
- 表格：`--n3` 边框、圆角 `--r-md`、表头 `--n1` 底 + `--n8` 字、行分割 `--n3`

## 3. 状态覆盖（⚠️ 部分落地）
| 状态 | 规范 | 现状 |
|------|------|------|
| 空态 | 统一 `.empty-state` | ✅ 各列表/清单已有（散落但类名一致） |
| 加载态 | spinner + 文字 | ⚠️ 二级页深链空态已补；模板弹窗/标准库等仍为纯文字，未统一组件 |
| 错误态 | toast 统一 | ✅ 全站 notify() 统一 |
| 成功态 | toast.ok 分色 | ✅ `notify(msg, "ok"/"err")` 已支持，56 处典型成功/失败调用已分色（toast.ok 绿 / toast.err 红） |

## 4. 层级架构（✅ 已落地）
```
L1 顶栏 Header（渐变蓝底 · 云状态徽章 · 身份）
L2 页面级（面包屑 + 页标题 + 页面级操作：保存/刷新/清空/分享）※ 二级页面包屑已加
L3 子页 Tab（下划线高亮）+ 内部 Segmented 三级筛选
L4 内容区（卡片/表格/输入；四态统一）
```
面包屑格式：`项目列表 / 项目名 / 子页`（ProjectDetail 已实现 subPageLabel）。

## 5. 优先级与合规台账
| 级别 | 项目 | 状态 |
|------|------|------|
| P0 | 设计令牌落地（中性色阶/字号/间距/圆角/阴影） | ✅ 17 组件 +249 处、main.css +83 处 |
| P0 | 输入框/按钮统一 | ✅ 按钮 4 级 36px；`.inp` 全局类族 + 全局兜底收敛（08-22） |
| P1 | 四态组件（空/加载/错误/成功） | ⚠️ 空态✅ 错误✅ 成功✅（toast 分色）；**加载态未统一组件** |
| P1 | 面包屑 + 层级强化 | ✅ 二级页面包屑 + Tab/Segmented 区分 |
| P2 | 移动端真机验证（640/1024 断点 + 触摸 ≥44px） | ⏸ 未排期 |
| P2 | 对比度审计 | ⚠️ `--n7`≈5.8:1 ✓；danger 浅红底文字待复核（当前白底红字实际达标） |

## 6. 待办（下一轮按序补齐）
1. 加载态统一组件（spinner + 文案），覆盖模板弹窗/标准库等
2. （可选）移动端真机验证
