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

> ⚠️ **2026-09-04 实测补充**：`.inp` 类族本身已落地，但**使用率很低**——表格化后 53 个 textarea 走组件私有类（`textwrap` 17 / `itg-note-input` 8（**零定义死类名**）/ `sp-cell` 4 / `f-*` 5 / `notes` 2）。缺 T2「表格单元格」、T3「内联无框」两层全局基类。**表单/弹窗外的新输入框仍用 `.inp`；表格内请用 §7.1 的 `.cell-inp`。**

### 2.3 Tab vs Segmented（✅ 已区分）
- **Tab**（二级导航）：下划线式，active 蓝字 + 蓝色底边（`.tabs/.tab`）
- **Segmented**（三级选择/筛选）：药丸式，active 白底胶囊 + 轻阴影（工卡分配 waSegment、换发 splitbutton 菜单同族）
- 换发 5 子 tab 与 A检 5 子页同为 Tab 语义，不得混用 Segmented 充当导航

### 2.4 字体规范（✅ 已落地 2026-08-23，组件非令牌字号已清理 225 处）
**字体族**（main.css `:root`，全局继承 `font: inherit`）：
```css
font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
```
**字号阶梯（10 级令牌）**：
| 令牌 | 值 | 用途 |
|------|-----|------|
| `--fs-10` | 10px | 极小微标、splitbutton 箭头、DAY 迁移下拉 |
| `--fs-11` | 11px | 徽章文字、胶囊、极小标签 |
| `--fs-12` | 12px | 元数据：列表副行、面包屑、状态徽章、表头辅助、表格正文小字号 |
| `--fs-13` | 13px | **正文基准**：按钮、输入框、表格单元格、卡片正文 |
| `--fs-14` | 14px | 强调：区块标题、DAY 标签、`.inp-lg` |
| `--fs-15` | 15px | 次级标题（保留） |
| `--fs-16` | 16px | 弹窗标题、项目卡片名 |
| `--fs-18` | 18px | 子页标题、模板名 |
| `--fs-21` | 21px | 页级标题（顶栏 H1） |
| `--fs-24` | 24px | 预留大标题 |
**字重语义**：400 正文 / 500 弱强调（f-note）/ 600 次级标题·胶囊 / **650 品牌级**（按钮·徽章·表头）/ 700 最高强调（页级/区块标题、标题输入、DAY 标签）。
**颜色×字体**：主标题蓝 `--blue-dark`+700；黄底黑字（表单工序标题区）；备注**统一红字** `--danger`（全局规则 `textarea[placeholder*="备注"]{color:var(--danger)}`，含表单/甘特/串件/物品/梳理/部位备注）；甘特表头阶段名蓝底白字；串件卡标题橙底白字。
**规则**：新增代码禁止使用非令牌字号（font-size 一律 `var(--fs-*)`）；圆角/间距同理。

### 2.4 卡片 / 表格（✅ 大体一致）
- 卡片：白底、`--n4` 边框、`--r-lg`、`--sh-1`；卡头 12-16px 内边距 + 底部 `--n3` 分隔线
- 表格：`--n3` 边框、圆角 `--r-md`、表头 `--n1` 底 + `--n8` 字、行分割 `--n3`

### 2.5 移动端适配（≤768px）与物品行表 / 工序卡 / 甘特列宽（✅ 已落地 2026-09-05）
**断点**：全站响应式断点统一 `@media (max-width: 768px)`；移动端视觉验证默认用 375px 视口（本机 Edge headless 截图，样本见 `output/mobcheck/`）。

**a. 物品行表 `.itg`（工具/航材/串件/重复梳理共用；A检工具 item-grid 卡式除外）**
- 桌面（main.css `:root` 后 .itg 基类）：表头 `.itg-head` + `.itg-row{display:contents}` 保持网格对齐；水平实线 `var(--n4)`、垂直虚线 `var(--n3)`、白底 `var(--n0)`、hover `var(--blue-light)`；输入框 padding 水平归零对齐表头。
- 数量列 = `.itg-qty` 外壳（DOM 恒 `−,input,+`）：内部 2 列 2 行 grid（输入框左 + 上/下步进按钮居右，`:first-child/:last-child` 纯 CSS 定位）；外壳默认 stretch 铺满行高（**固定高会露容器底色形成色带**）；隐藏原生 spinner。
- ≤768：隐藏表头行（字段名由 placeholder 承担）→ `.itg-row` 还原为独立**圆角白卡**，行间 **8px 缝隙**（`margin:0 0 8px`）替代原实线分割；行内 flex 换行——主字段（textarea/.itg-tag）均分 + `.itg-qty` 收窄 + × 行尾（`order:1` 靠主字段 grow 推至行尾，**勿用 margin auto**）；备注整行下沉 `order:2;flex:1 1 100%`，**上缘虚线须落在同一张行卡白底内**（背景在 `.itg-row`、cell 透明，勿给备注加 margin 制造色缝）。

**b. 换发表单子页工序卡（`.form-card-row`）移动三段**
- 三段语义：行1 标题黄块+持续至(fc-span)+×（串件行=类型标签+内容+×）；行2 负责人+参与人；行3 备注整行。
- **必须 grid-template-areas 显式三行**（flex-wrap+order 无法保证分组换行——曾致「标题/人员未分开只剩两行」）：
  - 工序行 areas `"t t s x" / "o p p ." / "n n n n"`；串件行 areas `"tag cnt cnt x" / "o p p ." / "n n n n"`；
  - 列模板 `minmax(0,auto) minmax(0,1fr) minmax(0,max-content) 24px`；容器 `max-width:100%`；子项 `min-width:0`（textarea 默认 cols 内禀宽会撑爆 auto 列）；`.icon-btn` 显式 24px；`.fc-span` nowrap；
  - NameSuggest 为子组件，钉 o/p 区必须 `:deep(.ns-wrap...)` 穿透 scope；备注/正文选择器用 `> textarea:last-of-type` 防误中标题区 textarea。
  - 缓存兜底：media 块选择器含冗余三选一变体 + `/* cache-bust:vN-YYYY-MM-DDx */` 注释戳（反复部署后浏览器缓存旧 chunk 时强制刷新 hash）。

**c. 甘特阶段列（GanttPrep）**
- 列宽令牌 `--gp-col:320px`（= 桌面完整页宽均分 8 列的单列宽，移动/桌面一致）；模板 `repeat(n, var(--gp-col, 320px))`；少于 8 列右侧留空，多于 8 列或窄屏由 `.gantt-wrap` 横向滑块（`overflow-x:auto`）。
- 拖拽落点 / 阶段增减 / 导出列宽一律按**实际解析列宽**（`parseFloat(getComputedStyle(grid).gridTemplateColumns.split(" ")[0]) || 320`）计算，勿用容器宽/列数（多列溢出时失真）；导出前把列宽写成 px 模板 + `.gantt-wrap` overflow visible，保证完整宽度输出。

**d. 新增代码红线**（踩坑总结，勿回退）
1. 跨行分组布局 → `grid-template-areas` 显式行区；禁 flex-wrap+order 保证换行。
2. 表格/网格内 textarea 必 `min-width:0`；容器 `max-width:100%`；auto 列用 `minmax(0,auto)`。
3. 移动行表缝隙 = 行卡 margin；cell 透明、背景置行卡，防色缝。
4. 子组件元素钉父级布局区必须 `:deep()` 穿透 scoped。

## 3. 状态覆盖（⚠️ 部分落地）
| 状态 | 规范 | 现状 |
|------|------|------|
| 空态 | 统一 `.empty-state` | ✅ 各列表/清单已有（散落但类名一致） |
| 加载态 | spinner + 文案 | ⚠️ `.loading-state` 全局类已存在且用于 6 处；但 `.sync-spinner` 另有 2 处重复实现、无组件封装、**无按钮内 loading**（可重复点击）。详见 §7.3 |
| 错误态 | toast 统一 | ✅ 全站 `notify()` 统一；`.toast.err` 红已实现 |
| 成功态 | toast 分色 | ⚠️ `.toast.ok` 绿 / `.toast.err` 红**已实现**，但 199 个调用点仅 84 处显式分级，**约 115 处仍走默认灰**（含「导入完成」「导出失败」）。修正方案见 §7.2 |

> 2026-09-04 实测修订：§3 后两行原记为「✅ 56 处已分色」，实测为部分完成，**以本节为准**。

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
| P0 | 按钮 4 级统一 | ✅ 4 级 36px |
| P1 | 输入框统一 `.inp` | ⚠️ **实测修订**：`.inp` 4 变体已落地，但**表格化后几乎无人用**——53 个 textarea 走组件私有类（`textwrap` 17 / `itg-note-input` 8（**0 定义**）/ `sp-cell` 4 / `f-*` 5 / `notes` 2）。缺 T2 单元格、T3 内联两层基类，见 §7.1 |
| P1 | 四态组件（空/加载/错误/成功） | ⚠️ 空态✅；错误✅；成功⚠️（115 处未分色，§7.2）；加载⚠️（2 处重复 spinner + 无组件 + 无按钮 loading，§7.3） |
| P1 | 面包屑 + 层级强化 | ✅ 二级页面包屑 + Tab/Segmented 区分 |
| P2 | 移动端真机验证（640/1024 断点 + 触摸 ≥44px） | ⏸ 未排期 |
| P2 | 对比度审计 | ⚠️ `--n7`≈5.8:1 ✓；danger 浅红底文字待复核（当前白底红字实际达标） |

## 6. 待办（下一轮按序补齐）

> 已按 2026-09-04 实测重写，实施顺序与参考样式见 **§7.4 优先级建议**。

1. toast `notify` 加 `guessLevel` 兜底（改 1 行，115 处灰 toast 立刻分色）
2. 按钮 `is-loading` 禁用态（导出/导入类，防重复点击）
3. `itg-note-input` 死类名 → `.cell-inp is-note`（8 处，须重测导出图片）
4. `LoadingState.vue` 替换 6 处 + 全屏遮罩收敛（消 2 处 `.sync-spinner`）
5. `textwrap`/`sp-cell`/`f-*` 逐组件迁移到 `.cell-inp`（私有类收敛）
6. （P2）骨架屏 / toast 多条堆叠
7. （P2）移动端真机复核（布局已落地见 §2.5；真机观感 / 触摸热区 ≥44px 审计）

**参考样式 Demo**：`output/ui-spec-gap-demo.html`（浏览器直接打开，含输入框 3 层、toast 4 级、加载态 5 种形态的可交互预览）

---

## 7. 三项补齐方案（2026-09-04 实测修订 + 参考样式）

> ⚠️ **本节结论基于 2026-09-04 实测，与 §3/§6 的旧结论不一致时以本节为准。**
> 实测：`itg-note-input` 8 处引用 **0 定义**（死类名）；`notify` 199 调用点仅 84 处显式分级；`.loading-state` 已存在但 `.sync-spinner` 另有 2 处重复实现。

### 7.1 输入框收敛（实测修正）

**实测数据**（组件目录 24 个 .vue，11 个含 textarea，共 53 个 textarea）：

| 类名 | 引用 | 定义位置 | 判定 |
|---|---|---|---|
| `textwrap` | 17 | GanttPrep scoped ×2 | ⚠️ 私有类，仅单组件可用 |
| `itg-note-input` | 8 | **无（0 定义）** | 🔴 死类名，靠 `.itg textarea` 兜底 |
| `sp-cell` | 4 | scoped ×3 | ⚠️ 私有类 |
| `f-content` / `f-note` | 3 / 2 | scoped ×4 / ×2 | ⚠️ 私有类 |
| `notes` | 2 | scoped ×2 + main.css ×2 | ⚠️ 跨层重复 |
| `sp-name` / `participant-input` | 1 / 1 | scoped ×2 / ×4 | ⚠️ 私有类 |

**结论**：问题**不是**「6+ 组件重复定义 `.inp`」，而是**输入框分三类语义但只有一类有全局基类**：
- T1 表单输入（有边框、36px）→ `.inp` ✅ 已有，但表格化后几乎无人用
- T2 **表格内单元格输入**（无边框、自适应行高、继承单元格 padding）→ ❌ 缺全局基类，各组件自造
- T3 **内联无框编辑**（标题/可编辑名，hover 才显边框）→ ❌ 缺全局基类

#### 参考样式（T2/T3 新增至 main.css）

```css
/* ===== 输入框 3 层语义（UI_DESIGN_SPEC §7.1）===== */

/* T1 表单输入：已有 .inp（36px / --n4 边框 / --r-md），此处仅补只读态 */
.inp[readonly], .inp:disabled {
  background: var(--n1); color: var(--n7); cursor: not-allowed;
}

/* T2 表格/网格内单元格输入：无边框、自适应行高、焦点才浮起 */
.cell-inp {
  width: 100%; box-sizing: border-box;
  padding: 3px 6px;                    /* 继承单元格内边距观感 */
  border: 1px solid transparent;        /* 占位边框，避免 focus 时抖动 */
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--n9); font: inherit; font-size: var(--fs-13);
  resize: none; overflow: hidden;
  field-sizing: content;                /* 自适应行高；Firefox 需 JS grow 兜底 */
  min-height: 26px; line-height: 1.5;
  transition: background var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast);
}
.cell-inp:hover { background: var(--n1); border-color: var(--n3); }
.cell-inp:focus {
  outline: none; background: #fff;
  border-color: var(--blue);
  box-shadow: 0 0 0 2px rgba(68, 114, 196, .14);   /* 比 .inp 的 3px 收窄，适应密集表格 */
}
.cell-inp::placeholder { color: var(--n6); }
/* 备注语义：红色（与全局 textarea[placeholder*="备注"] 一致，此处显式化） */
.cell-inp.is-note { color: var(--danger); }
.cell-inp.is-note::placeholder { color: var(--n6); }

/* T3 内联无框编辑：标题/可编辑名，默认无边框，hover/focus 才显形 */
.bare-inp {
  border: 1px solid transparent; border-radius: var(--r-sm);
  background: transparent; color: inherit; font: inherit;
  padding: 2px 6px; min-height: 28px; box-sizing: border-box;
  transition: border-color var(--t-fast), background var(--t-fast);
}
.bare-inp:hover { border-color: var(--n3); background: var(--n1); }
.bare-inp:focus { outline: none; border-color: var(--blue); background: #fff; }

/* 通用：被他人锁定的输入框（配合 v-lock 的 .remote-locked，勿覆盖既有规则） */
.remote-locked:where(.inp, .cell-inp, .bare-inp) { cursor: not-allowed; }
```

#### 迁移步骤（低风险、可分批）
1. **先修死类名**：8 处 `itg-note-input` → `cell-inp is-note`（一步消除 0 定义类名，视觉仅由「完全无定义」变为「有明确规范」）。
2. `.itg textarea` 现有兜底保留，`.cell-inp` 与之共存，逐组件替换后再决定是否收敛 `.itg input, .itg textarea`（**勿先删兜底**）。
3. `textwrap`（17 处，仅 GanttPrep）→ `cell-inp`，删 scoped 私有定义。
4. `sp-cell` / `f-content` / `f-note` / `notes` / `sp-name` 逐个比对后替换；差异语义用附加类保留（如 `.cell-inp.wide`）。
5. 表格外的模态框输入（ProjectFormModal / 各类弹窗）保持 `.inp` 不变。

> ⚠️ **勿一次性全局替换**：表格内输入框的行高/padding 直接影响导出图片（exportAllImage 会读取 scrollHeight），改后须重测导出。

### 7.2 toast 语义化分级（实测修正）

**实测**：`notify()` 199 个调用点，仅 **84 处**显式传 `"ok"` / `"err"`，约 **115 处走默认 `"info"`（灰色）**。典型漏色：
- 应为绿：`"标准库导入完成"` / `"工具车导入完成"` / `"一级页面链接已复制"` / `"分享内容已保存"`
- 应为红：`"导出失败(渲染)"` / `"导入失败：…"` / `"复制失败，请检查浏览器权限"`

**根因**：签名 `notify(message, level = "info")`，漏传即灰——语义丢失是**默认值的锅**，不是调用方偷懒。

#### 方案：语义 helper + 内容推断兜底（推荐）

```ts
// composables/useToolbox.ts —— 保留 notify 兼容，新增语义 helper
const ERR_HINT   = /失败|错误|异常|无法|不能|超时|中断|已存在|不存在|请勿|缺少|无效|拒/;
const OK_HINT    = /完成|成功|已保存|已复制|已上传|已删除|已同步|已导入|已导出|已添加|已更新/;

/**
 * 智能推断级别：优先显式，其次按文案关键字。
 * ⚠️ 仅作兜底——新代码一律显式传 level 或用 notifyOk/notifyErr。
 */
function guessLevel(msg: string): "info" | "ok" | "err" {
  if (ERR_HINT.test(msg)) return "err";
  if (OK_HINT.test(msg)) return "ok";
  return "info";
}

function notify(message: string, level?: "info" | "ok" | "err"): void {
  toast.message = message;
  toast.level = level ?? guessLevel(message);   // ← 只改这一行
  toast.visible = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.visible = false; }, 2200);
}
const notifyOk  = (m: string) => notify(m, "ok");
const notifyErr = (m: string) => notify(m, "err");
```

#### 参考样式（toast 增强：图标 + warn 级 + 堆叠）

```css
/* ===== toast（UI_DESIGN_SPEC §7.2）：分色 + 图标 + warn 级 ===== */
.toast {
  position: fixed; bottom: 28px; left: 50%; z-index: 30;
  display: flex; align-items: center; gap: 8px;
  max-width: min(92vw, 520px);
  padding: 10px 16px; color: #fff;
  border-radius: var(--r-md); background: #323232;
  box-shadow: var(--sh-3);
  opacity: 0; pointer-events: none;
  transform: translateX(-50%) translateY(8px);
  transition: opacity var(--t-med), transform var(--t-med);
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* 级别配色（保持既有 ok/err，新增 warn） */
.toast.ok   { background: var(--ok,     #2e7d32); }
.toast.err  { background: var(--danger, #c0392b); }
.toast.warn { background: var(--warn,   #b07d10); }

/* 语义图标（用 ::before，无需改模板结构） */
.toast::before {
  font-weight: 700; font-size: var(--fs-14); line-height: 1; flex: 0 0 auto;
}
.toast.ok::before   { content: "✓"; }
.toast.err::before  { content: "!"; }
.toast.warn::before { content: "!"; }

/* 无障碍：动效减弱时不位移 */
@media (prefers-reduced-motion: reduce) {
  .toast { transition: opacity var(--t-med); transform: translateX(-50%); }
}
```

> 多条堆叠（如同时 3 条 toast）为 P2，需把 `toast` 从单对象改数组 + `.toast-stack` 容器，暂不实施。

### 7.3 加载态统一（实测修正）

**实测**：`.loading-state` 全局类**已存在**（main.css:193，spinner 为 `::before` + `@keyframes loading-spin`），已在 **6 处**使用（ProjectDetail / ProjectList ×3 / GanttPrep / StandalonePrepSheet）。
**真实缺口**：
1. `.sync-spinner` 另有 **2 处重复实现**（App.vue:477 全屏遮罩、ProjectDetail.vue:545），与 `.loading-state` 的 spinner 不同源。
2. 无组件封装——每处手抄 `<p class="loading-state">加载中…</p>`，文案/尺寸不可配。
3. **无按钮内 loading**（提交/导出时按钮无禁用+spinner，可重复点击）。
4. 无骨架屏（长清单首屏空白）。

#### 方案：先做组件 + 统一 spinner 变量，骨架屏排 P2

```vue
<!-- components/LoadingState.vue —— 统一加载态 -->
<template>
  <div class="loading-state" :class="[`is-${size}`, { 'is-block': block }]" role="status" aria-live="polite">
    <span class="ls-spinner" aria-hidden="true" />
    <span class="ls-text"><slot>{{ text }}</slot></span>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ text?: string; size?: "sm" | "md"; block?: boolean }>(), {
  text: "加载中…", size: "md", block: false,
});
</script>

<style scoped>
.loading-state {
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--sp-2); color: var(--n7); font-size: var(--fs-13);
}
.loading-state.is-block { display: flex; width: 100%; padding: var(--sp-5) 0; }
.ls-spinner {
  width: 15px; height: 15px; flex: 0 0 auto;
  border: 2px solid var(--n4);
  border-top-color: var(--blue);
  border-radius: 50%;
  animation: loading-spin .8s linear infinite;   /* 复用 main.css 既有 keyframes */
}
.loading-state.is-sm { font-size: var(--fs-12); gap: 6px; }
.loading-state.is-sm .ls-spinner { width: 12px; height: 12px; border-width: 2px; }
@media (prefers-reduced-motion: reduce) { .ls-spinner { animation-duration: 1.6s; } }
</style>
```

```css
/* ===== 加载态附加：全屏遮罩 / 按钮内 loading（UI_DESIGN_SPEC §7.3）===== */

/* 全屏冻结遮罩（统一 App.vue .sync-overlay 与 ProjectDetail .detail-loading） */
.loading-overlay {
  position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  background: rgba(17, 24, 39, .45);
  backdrop-filter: blur(2px);
}
.loading-overlay-card {
  display: flex; flex-direction: column; align-items: center; gap: var(--sp-3);
  min-width: 200px; padding: var(--sp-6) var(--sp-7);
  background: #fff; border-radius: var(--r-lg); box-shadow: var(--sh-3);
  color: var(--n7); font-size: var(--fs-13);
}

/* 按钮内 loading：禁用防重复点击，spinner 占位保持按钮宽度不跳动 */
button.is-loading, .button.is-loading {
  position: relative; color: transparent !important;
  pointer-events: none; opacity: .85;
}
button.is-loading::after {
  content: ""; position: absolute; inset: 0; margin: auto;
  width: 14px; height: 14px;
  border: 2px solid rgba(255, 255, 255, .45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: loading-spin .8s linear infinite;
}
button.is-loading.primary::after,
button.is-loading.ghost::after { border-color: rgba(255, 255, 255, .45); border-top-color: #fff; }
button.is-loading:not(.primary)::after { border-color: var(--n4); border-top-color: var(--blue); }
```

#### 迁移步骤
1. 新增 `LoadingState.vue`，替换 6 处 `<p class="loading-state">`。
2. App.vue `.sync-overlay` + ProjectDetail `.detail-loading` 收敛为 `.loading-overlay` / `.loading-overlay-card`（消 2 处 `.sync-spinner` 重复）。
3. 「导出图片 / 导出 Word / 导入」等耗时按钮加 `:class="{ 'is-loading': busy }"` + `:disabled="busy"`（**防重复点击**，收益最高）。
4. 骨架屏（长清单首屏）排 P2。

### 7.4 优先级建议（投入产出排序）

| 顺序 | 事项 | 收益 | 风险 |
|---|---|---|---|
| 1 | toast `notify` 加 `guessLevel` 兜底（改 1 行） | 115 处灰色 toast 立刻分色，零视觉回归 | 极低（关键字可能误判，可逐条调） |
| 2 | 按钮 `is-loading` 禁用态（导出/导入类） | 防重复点击，消除偶发双份导出 | 低 |
| 3 | `itg-note-input` 死类名 → `.cell-inp is-note` | 消除 0 定义类名，备注样式显式化 | 低（须重测导出图片） |
| 4 | `LoadingState.vue` 替换 6 处 + 遮罩收敛 | 消重复，文案可配 | 低 |
| 5 | `textwrap`/`sp-cell`/`f-*` 逐组件迁移到 `.cell-inp` | 私有类收敛 | 中（逐组件回归 + 导出图片重测） |
| 6 | 骨架屏 / toast 堆叠 | 体验提升 | 中（需改 toast 数据结构） |
