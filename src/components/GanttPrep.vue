<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import type { GanttPrepState, GanttChart, GanttCard, GanttPartList, GanttPartListItem, GanttSpArrangement, GanttSpRow } from "../domain/toolbox";
// docx 仅做类型引用（运行时保持动态 import 分包）；D* 别名用于类型标注
import type { Paragraph as DParagraph, Table as DTable, TableRow as DTableRow, TableCell as DTableCell } from "docx";
import { backend } from "../api";
import NameSuggest from "./NameSuggest.vue";
import AttachmentSection from "./AttachmentSection.vue";
import { createEditLockDirective } from "../utils/editLock";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ (e: "share"): void }>();

// —— 单输入框级编辑软锁（共享指令）：换发/APU 数据在 ganttPrep 顶层字段 ——
const lockKey = (kind: string, id: string, field: string): string => `ganttPrep|${kind}|${id}|${field}`;
const vLock = createEditLockDirective(props.store);


const DEFAULT_RESP = ["现场负责人", "工具负责", "持卡", "必检", "拆装记录人"];
const DEFAULT_PARTS_TYPES = ["无", "串件", "单拆", "单装", "领新件"];

function genId(): string {
  return (globalThis.crypto?.randomUUID?.() || `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`).slice(0, 20);
}

const state = computed<GanttPrepState | null>(() => props.store.currentProject.value?.ganttPrep ?? null);

const tab = computed<"form" | "gantt" | "docs" | "airparts" | "tools">({
  get: () => props.store.ganttTab.value,
  set: (v) => { props.store.ganttTab.value = v; },
});
// 串件清单 tab → state 字段名（airparts→airParts, tools→toolParts）
const partKind = computed<"airParts" | "toolParts">(() => (tab.value === "airparts" ? "airParts" : "toolParts"));

// 标题行显示的可编辑「当前模板名称」
const templateName = computed<string>({
  get: () => state.value?.currentTemplateName || "",
  set: (v) => { if (state.value) state.value.currentTemplateName = v; },
});

function save(): void {
  // DAY 卡片始终按编号从小到大排序（覆盖新增/手动改编号/导入/插入等所有路径）
  const s = state.value;
  if (s && Array.isArray(s.charts)) {
    s.charts = s.charts.slice().sort((a, b) => (Number(a.day) || 0) - (Number(b.day) || 0));
  }
  props.store.saveGantt();
}

// —— meta 结构（确保存在）——
interface MetaAircraft { id: string; reg: string; fsn: string; msn: string; engine: string; type: string; etops: string; eltDt: string }
interface MetaComponent { id: string; name: string; offPn: string; offSn: string; onPn: string; onSn: string }
interface MetaArrangementItem { id: string; content: string; assign: string }
interface MetaArrangement { manager: string; dutyGroup: string; location: string; orderNo: string; orderName: string; participants: string; items: MetaArrangementItem[] }
function ensureMeta(s: GanttPrepState): Record<string, unknown> {
  if (!s.meta || typeof s.meta !== "object") s.meta = {};
  const m = s.meta as Record<string, unknown>;
  if (!Array.isArray(m.aircrafts)) m.aircrafts = [{ id: genId(), reg: "", fsn: "", msn: "", engine: "", type: "", etops: "", eltDt: "" }];
  if (!Array.isArray(m.components)) m.components = [{ id: genId(), name: "", offPn: "", offSn: "", onPn: "", onSn: "" }];
  if (!m.arrangement || typeof m.arrangement !== "object") {
    m.arrangement = { manager: "", dutyGroup: "", location: "", orderNo: "", orderName: "", participants: "", items: [{ id: genId(), content: "", assign: "" }] };
  } else {
    const a = m.arrangement as Record<string, unknown>;
    if (!Array.isArray(a.items)) a.items = [{ id: genId(), content: "", assign: "" }];
    if (typeof a.participants !== "string") a.participants = "";
  }
  return m;
}
const meta = computed(() => (state.value ? ensureMeta(state.value) : null));
const aircrafts = computed<MetaAircraft[]>(() => (meta.value?.aircrafts as MetaAircraft[]) || []);
const components = computed<MetaComponent[]>(() => (meta.value?.components as MetaComponent[]) || []);
const arrangement = computed<MetaArrangement>(() => (meta.value?.arrangement as MetaArrangement) || ({} as MetaArrangement));
const arrangementItems = computed<MetaArrangementItem[]>(() => (arrangement.value?.items as MetaArrangementItem[]) || []);

// —— 参与人名单：姓名拆分 / 自动检测 ——
function splitNames(s: string): string[] {
  if (!s) return [];
  return s.split(/[^\p{L}\p{N}]+/u).map((t) => t.trim()).filter(Boolean);
}
// 自动检测时忽略 L/R 等英文字母（位置标识），只保留中文/数字
function cleanDetectedName(t: string): string {
  return String(t || "").replace(/[A-Za-z]+/g, "").trim();
}
// 单 DAY 自动检测：从顶部责任 / 工序卡片 / 串件的 负责人 + 参与人 提取
function collectChartParticipants(chart: GanttChart): string[] {
  const set = new Set<string>();
  const add = (s: string) => splitNames(s).forEach((t) => { const c = cleanDetectedName(t); if (c) set.add(c); });
  (chart.responsibilities || []).forEach((r) => add(r.name));
  (chart.cards || []).forEach((card) => { add(card.owner); add(card.participants); });
  // 全局串件安排（该 DAY 已分配的串件行 + 未分配串件行都计入参与人）
  getSpArrangements().forEach((a) => a.rows.forEach((r) => {
    if (!r.executeStage || r.executeStage.chartId === chart.id) { add(r.owner); add(r.participants); }
  }));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
}
// 全部 DAY 自动检测名单
const allParticipants = computed<string[]>(() => {
  const set = new Set<string>();
  state.value?.charts.forEach((c) => collectChartParticipants(c).forEach((n) => set.add(n)));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
});
const manualParticipants = computed<string[]>(() => state.value?.manualParticipants || []);
// 姓名联想候选 = 手动名单 ∪ 全部自动检测，去重排序
const participantSuggestions = computed<string[]>(() => {
  const set = new Set<string>();
  manualParticipants.value.forEach((n) => n && set.add(n));
  allParticipants.value.forEach((n) => set.add(n));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
});
// 参与人员（项目安排卡片）：绑定到 arrangement.participants，手动名单跟随其变化增减
const participantInput = computed<string>({
  get: () => String(arrangement.value?.participants || ""),
  set: (v) => { if (state.value) arrangement.value.participants = v; },
});
// 手动名单 = 参与人员字段拆分结果（全量替换，跟随增减）
function syncManualFromArrangement(): void {
  const s = state.value; if (!s) return;
  s.manualParticipants = splitNames(String(arrangement.value?.participants || ""));
  save();
}
function onParticipantInputKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    e.preventDefault();
    syncManualFromArrangement();
  }
}
// 停止编辑（失焦）即同步手动名单，无需回车确认
function onParticipantInputBlur(): void {
  syncManualFromArrangement();
}
function removeManualParticipant(name: string): void {
  const s = state.value; if (!s) return;
  const cur = splitNames(String(arrangement.value?.participants || ""));
  arrangement.value.participants = cur.filter((n) => n !== name).join("、");
  s.manualParticipants = s.manualParticipants.filter((n) => n !== name);
  save();
}
// 从参与人名单跳转到对应 DAY 卡片（切到表单子页并滚动定位）
function gotoDay(dayNum: number): void {
  tab.value = "form";
  nextTick(() => {
    const chart = state.value?.charts.find((c) => c.day === dayNum);
    const el = chart ? document.getElementById("day-" + chart.id) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// —— 甘特行避让 ——
function computeRows(chart: GanttChart): Record<string, number> {
  const n = chart.stages.length;
  const cards = chart.cards.slice().sort((a, b) => {
    if (a.startStage !== b.startStage) return a.startStage - b.startStage;
    const la = a.endStage - a.startStage, lb = b.endStage - b.startStage;
    if (la !== lb) return lb - la;
    return (a.order ?? 0) - (b.order ?? 0);
  });
  const occupied: Set<number>[] = Array.from({ length: n }, () => new Set());
  const rows: Record<string, number> = {};
  let maxRow = 0;
  cards.forEach((c) => {
    let r = 0;
    outer: while (true) {
      for (let s = c.startStage; s <= c.endStage; s++) {
        if (occupied[s] && occupied[s].has(r)) { r++; continue outer; }
      }
      break;
    }
    rows[c.id] = r;
    maxRow = Math.max(maxRow, r);
    for (let s = c.startStage; s <= c.endStage; s++) occupied[s].add(r);
  });
  const colMax = Array(n).fill(-1);
  cards.forEach((c) => { for (let s = c.startStage; s <= c.endStage; s++) colMax[s] = Math.max(colMax[s], rows[c.id]); });
  const assigned = getSpArrangements().flatMap((arr) => arr.rows.map((row) => ({ arr, row })))
    .filter((x) => x.row.executeStage && x.row.executeStage.chartId === chart.id)
    .sort((a, b) => (a.row.executeStage!.stageIdx - b.row.executeStage!.stageIdx) || 0);
  const colCursor = colMax.map((m) => m + 1);
  assigned.forEach((x) => {
    const s = x.row.executeStage!.stageIdx;
    const r = colCursor[s];
    rows["sp:" + x.row.id] = r;
    maxRow = Math.max(maxRow, r);
    colCursor[s]++;
  });
  return rows;
}
function ganttRows(chart: GanttChart): Record<string, number> {
  return computeRows(chart);
}

// —— DAY / 阶段 / 工序 / 串件 / 责任 CRUD ——
/** 新建 DAY 卡片的默认日期：
 *  - 首个 DAY（DAY1）→ 项目执行日期（executeDate），无则今天；
 *  - 小数 DAY（0.5/1.5/2.5）→ 向下取整对应的整数 DAY 卡片日期（如 1.5 → DAY1 日期），对应整数卡片不存在则沿用 nextDate；
 *  - 其余 → 最后一张 DAY 日期 +1。 */
function chartDateFor(day: number): string {
  const s = state.value; if (!s) return "";
  if (s.charts.length === 0 || day === 1) {
    return props.store.currentProject.value?.executeDate || new Date().toISOString().slice(0, 10);
  }
  if (!Number.isInteger(day)) {
    const baseDay = Math.floor(day);
    const base = s.charts.find((c) => c.day === baseDay && Number.isInteger(c.day));
    if (base?.date) return base.date;
  }
  return nextDate();
}
/** 是否存在需要保留的小数/负数 DAY（此时禁止整体重编号，避免破坏编号语义）。 */
function hasSpecialDays(charts: GanttChart[]): boolean {
  return charts.some((c) => !Number.isInteger(c.day) || c.day < 0);
}
function addChart(): void {
  const s = state.value; if (!s) return;
  const last = s.charts[s.charts.length - 1];
  // 用「最大 DAY 编号 + 1」而非「数组长度 + 1」，避免删除/导入过 DAY 后编号不连续时产生重复或错乱编号
  const day = s.charts.reduce((m, c) => Math.max(m, Number.isFinite(c.day) ? c.day : 0), 0) + 1;
  const chart: GanttChart = {
    id: genId(), title: `DAY ${day}`, date: chartDateFor(day), day, collapsed: false,
    responsibilities: (last?.responsibilities?.length ? last.responsibilities : DEFAULT_RESP.map((l) => ({ id: genId(), label: l, name: "" })))
      .map((r) => ({ id: genId(), label: r.label, name: r.name })),
    stages: [], lanes: [], cards: [], parts: [],
  };
  s.charts.push(chart);
  save();
}
function addDayAfter(chartId: string): void {
  const s = state.value; if (!s) return;
  const idx = s.charts.findIndex((c) => c.id === chartId);
  if (idx < 0) return;
  const base = s.charts[idx];
  const responsibilities = (base.responsibilities?.length ? base.responsibilities : DEFAULT_RESP.map((l) => ({ id: genId(), label: l, name: "" })))
    .map((r) => ({ id: genId(), label: r.label, name: r.name }));
  if (hasSpecialDays(s.charts)) {
    // 存在小数/负数 DAY：插入「半天」卡片（base.day + 0.5），按 day 排序、不重编号（保护小数/负数编号）
    const newDay = base.day + 0.5;
    const chart: GanttChart = {
      id: genId(), title: `DAY ${newDay}`, date: chartDateFor(newDay), day: newDay, collapsed: false,
      responsibilities, stages: [], lanes: [], cards: [], parts: [],
    };
    s.charts.push(chart);
    s.charts.sort((a, b) => a.day - b.day);
  } else {
    // 纯整数场景：插入完整一天并重编号 1..n
    const chart: GanttChart = {
      id: genId(), title: `DAY ${idx + 2}`, date: chartDateFor(idx + 2), day: idx + 2, collapsed: false,
      responsibilities, stages: [], lanes: [], cards: [], parts: [],
    };
    s.charts.splice(idx + 1, 0, chart);
    s.charts.forEach((c, i) => { c.day = i + 1; c.title = `DAY ${i + 1}`; });
  }
  save();
}
function deleteChart(chartId: string): void {
  const s = state.value; if (!s) return;
  if (!window.confirm("确认删除本天？")) return;
  s.charts = s.charts.filter((c) => c.id !== chartId);
  // 清除串件安排中指向被删 DAY 的执行阶段（变回未分配）
  (Array.isArray(s.spArrangements) ? s.spArrangements : []).forEach((a) => {
    a.rows.forEach((r) => { if (r.executeStage && r.executeStage.chartId === chartId) r.executeStage = null; });
  });
  // 存在小数/负数 DAY 时不重编号（避免破坏编号语义）
  if (!hasSpecialDays(s.charts)) s.charts.forEach((c, i) => { c.day = i + 1; c.title = `DAY ${i + 1}`; });
  save();
}
function toggleCollapse(chartId: string): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  c.collapsed = !c.collapsed;
  save();
}
/** DAY 编号输入校验：允许 0/负数/小数（0.5 等半天卡），仅拒绝非数字。 */
function normalizeDay(chart: GanttChart): void {
  if (!chart || typeof chart.day !== "number" || !Number.isFinite(chart.day)) chart.day = 0;
  save();
}
function addStage(chartId: string): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  c.stages.push({ id: genId(), name: `阶段${c.stages.length + 1}` });
  save();
}
function removeStage(chartId: string, idx: number): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  if (!window.confirm(`确认删除阶段“${c.stages[idx]?.name}”？`)) return;
  c.stages.splice(idx, 1);
  c.cards = c.cards.filter((card) => !(card.startStage === idx || card.endStage === idx)).map((card) => {
    if (card.startStage > idx) card.startStage--;
    if (card.endStage > idx) card.endStage--;
    return card;
  });
  // 全局串件安排：删除落在该阶段的分配，其后阶段索引前移
  getSpArrangements().forEach((a) => {
    a.rows.forEach((r) => {
      if (r.executeStage && r.executeStage.chartId === chartId) {
        if (r.executeStage.stageIdx === idx) r.executeStage = null;
        else if (r.executeStage.stageIdx > idx) r.executeStage.stageIdx--;
      }
    });
  });
  save();
}
function addCard(chartId: string, stageIdx: number): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  const maxOrder = c.cards.filter((x) => x.startStage === stageIdx).reduce((m, x) => Math.max(m, x.order ?? 0), -1);
  c.cards.push({ id: genId(), laneId: "", content: "", owner: "", participants: "", note: "", startStage: stageIdx, endStage: stageIdx, order: maxOrder + 1 });
  save();
}
function deleteCard(chartId: string, cardId: string): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  c.cards = c.cards.filter((x) => x.id !== cardId);
  save();
}
/** 阶段迁移到其它 DAY：整个阶段（名称 + 起始于该阶段的工序卡片 + 指向该阶段的串件分配）搬到目标 DAY 末尾；
 *  源 DAY 后续阶段索引/卡片/串件 stageIdx 前移；跨阶段卡片收缩 endStage。 */
function moveStageToChart(srcChartId: string, stageIdx: number, targetChartId: string): void {
  const s = state.value; if (!s || !targetChartId || targetChartId === srcChartId) return;
  const src = s.charts.find((x) => x.id === srcChartId); if (!src) return;
  const tgt = s.charts.find((x) => x.id === targetChartId); if (!tgt) return;
  if (stageIdx < 0 || stageIdx >= src.stages.length) return;
  const [stage] = src.stages.splice(stageIdx, 1);
  const newIdx = tgt.stages.length;
  tgt.stages.push(stage);
  const moved: GanttCard[] = [];
  src.cards.forEach((c) => {
    if (c.startStage === stageIdx) moved.push(c);
    else if (c.startStage > stageIdx) { c.startStage--; c.endStage--; }
    else if (c.endStage >= stageIdx) c.endStage = Math.min(c.endStage - 1, stageIdx - 1);
  });
  src.cards = src.cards.filter((c) => !moved.includes(c));
  moved.forEach((c) => { c.startStage = newIdx; c.endStage = newIdx; });
  tgt.cards.push(...moved);
  tgt.cards.filter((x) => x.startStage === newIdx).forEach((x, i) => { x.order = i; });
  // 串件分配：指向该阶段的迁到目标；指向源 DAY 后续阶段的 stageIdx 前移
  getSpArrangements().forEach((a) => a.rows.forEach((r) => {
    if (!r.executeStage || r.executeStage.chartId !== srcChartId) return;
    if (r.executeStage.stageIdx === stageIdx) r.executeStage = { chartId: targetChartId, stageIdx: newIdx };
    else if (r.executeStage.stageIdx > stageIdx) r.executeStage.stageIdx--;
  }));
  save();
}
/** 可迁移的目标 DAY 选项（排除当前 DAY）。 */
function dayOptionsExcluding(chartId: string): Array<{ id: string; label: string }> {
  const s = state.value; if (!s) return [];
  return s.charts.filter((c) => c.id !== chartId).map((c) => ({ id: c.id, label: `DAY ${c.day}${c.title ? " · " + c.title : ""}` }));
}
function addResp(chartId: string): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  c.responsibilities.push({ id: genId(), label: "", name: "" });
  save();
}
function removeResp(chartId: string, respId: string): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  c.responsibilities = c.responsibilities.filter((x) => x.id !== respId);
  save();
}
function cardsOfStage(chart: GanttChart, stageIdx: number): GanttCard[] {
  return chart.cards.filter((c) => c.startStage === stageIdx).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// —— 全局串件安排（跨 DAY 统筹，不再跟随 DAY 卡片） ——
function ensureSpArrangements(s: GanttPrepState): GanttSpArrangement[] {
  if (Array.isArray(s.spArrangements)) {
    // 幂等补新字段：拆/装行独立工卡号/名称（旧数据缺省时继承 arrangement 层旧值）
    s.spArrangements.forEach((a) => {
      a.rows.forEach((r) => {
        if (r.jc === undefined) r.jc = a.jc || "";
        if (r.name === undefined) r.name = a.name || "";
      });
    });
    return s.spArrangements;
  }
  // 一次性迁移旧数据：charts[].parts → spArrangements（parts 字段保留作兼容，UI 不再使用）
  const d = ensureDocs(s);
  const spList = d.sp as Array<Record<string, string>>;
  const arr: GanttSpArrangement[] = [];
  (s.charts || []).forEach((c) => {
    (c.parts || []).forEach((p) => {
      const ext = p.content ? spList.find((x) => x.content === p.content) : undefined;
      const jc0 = ext?.jc || "", name0 = ext?.name || "";
      const rows: GanttSpRow[] = [{
        id: genId(), tag: p.type === "串件" || p.type === "单拆" ? "拆" : p.type === "单装" ? "装" : "",
        owner: p.owner || "", participants: p.participants || "", note: p.note || "",
        jc: jc0, name: name0,
        executeStage: (typeof p.executeStage === "number" && p.executeStage >= 0) ? { chartId: c.id, stageIdx: p.executeStage } : null,
      }];
      if (p.type === "串件") rows.push({ id: genId(), tag: "装", owner: "", participants: "", note: "", jc: jc0, name: name0, executeStage: null });
      arr.push({ id: genId(), type: p.type || "串件", content: p.content || "", jc: jc0, name: name0, rows });
    });
  });
  s.spArrangements = arr;
  return arr;
}
function getSpArrangements(): GanttSpArrangement[] {
  const s = state.value; if (!s) return [];
  return Array.isArray(s.spArrangements) ? s.spArrangements : ensureSpArrangements(s);
}
function addSpArrangement(): void {
  const s = state.value; if (!s) return;
  const list = ensureSpArrangements(s);
  list.push({
    id: genId(), type: "串件", content: "", jc: "", name: "",
    rows: [
      { id: genId(), tag: "拆", owner: "", participants: "", note: "", jc: "", name: "", executeStage: null },
      { id: genId(), tag: "装", owner: "", participants: "", note: "", jc: "", name: "", executeStage: null },
    ],
  });
  save();
}
function removeSpArrangement(id: string): void {
  const s = state.value; if (!s) return;
  s.spArrangements = (Array.isArray(s.spArrangements) ? s.spArrangements : []).filter((a) => a.id !== id);
  save();
}
/** 类型切换：串件 → 补齐拆/装两行；其他类型 → 裁剪为一行（tag 按类型）。保留第一行数据。 */
function changeSpType(a: GanttSpArrangement, type: string): void {
  a.type = type;
  if (type === "串件") {
    if (!a.rows.length) a.rows.push({ id: genId(), tag: "拆", owner: "", participants: "", note: "", jc: "", name: "", executeStage: null });
    a.rows[0].tag = "拆";
    if (a.rows.length < 2) a.rows.push({ id: genId(), tag: "装", owner: "", participants: "", note: "", jc: "", name: "", executeStage: null });
    else a.rows[1].tag = "装";
  } else {
    if (a.rows.length > 1) a.rows = a.rows.slice(0, 1);
    if (a.rows[0]) a.rows[0].tag = type === "单拆" ? "拆" : type === "单装" ? "装" : "";
  }
  save();
}
/** 执行阶段下拉选项：跨所有 DAY 的阶段（DAY n · 阶段名）。 */
function allStageOptions(): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [];
  const s = state.value; if (!s) return opts;
  s.charts.forEach((c) => {
    c.stages.forEach((st, si) => opts.push({ value: `${c.id}::${si}`, label: `DAY ${c.day} · ${st.name || "阶段" + (si + 1)}` }));
  });
  return opts;
}
/** 某 DAY 某阶段的串件行（展示用）。 */
function spRowsOfStage(chartId: string, stageIdx: number): Array<{ arr: GanttSpArrangement; row: GanttSpRow }> {
  return getSpArrangements().flatMap((arr) =>
    arr.rows.map((row) => ({ arr, row })).filter((x) => x.row.executeStage && x.row.executeStage.chartId === chartId && x.row.executeStage.stageIdx === stageIdx));
}
/** 所有未分配执行阶段的串件行（甘特图 DAY 卡片未分配区展示 + 拖拽分配）。 */
function unassignedSpRows(): Array<{ arr: GanttSpArrangement; row: GanttSpRow }> {
  return getSpArrangements().flatMap((arr) =>
    arr.rows.map((row) => ({ arr, row })).filter((x) => !x.row.executeStage));
}
/** 清除某串件行的执行阶段（阶段中串件卡片 X：删除原分配的阶段，不删记录）。 */
function clearSpStage(arrId: string, rowId: string): void {
  const s = state.value; if (!s) return;
  const arr = (Array.isArray(s.spArrangements) ? s.spArrangements : []).find((a) => a.id === arrId);
  const row = arr?.rows.find((r) => r.id === rowId);
  if (row) { row.executeStage = null; save(); }
}
/** 设置某串件行的执行阶段（下拉 "chartId::stageIdx" 或空 = 未分配）。 */
function setSpRowStage(row: GanttSpRow, value: string): void {
  if (!value) row.executeStage = null;
  else { const [chartId, si] = value.split("::"); row.executeStage = { chartId, stageIdx: Number(si) }; }
  save();
}
/** 某 DAY 已分配的串件行（甘特图阶段列渲染）。 */
function spCardsOfChart(chart: GanttChart): Array<{ arr: GanttSpArrangement; row: GanttSpRow; stageIdx: number }> {
  return getSpArrangements().flatMap((arr) =>
    arr.rows.map((row) => ({ arr, row })).filter((x) => x.row.executeStage && x.row.executeStage.chartId === chart.id)
      .map((x) => ({ arr: x.arr, row: x.row, stageIdx: x.row.executeStage!.stageIdx })));
}

// —— 飞机信息 / 项目安排 / 部件 CRUD ——
function addAircraft(): void {
  const m = meta.value; if (!m) return;
  (m.aircrafts as MetaAircraft[]).push({ id: genId(), reg: "", fsn: "", msn: "", engine: "", type: "", etops: "", eltDt: "" });
  save();
}
// 机号输入后查询回填（套用 A检 飞机信息模块：本地优先/远程公开接口兜底，库中无机号弹「更新机型标准库」）
async function onAircraftRegChange(a: MetaAircraft): Promise<void> {
  const reg = props.store.normalizeAircraftReg(a.reg);
  if (!reg) return;
  a.reg = reg;
  const match = await props.store.fetchAircraftInfo(reg);
  if (match) {
    a.fsn = String(match["FSN"] || "");
    a.msn = String(match["MSN"] || "");
    a.engine = String(match["发动机"] || "");
    a.type = String(match["机型"] || "");
    a.etops = String(match["ETOPS"] || "");
    a.eltDt = String(match["ELT-DT"] || "");
    save();
  } else {
    props.store.openAircraftUpdate({ 机号: reg, FSN: a.fsn, MSN: a.msn, 机型: a.type, 发动机: a.engine, ETOPS: a.etops, "ELT-DT": a.eltDt });
  }
}
// 机型字段编辑差异检测（FSN/MSN/机型/发动机/ETOPS/ELT-DT 任一与标准库不同 → 弹「更新机型标准库」）
function onAircraftFieldEdited(a: MetaAircraft): void {
  props.store.maybePromptAircraftDiff({ 机号: a.reg, FSN: a.fsn, MSN: a.msn, 机型: a.type, 发动机: a.engine, ETOPS: a.etops, "ELT-DT": a.eltDt });
}
function removeAircraft(id: string): void {
  const m = meta.value; if (!m) return;
  m.aircrafts = (m.aircrafts as MetaAircraft[]).filter((a) => a.id !== id);
  save();
}
function addComponent(): void {
  const m = meta.value; if (!m) return;
  (m.components as MetaComponent[]).push({ id: genId(), name: "", offPn: "", offSn: "", onPn: "", onSn: "" });
  save();
}
function removeComponent(id: string): void {
  const m = meta.value; if (!m) return;
  m.components = (m.components as MetaComponent[]).filter((c) => c.id !== id);
  save();
}
function addArrangementItem(): void {
  const a = arrangement.value; if (!a) return;
  (a.items as MetaArrangementItem[]).push({ id: genId(), content: "", assign: "" });
  save();
}
function removeArrangementItem(id: string): void {
  const a = arrangement.value; if (!a) return;
  a.items = (a.items as MetaArrangementItem[]).filter((x) => x.id !== id);
  save();
}

// —— 手册清单 ——
function ensureDocs(s: GanttPrepState) {
  if (!s.docs || typeof s.docs !== "object") s.docs = { wp: [], eng: [], sp: [] };
  return s.docs;
}
function addDoc(list: "wp" | "eng" | "sp"): void {
  const s = state.value; if (!s) return;
  const d = ensureDocs(s);
  d[list].push(list === "sp" ? { id: genId(), type: "串件", content: "", jc: "", name: "" } : { jc: "", name: "" });
  save();
}
function removeDoc(list: "wp" | "eng" | "sp", idx: number): void {
  const s = state.value; if (!s) return;
  ensureDocs(s)[list].splice(idx, 1);
  save();
}

// 依据工卡清单：B列(索引1)含 JC 为工卡号；SMJC/ZBJC 读 E列(4)，其他 JC 读 G列(6) 为名称(取 ## 前)
function parseWorkDocRows(rows: unknown[][]): number {
  const s = state.value; if (!s) return 0;
  const d = ensureDocs(s);
  let wp = 0;
  rows.forEach((row) => {
    const jc = String(row[1] || "").replace(/\s+/g, "");
    if (!/JC/.test(jc)) return;
    let name = /^(SMJC|ZBJC)/.test(jc) ? String(row[4] || "") : String(row[6] || "");
    name = name.split("##")[0].trim();
    if (!name) return;
    (d.wp as Array<Record<string, string>>).push({ jc, name });
    wp++;
  });
  return wp;
}
async function importWorkDocList(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
    const wp = parseWorkDocRows(rows);
    save();
    props.store.notify(`工卡清单导入完成：工包 ${wp} 条`, "ok");
  } catch (err) {
    props.store.notify(err instanceof Error ? err.message : "解析失败", "err");
  }
}

// —— 串件航材 / 工具清单 ——
function ensurePartLists(s: GanttPrepState) {
  if (!Array.isArray(s.airParts)) s.airParts = [];
  if (!Array.isArray(s.toolParts)) s.toolParts = [];
}
// 串件内容候选（卡片名联想：来自串件安排 content）
const partContentSuggestions = computed<string[]>(() => {
  const set = new Set<string>();
  getSpArrangements().forEach((a) => { if (a.content) set.add(a.content); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
});
// 把串件安排内容同步成串件清单卡片（该内容尚无卡片时补一张空卡片）
function syncPartCardsFromCharts(kind: "airParts" | "toolParts"): void {
  const s = state.value; if (!s) return;
  ensurePartLists(s);
  const list = s[kind] as GanttPartList[];
  const seen = new Set(list.map((x) => x.name));
  getSpArrangements().forEach((a) => {
    if (a.content && !seen.has(a.content)) { list.push({ id: genId(), name: a.content, items: [] }); seen.add(a.content); }
  });
}
function addPartList(kind: "airParts" | "toolParts"): void {
  const s = state.value; if (!s) return;
  ensurePartLists(s);
  (s[kind] as GanttPartList[]).unshift({ id: genId(), name: "新卡片", items: [] });
  save();
}
function removePartList(kind: "airParts" | "toolParts", id: string): void {
  const s = state.value; if (!s) return;
  (s[kind] as GanttPartList[]) = (s[kind] as GanttPartList[]).filter((c) => c.id !== id);
  save();
}
function addPartItem(kind: "airParts" | "toolParts", listId: string): void {
  const s = state.value; if (!s) return;
  const list = (s[kind] as GanttPartList[]).find((c) => c.id === listId); if (!list) return;
  list.items.push({ id: genId(), name: "", qty: 1 });
  save();
}
function removePartItem(kind: "airParts" | "toolParts", listId: string, itemId: string): void {
  const s = state.value; if (!s) return;
  const list = (s[kind] as GanttPartList[]).find((c) => c.id === listId); if (!list) return;
  list.items = list.items.filter((x) => x.id !== itemId);
  save();
}
// 航材/工具「+ 新增卡片」splitbutton：下拉含「清空清单(danger)」（对齐 A检 清空清单）
const partClearOpen = ref(false);
// 手册清单 换发/串件工卡 splitbutton 下拉状态
const engImportOpen = ref(false);
const spImportOpen = ref(false);
// 甘特阶段表头 split button 下拉（key=chartId:si，"+工序"主按钮，下拉=移DAY/+插/删除）
const stageMenuOpen = ref<string | null>(null);
function toggleStageMenu(chartId: string, si: number): void {
  const key = `${chartId}:${si}`;
  stageMenuOpen.value = stageMenuOpen.value === key ? null : key;
}
function onDocClick(): void { partClearOpen.value = false; engImportOpen.value = false; spImportOpen.value = false; stageMenuOpen.value = null; }
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));
function clearPartList(kind: "airParts" | "toolParts"): void {
  const s = state.value; if (!s) return;
  if (!window.confirm(`确认清空全部${kind === "airParts" ? "航材" : "工具"}卡片？`)) return;
  s[kind] = [];
  partClearOpen.value = false;
  save();
}
// 清空整个项目数据（含甘特准备单与模板引用），对齐 A检 top-row 的清空数据
function clearGanttAll(): void {
  if (!window.confirm("确认清空本项目的全部数据（含甘特准备单与模板引用）？此操作不可撤销。")) return;
  props.store.clearProjectAllData();
}
// 进入串件 tab 时，把表单串件内容同步成卡片，并重置搜索、撑高物品输入栏
function onPartTabEnter(): void {
  syncPartCardsFromCharts(partKind.value);
  partSearch.value = "";
  // 备注已为常显列，无需自动展开逻辑
  autoSizeAllParts();
}
// ===== 清单卡片搜索（AutoComplete：卡片名/件号/名称候选）+ 卡片折叠 =====
const partSearch = ref("");
const partSuggestOpen = ref(false);
const partSuggestOptions = computed<Array<{ label: string; kind: "card" | "pn" | "name" }>>(() => {
  const s = state.value; if (!s) return [];
  const list = tab.value === "airparts" ? s.airParts : s.toolParts;
  const opts: Array<{ label: string; kind: "card" | "pn" | "name" }> = [];
  const seen = new Set<string>();
  list.forEach((c) => {
    const cn = (c.name || "").trim();
    if (cn && !seen.has("card:" + cn)) { seen.add("card:" + cn); opts.push({ label: cn, kind: "card" }); }
    (c.items || []).forEach((it) => {
      const pn = String(it.pn || "").trim();
      if (pn && !seen.has("pn:" + pn)) { seen.add("pn:" + pn); opts.push({ label: pn, kind: "pn" }); }
      const nm = String(it.name || "").trim();
      if (nm && !seen.has("name:" + nm)) { seen.add("name:" + nm); opts.push({ label: nm, kind: "name" }); }
    });
  });
  return opts;
});
const partSuggestFiltered = computed(() => {
  const q = partSearch.value.trim().toLowerCase();
  const all = partSuggestOptions.value;
  if (!q) return all.slice(0, 40);
  return all.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 40);
});
function selectPartSuggest(opt: { label: string; kind: string }): void {
  partSearch.value = opt.label;
  partSuggestOpen.value = false;
}
const visiblePartCards = computed<GanttPartList[]>(() => {
  const s = state.value; if (!s) return [];
  const all = tab.value === "airparts" ? s.airParts : s.toolParts;
  const q = partSearch.value.trim().toLowerCase();
  if (!q) return all;
  return all.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    (c.items || []).some((it) =>
      String(it.pn || "").toLowerCase().includes(q) || String(it.name || "").toLowerCase().includes(q)
    )
  );
});
// 卡片折叠（默认展开）
const collapsedCards = ref<Set<string>>(new Set());
function toggleCardCollapse(id: string): void {
  const s = new Set(collapsedCards.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  collapsedCards.value = s;
}
// ===== 物品卡片输入栏自动撑高（参考 A检 m-item onAutoSize） =====
function onPartAutoSize(event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  save();
}
function autoSizeAllParts(): void {
  nextTick(() => {
    document.querySelectorAll<HTMLTextAreaElement>(".pt-card .itg textarea").forEach((el) => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
  });
}
// ===== 卡片自动浅色配色：蓝-橙-绿-土黄-灰 循环（按卡片在完整清单中的索引取色，筛选后颜色不漂移） =====
const PART_CARD_PALETTE = ["#4472C4", "#ED7D31", "#548235", "#C9A227", "#7F7F7F"];
function partCardColorOf(card: GanttPartList): string {
  const s = state.value; if (!s) return PART_CARD_PALETTE[0];
  const list = tab.value === "airparts" ? s.airParts : s.toolParts;
  const idx = list.findIndex((c) => c.id === card.id);
  return PART_CARD_PALETTE[(idx < 0 ? 0 : idx) % PART_CARD_PALETTE.length];
}
function partCardHeadOf(card: GanttPartList): string { return partCardColorOf(card) + "80"; } // 50% 透明度
function partCardBgOf(card: GanttPartList): string { return partCardColorOf(card) + "33"; }  // 20% 透明度
// 串件航材/工具清单「重复梳理」（对齐 A检 重复航材梳理）：航材按件号、工具按名称分组聚拢，重复 ≥2 归入重复组、单件归入单件组；卡片内数量/备注可编辑、可删除。
// 开关按清单类型分开记忆：串件航材与串件工具互不联动。
const dedupeOpen = ref<Record<"airParts" | "toolParts", boolean>>({ airParts: false, toolParts: false });
interface PartDedupeRow { card: GanttPartList; item: GanttPartListItem }
interface PartDedupeGroup { key: string; label: string; name: string; rows: PartDedupeRow[] }
function partDedupeKeyOf(it: GanttPartListItem): string {
  return tab.value === "airparts" ? String(it.pn || "").trim() : String(it.name || "").trim();
}
function partDedupeLabelOf(it: GanttPartListItem): string {
  return tab.value === "airparts" ? String(it.pn || "").trim() || String(it.name || "").trim() : String(it.name || "").trim();
}
const partDedupeGroups = computed<PartDedupeGroup[]>(() => {
  const map = new Map<string, PartDedupeGroup>();
  const list = (tab.value === "airparts" ? state.value?.airParts : state.value?.toolParts) || [];
  list.forEach((card) => {
    (card.items || []).forEach((it) => {
      const key = partDedupeKeyOf(it) || `__no__${it.id}`; // 无件号/名称：每件独立一组
      let g = map.get(key);
      if (!g) { g = { key, label: partDedupeLabelOf(it) || "（空）", name: it.name || "", rows: [] }; map.set(key, g); }
      if (!g.name && it.name) g.name = it.name;
      g.rows.push({ card, item: it });
    });
  });
  return [...map.values()].sort((a, b) => (a.label === "（空）" ? 1 : b.label === "（空）" ? -1 : a.label.localeCompare(b.label, "zh-CN")));
});
const partDuplicates = computed(() => partDedupeGroups.value.filter((g) => g.rows.length >= 2));
const partSingles = computed(() => partDedupeGroups.value.filter((g) => g.rows.length === 1));

// —— 模板加载 ——
const showTplModal = ref(false);
const tplMode = ref<"load" | "save">("load");
const templates = ref<Array<{ _id: string; id: string; name: string; savedAt: string; state: GanttPrepState }>>([]);
const templatesLoading = ref(false);
const saveTplInputRef = ref<HTMLInputElement | null>(null);
const tplQuery = ref("");
/** 模板弹窗模糊过滤（按名称，大小写不敏感）。 */
const filteredTemplates = computed(() => {
  const q = tplQuery.value.trim().toLowerCase();
  if (!q) return templates.value;
  return templates.value.filter((t) => String(t.name || "").toLowerCase().includes(q));
});
async function openTplModal(mode: "load" | "save" = tplMode.value): Promise<void> {
  tplMode.value = mode;
  showTplModal.value = true;
  tplQuery.value = "";
  templatesLoading.value = true;
  try {
    const res = await backend.listEngTemplates();
    templates.value = (Array.isArray(res.data) ? res.data : []).slice().sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板加载失败", "err");
  } finally {
    templatesLoading.value = false;
    if (mode === "save") nextTick(() => saveTplInputRef.value?.focus());
  }
}
function applyTemplate(t: { name: string; state: GanttPrepState }): void {
  if (!state.value) return;
  if (!window.confirm(`确认加载模板“${t.name}”？将覆盖当前甘特准备单内容。`)) return;
  props.store.applyGanttTemplate(t.state, t.name);
  showTplModal.value = false;
  props.store.notify(`已加载模板：${t.name}`, "ok");
}

// ===== 拖拽交互（对照 gantt-web 迁移） =====
function clamp(v: number, mn: number, mx: number): number {
  return Math.max(mn, Math.min(mx, v));
}
function findChart(chartId: string): GanttChart | null {
  return state.value?.charts.find((c) => c.id === chartId) ?? null;
}
function maxRowOf(chart: GanttChart): number {
  return Object.values(computeRows(chart)).reduce((m, r) => Math.max(m, r), 0);
}
function rowCountOf(chart: GanttChart): number {
  return Math.max(1, maxRowOf(chart) + 1);
}
function syncLanes(chart: GanttChart): void {
  if (!Array.isArray(chart.lanes)) chart.lanes = [];
  const need = Math.max(1, maxRowOf(chart) + 1);
  while (chart.lanes.length < need) chart.lanes.push({ id: genId(), name: `并列${chart.lanes.length + 1}` });
  while (chart.lanes.length > need) chart.lanes.pop();
}
// 把 card 插入到目标 order，其余卡片顺移，并同步并列行数
function setCardOrder(chart: GanttChart, card: GanttCard, newOrder: number): void {
  const others = chart.cards.filter((c) => c.id !== card.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  card.order = newOrder;
  const idx = clamp(newOrder, 0, others.length);
  others.splice(idx, 0, card);
  others.forEach((c, i) => { c.order = i; });
  chart.cards = others;
  syncLanes(chart);
}
// 阶段列换序：把 fromIdx 移到 toIdx，重映射卡片 start/end 与串件 executeStage
function moveStage(chartId: string, fromIdx: number, toIdx: number): void {
  const chart = findChart(chartId); if (!chart) return;
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= chart.stages.length || toIdx >= chart.stages.length) return;
  const [moved] = chart.stages.splice(fromIdx, 1);
  chart.stages.splice(toIdx, 0, moved);
  const remap = (idx: number): number => {
    if (idx === fromIdx) return toIdx;
    if (fromIdx < toIdx) { if (idx > fromIdx && idx <= toIdx) return idx - 1; }
    else { if (idx >= toIdx && idx < fromIdx) return idx + 1; }
    return idx;
  };
  chart.cards.forEach((c) => {
    c.startStage = remap(c.startStage);
    c.endStage = remap(c.endStage);
    if (c.startStage > c.endStage) { const t = c.startStage; c.startStage = c.endStage; c.endStage = t; }
  });
  // 全局串件安排中该 DAY 的行同步重映射阶段
  getSpArrangements().forEach((a) => {
    a.rows.forEach((r) => {
      if (r.executeStage && r.executeStage.chartId === chartId) r.executeStage.stageIdx = remap(r.executeStage.stageIdx);
    });
  });
}

// —— 拖拽目标位置占位虚线框（fixed 定位，拖拽时预览松手落点） ——
const dragGhost = ref<{ left: number; top: number; width: number; height: number } | null>(null);
function clearDragGhost(): void { dragGhost.value = null; }

// —— 工序卡片拖曳（move 横移改阶段/纵移调行序；resize-left/right 改起止阶段） ——
interface CardDrag { mode: "move" | "resize-left" | "resize-right"; chartId: string; cardId: string; el: HTMLElement; startX: number; startY: number; n: number; colW: number; rowH: number; headerH: number; gridEl: HTMLElement | null; origStart: number; origEnd: number; origOrder: number; curStart: number; curEnd: number; curOrder: number }
let cardDrag: CardDrag | null = null;
function onCardDragMove(e: PointerEvent): void {
  if (!cardDrag) return;
  const d = cardDrag;
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  const ds = Math.round(dx / d.colW);
  const dr = Math.round(dy / d.rowH);
  const L = d.origEnd - d.origStart;
  if (d.mode === "move") {
    d.curStart = clamp(d.origStart + ds, 0, d.n - 1 - L);
    d.curEnd = d.curStart + L;
    d.curOrder = Math.max(0, d.origOrder + dr);
  } else if (d.mode === "resize-left") {
    d.curStart = clamp(d.origStart + ds, 0, d.origEnd);
    d.curEnd = d.origEnd;
  } else {
    d.curEnd = clamp(d.origEnd + ds, d.origStart, d.n - 1);
    d.curStart = d.origStart;
  }
  const chart = findChart(d.chartId);
  if (d.mode === "move") {
    d.el.style.transform = `translate(${ds * d.colW}px, ${dr * d.rowH}px)`;
    d.el.title = `目标: 阶段「${chart?.stages[d.curStart]?.name ?? ""}」→「${chart?.stages[d.curEnd]?.name ?? ""}」 行 ${d.curOrder + 1}`;
    // 占位虚线框：目标网格单元格（阶段跨度 × 行）
    if (d.gridEl) {
      const r = d.gridEl.getBoundingClientRect();
      dragGhost.value = {
        left: r.left + d.curStart * d.colW,
        top: r.top + d.headerH + d.curOrder * d.rowH,
        width: (d.curEnd - d.curStart + 1) * d.colW - 4,
        height: Math.max(24, d.rowH - 4),
      };
    }
  } else {
    d.el.style.transform = "";
    const slot = d.el.closest(".card-slot") as HTMLElement | null;
    if (slot) slot.style.gridColumn = `${d.curStart + 1} / ${d.curEnd + 2}`;
    d.el.title = `调整: 起始「${chart?.stages[d.curStart]?.name ?? ""}」→ 结束「${chart?.stages[d.curEnd]?.name ?? ""}」`;
    clearDragGhost();
  }
}
function onCardDragEnd(): void {
  if (cardDrag) {
    const d = cardDrag;
    const chart = findChart(d.chartId);
    const card = chart?.cards.find((c) => c.id === d.cardId);
    if (chart && card) {
      card.startStage = d.curStart;
      card.endStage = d.curEnd;
      if (d.mode === "move") setCardOrder(chart, card, d.curOrder);
      else syncLanes(chart);
    }
    d.el.style.opacity = "";
    d.el.style.zIndex = "";
    d.el.style.transform = "";
    save();
  }
  clearDragGhost();
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onCardDragMove);
  window.removeEventListener("pointerup", onCardDragEnd);
  cardDrag = null;
}
function startCardDrag(e: PointerEvent, mode: "move" | "resize-left" | "resize-right", chartId: string, cardId: string): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const card = chart.cards.find((c) => c.id === cardId); if (!card) return;
  const el = (e.currentTarget as HTMLElement).closest(".gantt-card") as HTMLElement;
  const n = chart.stages.length;
  const grid = el.closest(".gantt-grid") as HTMLElement | null;
  const colW = grid ? grid.getBoundingClientRect().width / n : 160;
  const rowH = el.offsetHeight || 88;
  const headEl = grid?.querySelector(".gantt-head") as HTMLElement | null;
  const headerH = headEl ? headEl.offsetHeight + 6 : 50;
  cardDrag = { mode, chartId, cardId, el, startX: e.clientX, startY: e.clientY, n, colW, rowH, headerH, gridEl: grid, origStart: card.startStage, origEnd: card.endStage, origOrder: card.order ?? 0, curStart: card.startStage, curEnd: card.endStage, curOrder: card.order ?? 0 };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onCardDragMove);
  window.addEventListener("pointerup", onCardDragEnd);
}

// —— 串件卡片拖曳（已分配串件：同 DAY 内换阶段） ——
function findSpRow(arrId: string, rowId: string): GanttSpRow | null {
  const s = state.value; if (!s) return null;
  const arr = (Array.isArray(s.spArrangements) ? s.spArrangements : []).find((a) => a.id === arrId);
  return arr?.rows.find((r) => r.id === rowId) || null;
}
interface PartDrag { chartId: string; arrId: string; rowId: string; el: HTMLElement; startX: number; n: number; colW: number; origStage: number; curStage: number }
let partDrag: PartDrag | null = null;
function onPartDragMove(e: PointerEvent): void {
  if (!partDrag) return;
  const d = partDrag;
  const ds = Math.round((e.clientX - d.startX) / d.colW);
  const chart = findChart(d.chartId);
  d.curStage = clamp(d.origStage + ds, 0, d.n - 1);
  d.el.style.transform = `translate(${ds * d.colW}px, 0px)`;
  d.el.title = `阶段「${chart?.stages[d.curStage]?.name ?? ""}」`;
}
function onPartDragEnd(): void {
  if (partDrag) {
    const d = partDrag;
    const row = findSpRow(d.arrId, d.rowId);
    if (row && row.executeStage && row.executeStage.chartId === d.chartId) {
      row.executeStage.stageIdx = d.curStage;
    }
    d.el.style.opacity = "";
    d.el.style.zIndex = "";
    d.el.style.transform = "";
    save();
  }
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onPartDragMove);
  window.removeEventListener("pointerup", onPartDragEnd);
  partDrag = null;
}
function startPartDrag(e: PointerEvent, chartId: string, arrId: string, rowId: string): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const row = findSpRow(arrId, rowId); if (!row || !row.executeStage || row.executeStage.chartId !== chartId) return;
  const el = (e.currentTarget as HTMLElement).closest(".gantt-card") as HTMLElement;
  const n = chart.stages.length;
  const grid = el.closest(".gantt-grid") as HTMLElement | null;
  const colW = grid ? grid.getBoundingClientRect().width / n : 160;
  const origStage = row.executeStage.stageIdx;
  partDrag = { chartId, arrId, rowId, el, startX: e.clientX, n, colW, origStage, curStage: origStage };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onPartDragMove);
  window.addEventListener("pointerup", onPartDragEnd);
}

// —— 未分配串件拖到甘特图阶段列（分配 chartId + stageIdx） ——
let unassignedDrag: { chartId: string; arrId: string; rowId: string; el: HTMLElement; n: number; over: boolean; targetStage: number; grid: HTMLElement | null } | null = null;
function onUnassignedDragMove(e: PointerEvent): void {
  if (!unassignedDrag) return;
  const d = unassignedDrag;
  if (!d.grid) return;
  const rect = d.grid.getBoundingClientRect();
  const colW = rect.width / d.n;
  const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  d.over = over;
  d.targetStage = over ? clamp(Math.floor((e.clientX - rect.left) / colW), 0, d.n - 1) : -1;
  d.el.style.opacity = over ? "0.7" : "1";
}
function onUnassignedDragEnd(): void {
  if (unassignedDrag) {
    const d = unassignedDrag;
    const row = findSpRow(d.arrId, d.rowId);
    if (row && d.over && d.targetStage >= 0) {
      row.executeStage = { chartId: d.chartId, stageIdx: d.targetStage };
    }
    d.el.style.opacity = "";
    save();
  }
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onUnassignedDragMove);
  window.removeEventListener("pointerup", onUnassignedDragEnd);
  unassignedDrag = null;
}
function startUnassignedDrag(e: PointerEvent, chartId: string, arrId: string, rowId: string): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const row = findSpRow(arrId, rowId); if (!row) return;
  const el = (e.currentTarget as HTMLElement).closest(".gantt-card") as HTMLElement;
  const grid = el.closest(".gp-card")?.querySelector(".gantt-grid") as HTMLElement | null;
  unassignedDrag = { chartId, arrId, rowId, el, n: chart.stages.length, over: false, targetStage: -1, grid };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onUnassignedDragMove);
  window.addEventListener("pointerup", onUnassignedDragEnd);
}

// —— 阶段列头拖曳换序 ——
let stageColDrag: { chartId: string; idx: number; el: HTMLElement; startX: number; colW: number; n: number; target: number; gridEl: HTMLElement | null } | null = null;
function onStageColDragMove(e: PointerEvent): void {
  if (!stageColDrag) return;
  const d = stageColDrag;
  const ds = Math.round((e.clientX - d.startX) / d.colW);
  d.target = clamp(d.idx + ds, 0, d.n - 1);
  d.el.style.transform = `translateX(${ds * d.colW}px)`;
  // 占位虚线框：目标整列（含表头，工序卡片一起移动）
  if (d.gridEl) {
    const r = d.gridEl.getBoundingClientRect();
    dragGhost.value = { left: r.left + d.target * d.colW, top: r.top, width: d.colW - 4, height: r.height };
  }
}
function onStageColDragEnd(): void {
  if (stageColDrag) {
    const d = stageColDrag;
    d.el.style.opacity = "";
    d.el.style.zIndex = "";
    d.el.style.transform = "";
    if (d.target !== d.idx) { moveStage(d.chartId, d.idx, d.target); save(); }
  }
  clearDragGhost();
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onStageColDragMove);
  window.removeEventListener("pointerup", onStageColDragEnd);
  stageColDrag = null;
}
function startStageColDrag(e: PointerEvent, chartId: string, idx: number): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const el = (e.currentTarget as HTMLElement).closest(".gantt-head") as HTMLElement;
  const grid = el.closest(".gantt-grid") as HTMLElement | null;
  const colW = grid ? grid.getBoundingClientRect().width / chart.stages.length : 160;
  stageColDrag = { chartId, idx, el, startX: e.clientX, colW, n: chart.stages.length, target: idx, gridEl: grid };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onStageColDragMove);
  window.addEventListener("pointerup", onStageColDragEnd);
}

// —— 指定位置插入阶段（在 idx 前插入） ——
function insertStage(chartId: string, idx: number): void {
  const chart = findChart(chartId); if (!chart) return;
  chart.stages.splice(idx, 0, { id: genId(), name: "新阶段" });
  chart.cards.forEach((c) => {
    if (c.startStage >= idx) c.startStage++;
    if (c.endStage >= idx) c.endStage++;
  });
  getSpArrangements().forEach((a) => {
    a.rows.forEach((r) => {
      if (r.executeStage && r.executeStage.chartId === chartId && r.executeStage.stageIdx >= idx) r.executeStage.stageIdx++;
    });
  });
  save();
}

// —— 表单工序卡片纵移调行序 ——
let formCardDrag: { chartId: string; cardId: string; el: HTMLElement; startY: number; rowH: number; origOrder: number; curOrder: number } | null = null;
function onFormCardDragMove(e: PointerEvent): void {
  if (!formCardDrag) return;
  const d = formCardDrag;
  const dr = Math.round((e.clientY - d.startY) / d.rowH);
  d.curOrder = Math.max(0, d.origOrder + dr);
  d.el.style.transform = `translateY(${dr * d.rowH}px)`;
  // 占位虚线框：目标行位置（排除自身后，第 curOrder 个之前）
  const container = d.el.parentElement;
  if (container) {
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".form-card-row")).filter((r) => r !== d.el);
    const r0 = d.el.getBoundingClientRect();
    let top: number;
    if (d.curOrder >= rows.length) {
      top = rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom + 3 : r0.top;
    } else {
      top = rows[d.curOrder].getBoundingClientRect().top;
    }
    dragGhost.value = { left: r0.left, top, width: r0.width, height: r0.height };
  }
}
function onFormCardDragEnd(): void {
  if (formCardDrag) {
    const chart = findChart(formCardDrag.chartId);
    const card = chart?.cards.find((c) => c.id === formCardDrag!.cardId);
    if (chart && card) setCardOrder(chart, card, formCardDrag.curOrder);
    formCardDrag.el.style.opacity = "";
    formCardDrag.el.style.transform = "";
    formCardDrag.el.style.zIndex = "";
    save();
  }
  clearDragGhost();
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onFormCardDragMove);
  window.removeEventListener("pointerup", onFormCardDragEnd);
  formCardDrag = null;
}
function startFormCardDrag(e: PointerEvent, chartId: string, cardId: string): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const card = chart.cards.find((c) => c.id === cardId); if (!card) return;
  const el = (e.currentTarget as HTMLElement).closest(".form-card-row") as HTMLElement;
  const rowH = el.offsetHeight || 52;
  formCardDrag = { chartId, cardId, el, startY: e.clientY, rowH, origOrder: card.order ?? 0, curOrder: card.order ?? 0 };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onFormCardDragMove);
  window.addEventListener("pointerup", onFormCardDragEnd);
}

// —— 表单阶段卡片纵移换序 ——
let formStageDrag: { chartId: string; idx: number; el: HTMLElement; startY: number; itemH: number; target: number } | null = null;
function onFormStageDragMove(e: PointerEvent): void {
  if (!formStageDrag) return;
  const chart = findChart(formStageDrag.chartId);
  const dr = Math.round((e.clientY - formStageDrag.startY) / formStageDrag.itemH);
  formStageDrag.target = clamp(formStageDrag.idx + dr, 0, (chart?.stages.length ?? 1) - 1);
  formStageDrag.el.style.transform = `translateY(${dr * formStageDrag.itemH}px)`;
}
function onFormStageDragEnd(): void {
  if (formStageDrag) {
    const d = formStageDrag;
    d.el.style.opacity = "";
    d.el.style.transform = "";
    d.el.style.zIndex = "";
    if (d.target !== d.idx) { moveStage(d.chartId, d.idx, d.target); save(); }
  }
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onFormStageDragMove);
  window.removeEventListener("pointerup", onFormStageDragEnd);
  formStageDrag = null;
}
function startFormStageDrag(e: PointerEvent, chartId: string, idx: number): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const el = (e.currentTarget as HTMLElement).closest(".form-stage-card") as HTMLElement;
  const itemH = el.offsetHeight || 140;
  formStageDrag = { chartId, idx, el, startY: e.clientY, itemH, target: idx };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onFormStageDragMove);
  window.addEventListener("pointerup", onFormStageDragEnd);
}

// —— 阶段数增减拖拽（甘特图右缘拖拽） ——
let stageDrag: { chartId: string; el: HTMLElement; startX: number; stageWidth: number; origN: number; newN: number } | null = null;
function onStageDragMove(e: PointerEvent): void {
  if (!stageDrag) return;
  const delta = Math.round((e.clientX - stageDrag.startX) / stageDrag.stageWidth);
  stageDrag.newN = Math.max(1, stageDrag.origN + delta);
  stageDrag.el.title = `松开后调整为 ${stageDrag.newN} 个阶段`;
}
function onStageDragEnd(): void {
  if (stageDrag && stageDrag.newN !== stageDrag.origN) {
    const chart = findChart(stageDrag.chartId);
    if (chart) {
      const diff = stageDrag.newN - stageDrag.origN;
      if (diff > 0) { for (let i = 0; i < diff; i++) chart.stages.push({ id: genId(), name: "新阶段" }); }
      else { for (let i = 0; i < -diff; i++) removeStageInner(chart, chart.stages.length - 1); }
      save();
    }
  }
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onStageDragMove);
  window.removeEventListener("pointerup", onStageDragEnd);
  stageDrag = null;
}
function startStageDrag(e: PointerEvent, chartId: string): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const el = e.currentTarget as HTMLElement;
  const grid = el.closest(".gantt-grid") as HTMLElement | null;
  const n = chart.stages.length;
  const stageWidth = grid ? grid.getBoundingClientRect().width / Math.max(1, n) : 120;
  stageDrag = { chartId, el, startX: e.clientX, stageWidth, origN: n, newN: n };
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onStageDragMove);
  window.addEventListener("pointerup", onStageDragEnd);
}
function removeStageInner(chart: GanttChart, idx: number): void {
  chart.stages.splice(idx, 1);
  chart.cards = chart.cards.filter((c) => !(c.startStage === idx && c.endStage === idx)).map((c) => {
    if (c.startStage > idx) c.startStage--;
    if (c.endStage > idx) c.endStage--;
    return c;
  });
  chart.parts = chart.parts.filter((p) => p.executeStage !== idx).map((p) => {
    if (typeof p.executeStage === "number" && p.executeStage > idx) p.executeStage--;
    return p;
  });
}

// ===== 新增 DAY 自动推算日期 =====
function nextDate(): string {
  const charts = state.value?.charts || [];
  const last = charts[charts.length - 1];
  if (!last || !last.date || last.date.length < 8) return new Date().toISOString().slice(0, 10);
  const d = new Date(last.date + "T00:00:00");
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
// ===== 保存当前数据为模板 =====
const saveTplName = ref("");
/** 模板数据剥离人名（工序/串件/安排 的负责人参与人、安排姓名、手动名单），模板库不残留人员信息。 */
function stripNamesForTemplate(s: GanttPrepState): GanttPrepState {
  const t = JSON.parse(JSON.stringify(s)) as GanttPrepState;
  for (const ch of t.charts) {
    for (const c of ch.cards) { c.owner = ""; c.participants = ""; }
    for (const p of ch.parts) { p.owner = ""; p.participants = ""; }
    for (const r of ch.responsibilities) r.name = "";
  }
  for (const arr of t.spArrangements) {
    for (const row of arr.rows) { row.owner = ""; row.participants = ""; }
  }
  t.manualParticipants = [];
  return t;
}
async function saveAsTemplate(): Promise<void> {
  const s = state.value; if (!s) return;
  const name = saveTplName.value.trim();
  if (!name) { props.store.notify("请输入模板名称"); return; }
  try {
    await backend.createEngTemplate({ name, state: stripNamesForTemplate(s) });
    props.store.notify(`已保存模板：${name}`, "ok");
    saveTplName.value = "";
    await openTplModal(tplMode.value);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板保存失败", "err");
  }
}
async function overwriteTemplate(t: { _id: string; name: string }): Promise<void> {
  const s = state.value; if (!s) return;
  if (!window.confirm(`确认覆盖模板“${t.name}”？当前甘特数据将写入该模板。`)) return;
  try {
    await backend.updateEngTemplate(t._id, { name: t.name, state: stripNamesForTemplate(s) });
    props.store.notify(`已覆盖模板：${t.name}`);
    await openTplModal(tplMode.value);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板覆盖失败", "err");
  }
}
async function deleteTemplate(t: { _id: string; name: string }): Promise<void> {
  if (!window.confirm(`确认删除模板“${t.name}”？`)) return;
  try {
    await backend.deleteEngTemplate(t._id);
    templates.value = templates.value.filter((x) => x._id !== t._id);
    props.store.notify("模板已删除", "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板删除失败", "err");
  }
}
async function renameTemplate(t: { _id: string; name: string; state: GanttPrepState }): Promise<void> {
  const name = window.prompt("请输入新模板名称", t.name)?.trim();
  if (!name || name === t.name) return;
  try {
    await backend.updateEngTemplate(t._id, { name, state: t.state });
    props.store.notify(`模板已改名为：${name}`, "ok");
    await openTplModal(tplMode.value);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板改名失败", "err");
  }
}

// ===== 填空框上传中动画：输入后（防抖+异步上传未完成）在框上叠加灰蒙 + "……" =====
const saveTarget = ref<HTMLElement | null>(null);
const maskVisible = ref(false);
const maskStyle = ref<Record<string, string>>({});
function updateSaveMask(): void {
  const el = saveTarget.value;
  if (!el || !maskVisible.value) return;
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
    maskVisible.value = false;
    return;
  }
  maskStyle.value = {
    left: `${r.left}px`, top: `${r.top}px`,
    width: `${r.width}px`, height: `${r.height}px`,
    borderRadius: getComputedStyle(el).borderRadius || "6px",
  };
}
/** 根容器 @input 事件委托：输入只记录目标框，不显示蒙版（上传开始时才显示）。 */
function onAnyInput(e: Event): void {
  const t = e.target as HTMLElement | null;
  if (!t) return;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
    saveTarget.value = t;
  }
}
// 显示时机 = 上传真正开始（remoteSaving false→true）且最近编辑过填空框；上传完成（true→false）→ 蒙版淡出
watch(() => props.store.remoteSaving.value, (v, old) => {
  if (old === false && v === true) {
    if (saveTarget.value) {
      maskVisible.value = true;
      updateSaveMask();
    }
  } else if (old === true && v === false) {
    maskVisible.value = false;
    saveTarget.value = null;
  }
});
function onSaveMaskMove(): void { updateSaveMask(); }
onMounted(() => {
  window.addEventListener("scroll", onSaveMaskMove, true);
  window.addEventListener("resize", onSaveMaskMove);
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", onSaveMaskMove, true);
  window.removeEventListener("resize", onSaveMaskMove);
});

// ===== 导出：meta 文本行（复用） =====
function metaLines(): string[] {
  const m = meta.value; if (!m) return [];
  const lines: string[] = [];
  (m.aircrafts as MetaAircraft[]).forEach((a, i) => {
    const parts: string[] = [];
    if (a.reg) parts.push(`机号 ${a.reg}`);
    if (a.fsn) parts.push(`FSN ${a.fsn}`);
    if (a.msn) parts.push(`MSN ${a.msn}`);
    if (a.engine) parts.push(`发动机 ${a.engine}`);
    if (a.type) parts.push(`机型 ${a.type}`);
    if (a.etops) parts.push(`ETOPS ${a.etops}`);
    if (a.eltDt) parts.push(`ELT-DT ${a.eltDt}`);
    if (parts.length) lines.push(`飞机${(m.aircrafts as MetaAircraft[]).length > 1 ? i + 1 : ""}: ${parts.join("  ")}`);
  });
  const a = arrangement.value;
  const arrParts: string[] = [];
  if (a.manager) arrParts.push(`项目经理 ${a.manager}`);
  if (a.dutyGroup) arrParts.push(`值班组 ${a.dutyGroup}`);
  if (a.location) arrParts.push(`执行地点 ${a.location}`);
  if (a.orderNo) arrParts.push(`指令号 ${a.orderNo}`);
  if (a.orderName) arrParts.push(`指令名称 ${a.orderName}`);
  if (arrParts.length) lines.push(`项目安排: ${arrParts.join("  ")}`);
  return lines;
}
function stampDate(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// ===== 导出 Word 表单（HTML 降级为 .doc，Word 可打开） =====
function buildPrintableHtml(): string {
  const s = state.value; if (!s) return "";
  let body = "";
  metaLines().forEach((l) => { body += `<p><b>${esc(l)}</b></p>`; });
  s.charts.forEach((chart) => {
    body += `<h2>${esc(chart.date || "----")}号 ${esc(chart.title)} DAY ${chart.day}</h2>`;
    body += `<p><b>顶部责任：</b> ${chart.responsibilities.map((r) => `${esc(r.label)}: ${esc(r.name || "未填")}`).join("　|　")}</p>`;
    body += '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:12px;margin:8px 0;font-family:Microsoft YaHei,sans-serif">';
    body += "<thead><tr><th>阶段</th><th>内容</th><th>负责人</th><th>参与人</th><th>备注</th></tr></thead><tbody>";
    chart.cards.slice().sort((a, b) => (a.startStage - b.startStage) || ((a.order ?? 0) - (b.order ?? 0))).forEach((c) => {
      body += `<tr><td>${esc(chart.stages[c.startStage]?.name)}</td><td>${esc(c.content)}</td><td>${esc(c.owner)}</td><td>${esc(c.participants)}</td><td style="color:#c0392b">${esc(c.note)}</td></tr>`;
    });
    body += "</tbody></table>";
    body += "<h3>串件</h3>";
    body += '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:12px;font-family:Microsoft YaHei,sans-serif"><thead><tr><th>类型</th><th>内容</th><th>负责人</th><th>参与人</th><th>备注</th><th>执行阶段</th></tr></thead><tbody>';
    getSpArrangements().forEach((a) => {
      a.rows.forEach((r) => {
        const st = r.executeStage ? (() => { const c = s.charts.find((x) => x.id === r.executeStage!.chartId); return c && c.stages[r.executeStage!.stageIdx] ? `DAY ${c.day} · ${c.stages[r.executeStage!.stageIdx].name}` : "已删除"; })() : "未分配";
        body += `<tr><td>${esc((r.tag ? `（${r.tag}）` : "") + (a.type || ""))}</td><td>${esc(a.content)}</td><td>${esc(r.owner)}</td><td>${esc(r.participants)}</td><td>${esc(r.note)}</td><td>${esc(st)}</td></tr>`;
      });
    });
    body += "</tbody></table>";
  });
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>换发准备单</title></head><body style="font-family:Microsoft YaHei,sans-serif;padding:20px">${body}</body></html>`;
}
function exportDocx(): void {
  const s = state.value; if (!s) return;
  if (!s.charts.length) { props.store.notify("没有数据"); return; }
  const html = buildPrintableHtml();
  downloadBlob(new Blob(["\uFEFF" + html], { type: "application/msword;charset=utf-8" }), `换发准备单_${stampDate()}.doc`);
  props.store.notify("已导出 Word 表单");
}

// ===== 导出长图（html2canvas 渲染当前子页） =====
const mainAreaRef = ref<HTMLElement | null>(null);
async function exportAllImage(): Promise<void> {
  if (props.store.imageExportBusy.value) return;
  const s = state.value; if (!s) return;
  if (!s.charts.length) { props.store.notify("没有数据"); return; }
  const target = mainAreaRef.value;
  if (!target) return;
  props.store.imageExportBusy.value = true;

  // ① 先把所有 .gantt-grid 的列宽固定为当前实际列宽（替代百分比模板），保证横向内容能自然撑开
  const grids = Array.from(target.querySelectorAll<HTMLElement>(".gantt-grid"));
  const savedGrids = grids.map((el) => {
    const computed = window.getComputedStyle(el);
    const cols = computed.gridTemplateColumns.split(" ").filter(Boolean);
    const firstCol = cols[0] ? parseFloat(cols[0]) : 0;
    const stages = el.querySelectorAll<HTMLElement>(".gantt-head").length || 1;
    return {
      el,
      gridTemplateColumns: el.style.gridTemplateColumns,
      width: el.style.width,
      minWidth: el.style.minWidth,
      colWidth: firstCol,
      stages,
    };
  });
  savedGrids.forEach((g) => {
    if (g.colWidth > 0) {
      const total = Math.max(g.el.clientWidth, g.colWidth * g.stages);
      g.el.style.gridTemplateColumns = `repeat(${g.stages}, ${g.colWidth}px)`;
      g.el.style.width = `${total}px`;
      g.el.style.minWidth = `${total}px`;
    } else {
      g.el.style.width = "max-content";
      g.el.style.minWidth = "max-content";
    }
  });

  // ② 横向滚动容器展开：.gantt-wrap overflow visible + 宽度随内容；.main-area 也随内容
  const wraps = Array.from(target.querySelectorAll<HTMLElement>(".gantt-wrap"));
  const savedWraps = wraps.map((w) => ({
    el: w,
    overflow: w.style.overflow,
    width: w.style.width,
    minWidth: w.style.minWidth,
  }));
  wraps.forEach((w) => { w.style.overflow = "visible"; w.style.width = "max-content"; w.style.minWidth = "max-content"; });
  const savedMain = { width: target.style.width, minWidth: target.style.minWidth };
  target.style.width = "max-content";
  target.style.minWidth = "max-content";

  // ③ 在最终横向宽度确定后，撑高所有 textarea 到内容实际高度，避免多行文字被裁剪成半行
  const textareas = Array.from(target.querySelectorAll<HTMLTextAreaElement>("textarea"));
  const savedHeights = textareas.map((el) => ({
    el,
    h: el.style.height,
    fs: (el.style as any).fieldSizing,
    ov: el.style.overflow,
    rows: el.getAttribute("rows"),
  }));
  textareas.forEach((el) => {
    (el.style as any).fieldSizing = "content";
    el.style.overflow = "visible";
    el.removeAttribute("rows");
    el.style.height = "auto";
    void el.offsetHeight; // 强制 reflow
    el.style.height = `${el.scrollHeight}px`;
  });

  try {
    const html2canvas = (await import("html2canvas")).default;
    props.store.notify("正在渲染图片…");
    const fullW = Math.max(target.scrollWidth, document.documentElement.clientWidth);
    const fullH = target.scrollHeight;
    // 无尺寸限制：固定 1.5x 高清渲染，分块（tile）拼接突破浏览器单 canvas 尺寸上限，保证甘特图完整输出
    const scale = 1.5;
    const canvasW = Math.ceil(fullW * scale);
    const canvasH = Math.ceil(fullH * scale);
    if (canvasW > 30000 || canvasH > 30000) {
      props.store.notify(`导出尺寸过大（${canvasW}×${canvasH}px），请精简内容后重试`);
      return;
    }
    const out = document.createElement("canvas");
    out.width = canvasW;
    out.height = canvasH;
    const ctx = out.getContext("2d");
    if (!ctx) { props.store.notify("图片导出失败"); return; }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);
    // 每块渲染的 CSS 像素：×1.5 ≈ 3750px，单块 canvas 在浏览器安全上限内
    const tilePx = 2500;
    const cols = Math.ceil(fullW / tilePx);
    const rows = Math.ceil(fullH / tilePx);
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const bx = rx * tilePx;
        const by = ry * tilePx;
        const bw = Math.min(tilePx, fullW - bx);
        const bh = Math.min(tilePx, fullH - by);
        // 在克隆文档中把 main-area 裁剪为当前分块并平移内容，实现按块渲染、无损拼接
        const tile = await html2canvas(target, {
          scale,
          backgroundColor: "#ffffff",
          useCORS: true,
          scrollX: 0,
          scrollY: 0,
          windowWidth: Math.max(bw, document.documentElement.clientWidth),
          windowHeight: Math.max(bh, document.documentElement.clientHeight),
          onclone: (doc: Document) => {
            const el = doc.getElementById("gp-main-area");
            if (!el) return;
            el.style.width = `${bw}px`;
            el.style.height = `${bh}px`;
            el.style.overflow = "hidden";
            Array.from(el.children).forEach((c) => {
              const h = c as HTMLElement;
              h.style.transform = `translate(${-bx}px, ${-by}px)`;
            });
          },
        });
        ctx.drawImage(tile, bx * scale, by * scale, bw * scale, bh * scale);
      }
    }
    out.toBlob((blob) => {
      if (blob) downloadBlob(blob, `换发准备单_${tab.value === "gantt" ? "甘特图" : "表单"}_${stampDate()}.jpg`);
      else props.store.notify("图片导出失败", "err");
    }, "image/jpeg", 0.92);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "图片导出失败", "err");
  } finally {
    savedHeights.forEach((x) => {
      x.el.style.height = x.h;
      x.el.style.overflow = x.ov;
      if (x.rows !== null) x.el.setAttribute("rows", x.rows);
      else x.el.removeAttribute("rows");
      if (x.fs) (x.el.style as any).fieldSizing = x.fs;
    });
    savedGrids.forEach((g) => {
      g.el.style.gridTemplateColumns = g.gridTemplateColumns;
      g.el.style.width = g.width;
      g.el.style.minWidth = g.minWidth;
    });
    savedWraps.forEach((w, i) => {
      w.el.style.overflow = savedWraps[i].overflow;
      w.el.style.width = savedWraps[i].width;
      w.el.style.minWidth = savedWraps[i].minWidth;
    });
    target.style.width = savedMain.width;
    target.style.minWidth = savedMain.minWidth;
    props.store.imageExportBusy.value = false;
  }
}

// ===== 导出 / 导入 xlsx（工序数据） =====
async function exportAllXlsx(): Promise<void> {
  const s = state.value; if (!s) return;
  if (!s.charts.length) { props.store.notify("没有数据"); return; }
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    // 工序 sheet：所有 DAY 的工序合并到同一 sheet（加 DAY 列）
    const workRows: unknown[][] = [["DAY", "阶段", "内容", "负责人", "参与人", "备注"]];
    s.charts.forEach((chart) => {
      chart.cards.slice().sort((a, b) => (a.startStage - b.startStage) || ((a.order ?? 0) - (b.order ?? 0))).forEach((c) => {
        workRows.push([`DAY ${chart.day}`, chart.stages[c.startStage]?.name ?? "", c.content || "", c.owner || "", c.participants || "", c.note || ""]);
      });
    });
    const ws1 = XLSX.utils.aoa_to_sheet(workRows);
    ws1["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 42 }, { wch: 14 }, { wch: 22 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws1, "工序");
    // 串件 sheet：全局串件安排（每行一条，串件类型拆/装两行）
    const partRows: unknown[][] = [["DAY", "类型", "内容", "负责人", "参与人", "备注", "执行阶段"]];
    getSpArrangements().forEach((a) => {
      a.rows.forEach((r) => {
        const st = r.executeStage ? (() => { const c = s.charts.find((x) => x.id === r.executeStage!.chartId); return c && c.stages[r.executeStage!.stageIdx] ? `DAY ${c.day} · ${c.stages[r.executeStage!.stageIdx].name}` : "已删除"; })() : "未分配";
        partRows.push([r.executeStage ? `DAY ${s.charts.find((x) => x.id === r.executeStage!.chartId)?.day ?? ""}` : "", (r.tag ? `（${r.tag}）` : "") + (a.type || ""), a.content || "", r.owner || "", r.participants || "", r.note || "", st]);
      });
    });
    const ws2 = XLSX.utils.aoa_to_sheet(partRows);
    ws2["!cols"] = [{ wch: 8 }, { wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws2, "串件");
    // 责任信息 sheet
    const info: unknown[][] = [["项目", "内容"]];
    s.charts.forEach((chart) => { chart.responsibilities.forEach((r) => info.push([`DAY ${chart.day} ${r.label || ""}`, r.name || ""])); });
    metaLines().forEach((l) => { const idx = l.indexOf(": "); info.push(idx > 0 ? [l.slice(0, idx), l.slice(idx + 2)] : ["", l]); });
    const ws3 = XLSX.utils.aoa_to_sheet(info);
    ws3["!cols"] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws3, "责任信息");
    XLSX.writeFile(wb, `换发准备单_${stampDate()}.xlsx`);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "xlsx 导出失败", "err");
  }
}
// ===== 甘特图子页「导出 Excel」：仿参考工序模板（Sheet2/3 体例），泳道行卡式 =====
// 每 DAY 一个区块：DAY 横幅(日期+DAY) / 各项负责 / 阶段表头(每阶段 3 列一组) /
// 工序卡按网页甘特「泳道行」排版：同一行(row)不同阶段的卡并排放置同一行，不占独立整行；
// 每个泳道行导成三行：①卡标题行(浅灰/米黄底，卡按起止阶段合并多列)②人员行 ③备注行(红字)；
// 行首 A 列三行纵向合并写「并列N」；未分配串件每 DAY 尾部；DAY 间空 2 行。
const ganttXlsxBusy = ref(false);
/** 行高估算：按合并宽度（列数×每列 wch，CJK 每字约 2 字符位）估换行后行高。 */
function ganttExcelHpt(text: string, colCount: number, wchPer: number, minHpt = 20): number {
  const t = String(text || "");
  if (!t) return minHpt;
  const per = Math.max(1, Math.floor((colCount * wchPer) / 2));
  let lines = 0;
  t.split(/\r?\n/).forEach((seg) => { lines += Math.max(1, Math.ceil(seg.length / per)); });
  return Math.max(minHpt, 13 + lines * 13);
}
/** 日期 "2026-09-05" → "9月5日"（与参考模板横幅体例一致）。 */
function ganttDayLabel(date: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date || "");
  return m ? `${Number(m[2])}月${Number(m[3])}日` : (date || "");
}
async function exportGanttXlsx(): Promise<void> {
  const s = state.value; if (!s) return;
  if (!s.charts.length) { props.store.notify("没有数据"); return; }
  if (ganttXlsxBusy.value) return;
  ganttXlsxBusy.value = true;
  try {
    const XLSX = await import("xlsx");
    const charts = s.charts.slice().sort((a, b) => (Number(a.day) || 0) - (Number(b.day) || 0));
    const COL_W = 13;                                  // 每阶段小列宽 wch（每阶段 3 列）
    const SEQ_W = 9;                                   // A 列(序号/标签)宽
    const maxStage = Math.max(1, ...charts.map((c) => c.stages.length));
    const COLS = 1 + maxStage * 3;                     // A 列 + 阶段数×3 列
    const rows: unknown[][] = [];
    const heights: Array<{ hpt: number }> = [];
    const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
    type LKind = "day" | "resp" | "stagehead" | "card-head" | "card-meta" | "card-note" | "sp-head" | "sp-meta" | "sp-note" | "ua-title" | "ua";
    const lines: Array<{ r: number; c0: number; c1: number; kind: LKind }> = [];
    const pushRow = (hpt: number): number => { rows.push([]); heights.push({ hpt }); return rows.length - 1; };
    const blank = (hpt = 14): number => { rows.push([]); heights.push({ hpt }); return rows.length - 1; };
    const dayEndCol = (S: number): number => 1 + S * 3 - 1; // 该 DAY 阶段数据末列
    charts.forEach((chart, ci) => {
      const S = chart.stages.length;
      const endCol = Math.max(0, dayEndCol(S));
      // ① DAY 横幅：A=「日期」，B..末列 合并「9月5日 DAY 1 · 标题」
      const banner = `${ganttDayLabel(chart.date || "")} ${chart.day >= 0 ? "DAY " + chart.day : ""}${chart.title ? " · " + chart.title : ""}`.trim();
      const rB = pushRow(24);
      rows[rB][0] = "日期";
      if (endCol > 0) rows[rB][1] = banner;
      lines.push({ r: rB, c0: 0, c1: Math.max(endCol, 1), kind: "day" });
      // ② 各项负责行（仅展示已填姓名项）
      const respTxt = (chart.responsibilities || []).filter((x) => x.name).map((x) => `${x.label || ""}：${x.name}`).join("　");
      if (respTxt) {
        const rR = pushRow(20);
        rows[rR][0] = "各项负责";
        if (endCol > 0) rows[rR][1] = respTxt;
        lines.push({ r: rR, c0: 0, c1: Math.max(endCol, 1), kind: "resp" });
      }
      if (S === 0) {
        if (ci < charts.length - 1) { blank(); blank(); }
        return;
      }
      // ③ 阶段表头行：每阶段 3 列合并一格，A=「阶段」
      const rH = pushRow(24);
      rows[rH][0] = "阶段";
      chart.stages.forEach((st, i) => { rows[rH][1 + i * 3] = st.name || `阶段${i + 1}`; });
      lines.push({ r: rH, c0: 0, c1: endCol, kind: "stagehead" });
      // ④ 卡行：与网页甘特图一致——同一泳道行(row)内不同阶段的工序/串件并排放置于同一行，
      // 而不是每张卡独占多行；每个泳道行导成三行(①卡标题行灰/米黄 ②人员行 ③备注行红)，
      // 卡按其起止阶段横向合并多列；行首 A 列三行纵向合并写「并列N」（对应网页同一 row 的并行工序组）。
      const gridRowsMap = computeRows(chart);
      const items: Array<{ row: number; col: number; card?: GanttCard; sp?: { arr: GanttSpArrangement; row: GanttSpRow; stageIdx: number } }> = [];
      chart.cards.forEach((card) => items.push({ row: gridRowsMap[card.id] ?? 0, col: card.startStage, card }));
      spCardsOfChart(chart).forEach((x) => items.push({ row: gridRowsMap["sp:" + x.row.id] ?? 0, col: x.stageIdx, sp: x }));
      items.sort((a, b) => (a.row - b.row) || (a.col - b.col));
      const laneGroups = new Map<number, Array<{ c0: number; c1: number; isSp: boolean; headTxt: string; metaTxt: string; noteTxt: string }>>();
      items.forEach((it) => {
        const startIdx = it.card ? it.card.startStage : it.sp ? it.sp.stageIdx : 0;
        const endIdx = it.card ? it.card.endStage : it.sp ? it.sp.stageIdx : 0;
        if (startIdx < 0 || startIdx >= S) return;
        const c0 = 1 + clamp(startIdx, 0, S - 1) * 3;
        const span = Math.max(1, clamp(endIdx, 0, S - 1) - clamp(startIdx, 0, S - 1) + 1);
        const c1 = c0 + span * 3 - 1;
        const isSp = !!it.sp;
        const content = (isSp && it.sp ? it.sp.arr.content : it.card?.content) || "";
        const headTxt = (isSp && it.sp ? `${it.sp.row.tag ? "（" + it.sp.row.tag + "）" : ""}${it.sp.arr.type || "串件"} ${content}` : content).trim();
        const owner = (isSp && it.sp ? it.sp.row.owner : it.card?.owner) || "";
        const participants = (isSp && it.sp ? it.sp.row.participants : it.card?.participants) || "";
        const note = (isSp && it.sp ? it.sp.row.note : it.card?.note) || "";
        const metaTxt = `负责：${owner || "—"}${participants ? "　参与：" + participants : ""}`;
        const noteTxt = note ? `备注：${note}` : "";
        const lane = laneGroups.get(it.row) ?? [];
        lane.push({ c0, c1, isSp, headTxt, metaTxt, noteTxt });
        laneGroups.set(it.row, lane);
      });
      let laneNo = 0;
      [...laneGroups.keys()].sort((a, b) => a - b).forEach((rowNo) => {
        const lane = laneGroups.get(rowNo)!.slice().sort((a, b) => a.c0 - b.c0);
        laneNo++;
        const rT = rows.length;
        // 标题行（整泳道一行，卡按列区间合并）
        const headH = Math.max(22, ...lane.map((c) => ganttExcelHpt(c.headTxt, c.c1 - c.c0 + 1, COL_W, 18)));
        const r0 = pushRow(headH);
        rows[r0][0] = `并列${laneNo}`;
        lane.forEach((c) => {
          rows[r0][c.c0] = c.headTxt;
          lines.push({ r: r0, c0: c.c0, c1: c.c1, kind: c.isSp ? "sp-head" : "card-head" });
        });
        // 人员行（同一行并排）
        const metaH = Math.max(18, ...lane.map((c) => ganttExcelHpt(c.metaTxt, c.c1 - c.c0 + 1, COL_W, 16)));
        const r1 = pushRow(metaH);
        lane.forEach((c) => {
          rows[r1][c.c0] = c.metaTxt;
          lines.push({ r: r1, c0: c.c0, c1: c.c1, kind: c.isSp ? "sp-meta" : "card-meta" });
        });
        // 备注行（红字，同一行并排；无备注留空行保三行节奏）
        const anyNote = lane.some((c) => c.noteTxt);
        const r2 = pushRow(anyNote ? Math.max(18, ...lane.map((c) => (c.noteTxt ? ganttExcelHpt(c.noteTxt, c.c1 - c.c0 + 1, COL_W, 16) : 0))) : 10);
        lane.forEach((c) => {
          if (c.noteTxt) {
            rows[r2][c.c0] = c.noteTxt;
            lines.push({ r: r2, c0: c.c0, c1: c.c1, kind: c.isSp ? "sp-note" : "card-note" });
          }
        });
        // A 列三行纵向合并
        merges.push({ s: { r: rT, c: 0 }, e: { r: rT + 2, c: 0 } });
      });
      // ⑤ 未分配串件（网页每 DAY 底部横幅重复）
      const un = unassignedSpRows();
      if (un.length) {
        const rU = pushRow(20);
        rows[rU][0] = `▲ 未分配串件（${un.length}）`;
        lines.push({ r: rU, c0: 0, c1: endCol, kind: "ua-title" });
        un.forEach((x) => {
          const t = `${x.row.tag ? "（" + x.row.tag + "）" : ""}${x.arr.type || "串件"} · ${x.arr.content || "（空）"}　负责：${x.row.owner || "未指派"}${x.row.participants ? "　参与：" + x.row.participants : ""}${x.row.note ? "　备注：" + x.row.note : ""}`;
          const rI = pushRow(Math.max(18, ganttExcelHpt(t, endCol + 1, COL_W, 16)));
          rows[rI][0] = t;
          lines.push({ r: rI, c0: 0, c1: endCol, kind: "ua" });
        });
      }
      // ⑥ DAY 间空 2 行
      if (ci < charts.length - 1) { blank(14); blank(14); }
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const addr = (row: number, col: number): string => XLSX.utils.encode_cell({ r: row, c: col });
    const solid = (rgb: string): { patternType: "solid"; fgColor: { rgb: string } } => ({ patternType: "solid", fgColor: { rgb } });
    lines.forEach((m) => {
      if (m.kind === "stagehead") {
        const aL = addr(m.r, 0);
        if (ws[aL]) ws[aL].s = { font: { bold: true, color: { rgb: "1F1F1F" }, sz: 11 }, alignment: { vertical: "center", horizontal: "left" } } as never;
        const S = Math.max(1, Math.floor((m.c1 - m.c0 + 1) / 3));
        for (let i = 0; i < S; i++) {
          const cc0 = 1 + i * 3; const cc1 = cc0 + 2;
          if (cc1 > m.c1) break;
          merges.push({ s: { r: m.r, c: cc0 }, e: { r: m.r, c: cc1 } });
          const a = addr(m.r, cc0);
          if (ws[a]) ws[a].s = { font: { bold: true, color: { rgb: "1F1F1F" }, sz: 11 }, alignment: { vertical: "center", horizontal: "center", wrapText: true } } as never;
        }
        return;
      }
      if (m.kind === "day" || m.kind === "resp" || m.kind === "ua-title" || m.kind === "ua") {
        // day/resp：A 列标签独立（日期/各项负责），正文从 B 列起合并；ua 横幅则整行(含 A)合并
        const from = (m.kind === "day" || m.kind === "resp") ? 1 : 0;
        if (m.c1 > from) merges.push({ s: { r: m.r, c: from }, e: { r: m.r, c: m.c1 } });
        if ((m.kind === "day" || m.kind === "resp")) {
          const aL = addr(m.r, 0);
          if (ws[aL]) ws[aL].s = { font: { bold: true, color: { rgb: "1F1F1F" }, sz: 10 }, alignment: { vertical: "center", horizontal: "left" } } as never;
        }
        const a = addr(m.r, from);
        if (!ws[a]) return;
        const st: Record<string, unknown> = { alignment: { vertical: "center", wrapText: true } };
        if (m.kind === "day") st.font = { bold: true, color: { rgb: "2F5597" }, sz: 13 };
        else if (m.kind === "resp") st.font = { color: { rgb: "1F1F1F" }, sz: 11 };
        else { st.font = { bold: m.kind === "ua-title", color: { rgb: "B45309" }, sz: 11 }; st.fill = solid("FFE8C7"); }
        ws[a].s = st as never;
        return;
      }
      const isHead = m.kind.endsWith("-head");
      const isNote = m.kind.endsWith("-note");
      const isSp = m.kind.startsWith("sp");
      if (m.c1 > m.c0) merges.push({ s: { r: m.r, c: m.c0 }, e: { r: m.r, c: m.c1 } });
      const a = addr(m.r, m.c0);
      if (!ws[a]) return;
      const st: Record<string, unknown> = { alignment: { vertical: "center", wrapText: true } };
      if (isHead) { st.font = { bold: true, color: { rgb: "1F1F1F" }, sz: 11 }; st.fill = solid(isSp ? "FDEADA" : "F2F2F2"); }
      else if (isNote) st.font = { color: { rgb: "FF0000" }, sz: 11 };
      else st.font = { color: { rgb: "1F1F1F" }, sz: 11 };
      ws[a].s = st as never;
      if (isHead) {
        const aA = addr(m.r, 0);
        if (ws[aA]) ws[aA].s = { font: { bold: true, color: { rgb: "1F1F1F" }, sz: 10 }, alignment: { vertical: "center", horizontal: "center" } } as never;
      }
    });
    ws["!merges"] = merges;
    ws["!cols"] = [{ wch: SEQ_W }, ...Array.from({ length: COLS - 1 }, () => ({ wch: COL_W }))];
    ws["!rows"] = heights;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "甘特表");
    XLSX.writeFile(wb, `甘特工序表_${stampDate()}.xlsx`);
    props.store.notifyOk("甘特 Excel 已导出");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "Excel 导出失败", "err");
  } finally {
    ganttXlsxBusy.value = false;
  }
}

// ===== 甘特图子页「导出 Word」：原生表格，A4 横向，每个 DAY 卡片各占一页，维持网页甘特图布局 =====
// 每 DAY 一个表格：DAY 标题行(浅蓝) + 责任行(灰蓝) + 阶段表头行(主蓝白字，横向列) +
// 卡片行(工序卡按起止阶段横向合并多列/串件卡贴其阶段列，卡内 内容/负责·参与/备注 分行) +
// 未分配串件横幅每 DAY 重复；表格用 docx 原生单元格（可编辑、可打印），非截图图片。
const wordExportBusy = ref(false);
async function exportGanttWord(): Promise<void> {
  const s = state.value; if (!s) return;
  if (!s.charts.length) { props.store.notify("没有数据"); return; }
  if (wordExportBusy.value) return;
  wordExportBusy.value = true;
  try {
    const docx = await import("docx");
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, TableLayoutType, WidthType, VerticalAlign, BorderStyle, AlignmentType, PageOrientation } = docx;
    const mm = docx.convertMillimetersToTwip;
    const C = { day: "E8F1FC", dayTxt: "2F5597", blue: "4472C4", headSub: "EDF2FC", yellow: "FDCA17", orange: "E8A44D", warnBg: "FFE8C7", warnTxt: "B45309", danger: "C0392B", white: "FFFFFF", ink: "1F1F1F", noteOnOrange: "FFE8C7", line: "C9CFDA" };
    const charts = s.charts.slice().sort((a, b) => (Number(a.day) || 0) - (Number(b.day) || 0));
    props.store.notify("正在生成 Word…");
    const children: Array<DParagraph | DTable> = [];
    const p = (opts: ConstructorParameters<typeof DParagraph>[0]): DParagraph => new Paragraph(opts);
    const border = { style: BorderStyle.SINGLE, size: 4, color: C.line };
    const cardBorders = { top: border, bottom: border, left: border, right: border };
    const emptyCell = (): DTableCell => new TableCell({ children: [p({ children: [] })] });
    charts.forEach((chart, ci) => {
      const S = chart.stages.length;
      const dayNo = `DAY ${chart.day}`;
      const date = chart.date || "";
      const colW = S > 0 ? Math.floor((297 - 24) * 56.7 / S) : 0; // 可用宽度分列（twips）
      if (ci > 0) children.push(p({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] })); // 每 DAY 另起一页
      if (S === 0) {
        // 无阶段：仅标题/责任段落
        children.push(p({ spacing: { after: 60 }, children: [new TextRun({ text: `${dayNo}｜${date}${chart.title ? "｜" + chart.title : ""}`, bold: true, color: C.dayTxt, size: 28 })] }));
        const respTxt0 = (chart.responsibilities || []).filter((x) => x.name).map((x) => `${x.label || ""}：${x.name}`).join("　");
        if (respTxt0) children.push(p({ children: [new TextRun({ text: `责任　${respTxt0}`, color: C.ink, size: 20 })] }));
        children.push(p({ children: [new TextRun({ text: "（本 DAY 未设置阶段）", color: C.warnTxt, size: 20 })] }));
        return;
      }
      const rows: DTableRow[] = [];
      // ① DAY 标题行（合并整行，浅蓝底）
      const titleTxt = `${dayNo}｜${date}${chart.title ? "｜" + chart.title : ""}`;
      rows.push(new TableRow({ children: [new TableCell({
        columnSpan: S, shading: { fill: C.day }, verticalAlign: VerticalAlign.CENTER,
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        borders: cardBorders,
        children: [p({ spacing: { after: 0 }, children: [new TextRun({ text: titleTxt, bold: true, color: C.dayTxt, size: 24 })] })],
      })] }));
      // ② 顶部责任行（灰蓝底，合并整行；仅展示已填姓名项）
      const respTxt = (chart.responsibilities || []).filter((x) => x.name).map((x) => `${x.label || ""}：${x.name}`).join("　");
      if (respTxt) {
        rows.push(new TableRow({ children: [new TableCell({
          columnSpan: S, shading: { fill: C.headSub }, verticalAlign: VerticalAlign.CENTER,
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          borders: cardBorders,
          children: [p({ spacing: { after: 0 }, children: [new TextRun({ text: `责任　${respTxt}`, color: C.ink, size: 20 })] })],
        })] }));
      }
      // ③ 阶段表头行（每个阶段一列，主蓝底白字）
      rows.push(new TableRow({ children: chart.stages.map((st) => new TableCell({
        shading: { fill: C.blue }, verticalAlign: VerticalAlign.CENTER,
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
        borders: cardBorders,
        children: [p({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: st.name || "阶段", bold: true, color: C.white, size: 22 })] })],
      })) }));
      // ④ 卡片行：按网页 computeRows 行→列序；工序卡横跨起止阶段(columnSpan)、串件卡贴其阶段列
      const gridRows = computeRows(chart);
      const items: Array<{ row: number; col: number; card?: GanttCard; sp?: { arr: GanttSpArrangement; row: GanttSpRow; stageIdx: number } }> = [];
      chart.cards.forEach((card) => items.push({ row: gridRows[card.id] ?? 0, col: card.startStage, card }));
      spCardsOfChart(chart).forEach((x) => items.push({ row: gridRows["sp:" + x.row.id] ?? 0, col: x.stageIdx, sp: x }));
      items.forEach((it) => { if ((it.col ?? 0) < 0 || (it.col ?? 0) >= S) return; });
      const groups = new Map<number, typeof items>();
      items.forEach((it) => { const arr = groups.get(it.row) || []; arr.push(it); groups.set(it.row, arr); });
      [...groups.keys()].sort((a, b) => a - b).forEach((rowNo) => {
        const group = groups.get(rowNo)!.slice().sort((a, b) => a.col - b.col);
        const cells: DTableCell[] = [];
        let cur = 0;
        group.forEach((it) => {
          if (it.col > cur) { for (let k = cur; k < it.col; k++) cells.push(emptyCell()); cur = it.col; }
          const span = it.card ? Math.max(1, it.card.endStage - it.card.startStage + 1) : 1;
          if (it.card) {
            const card = it.card;
            const cardParas: DParagraph[] = [p({ spacing: { after: 0 }, children: [new TextRun({ text: card.content || "（空）", bold: true, color: C.ink, size: 22 })] })];
            const metaTxt = `负责：${card.owner || "—"}${card.participants ? "　参与：" + card.participants : ""}`;
            cardParas.push(p({ spacing: { after: 0 }, children: [new TextRun({ text: metaTxt, color: C.ink, size: 20 })] }));
            if (card.note) cardParas.push(p({ spacing: { after: 0 }, children: [new TextRun({ text: `备注：${card.note}`, color: C.danger, size: 20 })] }));
            cells.push(new TableCell({
              columnSpan: span, shading: { fill: C.yellow }, verticalAlign: VerticalAlign.CENTER,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              borders: cardBorders,
              children: cardParas,
            }));
          } else if (it.sp) {
            const x = it.sp;
            const headTxt = `${x.row.tag ? "（" + x.row.tag + "）" : ""}${x.arr.type || "串件"} ${x.arr.content || "（空）"}`.trim();
            const cardParas: DParagraph[] = [p({ spacing: { after: 0 }, children: [new TextRun({ text: headTxt, bold: true, color: C.white, size: 22 })] })];
            const metaTxt = `负责：${x.row.owner || "—"}${x.row.participants ? "　参与：" + x.row.participants : ""}`;
            cardParas.push(p({ spacing: { after: 0 }, children: [new TextRun({ text: metaTxt, color: C.white, size: 20 })] }));
            if (x.row.note) cardParas.push(p({ spacing: { after: 0 }, children: [new TextRun({ text: `备注：${x.row.note}`, color: C.noteOnOrange, size: 20 })] }));
            cells.push(new TableCell({
              columnSpan: 1, shading: { fill: C.orange }, verticalAlign: VerticalAlign.CENTER,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              borders: cardBorders,
              children: cardParas,
            }));
          }
          cur += span;
        });
        for (let k = cur; k < S; k++) cells.push(emptyCell());
        rows.push(new TableRow({ children: cells }));
      });
      // ⑤ 未分配串件横幅（网页每个 DAY 卡片底部重复 → 每 DAY 表格内重复）
      const un = unassignedSpRows();
      if (un.length) {
        rows.push(new TableRow({ children: [new TableCell({
          columnSpan: S, shading: { fill: C.warnBg }, verticalAlign: VerticalAlign.CENTER,
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          borders: cardBorders,
          children: [p({ spacing: { after: 40 }, children: [new TextRun({ text: `▲ 未分配串件（${un.length}）　拖拽到本 DAY 的阶段列即可分配`, bold: true, color: C.warnTxt, size: 22 })] })],
        })] }));
        un.forEach((x) => {
          const lineTxt = `${x.row.tag ? "（" + x.row.tag + "）" : ""}${x.arr.type || "串件"} · ${x.arr.content || "（空）"}　负责：${x.row.owner || "未指派"}${x.row.participants ? "　参与：" + x.row.participants : ""}${x.row.note ? "　备注：" + x.row.note : ""}`;
          rows.push(new TableRow({ children: [new TableCell({
            columnSpan: S, shading: { fill: C.warnBg }, verticalAlign: VerticalAlign.CENTER,
            margins: { top: 40, bottom: 40, left: 140, right: 120 },
            borders: cardBorders,
            children: [p({ spacing: { after: 0 }, children: [new TextRun({ text: lineTxt, color: C.warnTxt, size: 20 })] })],
          })] }));
        });
      }
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: Array.from({ length: S }, () => colW),
        layout: TableLayoutType.FIXED,
        rows,
      }));
    });
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE, width: mm(297), height: mm(210) },
            margin: { top: mm(12), right: mm(12), bottom: mm(12), left: mm(12) },
          },
        },
        children,
      }],
    });
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `换发准备单_甘特图_${stampDate()}.docx`);
    props.store.notifyOk("甘特 Word 已导出");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "Word 导出失败", "err");
  } finally {
    wordExportBusy.value = false;
  }
}

// 手册清单表格导出：工包工卡 + 换发工卡 + 串件工卡 合并导出（串件工卡单独一个 sheet）
async function exportDocsXlsx(): Promise<void> {
  const s = state.value; if (!s) return;
  const d = ensureDocs(s);
  const wpEng: unknown[][] = [["序号", "工卡号", "工卡名称", "领用人"]];
  [...(d.wp as Array<Record<string, string>>), ...(d.eng as Array<Record<string, string>>)].forEach((x, i) => {
    wpEng.push([i + 1, x.jc || "", x.name || "", ""]);
  });
  const spList = getSpArrangements();
  const sp: unknown[][] = [["序号", "类型", "串件内容", "拆/装", "工卡号", "工卡名称"]];
  spList.forEach((a, i) => {
    a.rows.forEach((r, ri) => {
      sp.push([ri === 0 ? i + 1 : "", a.type || "", ri === 0 ? a.content || "" : "", r.tag || "", r.jc || "", r.name || ""]);
    });
  });
  if (!wpEng.length && !spList.length) { props.store.notify("手册清单暂无数据"); return; }
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(wpEng);
    ws1["!cols"] = [{ wch: 6 }, { wch: 24 }, { wch: 50 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws1, "手册清单");
    if (spList.length) {
      const ws2 = XLSX.utils.aoa_to_sheet(sp);
      ws2["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 26 }, { wch: 8 }, { wch: 24 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, ws2, "串件工卡");
    }
    XLSX.writeFile(wb, `手册清单_${stampDate()}.xlsx`);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "xlsx 导出失败", "err");
  }
}
// 换发工卡导出（数据表单：序号/工卡号/工卡名称）
async function exportEngXlsx(): Promise<void> {
  const s = state.value; if (!s) return;
  const d = ensureDocs(s);
  const eng = d.eng as Array<Record<string, string>>;
  if (!eng.length) { props.store.notify("换发工卡暂无数据"); return; }
  const rows: unknown[][] = [["序号", "工卡号", "工卡名称"]];
  eng.forEach((x, i) => rows.push([i + 1, x.jc || "", x.name || ""]));
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 24 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, ws, "换发工卡");
    XLSX.writeFile(wb, `换发工卡_${stampDate()}.xlsx`);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "xlsx 导出失败", "err");
  }
}
// 换发工卡导入：追加 docs.eng（兼容 带序号三列 / 无序号两列 / 含表头）
async function importEngXlsx(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const s = state.value; if (!s) return;
  const d = ensureDocs(s);
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
    let n = 0;
    rows.forEach((r) => {
      const cells = r.map((v) => String(v || "").trim());
      if (cells.some((c) => /工卡|序号/.test(c))) return; // 表头
      const jc = cells.length >= 3 ? cells[1] : cells[0] || "";
      const name = cells.length >= 3 ? cells[2] : cells[1] || "";
      if (!jc && !name) return;
      (d.eng as Array<Record<string, string>>).push({ jc, name });
      n++;
    });
    save();
    engImportOpen.value = false;
    props.store.notify(`换发工卡导入完成：${n} 条`, "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "解析失败", "err");
  }
}
// 串件工卡导出（数据表单：序号/类型/串件内容/拆装/工卡号/工卡名称；拆装行独立）
async function exportSpXlsx(): Promise<void> {
  const s = state.value; if (!s) return;
  const spList = getSpArrangements();
  if (!spList.length) { props.store.notify("串件工卡暂无数据"); return; }
  const rows: unknown[][] = [["序号", "类型", "串件内容", "拆/装", "工卡号", "工卡名称"]];
  spList.forEach((a, i) => {
    a.rows.forEach((r, ri) => {
      rows.push([ri === 0 ? i + 1 : "", a.type || "", ri === 0 ? a.content || "" : "", r.tag || "", r.jc || "", r.name || ""]);
    });
  });
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 26 }, { wch: 8 }, { wch: 24 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, "串件工卡");
    XLSX.writeFile(wb, `串件工卡_${stampDate()}.xlsx`);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "xlsx 导出失败", "err");
  }
}
// 串件工卡导入：按 类型+内容+拆装 匹配现有行更新工卡号/名称；未匹配则新建串件安排
async function importSpXlsx(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const s = state.value; if (!s) return;
  const spList = ensureSpArrangements(s);
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
    let n = 0;
    rows.forEach((r) => {
      const cells = r.map((v) => String(v || "").trim());
      if (cells.some((c) => /序号|工卡/.test(c))) return; // 表头
      const type = cells.length >= 4 ? cells[1] : cells[0] || "";
      const content = cells.length >= 4 ? cells[2] : cells[1] || "";
      const tag = cells.length >= 4 ? cells[3] : cells[2] || "";
      const jc = cells.length >= 4 ? cells[4] : cells[3] || "";
      const name = cells.length >= 4 ? cells[5] : cells[4] || "";
      if (!jc && !name) return;
      let arr = spList.find((x) => x.type === type && x.content === content);
      if (arr) {
        const row = arr.rows.find((x) => x.tag === tag) || arr.rows[0];
        if (row) { row.jc = jc; row.name = name; }
      } else {
        arr = {
          id: genId(), type: type || "串件", content, jc: "", name: "",
          rows: [{
            id: genId(), tag: (tag as "拆" | "装" | "") || (type === "串件" ? "拆" : type === "单拆" ? "拆" : type === "单装" ? "装" : ""),
            owner: "", participants: "", note: "", jc, name, executeStage: null,
          }],
        };
        spList.push(arr);
      }
      n++;
    });
    save();
    spImportOpen.value = false;
    props.store.notify(`串件工卡导入完成：${n} 条`, "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "解析失败", "err");
  }
}
// 串件航材/工具表格导出
async function exportPartsXlsx(): Promise<void> {
  const s = state.value; if (!s) return;
  const isAir = tab.value === "airparts";
  const cards = isAir ? s.airParts : s.toolParts;
  const rows: unknown[][] = isAir ? [["卡片", "件号", "名称", "数量", "备注"]] : [["卡片", "名称", "数量", "备注"]];
  cards.forEach((card) => {
    card.items.forEach((it) => {
      if (isAir) rows.push([card.name, (it as any).pn || "", it.name || "", it.qty ?? "", it.note || ""]);
      else rows.push([card.name, it.name || "", it.qty ?? "", it.note || ""]);
    });
  });
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = isAir ? [{ wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 8 }, { wch: 24 }] : [{ wch: 20 }, { wch: 24 }, { wch: 8 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, isAir ? "串件航材" : "串件工具");
    XLSX.writeFile(wb, `${isAir ? "串件航材" : "串件工具"}_${stampDate()}.xlsx`);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "xlsx 导出失败", "err");
  }
}
// 串件航材/工具表格导入：列 卡片/件号/名称/数量/备注（工具无件号列）；按卡片名匹配，不存在则新建卡片
async function importPartsXlsx(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const s = state.value; if (!s) return;
  const isAir = tab.value === "airparts";
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
    ensurePartLists(s);
    const list = (isAir ? s.airParts : s.toolParts) as GanttPartList[];
    let n = 0;
    rows.slice(1).forEach((r) => {
      const cardName = String(r[0] || "").trim();
      if (!cardName) return;
      const pn = isAir ? String(r[1] || "").trim() : "";
      const name = String(isAir ? r[2] : r[1] || "").trim();
      if (!name && !pn) return;
      const qty = Number(String(isAir ? r[3] : r[2] || "").trim());
      const note = String(isAir ? r[4] : r[3] || "").trim();
      let card = list.find((c) => c.name === cardName);
      if (!card) { card = { id: genId(), name: cardName, items: [] }; list.push(card); }
      const item: GanttPartListItem = { id: genId(), name, qty: Number.isFinite(qty) ? qty : 1 };
      if (isAir) item.pn = pn;
      if (note) item.note = note;
      card.items.push(item);
      n++;
    });
    save();
    props.store.notify(`串件${isAir ? "航材" : "工具"}导入完成：${n} 条`, "ok");
  } catch (err) {
    props.store.notify(err instanceof Error ? err.message : "解析失败", "err");
  }
}
// 串件工具清单「下载现场管控单」：下载「定检工具现场管控单(单项工作).docx」（优先按文件名，其次按类型「单独项目」）
async function downloadSpControlDoc(): Promise<void> {
  try {
    const res = await backend.listControlDocs();
    const list = (res.data || []) as Array<{ _id: string; type: string; fileName: string }>;
    const doc = list.find((d) => d.fileName === "定检工具现场管控单(单项工作).docx") || list.find((d) => d.type === "单独项目");
    if (!doc) { props.store.notify("尚未上传「定检工具现场管控单(单项工作).docx」的现场管控单"); return; }
    const urlRes = await backend.getControlDocUrl(doc._id);
    const url = urlRes.data?.downloadUrl;
    if (!url) { props.store.notify("未获取到下载链接"); return; }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = doc.fileName || "";
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "下载失败", "err");
  }
}
async function importAllXlsx(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const s = state.value; if (!s) return;
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    let added = 0;
    wb.SheetNames.forEach((name) => {
      if (!/工序/.test(name)) return;
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      // 旧格式兼容：sheet 名可能为「DAY n」（每 DAY 一个 sheet）；支持负数/小数编号
      const sheetDayMatch = name.match(/DAY\s*(-?\d+(?:\.\d+)?)/i);
      const sheetDay = sheetDayMatch ? Number(sheetDayMatch[1]) : NaN;
      rows.slice(1).forEach((row) => {
        // 列映射与导出一致：DAY | 阶段 | 内容 | 负责人 | 参与人 | 备注
        const dayText = String(row[0] || "").trim();
        const stageName = String(row[1] || "").trim();
        const content = String(row[2] || "").trim();
        const owner = String(row[3] || "").trim();
        const participants = String(row[4] || "").trim();
        const note = String(row[5] || "").trim();
        if (!content) return;
        // DAY 解析：行内 DAY 列优先（"DAY 1"/"DAY 0"/"DAY -1"/"DAY 1.5"），无则回退 sheet 名
        const dm = dayText.match(/DAY\s*(-?\d+(?:\.\d+)?)/i);
        let dayNum = dm ? Number(dm[1]) : NaN;
        if (!Number.isFinite(dayNum)) dayNum = Number.isFinite(sheetDay) ? sheetDay : NaN;
        let chart = Number.isFinite(dayNum) ? s.charts.find((c) => c.day === dayNum) : undefined;
        if (!chart && Number.isFinite(dayNum)) {
          // 导入数据含新 DAY：自动新建 DAY 卡片（默认无阶段，日期按 chartDateFor 规则）
          const last = s.charts[s.charts.length - 1];
          chart = {
            id: genId(), title: `DAY ${dayNum}`, date: chartDateFor(dayNum), day: dayNum, collapsed: false,
            responsibilities: (last?.responsibilities?.length ? last.responsibilities : DEFAULT_RESP.map((l) => ({ id: genId(), label: l, name: "" })))
              .map((r) => ({ id: genId(), label: r.label, name: r.name })),
            stages: [], lanes: [], cards: [], parts: [],
          };
          s.charts.push(chart);
          s.charts.sort((a, b) => a.day - b.day);
        }
        if (!chart) chart = s.charts[0];
        if (!chart) return;
        const stageMap = new Map<string, number>();
        chart.stages.forEach((st, i) => stageMap.set(st.name, i));
        let si = stageMap.get(stageName);
        if (si === undefined) { chart.stages.push({ id: genId(), name: stageName || "新阶段" }); si = chart.stages.length - 1; stageMap.set(stageName, si); }
        chart.cards.push({ id: genId(), laneId: "", content, owner, participants, note, startStage: si, endStage: si, order: chart.cards.length });
        added++;
      });
    });
    save();
    props.store.notify(`xlsx 导入完成：工序 ${added} 条`, "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "xlsx 解析失败", "err");
  }
}
</script>

<template>
  <div class="gantt-page" :class="{ 'gantt-wide': tab === 'gantt' }" @input="onAnyInput">
    <!-- 拖拽目标位置占位虚线框 -->
    <div v-if="dragGhost" class="drag-ghost" :style="{ left: dragGhost.left + 'px', top: dragGhost.top + 'px', width: dragGhost.width + 'px', height: dragGhost.height + 'px' }"></div>
    <!-- 填空框上传中蒙版：输入后上传未完成时叠加灰蒙 + "……" -->
    <div v-if="maskVisible" class="save-mask" :style="maskStyle"><span class="dots"><i></i><i></i><i></i></span></div>
    <!-- 参与人名单侧边栏 -->
    <aside v-if="state" class="participant-panel">
      <h3>参与人名单</h3>
      <div class="participant-sec">手动名单（绿底=与检测重合）</div>
      <div class="participant-grid">
        <div v-for="n in manualParticipants" :key="n" class="chip manual" :class="{ match: allParticipants.includes(n) }" :title="allParticipants.includes(n) ? '与检测名单重合' : '手动添加(未在检测名单中)'" @click="removeManualParticipant(n)">{{ n }}<span class="chip-x">×</span></div>
        <div v-if="!manualParticipants.length" class="participant-empty">未手动输入姓名</div>
      </div>
      <div class="participant-sec">自动检测（按 DAY）</div>
      <template v-for="c in state.charts" :key="c.id">
        <div class="participant-day-label" @click="gotoDay(c.day)">DAY {{ c.day }}（自动检测）↗</div>
        <div class="participant-grid">
          <div v-for="n in collectChartParticipants(c)" :key="n" class="chip" :class="{ match: manualParticipants.includes(n) }">{{ n }}</div>
          <div v-if="!collectChartParticipants(c).length" class="participant-empty">本天暂无</div>
        </div>
      </template>
      <div v-if="!state.charts.length" class="participant-empty">暂无 DAY 数据</div>
    </aside>

    <!-- 主区 -->
    <div class="main-area" id="gp-main-area" ref="mainAreaRef">
      <div class="subpage-head">
        <input class="gp-title-input" v-model="templateName" placeholder="工作准备单（甘特）" @change="save" @input="save" v-lock="lockKey('title', 'main', 'templateName')" />
        <button class="ghost" @click="openTplModal('load')">调取模板</button>
        <button class="ghost" @click="openTplModal('save')">保存模板</button>
        <span class="toolbar-sep" />
        <div class="subpage-actions top-actions">
          <button class="ghost" @click="emit('share')">分享本页</button>
          <button class="ghost" title="强制推送后台" @click="props.store.saveNow()">保存</button>
          <button class="ghost" title="强制同步数据" @click="props.store.refresh()">刷新</button>
          <button class="danger" @click="clearGanttAll">清空数据</button>
        </div>
      </div>

      <nav class="tabs gp-tabs">
        <button class="tab" :class="{ active: tab === 'form' }" @click="tab = 'form'">表单录入</button>
        <button class="tab" :class="{ active: tab === 'gantt' }" @click="tab = 'gantt'">甘特图</button>
        <button class="tab" :class="{ active: tab === 'docs' }" @click="tab = 'docs'">手册清单</button>
        <button class="tab" :class="{ active: tab === 'airparts' }" @click="tab = 'airparts'; onPartTabEnter()">串件航材清单</button>
        <button class="tab" :class="{ active: tab === 'tools' }" @click="tab = 'tools'; onPartTabEnter()">串件工具清单</button>
      </nav>

      <!-- 姓名联想候选（datalist，全局复用） -->
      <datalist id="gp-participants">
        <option v-for="n in participantSuggestions" :key="n" :value="n" />
      </datalist>
      <datalist id="gp-part-contents">
        <option v-for="n in partContentSuggestions" :key="n" :value="n" />
      </datalist>
      <datalist id="gp-aircraft-numbers">
        <option v-for="n in store.aircraftNumbers.value" :key="n" :value="n" />
      </datalist>

      <template v-if="state">
        <!-- 表单录入 -->
        <div v-if="tab === 'form'" class="gp-form">
          <div class="subpage-head">
            <div class="subpage-actions">
              <label class="button ghost">导入表格<input hidden type="file" accept=".xlsx,.xls" @change="importAllXlsx" /></label>
              <button class="ghost" @click="exportAllXlsx">导出表格</button>
              <button class="ghost" @click="exportDocx">导出 Word</button>
              <button class="ghost" :class="{ 'is-loading': store.imageExportBusy.value }" :disabled="store.imageExportBusy.value" @click="exportAllImage">导出图片</button>
            </div>
          </div>
          <!-- 全局飞机/项目信息 -->
          <section class="gp-section">
            <div class="gp-sec-title">飞机信息</div>
            <div v-for="(a, i) in aircrafts" :key="a.id" class="meta-group">
              <div class="meta-grid meta-grid-4">
                <label class="gpf"><span class="gpf-label">机号</span><input v-model="a.reg" list="gp-aircraft-numbers" @change="onAircraftRegChange(a)" @input="save" v-lock="lockKey('aircraft', a.id, 'reg')" /></label>
                <label class="gpf"><span class="gpf-label">FSN</span><input v-model="a.fsn" @change="onAircraftFieldEdited(a)" @input="save" v-lock="lockKey('aircraft', a.id, 'fsn')" /></label>
                <label class="gpf"><span class="gpf-label">MSN</span><input v-model="a.msn" @change="onAircraftFieldEdited(a)" @input="save" v-lock="lockKey('aircraft', a.id, 'msn')" /></label>
                <label class="gpf"><span class="gpf-label">发动机</span><input v-model="a.engine" @change="onAircraftFieldEdited(a)" @input="save" v-lock="lockKey('aircraft', a.id, 'engine')" /></label>
                <label class="gpf"><span class="gpf-label">机型</span><input v-model="a.type" @change="onAircraftFieldEdited(a)" @input="save" v-lock="lockKey('aircraft', a.id, 'type')" /></label>
                <label class="gpf"><span class="gpf-label">ETOPS</span><input v-model="a.etops" @change="onAircraftFieldEdited(a)" @input="save" v-lock="lockKey('aircraft', a.id, 'etops')" /></label>
                <label class="gpf"><span class="gpf-label">ELT-DT</span>
                  <div class="meta-type-row">
                    <input v-model="a.eltDt" @change="onAircraftFieldEdited(a)" @input="save" v-lock="lockKey('aircraft', a.id, 'eltDt')" />
                    <button class="icon-btn meta-x" title="删除该飞机" @click="removeAircraft(a.id)">×</button>
                  </div>
                </label>
              </div>
              <hr v-if="i < aircrafts.length - 1" class="meta-divider" />
            </div>
            <button class="gp-add" @click="addAircraft">+ 新增飞机</button>
          </section>

          <section class="gp-section">
            <div class="gp-sec-title">项目安排</div>
            <div class="arrange-row arrange-row-3">
              <label class="gpf"><span class="gpf-label">项目经理</span><textarea class="textwrap" rows="1" v-model="arrangement.manager" @input="save" v-lock="lockKey('arrangement', 'single', 'manager')"></textarea></label>
              <label class="gpf"><span class="gpf-label">值班组</span><textarea class="textwrap" rows="1" v-model="arrangement.dutyGroup" @input="save" v-lock="lockKey('arrangement', 'single', 'dutyGroup')"></textarea></label>
              <label class="gpf"><span class="gpf-label">执行地点</span><textarea class="textwrap" rows="1" v-model="arrangement.location" @input="save" v-lock="lockKey('arrangement', 'single', 'location')"></textarea></label>
            </div>
            <div class="arrange-divider" />
            <div class="arrange-row arrange-participants-row">
              <label class="gpf"><span class="gpf-label">参与人员</span><textarea class="participant-input textwrap" rows="1" v-model="participantInput" placeholder="例如：张三、李四（停止编辑即同步名单）" @keydown="onParticipantInputKeydown" @blur="onParticipantInputBlur" v-lock="lockKey('arrangement', 'single', 'participants')"></textarea></label>
            </div>
            <div class="arrange-divider" />
            <div class="arrange-row arrange-row-2">
              <label class="gpf"><span class="gpf-label">指令号</span><textarea class="textwrap" rows="1" v-model="arrangement.orderNo" @input="save" v-lock="lockKey('arrangement', 'single', 'orderNo')"></textarea></label>
              <label class="gpf"><span class="gpf-label">指令名称</span><textarea class="textwrap" rows="1" v-model="arrangement.orderName" @input="save" v-lock="lockKey('arrangement', 'single', 'orderName')"></textarea></label>
            </div>
            <div class="arrange-items">
              <div v-for="it in arrangementItems" :key="it.id" class="arrange-item">
                <label class="gpf"><span class="gpf-label">内容</span><textarea class="textwrap" rows="1" v-model="it.content" @input="save" v-lock="lockKey('arrangeitem', it.id, 'content')"></textarea></label>
                <label class="gpf"><span class="gpf-label">安排</span><textarea class="textwrap" rows="1" v-model="it.assign" @input="save" v-lock="lockKey('arrangeitem', it.id, 'assign')"></textarea></label>
                <button class="icon-btn" @click="removeArrangementItem(it.id)">×</button>
              </div>
            </div>
            <button class="gp-add" @click="addArrangementItem">+ 新增安排</button>
          </section>

          <section class="gp-section">
            <div class="gp-sec-title">部件卡片</div>
            <div v-for="(c, i) in components" :key="c.id" class="component-card">
              <div class="meta-group-head">
                <label class="gpf component-name-wrap"><input v-model="c.name" class="component-name-input" :placeholder="`部件卡片 ${i + 1} 名称`" @input="save" v-lock="lockKey('component', c.id, 'name')" /></label>
                <button class="icon-btn" @click="removeComponent(c.id)">×</button>
              </div>
              <div class="component-cols">
                <div class="component-col">
                  <div class="component-tag off">拆下件</div>
                  <label class="gpf"><span class="gpf-label">件号</span><textarea class="textwrap" rows="1" v-model="c.offPn" @input="save" v-lock="lockKey('component', c.id, 'offPn')"></textarea></label>
                  <label class="gpf"><span class="gpf-label">序号</span><textarea class="textwrap" rows="1" v-model="c.offSn" @input="save" v-lock="lockKey('component', c.id, 'offSn')"></textarea></label>
                </div>
                <div class="component-col">
                  <div class="component-tag on">装上件</div>
                  <label class="gpf"><span class="gpf-label">件号</span><textarea class="textwrap" rows="1" v-model="c.onPn" @input="save" v-lock="lockKey('component', c.id, 'onPn')"></textarea></label>
                  <label class="gpf"><span class="gpf-label">序号</span><textarea class="textwrap" rows="1" v-model="c.onSn" @input="save" v-lock="lockKey('component', c.id, 'onSn')"></textarea></label>
                </div>
              </div>
            </div>
            <button class="gp-add" @click="addComponent">+ 新增部件卡片</button>
          </section>

          <section class="gp-section">
            <div class="gp-sec-title">串件安排</div>
            <div class="part-rule">全局统筹所有串件安排（不再跟随 DAY 卡片）：类型「串件」含拆/装两行（负责人前带（拆）（装）标识，数据独立）；执行阶段可跨所有 DAY 选择，未分配项显示在甘特图「未分配串件」区并可拖曳分配。</div>
            <table class="parts-table sp-arr-table">
              <thead><tr><th style="width:80px">类型</th><th style="width:24%">串件内容</th><th style="width:120px">负责人</th><th style="width:130px">参与人</th><th>备注</th><th style="width:170px">执行阶段</th><th class="col-act">×</th></tr></thead>
              <tbody>
                <template v-for="a in getSpArrangements()" :key="a.id">
                  <tr v-for="(r, ri) in a.rows" :key="r.id">
                    <td v-if="ri === 0" :rowspan="a.rows.length">
                      <select :value="a.type" @change="changeSpType(a, ($event.target as HTMLSelectElement).value)">
                        <option v-for="t in DEFAULT_PARTS_TYPES" :key="t" :value="t">{{ t }}</option>
                        <option v-if="a.type && !DEFAULT_PARTS_TYPES.includes(a.type)" :value="a.type">{{ a.type }}</option>
                      </select>
                    </td>
                    <td v-if="ri === 0" :rowspan="a.rows.length"><textarea class="textwrap" rows="1" v-model="a.content" placeholder="串件内容" @input="save" :class="{ 'sp-empty': !a.content.trim() }" v-lock="lockKey('spa', a.id, 'content')"></textarea></td>
                    <td :class="{ 'sp-empty-cell': !r.owner.trim() }"><span class="sp-tag" v-if="r.tag">（{{ r.tag }}）</span><NameSuggest :model-value="r.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="r.owner = $event; save()" v-lock="lockKey('sprow', r.id, 'owner')" /></td>
                    <td :class="{ 'sp-empty-cell': !r.participants.trim() }"><NameSuggest :model-value="r.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="r.participants = $event; save()" v-lock="lockKey('sprow', r.id, 'participants')" /></td>
                    <td><textarea class="textwrap" rows="1" v-model="r.note" placeholder="备注" @input="save" v-lock="lockKey('sprow', r.id, 'note')"></textarea></td>
                    <td>
                      <select :value="r.executeStage ? r.executeStage.chartId + '::' + r.executeStage.stageIdx : ''" @change="setSpRowStage(r, ($event.target as HTMLSelectElement).value)">
                        <option value="">未选择</option>
                        <option v-for="o in allStageOptions()" :key="o.value" :value="o.value">{{ o.label }}</option>
                      </select>
                    </td>
                    <td v-if="ri === 0" :rowspan="a.rows.length"><button class="icon-btn" title="删除整条串件安排" @click="removeSpArrangement(a.id)">×</button></td>
                  </tr>
                </template>
                <tr v-if="!getSpArrangements().length"><td colspan="7" style="color:var(--muted);text-align:center;padding:12px">暂无串件安排 — 点击下方"新增串件安排"</td></tr>
              </tbody>
            </table>
            <button class="gp-add" @click="addSpArrangement">+ 新增串件安排</button>
          </section>

          <!-- 每个 DAY 的表单卡片 -->
          <section v-for="chart in state.charts" :key="chart.id" class="gp-card day-card" :id="'day-' + chart.id">
            <div class="chart-header">
              <div class="chart-title-row">
                <button class="collapse-btn" @click="toggleCollapse(chart.id)" :title="chart.collapsed ? '展开本天' : '收起本天'">{{ chart.collapsed ? '▶' : '▼' }}</button>
                <input class="date-input" type="date" v-model="chart.date" @change="save" title="日期(日历选择)" v-lock="lockKey('chart', chart.id, 'date')" />
                <span class="day-label">DAY</span><input v-model.number="chart.day" class="day-input" @change="normalizeDay(chart)" title="DAY 计数" v-lock="lockKey('chart', chart.id, 'day')" />
                <input v-model="chart.title" class="chart-title-input" @change="save" title="标题" v-lock="lockKey('chart', chart.id, 'title')" />
              </div>
              <div class="chart-toolbar">
                <button @click="addDayAfter(chart.id)">+ 增加一天</button>
                <button @click="addStage(chart.id)">+ 阶段</button>
                <button class="danger" @click="deleteChart(chart.id)">删除本天</button>
              </div>
            </div>

            <template v-if="!chart.collapsed">
              <div class="gp-sec-title">顶部责任 (各项负责)</div>
              <div class="resp-banner">
                <div v-for="r in chart.responsibilities" :key="r.id" class="resp-cell">
                  <input v-model="r.label" class="resp-label-input" title="负责内容" @input="save" v-lock="lockKey('resp', r.id, 'label')" />
                  <span class="resp-colon">:</span>
                  <NameSuggest :model-value="r.name" :suggestions="participantSuggestions" placeholder="姓名" @update:model-value="r.name = $event; save()" v-lock="lockKey('resp', r.id, 'name')" />
                  <button class="icon-btn resp-del" @click="removeResp(chart.id, r.id)">×</button>
                </div>
                <div class="resp-cell resp-add"><button @click="addResp(chart.id)">+ 添加安排</button></div>
              </div>

              <div class="gp-sec-title">工序卡片（按起阶段分组）</div>
              <div class="gp-stage-list">
                <div v-for="(st, si) in chart.stages" :key="st.id" class="form-stage-card">
                  <div class="form-stage-head">
                    <div class="form-stage-drag" title="拖动调整阶段顺序" @pointerdown="startFormStageDrag($event, chart.id, si)">⠿</div>
                    <input v-model="st.name" @input="save" v-lock="lockKey('stage', st.id, 'name')" />
                    <select v-if="dayOptionsExcluding(chart.id).length" class="day-move-select form" :value="''" title="迁移整个阶段到其它 DAY" @change="moveStageToChart(chart.id, si, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
                      <option value="" disabled>⇄ 移 DAY</option>
                      <option v-for="c in dayOptionsExcluding(chart.id)" :key="c.id" :value="c.id">{{ c.label }}</option>
                    </select>
                    <button class="icon-btn" title="在当前位置前插入阶段" @click="insertStage(chart.id, si)">+插</button>
                    <button class="icon-btn" @click="removeStage(chart.id, si)">×</button>
                  </div>
                  <div class="form-stage-body">
                    <div v-for="card in cardsOfStage(chart, si)" :key="card.id" class="form-card-row">
                      <div class="form-card-title">
                        <div class="form-card-drag" title="拖动调行序" @pointerdown="startFormCardDrag($event, chart.id, card.id)">⠿</div>
                        <textarea class="textwrap" rows="1" v-model="card.content" placeholder="工作内容" @input="save" v-lock="lockKey('card', card.id, 'content')"></textarea>
                      </div>
                      <NameSuggest class="ns-owner" :model-value="card.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="card.owner = $event; save()" v-lock="lockKey('card', card.id, 'owner')" />
                      <NameSuggest :model-value="card.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="card.participants = $event; save()" v-lock="lockKey('card', card.id, 'participants')" />
                      <textarea class="textwrap" rows="1" v-model="card.note" placeholder="备注" @input="save" v-lock="lockKey('card', card.id, 'note')"></textarea>
                      <span v-if="card.endStage > card.startStage" class="fc-span">持续至「{{ chart.stages[card.endStage]?.name }}」</span>
                      <button class="icon-btn" @click="deleteCard(chart.id, card.id)">×</button>
                    </div>
                    <div v-for="x in spRowsOfStage(chart.id, si)" :key="'sp' + x.row.id" class="form-card-row part-form-row">
                      <span class="part-form-tag">{{ x.row.tag ? '（' + x.row.tag + '）' : '' }}{{ x.arr.type }}</span>
                      <span class="sp-view-content" :title="x.arr.content">{{ x.arr.content }}</span>
                      <NameSuggest :model-value="x.row.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="x.row.owner = $event; save()" v-lock="lockKey('sprow', x.row.id, 'owner')" />
                      <NameSuggest :model-value="x.row.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="x.row.participants = $event; save()" v-lock="lockKey('sprow', x.row.id, 'participants')" />
                      <textarea class="textwrap" rows="1" v-model="x.row.note" placeholder="备注" @input="save" v-lock="lockKey('sprow', x.row.id, 'note')"></textarea>
                      <button class="icon-btn" title="删除原分配的阶段（串件仍在串件安排中）" @click="clearSpStage(x.arr.id, x.row.id)">×</button>
                    </div>
                    <div v-if="!cardsOfStage(chart, si).length && !spRowsOfStage(chart.id, si).length" class="stage-empty">无工序</div>
                  </div>
                  <button class="add-form-card-btn" @click="addCard(chart.id, si)">+ 添加工序卡片</button>
                </div>
              </div>
            </template>
          </section>

          <button class="add-day-card" @click="addChart"><span>+ 增加一天</span></button>
          <AttachmentSection :store="store" />
        </div>

        <!-- 甘特图 -->
        <div v-else-if="tab === 'gantt'" class="gp-gantt">
          <div class="subpage-head">
            <div class="subpage-actions">
              <button class="ghost" :class="{ 'is-loading': store.imageExportBusy.value }" :disabled="store.imageExportBusy.value" @click="exportAllImage">导出图片</button>
              <button class="ghost" :class="{ 'is-loading': wordExportBusy }" :disabled="wordExportBusy" @click="exportGanttWord" title="导出 Word（A4 横向）：每 DAY 一页 Word 原生表格，阶段为横列表头、工序卡跨起止阶段合并列，维持网页甘特图布局">导出 Word</button>
              <button class="ghost" :class="{ 'is-loading': ganttXlsxBusy }" :disabled="ganttXlsxBusy" @click="exportGanttXlsx" title="导出 Excel：仿工序计划模板体例，与网页甘特一致按泳道行排版——同一行不同阶段工序并排、卡跨起止阶段合并多列，三行节奏(标题/人员/备注)">导出 Excel</button>
            </div>
          </div>
          <section v-for="chart in state.charts" :key="chart.id" class="gp-card day-card" :id="'day-' + chart.id">
            <div class="chart-header">
              <div class="chart-title-row">
                <button class="collapse-btn" @click="toggleCollapse(chart.id)" :title="chart.collapsed ? '展开本天' : '收起本天'">{{ chart.collapsed ? '▶' : '▼' }}</button>
                <input class="date-input" type="date" v-model="chart.date" @change="save" v-lock="lockKey('chart', chart.id, 'date')" />
                <span class="day-label">DAY</span><input v-model.number="chart.day" class="day-input" @change="normalizeDay(chart)" v-lock="lockKey('chart', chart.id, 'day')" />
                <input v-model="chart.title" class="chart-title-input" @change="save" v-lock="lockKey('chart', chart.id, 'title')" />
              </div>
              <div class="chart-toolbar">
                <button @click="addStage(chart.id)">+ 阶段</button>
                <button @click="addDayAfter(chart.id)">+ 增加一天</button>
                <button class="danger" @click="deleteChart(chart.id)">删除本天</button>
              </div>
            </div>
            <div v-if="chart.collapsed" class="stage-capsules">
              <span v-for="st in chart.stages" :key="st.id" class="stage-capsule">{{ st.name }}</span>
            </div>

            <template v-if="!chart.collapsed">
              <div class="resp-banner">
                <div v-for="r in chart.responsibilities" :key="r.id" class="resp-cell">
                  <input v-model="r.label" class="resp-label-input" @input="save" v-lock="lockKey('resp', r.id, 'label')" /><span class="resp-colon">:</span>
                  <NameSuggest :model-value="r.name" :suggestions="participantSuggestions" placeholder="姓名" @update:model-value="r.name = $event; save()" v-lock="lockKey('resp', r.id, 'name')" />
                  <button class="icon-btn resp-del" @click="removeResp(chart.id, r.id)">×</button>
                </div>
                <div class="resp-cell resp-add"><button @click="addResp(chart.id)">+ 添加安排</button></div>
              </div>
              <div class="gantt-wrap">
                <div class="gantt-grid" :style="{ gridTemplateColumns: `repeat(${chart.stages.length}, minmax(40px, min(calc(100% / ${chart.stages.length}), 20%)))`, gridTemplateRows: `44px repeat(${rowCountOf(chart)}, auto)` }">
                  <div v-for="(st, si) in chart.stages" :key="st.id" class="gantt-head" :style="{ gridColumn: si + 1, gridRow: 1 }">
                    <div class="stage-col-drag" title="拖动调整列位置" @pointerdown="startStageColDrag($event, chart.id, si)">⠿</div>
                    <input v-model="st.name" class="stage-name-input" @input="save" v-lock="lockKey('stage', st.id, 'name')" />
                    <span class="stage-split" @click.stop>
                      <button class="add-card-btn stage-split-main" title="本列添加工序" @click="addCard(chart.id, si)">+工序</button>
                      <button class="stage-split-arrow" title="更多操作" @click="toggleStageMenu(chart.id, si)">▾</button>
                      <div v-if="stageMenuOpen === `${chart.id}:${si}`" class="stage-split-menu">
                        <template v-if="dayOptionsExcluding(chart.id).length">
                          <span class="ssm-label">移到其它 DAY</span>
                          <button v-for="c in dayOptionsExcluding(chart.id)" :key="c.id" @click="stageMenuOpen = null; moveStageToChart(chart.id, si, c.id)">{{ c.label }}</button>
                        </template>
                        <button @click="stageMenuOpen = null; insertStage(chart.id, si)">+ 插入阶段</button>
                        <button class="danger" @click="stageMenuOpen = null; removeStage(chart.id, si)">× 删除阶段</button>
                      </div>
                    </span>
                  </div>
                  <div v-for="card in chart.cards" :key="card.id" class="card-slot" :style="{ gridColumn: `${card.startStage + 1}/${card.endStage + 2}`, gridRow: (ganttRows(chart)[card.id] ?? 0) + 2 }">
                    <div class="gantt-card">
                      <div class="card-grip" title="拖动: 横移改阶段 / 纵移调行序" @pointerdown="startCardDrag($event, 'move', chart.id, card.id)">⠿</div>
                      <div class="resize-l" title="拖左边缘改开始阶段" @pointerdown="startCardDrag($event, 'resize-left', chart.id, card.id)"></div>
                      <div class="resize-r" title="拖右边缘改结束阶段" @pointerdown="startCardDrag($event, 'resize-right', chart.id, card.id)"></div>
                      <button class="card-close" title="删除工序" @click="deleteCard(chart.id, card.id)">✕</button>
                      <div class="card-body">
                        <textarea class="f-content" v-model="card.content" placeholder="工作内容" @input="save" rows="1" v-lock="lockKey('card', card.id, 'content')"></textarea>
                        <div class="people-row"><span class="pl">负责</span><NameSuggest :model-value="card.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="card.owner = $event; save()" v-lock="lockKey('card', card.id, 'owner')" /></div>
                        <div class="people-row"><span class="pl">参与</span><NameSuggest :model-value="card.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="card.participants = $event; save()" v-lock="lockKey('card', card.id, 'participants')" /></div>
                        <textarea class="f-note" v-model="card.note" placeholder="备注(红色提示)" @input="save" rows="1" v-lock="lockKey('card', card.id, 'note')"></textarea>
                      </div>
                    </div>
                  </div>
                  <div v-for="x in spCardsOfChart(chart)" :key="'sp' + x.row.id" class="card-slot" :style="{ gridColumn: `${x.stageIdx + 1}/${x.stageIdx + 2}`, gridRow: (ganttRows(chart)['sp:' + x.row.id] ?? 0) + 2 }">
                    <div class="gantt-card part-item">
                      <div class="card-grip" title="拖动: 同 DAY 内换阶段" @pointerdown="startPartDrag($event, chart.id, x.arr.id, x.row.id)">⠿</div>
                      <button class="card-close" title="删除原分配的阶段（串件仍在串件安排中）" @click="clearSpStage(x.arr.id, x.row.id)">✕</button>
                      <div class="card-body">
                        <div class="sp-title-row">
                          <span class="part-tag">{{ x.row.tag ? '（' + x.row.tag + '）' : '' }}{{ x.arr.type }}</span>
                          <textarea class="f-content sp-view-content" rows="1" v-model="x.arr.content" placeholder="（空）" @input="save" v-lock="lockKey('spa', x.arr.id, 'content')"></textarea>
                        </div>
                        <div class="people-row"><span class="pl">负责</span><NameSuggest :model-value="x.row.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="x.row.owner = $event; save()" v-lock="lockKey('sprow', x.row.id, 'owner')" /></div>
                        <div class="people-row"><span class="pl">参与</span><NameSuggest :model-value="x.row.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="x.row.participants = $event; save()" v-lock="lockKey('sprow', x.row.id, 'participants')" /></div>
                        <textarea class="f-note" v-model="x.row.note" placeholder="备注" @input="save" rows="1" v-lock="lockKey('sprow', x.row.id, 'note')"></textarea>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="stage-edge" title="拖拽增减阶段数（右加左减）" @pointerdown="startStageDrag($event, chart.id)">⋮</div>
              </div>
              <div v-if="unassignedSpRows().length" class="unassigned-banner">
                <div class="unassigned-banner-h">
                  <span>▲ 未分配串件 ({{ unassignedSpRows().length }})</span>
                  <span class="part-rule">拖拽到本 DAY 的阶段列即可分配</span>
                </div>
                <div class="unassigned-grid">
                  <div v-for="x in unassignedSpRows()" :key="'u' + x.row.id" class="gantt-card unassigned">
                    <span class="card-warn">▲</span>
                    <div class="card-grip" title="拖动到甘特图阶段列以分配" @pointerdown="startUnassignedDrag($event, chart.id, x.arr.id, x.row.id)">⠿</div>
                    <div class="card-body">
                      <div class="sp-title-row">
                        <span class="part-tag">{{ x.row.tag ? '（' + x.row.tag + '）' : '' }}{{ x.arr.type }}</span>
                        <textarea class="f-content sp-view-content" rows="1" v-model="x.arr.content" placeholder="（空）" @input="save"></textarea>
                      </div>
                      <div class="people-row"><span class="pl">负责</span><span>{{ x.row.owner || '未指派' }}</span></div>
                      <div class="people-row"><span class="pl">参与</span><span>{{ x.row.participants }}</span></div>
                      <span v-if="x.row.note" class="sp-view-note">{{ x.row.note }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </section>
          <button class="add-day-card" @click="addChart"><span>+ 增加一天</span></button>
        </div>

        <!-- 手册清单 -->
        <div v-else-if="tab === 'docs'" class="gp-docs">
          <div class="subpage-head">
            <div class="subpage-actions">
              <button class="ghost" @click="exportDocsXlsx">导出表格</button>
            </div>
          </div>
          <section class="gp-card">
            <div class="gp-docs-head">
              <div class="gp-sec-title">工包工卡</div>
              <label class="button primary" title="导入 AMES线控平台-打印其他 中的《例行工卡清单》（八大件的工卡清单），网页会根据表单自动导入工卡并关联工具、航材">依据工卡清单<input hidden type="file" accept=".xlsx,.xls" @change="importWorkDocList" /></label>
            </div>
            <table class="parts-table">
              <thead><tr><th>工卡号</th><th>工卡名称</th><th class="col-act">×</th></tr></thead>
              <tbody>
                <tr v-for="(x, i) in state.docs.wp" :key="'wp' + i">
                  <td><input v-model="(x as any).jc" placeholder="工卡号" @input="save" v-lock="lockKey('docwp', 'row' + i, 'jc')" /></td>
                  <td><input v-model="(x as any).name" placeholder="工卡名称" @input="save" v-lock="lockKey('docwp', 'row' + i, 'name')" /></td>
                  <td><button class="icon-btn" @click="removeDoc('wp', i)">×</button></td>
                </tr>
              </tbody>
            </table>
            <button class="gp-add" @click="addDoc('wp')">+ 添加</button>
          </section>
          <section class="gp-card">
            <div class="gp-docs-head">
              <div class="gp-sec-title">换发工卡</div>
              <span class="split-btn" @click.stop>
                <button class="ghost" @click="exportEngXlsx">导出换发工卡表格</button>
                <button class="ghost split-arrow" title="更多操作" @click="engImportOpen = !engImportOpen">▾</button>
                <div v-if="engImportOpen" class="split-menu">
                  <label>导入换发工卡表格<input hidden type="file" accept=".xlsx,.xls" @change="importEngXlsx" /></label>
                </div>
              </span>
            </div>
            <table class="parts-table">
              <thead><tr><th>工卡号</th><th>工卡名称</th><th class="col-act">×</th></tr></thead>
              <tbody>
                <tr v-for="(x, i) in state.docs.eng" :key="'eng' + i">
                  <td><input v-model="(x as any).jc" placeholder="工卡号" @input="save" v-lock="lockKey('doceng', 'row' + i, 'jc')" /></td>
                  <td><input v-model="(x as any).name" placeholder="工卡名称" @input="save" v-lock="lockKey('doceng', 'row' + i, 'name')" /></td>
                  <td><button class="icon-btn" @click="removeDoc('eng', i)">×</button></td>
                </tr>
              </tbody>
            </table>
            <button class="gp-add" @click="addDoc('eng')">+ 添加</button>
          </section>
          <section class="gp-card">
            <div class="gp-docs-head">
              <div class="gp-sec-title">串件工卡</div>
              <span class="split-btn" @click.stop>
                <button class="ghost" @click="exportSpXlsx">导出串件工卡表格</button>
                <button class="ghost split-arrow" title="更多操作" @click="spImportOpen = !spImportOpen">▾</button>
                <div v-if="spImportOpen" class="split-menu">
                  <label>导入串件工卡表格<input hidden type="file" accept=".xlsx,.xls" @change="importSpXlsx" /></label>
                </div>
              </span>
            </div>
            <div class="part-rule">数据与「表单录入 → 串件安排」一致；类型「串件」含拆/装两行，工卡号/工卡名称拆装各自独立填写。</div>
            <table class="parts-table sp-table">
              <thead><tr><th style="width:14%">类型</th><th style="width:26%">串件内容</th><th style="width:24%">工卡号</th><th>工卡名称</th><th class="col-act">×</th></tr></thead>
              <tbody>
                <template v-for="a in getSpArrangements()" :key="a.id">
                  <tr v-for="(r, ri) in a.rows" :key="r.id">
                    <td v-if="ri === 0" :rowspan="a.rows.length">
                      <select :value="a.type" @change="changeSpType(a, ($event.target as HTMLSelectElement).value)">
                        <option v-for="t in DEFAULT_PARTS_TYPES" :key="t" :value="t">{{ t }}</option>
                        <option v-if="a.type && !DEFAULT_PARTS_TYPES.includes(a.type)" :value="a.type">{{ a.type }}</option>
                      </select>
                    </td>
                    <td v-if="ri === 0" :rowspan="a.rows.length"><textarea class="textwrap" rows="1" v-model="a.content" placeholder="串件内容" @input="save"></textarea></td>
                    <td><span class="sp-tag" v-if="r.tag">（{{ r.tag }}）</span><input :value="r.jc" placeholder="工卡号" @input="r.jc = ($event.target as HTMLInputElement).value; save()" v-lock="lockKey('sprow', r.id, 'jc')" /></td>
                    <td><span class="sp-tag" v-if="r.tag">（{{ r.tag }}）</span><textarea class="sp-name" rows="1" :value="r.name" placeholder="工卡名称" @input="r.name = ($event.target as HTMLTextAreaElement).value; onPartAutoSize($event)" v-lock="lockKey('sprow', r.id, 'name')"></textarea></td>
                    <td v-if="ri === 0" :rowspan="a.rows.length"><button class="icon-btn" title="删除整条串件安排" @click="removeSpArrangement(a.id)">×</button></td>
                  </tr>
                </template>
                <tr v-if="!getSpArrangements().length"><td colspan="5" style="color:var(--muted);text-align:center;padding:12px">暂无串件安排 — 请到「表单录入 → 串件安排」添加</td></tr>
              </tbody>
            </table>
          </section>
        </div>

        <!-- 串件航材 / 工具清单 -->
        <div v-else class="gp-parts">
          <div class="subpage-head">
            <h3>{{ tab === 'airparts' ? '串件航材清单' : '串件工具清单' }}</h3>
            <div class="subpage-actions">
              <label class="field dedupe-toggle"><input type="checkbox" v-model="dedupeOpen[partKind]" /> {{ tab === 'airparts' ? '重复航材梳理' : '重复工具梳理' }}</label>
              <label class="button ghost">导入表格<input hidden type="file" accept=".xlsx,.xls" @change="importPartsXlsx" /></label>
              <button class="ghost" @click="exportPartsXlsx">导出表格</button>
              <button v-if="tab === 'tools'" class="ghost" @click="downloadSpControlDoc">下载现场管控单</button>
              <span class="split-btn" @click.stop>
                <button class="ghost" @click="addPartList(partKind)">+ 新增卡片</button>
                <button class="ghost split-arrow" title="更多操作" @click="partClearOpen = !partClearOpen">▾</button>
                <div v-if="partClearOpen" class="split-menu">
                  <button class="danger" @click="clearPartList(partKind)">清空清单</button>
                </div>
              </span>
            </div>
          </div>
          <!-- 卡片搜索：AutoComplete（卡片名 / 件号 / 名称候选） -->
          <div class="part-search-bar">
            <div class="part-search-wrap">
              <input
                v-model="partSearch"
                class="part-search-input"
                placeholder="搜索卡片名 / 件号 / 名称（自动补全）"
                @focus="partSuggestOpen = true"
                @input="partSuggestOpen = true"
                @blur="partSuggestOpen = false"
              />
              <div v-if="partSuggestOpen && partSuggestFiltered.length" class="part-suggest">
                <button v-for="opt in partSuggestFiltered" :key="opt.kind + ':' + opt.label" class="part-suggest-item" @mousedown.prevent="selectPartSuggest(opt)">
                  <span class="psi-label">{{ opt.label }}</span>
                  <span class="psi-kind" :class="opt.kind">{{ opt.kind === 'card' ? '卡片' : opt.kind === 'pn' ? '件号' : '名称' }}</span>
                </button>
              </div>
            </div>
          </div>
          <!-- 重复梳理（对齐 A检 重复航材梳理）：按件号(航材)/名称(工具)跨卡片分组聚拢，重复≥2 归重复组、单件归单件组；
               卡片 UI 与 A检 PartNoGroupCard 一致（浅蓝头部：键名+名称+×N；行内：所属卡片/数量/删除/备注）；
               梳理视图与主卡片列表互斥（v-if/v-else），开关按清单类型分开记忆，不联动。 -->
          <template v-if="dedupeOpen[partKind]">
            <section class="pnc-section">
              <h4 class="pnc-title">{{ tab === 'airparts' ? '重复航材' : '重复工具' }}（{{ partDuplicates.length }} 组）</h4>
              <template v-if="partDuplicates.length">
                <article v-for="g in partDuplicates" :key="g.key" class="pnc-card">
                  <header class="pnc-head">
                    <strong class="pnc-partno">{{ g.label }}</strong>
                    <span class="pnc-name">{{ g.name }}</span>
                    <span class="pnc-count">×{{ g.rows.length }}</span>
                  </header>
                  <div class="pnc-body">
                    <div class="itg" style="grid-template-columns: 1.4fr 0.6fr 2.2fr auto">
                      <div class="itg-head"><span>卡片</span><span>数量</span><span class="itg-note-cell">备注</span><span></span></div>
                      <div v-for="row in g.rows" :key="row.item.id" class="itg-row">
                        <span class="itg-tag" :title="row.card.name">{{ row.card.name || '未命名卡片' }}</span>
                        <input v-model.number="row.item.qty" type="number" min="0" placeholder="数量" @input="save" v-lock="lockKey('partitem', row.item.id, 'qty')" />
                        <textarea rows="1" class="cell-inp is-note" v-model="row.item.note" placeholder="备注" @input="onPartAutoSize" v-lock="lockKey('partitem', row.item.id, 'note')"></textarea>
                        <div class="itg-ops"><button class="del" title="删除该物品" @click="removePartItem(partKind, row.card.id, row.item.id)">×</button></div>
                      </div>
                    </div>
                  </div>
                </article>
              </template>
              <div v-else class="pt-empty">{{ tab === 'airparts' ? '暂无重复航材。' : '暂无重复工具。' }}</div>
            </section>
            <section class="pnc-section">
              <h4 class="pnc-title">{{ tab === 'airparts' ? '单件航材' : '单件工具' }}（{{ partSingles.length }} 组）</h4>
              <template v-if="partSingles.length">
                <article v-for="g in partSingles" :key="g.key" class="pnc-card">
                  <header class="pnc-head">
                    <strong class="pnc-partno">{{ g.label }}</strong>
                    <span class="pnc-name">{{ g.name }}</span>
                    <span class="pnc-count">×1</span>
                  </header>
                  <div class="pnc-body">
                    <div class="itg" style="grid-template-columns: 1.4fr 0.6fr 2.2fr auto">
                      <div class="itg-head"><span>卡片</span><span>数量</span><span class="itg-note-cell">备注</span><span></span></div>
                      <div v-for="row in g.rows" :key="row.item.id" class="itg-row">
                        <span class="itg-tag" :title="row.card.name">{{ row.card.name || '未命名卡片' }}</span>
                        <input v-model.number="row.item.qty" type="number" min="0" placeholder="数量" @input="save" v-lock="lockKey('partitem', row.item.id, 'qty')" />
                        <textarea rows="1" class="cell-inp is-note" v-model="row.item.note" placeholder="备注" @input="onPartAutoSize" v-lock="lockKey('partitem', row.item.id, 'note')"></textarea>
                        <div class="itg-ops"><button class="del" title="删除该物品" @click="removePartItem(partKind, row.card.id, row.item.id)">×</button></div>
                      </div>
                    </div>
                  </div>
                </article>
              </template>
              <div v-else class="pt-empty">{{ tab === 'airparts' ? '暂无单件航材。' : '暂无单件工具。' }}</div>
            </section>
          </template>
          <template v-else>
          <section v-for="card in visiblePartCards" :key="card.id" class="gp-card pt-card" :style="{ borderLeft: '6px solid ' + partCardColorOf(card), background: partCardBgOf(card) }">
            <div class="pt-card-head" :style="{ background: partCardHeadOf(card) }">
              <button class="pt-collapse" :title="collapsedCards.has(card.id) ? '展开卡片' : '折叠卡片'" @click="toggleCardCollapse(card.id)">{{ collapsedCards.has(card.id) ? '▸' : '▾' }}</button>
              <input v-model="card.name" class="pt-card-name" placeholder="卡片名称(可输入或搜索串件内容)" list="gp-part-contents" @input="save" v-lock="lockKey('partcard', card.id, 'name')" />
              <span class="pt-count">{{ card.items.length }} 项</span>
              <button class="icon-btn" @click="removePartList(partKind, card.id)">×</button>
            </div>
            <template v-if="!collapsedCards.has(card.id)">
            <div v-if="card.items.length" class="itg" :style="{ gridTemplateColumns: tab === 'airparts' ? '1.2fr 2fr 0.6fr 2.2fr auto' : '2fr 0.6fr 2.2fr auto' }">
              <div class="itg-head">
                <template v-if="tab === 'airparts'"><span>件号</span></template>
                <span>名称</span><span>数量</span><span class="itg-note-cell">备注</span><span></span>
              </div>
              <div v-for="it in card.items" :key="it.id" class="itg-row">
                <template v-if="tab === 'airparts'">
                  <textarea rows="1" v-model="it.pn" placeholder="件号" @input="onPartAutoSize" v-lock="lockKey('partitem', it.id, 'pn')"></textarea>
                </template>
                <textarea rows="1" v-model="it.name" placeholder="名称" @input="onPartAutoSize" v-lock="lockKey('partitem', it.id, 'name')"></textarea>
                <input v-model.number="it.qty" type="number" min="0" placeholder="数量" @input="save" v-lock="lockKey('partitem', it.id, 'qty')" />
                <textarea rows="1" class="cell-inp is-note" v-model="it.note" placeholder="备注" @input="onPartAutoSize" @blur="save" v-lock="lockKey('partitem', it.id, 'note')"></textarea>
                <div class="itg-ops"><button class="del" title="删除物品" @click="removePartItem(partKind, card.id, it.id)">×</button></div>
              </div>
            </div>
            <div v-else class="pt-empty">暂无物品 — 点击「+ 增加物品」</div>
            <button class="gp-add" @click="addPartItem(partKind, card.id)">+ 增加物品</button>
            </template>
          </section>
          <div v-if="!visiblePartCards.length" class="pt-empty-all">暂无卡片 — 点上方「+ 新增卡片」</div>
          </template>
        </div>
      </template>

      <!-- 模板库弹窗：调取模式=仅加载；保存模式=保存为新模板 + 覆盖/改名/删除 -->
      <div v-if="showTplModal" class="gp-modal" @click.self="showTplModal = false">
        <div class="gp-modal-card">
          <div class="gp-modal-head"><h3>{{ tplMode === 'load' ? '调取模板' : '保存模板' }}</h3><button class="icon-btn" @click="showTplModal = false">×</button></div>
          <div v-if="tplMode === 'save'" class="gp-save-tpl-row">
            <input ref="saveTplInputRef" v-model="saveTplName" placeholder="新模板名称" @keydown.enter="saveAsTemplate" />
            <button class="primary" @click="saveAsTemplate">保存为新模板</button>
          </div>
          <div class="gp-tpl-search">
            <input v-model="tplQuery" class="inp" placeholder="模糊搜索模板名称…" aria-label="模糊搜索模板" />
            <button v-if="tplQuery" class="clear-btn" type="button" title="清空搜索" @click="tplQuery = ''">×</button>
          </div>
          <p v-if="templatesLoading" class="loading-state">加载中…</p>
          <template v-else-if="filteredTemplates.length">
            <div v-for="t in filteredTemplates" :key="t._id" class="gp-tpl-row">
              <div class="gp-tpl-info" :class="{ clickable: tplMode === 'load' }" @click="tplMode === 'load' && applyTemplate(t)"><strong>{{ t.name }}</strong><span>{{ t.state.charts.length }} DAY · {{ t.state.charts.reduce((n, c) => n + c.cards.length, 0) }} 工序</span></div>
              <div class="gp-tpl-actions">
                <button v-if="tplMode === 'load'" class="ghost" @click="applyTemplate(t)">加载</button>
                <template v-else>
                  <button class="ghost" @click="overwriteTemplate(t)">覆盖</button>
                  <button class="ghost" @click="renameTemplate(t)">改名</button>
                  <button class="danger" @click="deleteTemplate(t)">删除</button>
                </template>
              </div>
            </div>
          </template>
          <p v-else-if="templates.length" class="gp-empty">未找到匹配“{{ tplQuery }}”的模板。</p>
          <p v-else class="gp-empty">暂无模板。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== 布局：参与人面板 + 主区 ===== */
.gantt-page { display: flex; gap: 16px; align-items: flex-start; }
.gantt-page.gantt-wide { gap: 12px; }
.participant-panel {
  width: 230px; flex-shrink: 0; position: sticky; top: 120px;
  padding: 14px; background: var(--card, var(--n0)); border: 1px solid var(--line, var(--n4));
  border-radius: var(--r-lg); box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.participant-panel h3 { margin: 0 0 12px; font-size: var(--fs-16); color: var(--muted, var(--n7)); font-weight: 650; }
.participant-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 4px; }
.participant-sec { font-size: var(--fs-12); color: var(--muted, var(--n7)); font-weight: 700; margin: 10px 0 6px; border-left: 3px solid var(--blue, var(--blue)); padding-left: 6px; }
.participant-day-label { font-size: var(--fs-12); color: var(--blue-dark, var(--blue-dark)); font-weight: 700; margin: 8px 0 4px; cursor: pointer; user-select: none; }
.participant-day-label:hover { color: var(--blue, var(--blue)); text-decoration: underline; }
.participant-input {
  width: 100%; height: 32px; padding: 0 8px; border: 1.5px solid var(--line, var(--n4)); border-radius: var(--r-md);
  font-size: var(--fs-13); margin-bottom: 4px;
}
.participant-input:focus { border-color: var(--focus); outline: none; }
.chip {
  background: var(--blue-light, var(--blue-light)); color: var(--blue-dark, var(--blue-dark)); border-radius: var(--r-pill);
  padding: 4px 8px; font-size: var(--fs-12); text-align: center; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; font-weight: 600;
}
.chip.match { background: #d5efc9; color: #256b16; border: 1px solid #9fd08c; }
.chip.manual { cursor: pointer; }
.chip.manual:hover { opacity: .8; }
.chip .chip-x { opacity: 0; margin-left: 3px; font-weight: 700; }
.chip.manual:hover .chip-x { opacity: 1; }
.participant-empty { color: var(--muted, var(--n7)); font-size: var(--fs-12); grid-column: 1 / -1; text-align: center; padding: 12px 0; }

.main-area { flex: 1; min-width: 0; }
/* 主区内容：非甘特图子页 1100px 居中（参与人名单已放屏幕左侧，不受此限制）；甘特图子页全宽 */
.main-area > *:not(.gp-modal) { max-width: 1100px; margin-left: auto; margin-right: auto; width: 100%; }
.gantt-page.gantt-wide .main-area > *:not(.gp-modal) { max-width: none; }

/* ===== 子页抬头 / tab ===== */
.gp-tabs { margin: 8px 0 12px; }
.subpage-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 4px 0 10px; }
.subpage-head h3 { margin: 0; font-size: var(--fs-18); color: var(--blue-dark, var(--blue-dark)); }
.gp-title-input { flex: 1; min-width: 220px; max-width: 560px; height: 34px; padding: 0 12px; border: 1.5px solid transparent; border-radius: var(--r-md); background: transparent; font-size: var(--fs-18); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); }
.gp-title-input:hover { border-color: var(--line, var(--n4)); background: var(--n0); }
.gp-title-input:focus { border-color: var(--focus); background: var(--n0); outline: none; }
.subpage-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.top-actions { margin-left: auto; }
@media (max-width: 768px) { .top-actions { margin-left: 0; } }
.toolbar-sep { width: 1px; height: 20px; background: var(--line, var(--n4)); flex: 0 0 auto; }
/* 「+ 新增卡片」splitbutton：主按钮 + ▾ 下拉（清空清单 danger） */
.split-btn { position: relative; display: inline-flex; align-items: stretch; }
.split-btn .ghost:first-child { border-radius: 8px 0 0 8px; }
.split-btn .split-arrow { border-radius: 0 8px 8px 0; border-left: none; padding: 0 7px; }
.split-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 40; min-width: 130px; padding: 4px; background: var(--n0); border: 1px solid var(--line, var(--n4)); border-radius: var(--r-md); box-shadow: 0 4px 14px rgba(0, 0, 0, .12); }
.split-menu button { display: block; width: 100%; padding: 7px 10px; border: none; background: transparent; border-radius: var(--r-sm); font-size: var(--fs-13); text-align: left; cursor: pointer; }
.split-menu button:hover { background: var(--blue-bg); }
.split-menu button.danger { color: var(--danger, var(--danger)); }
.split-menu button.danger:hover { background: #fdecec; }
.split-menu label { display: block; width: 100%; padding: 7px 10px; border: none; background: transparent; border-radius: var(--r-sm); font-size: var(--fs-13); text-align: left; cursor: pointer; white-space: nowrap; box-sizing: border-box; }
.split-menu label:hover { background: var(--blue-bg); }

/* ===== 通用卡片 ===== */
.gp-card { border: 1px solid var(--line, var(--n4)); border-radius: var(--r-lg); background: var(--n0); padding: 14px 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
/* DAY 卡片：浅蓝底黑字；填空栏/选择框保持白底黑字 */
.gp-card.day-card { background: #E8F1FC; }
.gp-card.day-card .day-label { color: #222; }
.gp-card.day-card .chart-title-input { color: #222; }
.gp-card.day-card .chart-title-input:hover { background: rgba(255, 255, 255, .6); border-radius: 4px; }
.gp-card.day-card .chart-title-input:focus { background: var(--n0); color: #222; box-shadow: none; }
.gp-card.day-card .gp-sec-title { color: #222; border-left-color: var(--blue, var(--blue)); }
.gp-card.day-card .date-input { background: var(--n0); color: #222; }
.gp-card.day-card .day-input { background: var(--n0); color: #222; }
.gp-sec-title { font-size: var(--fs-14); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); margin: 10px 0 8px; border-left: 3px solid var(--blue, var(--blue)); padding-left: 8px; }
.gp-add { margin-top: 10px; }
.icon-btn { border: none; background: transparent; color: var(--danger, var(--danger)); font-size: var(--fs-14); cursor: pointer; }

/* ===== chart 头部 ===== */
.chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 12px; flex-wrap: wrap; }
.chart-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.collapse-btn { min-height: 0; height: 26px; padding: 0 8px; font-size: var(--fs-12); }
.date-input { width: 148px; height: 32px; padding: 0 8px; border: 1.5px solid var(--blue, var(--blue)); border-radius: var(--r-md); font-size: var(--fs-13); font-weight: 600; color: var(--blue-dark, var(--blue-dark)); text-align: center; }
.day-label { font-size: var(--fs-13); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); }
.day-input { width: 34px; border: none; background: var(--blue-light, var(--blue-light)); border-radius: var(--r-sm); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); text-align: center; font-size: var(--fs-13); padding: 4px 2px; }
.chart-title-input { border: none; background: transparent; font-size: var(--fs-18); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); outline: none; padding: 2px 4px; min-width: 80px; }
.chart-title-input:hover { background: var(--blue-light, var(--blue-light)); border-radius: 4px; }
.chart-title-input:focus { background: var(--n0); border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus); }
.chart-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }

/* ===== 顶部责任 ===== */
.resp-banner {
  background: linear-gradient(180deg, #edf2fc, var(--n0));
  border: 1px solid var(--line, var(--n4)); border-radius: var(--r-lg);
  padding: 10px 14px; margin: 0 0 12px;
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 16px;
}
.resp-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
.resp-label-input { width: 90px; flex-shrink: 0; padding: 2px 6px; outline: none; font-weight: 700; font-size: var(--fs-13); color: var(--blue-dark, var(--blue-dark)); background: transparent; border: none; border-bottom: 1px dashed transparent; }
.resp-label-input:focus { background: var(--n0); border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus); }
.resp-colon { color: var(--muted, var(--n7)); flex-shrink: 0; }
.resp-name { flex: 1; min-width: 60px; padding: 2px 6px; outline: none; font-weight: 600; font-size: var(--fs-13); background: transparent; border: none; border-bottom: 1px dashed transparent; }
.resp-name:focus { background: var(--n0); border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus); }
.resp-del { opacity: 0; width: 22px; height: 22px; }
.resp-cell:hover .resp-del { opacity: 1; }
.resp-cell.resp-add { justify-content: flex-start; }
.resp-cell.resp-add button { font-size: var(--fs-12); height: 26px; padding: 0 10px; }

/* ===== 甘特网格 ===== */
.gantt-wrap { overflow-x: auto; margin: 0 -6px; padding: 0 6px 6px; display: flex; align-items: stretch; }
.gantt-grid {
  display: grid; min-width: 0; width: 100%; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-lg);
  background: #eaf1fa; position: relative; flex: 1;
}
.stage-edge { flex-shrink: 0; width: 16px; cursor: ew-resize; background: var(--blue-light, var(--blue-light)); border: 1px solid var(--line, var(--n4)); border-left: none; border-radius: 0 10px 10px 0; display: flex; align-items: center; justify-content: center; color: var(--blue-dark, var(--blue-dark)); font-weight: 700; user-select: none; touch-action: none; }
.stage-edge:hover { background: #cdddf4; }
.form-stage-drag:active, .form-card-drag:active { cursor: grabbing; }
.fc-span { flex-shrink: 0; font-size: var(--fs-11); color: var(--blue-dark, var(--blue-dark)); background: var(--blue-light, var(--blue-light)); padding: 2px 8px; border-radius: 4px; }
.gantt-head {
  background: var(--blue, var(--blue));
  border-radius: var(--r-md);
  margin: 3px 2px;
  border: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
  padding: 6px 8px; display: flex; flex-direction: row; align-items: center; gap: 4px;
  position: relative; min-height: 44px;
}
.stage-name-input { flex: 1; min-width: 0; text-align: center; border: none; background: transparent; font-size: var(--fs-14); font-weight: 650; padding: 2px 0; color: var(--n0); }
.stage-name-input:focus { background: var(--n0); border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus); color: var(--blue-dark, var(--blue-dark)); }
.add-card-btn { width: auto; height: 20px; padding: 0 6px; border-radius: 3px; font-size: var(--fs-11); line-height: 18px; border: 1px solid rgba(255,255,255,.45); background: rgba(255,255,255,.18); color: var(--n0); flex-shrink: 0; }
/* 阶段表头 split button：+工序 主按钮 + ▾ 下拉（移DAY/+插/删除阶段） */
.stage-split { position: relative; display: inline-flex; align-items: stretch; flex-shrink: 0; }
.stage-split-main { border-radius: 3px 0 0 3px; }
.stage-split-arrow {
  width: 16px; height: 20px; padding: 0; font-size: var(--fs-10); line-height: 18px;
  border: 1px solid rgba(255,255,255,.45); border-left: none; border-radius: 0 3px 3px 0;
  background: rgba(255,255,255,.18); color: var(--n0); flex-shrink: 0;
}
.stage-split-arrow:hover { background: rgba(255,255,255,.32); }
.stage-split-menu {
  position: absolute; top: calc(100% + 3px); right: 0; z-index: 80;
  min-width: 132px; padding: 5px;
  background: var(--n0); border: 1px solid var(--n3); border-radius: var(--r-md); box-shadow: var(--sh-2);
}
.stage-split-menu .ssm-label { display: block; font-size: var(--fs-10); color: var(--n6); padding: 2px 8px 4px; }
.stage-split-menu button {
  display: block; width: 100%; min-height: 28px; padding: 4px 10px;
  border: none; border-radius: var(--r-sm); background: transparent;
  color: var(--n8); font-size: var(--fs-12); text-align: left;
}
.stage-split-menu button:hover { background: var(--blue-bg); }
.stage-split-menu button.danger { color: var(--danger); }
.stage-split-menu button.danger:hover { background: var(--danger-bg); }
.stage-col-drag { cursor: grab; color: rgba(255,255,255,.85); font-size: var(--fs-12); user-select: none; touch-action: none; flex-shrink: 0; }
.stage-col-drag:active { cursor: grabbing; }
.corner-cell { background: var(--n0); border-right: 1px solid var(--line, var(--n4)); border-bottom: 1px solid var(--line, var(--n4)); display: flex; align-items: center; justify-content: center; font-size: var(--fs-12); font-weight: 700; color: var(--muted, var(--n7)); padding: 6px 8px; }
.lane-label-cell { background: var(--n0); border-right: 1px solid var(--line, var(--n4)); border-bottom: 1px dashed var(--line, var(--n4)); display: flex; align-items: center; justify-content: center; min-height: 72px; font-size: var(--fs-12); font-weight: 650; color: var(--blue-dark, var(--blue-dark)); }
.card-slot { position: relative; }
.stage-capsules { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.stage-capsule { font-size: var(--fs-12); font-weight: 600; color: var(--blue-dark, var(--blue-dark)); background: var(--blue-light, var(--blue-light)); border: 1px solid var(--blue, var(--blue)); border-radius: var(--r-pill); padding: 2px 10px; }

/* ===== 拖拽目标位置占位虚线框 ===== */
.drag-ghost {
  position: fixed; z-index: 998; pointer-events: none;
  border: 2px dashed var(--blue, var(--blue)); border-radius: var(--r-md);
  background: rgba(68, 114, 196, .10);
  box-shadow: 0 0 0 1px rgba(68, 114, 196, .15);
}

/* ===== 甘特卡片（工序=灰渐变至白 / 串件=橙渐变至白，从顶部渐变到负责行后全白） ===== */
.gantt-card {
  margin: 2px; padding: 0; border-radius: var(--r-md); background: var(--n0);
  border: 2.5px solid var(--focus); box-shadow: 0 1px 3px rgba(0,0,0,.04); position: relative;
  display: flex; flex-direction: column; min-height: 64px; z-index: 2; transition: box-shadow .15s;
}
.gantt-card {
  background: var(--n0);
}
.gantt-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.08); z-index: 3; }
.gantt-card.unassigned { background: var(--n0); border-color: #e8a44d; }
.gantt-card.unassigned .card-warn { position: absolute; top: 0; left: 0; color: var(--danger, var(--danger)); font-size: var(--fs-10); line-height: 1; padding: 1px 3px; z-index: 5; }
.gantt-card.part-item {
  border-color: #e8a44d;
  background: var(--n0);
}
/* 标题栏及以上：工序卡=黄底 #FDCA17（无渐变，标题栏底边清晰分界）；串件卡=橙底 #E8A44D 标题白字 */
.gantt-card .card-grip { background: #FDCA17; border-radius: 6px 6px 0 0; }
.gantt-card .f-content { background: #FDCA17; margin-top: -2px; border-radius: 0 0 3px 3px; }
.gantt-card.part-item .card-grip, .gantt-card.unassigned .card-grip { background: #E8A44D; }
.sp-title-row { display: flex; align-items: center; gap: 5px; margin: -2px -9px 4px; padding: 2px 9px; background: #E8A44D; color: var(--n0); border-radius: 0 0 6px 6px; min-width: 0; }
.sp-title-row .sp-view-content, .sp-title-row .f-content { color: var(--n0); font-weight: 600; flex: 1; min-width: 0; width: auto; background: transparent; border-radius: 0; box-shadow: none; }
.part-tag { flex-shrink: 0; font-size: var(--fs-10); font-weight: 700; color: var(--n0); background: #c2701a; border-radius: var(--r-pill); padding: 0 7px; line-height: 14px; z-index: 5; }
.card-grip { position: absolute; top: 0; left: 8px; right: 8px; height: 14px; cursor: grab; display: flex; align-items: center; justify-content: center; color: var(--muted, var(--n7)); font-size: var(--fs-10); letter-spacing: 3px; user-select: none; touch-action: none; z-index: 4; }
.card-grip:active { cursor: grabbing; }
.resize-l, .resize-r { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 4; touch-action: none; }
.resize-l { left: 0; border-radius: 8px 0 0 8px; }
.resize-r { right: 0; border-radius: 0 8px 8px 0; }
.resize-l:hover, .resize-r:hover { background: rgba(142,170,219,.45); }
.card-body { padding: 16px 9px 6px; display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.f-content { font-size: var(--fs-12); font-weight: 600; outline: none; word-break: break-word; background: rgba(247,249,253,.6); padding: 2px 4px; border-radius: 3px; min-height: 18px; border: none; width: 100%; resize: none; font-family: inherit; overflow: hidden; field-sizing: content; max-height: 140px; }
.f-content:focus { background: var(--n0); box-shadow: 0 0 0 2px var(--focus); }
.people-row { display: flex; align-items: center; gap: 4px; font-size: var(--fs-12); }
.people-row .pl { color: var(--muted, var(--n7)); flex-shrink: 0; }
.f-owner, .f-part { outline: none; flex: 1; min-width: 0; word-break: break-word; border: none; background: transparent; font-size: var(--fs-12); padding: 1px 2px; resize: none; overflow: hidden; font-family: inherit; }
.f-owner { font-weight: 600; }
.f-owner:focus, .f-part:focus { background: var(--n0); box-shadow: 0 0 0 2px var(--focus); border-radius: 3px; }
.f-note { font-size: var(--fs-12); color: var(--danger, var(--danger)); outline: none; word-break: break-word; font-weight: 500; min-height: 14px; border: none; background: transparent; width: 100%; padding: 1px 2px; resize: none; font-family: inherit; overflow: hidden; field-sizing: content; max-height: 140px; }
.f-note:focus { background: var(--n0); box-shadow: 0 0 0 2px var(--focus); border-radius: 3px; }
/* 阶段跨 DAY 迁移下拉 */
.day-move-select { width: 100%; height: 20px; padding: 0 4px; font-size: var(--fs-10); color: var(--blue-dark, var(--blue-dark)); border: 1px dashed var(--blue, var(--blue)); border-radius: 4px; background: rgba(255,255,255,.75); cursor: pointer; font-family: inherit; }
.day-move-select.form { width: auto; flex-shrink: 0; height: 24px; font-size: var(--fs-12); }
.day-move-select:hover { border-style: solid; background: var(--n0); }
/* 甘特卡右上角黑色关闭叉号（黄/橙标题区上可见） */
.gantt-card .card-close {
  position: absolute; top: 3px; right: 5px; z-index: 6;
  width: 20px; height: 20px; padding: 0; border: none; border-radius: 50%;
  background: rgba(255,255,255,.72); color: #000; cursor: pointer;
  font-size: var(--fs-12); line-height: 1; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .15s, background .15s, color .15s;
}
.gantt-card:hover .card-close { opacity: 1; }
.gantt-card .card-close:hover { background: var(--n0); color: var(--danger, var(--danger)); }

/* ===== 未分配串件 ===== */
.unassigned-banner { margin: 12px 0 0; padding: 10px 12px; background: #ffe8c7; border: 1.5px solid #e8a44d; border-radius: var(--r-lg); }
.unassigned-banner-h { font-size: var(--fs-13); font-weight: 700; color: #b45309; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.unassigned-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }

/* ===== 表单段落 ===== */
.gp-section { border: 1px solid var(--line, var(--n4)); border-radius: var(--r-lg); background: var(--n0); padding: 0 16px 14px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); overflow: hidden; }
/* 飞机信息/项目安排/部件卡片 三节标题：蓝底白字行 */
.gp-section > .gp-sec-title {
  margin: 0 -16px 12px -16px; padding: 9px 16px; border-left: none; border-radius: 0;
  background: linear-gradient(100deg, var(--blue, var(--blue)), var(--blue-dark, var(--blue-dark))); color: var(--n0);
}
.meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.meta-grid-4 { grid-template-columns: repeat(4, 1fr); }
.meta-grid input, .arrange-row input, .arrange-item input, .component-col input {
  height: 32px; padding: 0 8px; border: 1.5px solid var(--line, var(--n4)); border-radius: var(--r-md); font-size: var(--fs-13); width: 100%;
}
.meta-grid input:focus, .arrange-row input:focus, .arrange-item input:focus, .component-col input:focus { border-color: var(--focus); outline: none; }
/* 飞机卡片：去卡片框，多架之间用水平分割线；删除 × 在机型行末尾 */
.meta-group { padding: 2px 0; }
.meta-type-row { display: flex; align-items: center; gap: 4px; }
.meta-type-row input { flex: 1; min-width: 0; }
.meta-x {
  flex: 0 0 auto; min-height: 24px; min-width: 26px; padding: 0;
  border: 1px solid #f2cdcd; border-radius: var(--r-sm);
  background: #fdecec; color: #b53a3a; font-size: var(--fs-16); line-height: 1;
}
.meta-x:hover { background: #f9dcdc; }
.meta-divider { border: none; border-top: 1px solid var(--line, var(--n4)); margin: 14px 0 12px; }
.meta-group-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--fs-12); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); margin-bottom: 8px; }
/* 项目安排三行：去卡片框，行间水平虚线分割 */
.arrange-row { display: grid; gap: 10px; margin-bottom: 10px; }
.arrange-divider { border: none; border-top: 1px dashed var(--line, var(--n4)); margin: 2px 0 12px; }
.arrange-row-3 { grid-template-columns: repeat(3, 1fr); }
.arrange-row-2 { grid-template-columns: repeat(2, 1fr); }
.arrange-participants-row { grid-template-columns: 1fr; }
.arrange-participants .participant-input { width: 100%; }
.arrange-items { margin-top: 4px; }
.arrange-item { display: grid; grid-template-columns: 1fr 1fr 28px; gap: 10px; align-items: end; margin-bottom: 8px; }
/* 部件卡片轮廓 */
.component-card { border: 1px solid var(--line, var(--n4)); border-radius: var(--r-lg); padding: 10px 12px; margin-bottom: 12px; background: var(--n0); box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.component-name-input { flex: 1; min-width: 0; height: 30px; padding: 0 8px; border: 1.5px solid var(--line, var(--n4)); border-radius: var(--r-sm); font-size: var(--fs-13); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); }
.component-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.component-col { display: flex; flex-direction: column; gap: 6px; }
.component-tag { align-self: flex-start; font-size: var(--fs-12); font-weight: 700; padding: 2px 10px; border-radius: var(--r-sm); }
.component-tag.off { background: #ffe0b3; color: #b45309; }
.component-tag.on { background: #d5ecdc; color: #1e6b3a; }

/* ===== 字段标签外置（空名称放填报栏外）+ 自动换行文本域 ===== */
.gpf { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.gpf-label { font-size: var(--fs-12); color: var(--muted, var(--n7)); font-weight: 600; line-height: 1.2; }
.component-name-wrap { flex: 1; }
textarea.textwrap {
  resize: none; overflow: hidden; field-sizing: content;
  min-height: 20px; max-height: 140px; line-height: 1.4;
  word-break: break-word; overflow-wrap: break-word; white-space: pre-wrap;
  font-family: inherit;
}
.meta-grid input, .gpf input, .gpf textarea, .arrange-row textarea, .arrange-item textarea, .component-col textarea {
  min-height: 28px; padding: 4px 8px; border: 1.5px solid var(--line, var(--n4)); border-radius: var(--r-md); font-size: var(--fs-13); width: 100%; box-sizing: border-box; background: var(--n0);
}
.gpf input:focus, .gpf textarea:focus { border-color: var(--focus); outline: none; }
.participant-input.textwrap { height: auto; min-height: 32px; }

/* ===== 阶段卡片（表单） ===== */
.gp-stage-list { display: flex; flex-direction: column; gap: 10px; }
.form-stage-card { border: 1px solid var(--line, var(--n4)); border-radius: var(--r-lg); padding: 8px 10px; background: var(--n1); }
.form-stage-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.form-stage-head input { flex: 1; border: none; background: transparent; font-size: var(--fs-13); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); padding: 4px; outline: none; }
.form-stage-head input:focus { background: var(--n0); border-radius: 4px; box-shadow: 0 0 0 2px var(--focus); }
.form-stage-body { display: flex; flex-direction: column; gap: 4px; }
.form-card-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm); padding: 3px 6px; background: var(--n0); }
/* 表单工序行：左侧纯黄（拖拽柄+标题）随标题自适应、黄色竖线分界、右半白；备注红字；串件行除外 */
.form-card-row:not(.part-form-row) .form-card-title {
  display: flex; align-items: center; gap: 2px;
  background: #FDCA17; border-radius: var(--r-sm);
  border-right: 2px solid #C9A227;
  flex: none; max-width: 50%; min-width: 0;
  padding: 1px 3px 1px 1px;
}
.form-card-row:not(.part-form-row) .form-card-title .form-card-drag {
  background: transparent; border-radius: 4px; padding: 4px 6px;
  color: #8a6d00; touch-action: none;
}
.form-card-row:not(.part-form-row) .form-card-title textarea {
  flex: none; width: 20em; min-width: 20em; max-width: 100%;
  background: transparent; border: none; box-shadow: none;
  color: #000; font-weight: 600;
  padding: 3px 4px;
}
/* 表单工序行输入框定宽：负责人 8 字加粗黑字 / 参与人自适应 / 备注 15 字红字 */
.form-card-row .ns-owner { flex: none; width: 8em; min-width: 0; }
.form-card-row .ns-owner .ns-input { font-weight: 600; color: #000; }
.form-card-row:not(.part-form-row) textarea:last-of-type {
  flex: none; width: 15em; min-width: 15em;
  color: var(--danger, var(--danger));
}
.form-card-row input, .form-card-row textarea { flex: 1; min-width: 90px; padding: 2px 5px; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm); font-size: var(--fs-12); font-family: inherit; }
.form-card-row textarea { resize: none; overflow: hidden; line-height: 1.4; word-break: break-word; }
.form-card-row.part-form-row textarea:first-of-type { flex: 1.5; }
.form-card-row input:focus, .form-card-row textarea:focus { border-color: var(--focus); outline: none; }
.part-form-row { border-color: #f0d9b8; background: #fff6e8; }
.part-form-tag { flex-shrink: 0; font-size: var(--fs-11); font-weight: 700; color: #b45309; background: #ffe0b3; padding: 2px 6px; border-radius: 4px; }
.stage-empty { color: var(--muted, var(--n7)); font-size: var(--fs-12); text-align: center; padding: 10px 0; }
.add-form-card-btn { margin-top: 6px; font-size: var(--fs-12); height: 26px; padding: 0 10px; }

/* ===== 串件表 ===== */
.parts-table { width: 100%; border-collapse: collapse; font-size: var(--fs-13); }
.parts-table th, .parts-table td { border: 1px solid var(--line, var(--n4)); padding: 5px 6px; }
.parts-table th { background: var(--blue, var(--blue)); color: var(--n0); font-weight: 650; font-size: var(--fs-12); text-align: left; }
.parts-table tr.unassigned { background: #ffe8c7; }
.parts-table select, .parts-table input { width: 100%; height: 28px; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm); padding: 0 6px; font-size: var(--fs-12); background: var(--n0); }
.parts-table select:focus, .parts-table input:focus { border-color: var(--focus); outline: none; }
.parts-table textarea { width: 100%; min-height: 28px; padding: 0 6px; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm); font-size: var(--fs-12); background: var(--n0); resize: none; overflow: hidden; line-height: 1.4; word-break: break-word; font-family: inherit; }
.parts-table textarea:focus { border-color: var(--focus); outline: none; }
.parts-table .ns-wrap { width: 100%; }
.parts-table .ns-input { font-size: var(--fs-12); }
.parts-table tr.sp-auto { background: #fff6e8; }
.part-rule { font-size: var(--fs-12); color: var(--muted, var(--n7)); margin: 4px 0 6px; }
.col-act { width: 32px; text-align: center; }
/* 串件工卡：工卡号/名称两列 + 类型/内容自动换行 + 串件/拆装汇总行 */
.sp-content, .sp-name {
  width: 100%; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm); padding: 3px 6px; font-size: var(--fs-12);
  resize: none; overflow: hidden; line-height: 1.4; word-break: break-word; overflow-wrap: break-word; font-family: inherit;
  box-sizing: border-box; background: var(--n0); min-height: 26px;
}
.sp-name { min-height: 26px; color: var(--text, #222); }
.sp-content { min-height: 26px; }
.sp-table select { width: 100%; height: 28px; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm); padding: 0 4px; font-size: var(--fs-12); background: var(--n0); }
.sp-table-note { font-size: var(--fs-12); color: var(--muted, var(--n7)); margin: 6px 0 2px; }
.sp-combine-row td { background: var(--blue-bg); }
/* 串件安排表：拆/装标签 + 只读展示 */
.sp-tag { color: #b45309; font-weight: 700; font-size: var(--fs-12); margin-right: 2px; white-space: nowrap; }
.sp-view-content { flex: 1.5; min-width: 90px; padding: 3px 6px; font-size: var(--fs-12); line-height: 1.4; word-break: break-word; overflow-wrap: break-word; }
.sp-view-field { flex: 1; min-width: 70px; padding: 3px 6px; font-size: var(--fs-12); line-height: 1.4; word-break: break-word; }
.sp-view-note { flex: 1; min-width: 70px; padding: 3px 6px; font-size: var(--fs-12); color: var(--danger); word-break: break-word; }
.gantt-card > .card-body > .sp-view-content, .gantt-card > .card-body > .sp-view-field, .gantt-card > .card-body > .sp-view-note { flex: none; width: 100%; padding: 0 2px; }
.sp-arr-table td { vertical-align: top; }
/* 串件安排表：未填写栏浅红底色 */
.sp-arr-table textarea.sp-empty { background: #fdeaea; border-color: #f0b9b9; }
.sp-arr-table td.sp-empty-cell { background: #fdeaea; }
.sp-arr-table td.sp-empty-cell input,
.sp-arr-table td.sp-empty-cell textarea,
.sp-arr-table td.sp-empty-cell .ns-input { background: #fdeaea; border-color: #f0b9b9; }

/* ===== 串件航材/工具清单（pt-card） ===== */
.pt-card-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: linear-gradient(90deg, #edf2fc, var(--n0)); border-radius: 11px 11px 0 0; border-bottom: 1px solid var(--line, var(--n4)); margin: -14px -16px 6px; }
.pt-card-name { flex: 1; min-width: 120px; height: 32px; padding: 0 8px; border: 1.5px solid var(--blue, var(--blue)); border-radius: var(--r-sm); font-size: var(--fs-14); font-weight: 700; color: var(--blue-dark, var(--blue-dark)); }
.pt-card-name:focus { outline: none; border-color: var(--focus); }
.pt-count { font-size: var(--fs-12); color: var(--muted, var(--n7)); flex-shrink: 0; }
.pt-items { padding: 4px 0 8px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.pt-empty { color: var(--muted, var(--n7)); font-size: var(--fs-12); text-align: center; padding: 10px 0; }
.pt-empty-all { text-align: center; color: var(--muted, var(--n7)); padding: 40px 0; font-size: var(--fs-13); }
/* 卡片搜索栏：AutoComplete 输入 + 下拉候选 */
.part-search-bar { margin: 0 0 12px; padding: 10px 12px; background: var(--n0); border: 1px solid var(--line, var(--n4)); border-radius: var(--r-lg); }
.part-search-wrap { position: relative; }
.part-search-input { height: 34px; padding: 0 12px; border: 1.5px solid var(--line, var(--n4)); border-radius: var(--r-md); font-size: var(--fs-14); width: 100%; box-sizing: border-box; font-family: inherit; }
.part-search-input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 3px rgba(142, 170, 219, .18); }
.part-suggest { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30; max-height: 260px; overflow-y: auto; background: var(--n0); border: 1px solid var(--line, var(--n4)); border-radius: var(--r-lg); box-shadow: 0 8px 24px rgba(0, 0, 0, .12); padding: 4px; }
.part-suggest-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: none; background: transparent; border-radius: var(--r-sm); cursor: pointer; text-align: left; }
.part-suggest-item:hover { background: var(--blue-light, #eaf1fa); }
.psi-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-13); color: var(--text, #222); }
.psi-kind { flex-shrink: 0; font-size: var(--fs-11); padding: 1px 7px; border-radius: var(--r-pill); background: #eef2f8; color: var(--muted, var(--n7)); }
.psi-kind.card { background: #e3edfb; color: var(--blue-dark); }
.psi-kind.pn { background: #fdecec; color: #b53a3a; }
.psi-kind.name { background: #e8f5e9; color: #2e7d32; }
/* 卡片折叠按钮 */
.pt-collapse { flex-shrink: 0; width: 24px; height: 24px; padding: 0; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm); background: rgba(255, 255, 255, .8); color: var(--muted, var(--n7)); font-size: var(--fs-13); line-height: 1; cursor: pointer; }
.pt-collapse:hover { border-color: var(--blue, var(--blue)); color: var(--blue-dark, var(--blue-dark)); }
/* 物品卡片：参考 A检 航材清单 m-item 样式（件号/名称/数量带字段标签 + 自动换行） */
.pt-item { display: grid; grid-template-columns: 1.1fr 2fr 0.6fr auto; gap: 6px; align-items: stretch; border: 1px solid var(--n3); border-radius: var(--r-md); padding: 6px 8px; background: var(--n0); word-break: break-word; }
.pt-item-tool { grid-template-columns: 2fr 0.6fr auto; }
.pt-item:hover { border-color: var(--blue, var(--blue)); }
.m-field { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-12); color: var(--n7); min-width: 0; }
.m-field input, .m-name { padding: 5px 7px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); min-width: 0; width: 100%; box-sizing: border-box; }
.m-name { padding: 5px 7px; font-size: var(--fs-12); line-height: 1.4; resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; font-family: inherit; min-height: 30px; }
.m-ops { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
.pt-note-row { grid-column: 1 / -1; display: flex; align-items: flex-end; }
.pt-note { min-height: 28px; font-size: var(--fs-12); color: var(--danger, var(--danger)); outline: none; background: var(--blue-bg); border: 1px dashed var(--line, var(--n4)); border-radius: var(--r-sm); padding: 4px 8px; resize: none; width: 100%; font-family: inherit; }
/* 物品操作按钮：×（删除）在上、+（备注）在下，两按钮平分卡片高度（参考 A检 m-item） */
.m-op { flex: 1; min-width: 26px; min-height: 22px; padding: 0 6px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--n0); color: var(--n7); font-size: var(--fs-14); line-height: 1; cursor: pointer; }
.m-op:hover { background: var(--blue-light); }
.m-op-del { border-color: #f2cdcd; background: #fdecec; color: #b53a3a; }
.m-op-del:hover { background: #f9dcdc; }
.danger-text { color: var(--danger, var(--danger)); }

/* ===== 重复梳理（航材按件号 / 工具按名称 卡片聚拢）——UI 对齐 A检 PartNoGroupCard ===== */
.dedupe-toggle { display: flex; align-items: center; gap: 4px; font-size: var(--fs-13); color: var(--text, #222); }
.dedupe-toggle input { width: 15px; height: 15px; accent-color: var(--blue, var(--blue)); }
.pnc-section { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.pnc-title { margin: 0; font-size: var(--fs-14); color: var(--n8); }
.pnc-card { border: 1px solid var(--n4); border-radius: var(--r-lg); background: var(--n0); margin-bottom: 10px; overflow: hidden; }
.pnc-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #edf2fc; }
.pnc-partno { font-size: var(--fs-14); color: var(--blue-dark); font-weight: 700; }
.pnc-name { font-size: var(--fs-13); color: #4a5160; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pnc-count { margin-left: auto; font-size: var(--fs-12); color: #98a2b3; flex: 0 0 auto; }
.pnc-body { padding: 6px 10px; display: flex; flex-direction: column; gap: 6px; }
.pnc-item { display: grid; grid-template-columns: 1.2fr 0.5fr auto 2fr; gap: 6px; align-items: center; }
.pnc-type { font-size: var(--fs-13); color: #4a5160; padding: 4px 8px; background: #f4f6fb; border-radius: var(--r-sm); min-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pnc-qty { width: 100%; min-height: 30px; padding: 4px 6px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); box-sizing: border-box; }
.pnc-del { width: 26px; height: 26px; padding: 0; border: 1px solid #f2cdcd; border-radius: var(--r-sm); background: #fdecec; color: #b53a3a; font-size: var(--fs-16); line-height: 1; cursor: pointer; }
.pnc-del:hover { background: #f9dcdc; }
.pnc-note { min-height: 30px; padding: 4px 7px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-12); resize: none; overflow: hidden; font-family: inherit; line-height: 1.4; box-sizing: border-box; width: 100%; }

/* ===== 增加一天 ===== */
.add-day-card {
  display: flex; align-items: center; justify-content: center;
  width: 100%;
  border: 2px dashed var(--blue, var(--blue)); border-radius: var(--r-lg); padding: 18px; margin-top: 14px;
  cursor: pointer; color: var(--blue, var(--blue)); font-size: var(--fs-16); font-weight: 700; background: #f5f9ff;
  transition: background .15s, border-color .15s;
}
.add-day-card:hover { background: var(--blue-light, var(--blue-light)); border-color: var(--blue-dark, var(--blue-dark)); }

/* ===== 手册清单头 ===== */
.gp-docs-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }

/* ===== 填空框上传中蒙版（灰蒙 + "……"） ===== */
.save-mask {
  position: fixed; z-index: 9000; pointer-events: none;
  background: rgba(232,232,237,.78); box-shadow: inset 0 0 0 1px rgba(0,0,0,.05);
  display: flex; align-items: center; justify-content: center;
  transition: opacity .15s ease;
}
.save-mask .dots { display: inline-flex; gap: 4px; align-items: center; }
.save-mask .dots i {
  width: 5px; height: 5px; border-radius: 50%; background: #60646c;
  opacity: .25; transform: scale(.8); animation: saveDotBlink 1.1s ease-in-out infinite;
}
.save-mask .dots i:nth-child(2) { animation-delay: .18s; }
.save-mask .dots i:nth-child(3) { animation-delay: .36s; }
@keyframes saveDotBlink { 0%, 100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }

/* ===== 模板弹窗 ===== */
.gp-modal { position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); padding: 20px; }
.gp-modal-card { background: var(--n0); border-radius: var(--r-lg); box-shadow: 0 16px 48px rgba(0,0,0,.25); width: 100%; max-width: 520px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; }
.gp-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line, var(--n4)); }
.gp-modal-head h3 { margin: 0; font-size: var(--fs-16); color: var(--blue-dark, var(--blue-dark)); }
.gp-save-tpl-row { display: flex; gap: 8px; padding: 12px 18px; border-bottom: 1px solid var(--line, var(--n4)); }
.gp-save-tpl-row input { flex: 1; height: 34px; padding: 0 10px; border: 1.5px solid var(--line, var(--n4)); border-radius: var(--r-md); font-size: var(--fs-13); }
.gp-save-tpl-row input:focus { border-color: var(--focus); outline: none; }
.gp-tpl-row { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--line, var(--n4)); cursor: pointer; }
.gp-tpl-row:hover { background: #f5f9ff; }
.gp-tpl-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.gp-tpl-info.clickable { cursor: pointer; }
.gp-tpl-info.clickable:hover strong { color: var(--blue, var(--blue)); }
.gp-tpl-info strong { font-size: var(--fs-14); color: var(--text, #222); }
.gp-tpl-info span { font-size: var(--fs-12); color: var(--muted, var(--n7)); }
.gp-tpl-actions { display: flex; gap: 6px; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
.gp-empty { color: var(--muted, var(--n7)); text-align: center; padding: 20px 0; }

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .gantt-page { flex-direction: column; }
  .participant-panel { width: 100%; position: static; }
  .meta-grid, .meta-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .arrange-row-3, .arrange-row-2 { grid-template-columns: 1fr; }
  .arrange-item { grid-template-columns: 1fr; }
  .resp-banner { grid-template-columns: 1fr; }
  .component-cols { grid-template-columns: 1fr; }
  .pt-items { grid-template-columns: 1fr; }
  .pt-item { grid-template-columns: 1fr 1fr auto; }
  .pt-item .m-field-name { grid-column: span 2; }
  .subpage-actions { gap: 6px; }
  .form-card-row { align-items: stretch; }
  .form-card-row textarea { min-width: 100%; }
  .form-card-row .form-card-title textarea { min-width: 60px; max-width: 100%; }
  .gantt-grid { min-width: 640px; }
}

/* ===== 他人正在编辑：输入框亮黄底 + 锁定 ===== */
.remote-locked,
.remote-locked textarea,
.remote-locked input,
.remote-locked .ns-input,
textarea.remote-locked,
input.remote-locked {
  background: #FFF176 !important;           /* 亮黄警示底 */
  border-color: #F9A825 !important;
  box-shadow: inset 0 0 0 1.5px #FBC02D !important;
  cursor: not-allowed !important;
  color: #6d4c00 !important;
}
.remote-locked[title]:not([title=""]) { position: relative; }
.remote-locked textarea:disabled,
.remote-locked input:disabled,
textarea.remote-locked:disabled,
input.remote-locked:disabled {
  opacity: 0.85; color: #6d4c00 !important; -webkit-text-fill-color: #6d4c00;
}

/* 模板弹窗模糊搜索行 */
.gp-tpl-search { display: flex; align-items: center; gap: 6px; padding: 10px 18px; border-bottom: 1px solid var(--line, var(--n4)); }
.gp-tpl-search input { flex: 1; height: 32px; padding: 0 10px; border: 1.5px solid var(--line, var(--n4)); border-radius: var(--r-md); font-size: var(--fs-13); font-family: inherit; }
.gp-tpl-search input:focus { border-color: var(--focus); outline: none; }
.gp-tpl-search .clear-btn { border: none; background: none; color: var(--n7, #888); font-size: 15px; line-height: 1; cursor: pointer; }
</style>
