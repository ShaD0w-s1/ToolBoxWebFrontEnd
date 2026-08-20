<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import type { GanttPrepState, GanttChart, GanttCard, GanttPart, GanttPartList, GanttPartListItem } from "../domain/toolbox";
import { backend } from "../api";
import NameSuggest from "./NameSuggest.vue";

const props = defineProps<{ store: ToolboxStore }>();

const DEFAULT_RESP = ["现场负责人", "工具负责", "持卡", "必检", "拆装记录人"];
const DEFAULT_STAGES = ["前期准备", "构型准备", "外围拆除", "短舱拆除", "上下发", "上发准备", "交接"];
const DEFAULT_PARTS_TYPES = ["N/A", "普查", "串件", "单拆", "单装", "装新件"];

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
  props.store.saveGantt();
}

// —— meta 结构（确保存在）——
interface MetaAircraft { id: string; reg: string; fsn: string; msn: string; engine: string; type: string; etops: string; eltDt: string }
interface MetaComponent { id: string; name: string; offPn: string; offSn: string; onPn: string; onSn: string }
interface MetaArrangementItem { id: string; content: string; assign: string }
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
const arrangement = computed<Record<string, unknown>>(() => (meta.value?.arrangement as Record<string, unknown>) || {});
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
  (chart.parts || []).forEach((p) => { add(p.owner); add(p.participants); });
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
  set: (v) => { if (state.value) (arrangement.value as any).participants = v; },
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
  (arrangement.value as any).participants = cur.filter((n) => n !== name).join("、");
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
  const assigned = (chart.parts || []).filter((p) => typeof p.executeStage === "number" && p.executeStage >= 0);
  assigned.sort((a, b) => (a.executeStage !== b.executeStage ? a.executeStage! - b.executeStage! : (a.order ?? 0) - (b.order ?? 0)));
  const colCursor = colMax.map((m) => m + 1);
  assigned.forEach((p) => {
    const s = p.executeStage!;
    const r = colCursor[s];
    rows["part:" + p.id] = r;
    maxRow = Math.max(maxRow, r);
    colCursor[s]++;
  });
  return rows;
}
function ganttRows(chart: GanttChart): Record<string, number> {
  return computeRows(chart);
}

// —— DAY / 阶段 / 工序 / 串件 / 责任 CRUD ——
function addChart(): void {
  const s = state.value; if (!s) return;
  const last = s.charts[s.charts.length - 1];
  const day = s.charts.length + 1;
  const chart: GanttChart = {
    id: genId(), title: `DAY ${day}`, date: nextDate(), day, collapsed: false,
    responsibilities: (last?.responsibilities?.length ? last.responsibilities : DEFAULT_RESP.map((l) => ({ id: genId(), label: l, name: "" })))
      .map((r) => ({ id: genId(), label: r.label, name: r.name })),
    stages: DEFAULT_STAGES.map((n) => ({ id: genId(), name: n })),
    lanes: [], cards: [], parts: [],
  };
  s.charts.push(chart);
  save();
}
function addDayAfter(chartId: string): void {
  const s = state.value; if (!s) return;
  const idx = s.charts.findIndex((c) => c.id === chartId);
  if (idx < 0) return;
  const base = s.charts[idx];
  const chart: GanttChart = {
    id: genId(), title: `DAY ${idx + 2}`, date: nextDate(), day: idx + 2, collapsed: false,
    responsibilities: base.responsibilities.map((r) => ({ id: genId(), label: r.label, name: r.name })),
    stages: base.stages.map((st) => ({ id: genId(), name: st.name })),
    lanes: [], cards: [], parts: [],
  };
  s.charts.splice(idx + 1, 0, chart);
  s.charts.forEach((c, i) => { c.day = i + 1; c.title = `DAY ${i + 1}`; });
  save();
}
function deleteChart(chartId: string): void {
  const s = state.value; if (!s) return;
  if (!window.confirm("确认删除本天？")) return;
  s.charts = s.charts.filter((c) => c.id !== chartId);
  s.charts.forEach((c, i) => { c.day = i + 1; });
  save();
}
function toggleCollapse(chartId: string): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  c.collapsed = !c.collapsed;
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
  c.parts = c.parts.filter((p) => p.executeStage !== idx).map((p) => {
    if (typeof p.executeStage === "number" && p.executeStage > idx) p.executeStage--;
    return p;
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
function addPart(chartId: string): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  c.parts.push({ id: genId(), type: "串件", content: "", owner: "", participants: "", note: "", executeStage: null, order: c.parts.length });
  save();
}
function deletePart(chartId: string, partId: string): void {
  const s = state.value; if (!s) return;
  const c = s.charts.find((x) => x.id === chartId); if (!c) return;
  c.parts = c.parts.filter((x) => x.id !== partId);
  renormalizePartOrders(c);
  save();
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
function partsOfStage(chart: GanttChart, stageIdx: number): GanttPart[] {
  return chart.parts.filter((p) => p.executeStage === stageIdx);
}
function isPartUnassigned(p: GanttPart): boolean {
  return !(typeof p.executeStage === "number" && p.executeStage >= 0);
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

// —— 串件工卡（合并视图：表单串件 auto 行 + 手动记录 manual 行）——
interface SpRow {
  uid: string;
  partId: string | null; // 非空 = 自动行（来自表单串件卡片）
  spId: string | null;   // 非空 = 手动行在 docs.sp 的记录 id
  content: string;
  type: string;
  jc: string;
  name: string;
  source: "auto" | "manual";
}
function findPartById(partId: string): GanttPart | null {
  for (const c of state.value?.charts || []) {
    const p = (c.parts || []).find((x) => x.id === partId);
    if (p) return p;
  }
  return null;
}
function findSpById(id: string): Record<string, string> | null {
  const s = state.value; if (!s) return null;
  return (ensureDocs(s).sp as Array<Record<string, string>>).find((x) => x.id === id) || null;
}
function findOrCreateSpByContent(content: string): Record<string, string> {
  const s = state.value!;
  const d = ensureDocs(s);
  const spList = d.sp as Array<Record<string, string>>;
  let rec = spList.find((x) => x.content === content);
  if (!rec) { rec = { id: genId(), type: "", content, jc: "", name: "" }; spList.push(rec); }
  return rec;
}
function getSpRows(): SpRow[] {
  const s = state.value; if (!s) return [];
  const d = ensureDocs(s);
  const spList = d.sp as Array<Record<string, string>>;
  const partContents = new Set<string>();
  s.charts.forEach((c) => (c.parts || []).forEach((p) => { if (p.content) partContents.add(p.content); }));
  const rows: SpRow[] = [];
  s.charts.forEach((c) => (c.parts || []).forEach((p) => {
    const ext = p.content ? spList.find((x) => x.content === p.content) : undefined;
    rows.push({ uid: "auto:" + p.id, partId: p.id, spId: null, content: p.content || "", type: p.type || "", jc: ext ? (ext.jc || "") : "", name: ext ? (ext.name || "") : "", source: "auto" });
  }));
  spList.forEach((x, idx) => {
    if (x.content && partContents.has(x.content)) return; // 已被自动行匹配（同内容）
    rows.push({ uid: "manual:" + (x.id || ("sp" + idx)), partId: null, spId: String(x.id || ("sp" + idx)), content: x.content || "", type: x.type || "", jc: x.jc || "", name: x.name || "", source: "manual" });
  });
  return rows;
}
// 串件/拆装类型：下方附「工卡号+工卡名称」汇总行，且类型/内容上下行合并单元格
function isCombineType(t: string): boolean { return t === "串件" || t === "拆装"; }
// 编辑串件工卡类型：auto→同步串件卡片(part.type)；manual→写 docs.sp
function editSpRowType(row: SpRow, value: string): void {
  if (row.partId) { const p = findPartById(row.partId); if (p) { p.type = value; save(); } }
  else { const rec = findSpById(row.spId || ""); if (rec) { rec.type = value; save(); } }
}
// 编辑串件工卡内容：auto→同步串件卡片(part.content)+docs.sp 键；manual→写 docs.sp
function editSpRowContent(row: SpRow, value: string): void {
  if (row.partId) {
    const p = findPartById(row.partId); if (!p) return;
    const old = p.content;
    p.content = value;
    const s = state.value; if (s) {
      const rec = (ensureDocs(s).sp as Array<Record<string, string>>).find((x) => x.content === old);
      if (rec) rec.content = value;
    }
    save();
  } else {
    const rec = findSpById(row.spId || ""); if (rec) { rec.content = value; save(); }
  }
}
// 编辑工卡号：auto 行写入与串件内容匹配的 docs.sp 记录；manual 行直接改
function editSpRowJc(row: SpRow, value: string): void {
  if (row.partId) { const p = findPartById(row.partId); if (p) { findOrCreateSpByContent(p.content).jc = value; save(); } }
  else { const rec = findSpById(row.spId || ""); if (rec) { rec.jc = value; save(); } }
}
function editSpRowName(row: SpRow, value: string): void {
  if (row.partId) { const p = findPartById(row.partId); if (p) { findOrCreateSpByContent(p.content).name = value; save(); } }
  else { const rec = findSpById(row.spId || ""); if (rec) { rec.name = value; save(); } }
}
function removeSpDoc(row: SpRow): void {
  const s = state.value; if (!s) return;
  const d = ensureDocs(s);
  if (row.spId) d.sp = (d.sp as Array<Record<string, string>>).filter((x) => x.id !== row.spId);
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
    props.store.notify(`工卡清单导入完成：工包 ${wp} 条`);
  } catch (err) {
    props.store.notify(err instanceof Error ? err.message : "解析失败");
  }
}

// —— 串件航材 / 工具清单 ——
function ensurePartLists(s: GanttPrepState) {
  if (!Array.isArray(s.airParts)) s.airParts = [];
  if (!Array.isArray(s.toolParts)) s.toolParts = [];
}
// 串件内容候选（卡片名联想：来自表单各 DAY 串件 content）
const partContentSuggestions = computed<string[]>(() => {
  const set = new Set<string>();
  state.value?.charts.forEach((c) => (c.parts || []).forEach((p) => { if (p.content) set.add(p.content); }));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
});
// 把表单串件内容同步成串件清单卡片（该内容尚无卡片时补一张空卡片）
function syncPartCardsFromCharts(kind: "airParts" | "toolParts"): void {
  const s = state.value; if (!s) return;
  ensurePartLists(s);
  const list = s[kind] as GanttPartList[];
  const seen = new Set(list.map((x) => x.name));
  s.charts.forEach((c) => (c.parts || []).forEach((p) => {
    if (p.content && !seen.has(p.content)) { list.push({ id: genId(), name: p.content, items: [] }); seen.add(p.content); }
  }));
}
function addPartList(kind: "airParts" | "toolParts"): void {
  const s = state.value; if (!s) return;
  ensurePartLists(s);
  (s[kind] as GanttPartList[]).push({ id: genId(), name: "新卡片", items: [] });
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
// 进入串件 tab 时，把表单串件内容同步成卡片
function onPartTabEnter(): void {
  syncPartCardsFromCharts(partKind.value);
}
// 串件航材清单：重复航材检查（跨卡片按件号分组，重复 ≥2 次即列出）
const airDedupeMode = ref(false);
interface AirDedupeGroup { pn: string; name: string; qty: number; count: number; cards: string[] }
const airDedupeGroups = computed<AirDedupeGroup[]>(() => {
  const map = new Map<string, AirDedupeGroup>();
  (state.value?.airParts || []).forEach((card) => {
    (card.items || []).forEach((it) => {
      const pn = String(it.pn || "").trim();
      if (!pn) return;
      if (!map.has(pn)) map.set(pn, { pn, name: it.name || "", qty: Number(it.qty) || 0, count: 0, cards: [] });
      const g = map.get(pn)!;
      g.count++;
      if (card.name && !g.cards.includes(card.name)) g.cards.push(card.name);
    });
  });
  return Array.from(map.values()).filter((g) => g.count >= 2).sort((a, b) => b.count - a.count);
});

// —— 模板加载 ——
const showTplModal = ref(false);
const templates = ref<Array<{ _id: string; id: string; name: string; savedAt: string; state: GanttPrepState }>>([]);
const templatesLoading = ref(false);
const saveTplInputRef = ref<HTMLInputElement | null>(null);
async function openTplModal(focusSave = false): Promise<void> {
  showTplModal.value = true;
  templatesLoading.value = true;
  try {
    const res = await backend.listEngTemplates();
    templates.value = Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板加载失败");
  } finally {
    templatesLoading.value = false;
    if (focusSave) nextTick(() => saveTplInputRef.value?.focus());
  }
}
function applyTemplate(t: { name: string; state: GanttPrepState }): void {
  if (!state.value) return;
  if (!window.confirm(`确认加载模板“${t.name}”？将覆盖当前甘特准备单内容。`)) return;
  props.store.applyGanttTemplate(t.state, t.name);
  showTplModal.value = false;
  props.store.notify(`已加载模板：${t.name}`);
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
function renormalizePartOrders(chart: GanttChart): void {
  const groups: Record<string, GanttPart[]> = {};
  chart.parts.forEach((p) => {
    const k = (typeof p.executeStage === "number" && p.executeStage >= 0) ? String(p.executeStage) : "unassigned";
    (groups[k] = groups[k] || []).push(p);
  });
  Object.values(groups).forEach((g) => {
    g.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    g.forEach((p, i) => { p.order = i; });
  });
}
function setPartOrder(chart: GanttChart, part: GanttPart, newOrder: number): void {
  const group = chart.parts.filter((p) => p.executeStage === part.executeStage);
  const others = group.filter((p) => p.id !== part.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = clamp(newOrder, 0, others.length);
  others.splice(idx, 0, part);
  others.forEach((p, i) => { p.order = i; });
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
  chart.parts.forEach((p) => {
    if (typeof p.executeStage === "number" && p.executeStage >= 0) p.executeStage = remap(p.executeStage);
  });
}

// —— 工序卡片拖曳（move 横移改阶段/纵移调行序；resize-left/right 改起止阶段） ——
interface CardDrag { mode: "move" | "resize-left" | "resize-right"; chartId: string; cardId: string; el: HTMLElement; startX: number; startY: number; n: number; colW: number; rowH: number; origStart: number; origEnd: number; origOrder: number; curStart: number; curEnd: number; curOrder: number }
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
  } else {
    d.el.style.transform = "";
    const slot = d.el.closest(".card-slot") as HTMLElement | null;
    if (slot) slot.style.gridColumn = `${d.curStart + 1} / ${d.curEnd + 2}`;
    d.el.title = `调整: 起始「${chart?.stages[d.curStart]?.name ?? ""}」→ 结束「${chart?.stages[d.curEnd]?.name ?? ""}」`;
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
  cardDrag = { mode, chartId, cardId, el, startX: e.clientX, startY: e.clientY, n, colW, rowH, origStart: card.startStage, origEnd: card.endStage, origOrder: card.order ?? 0, curStart: card.startStage, curEnd: card.endStage, curOrder: card.order ?? 0 };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onCardDragMove);
  window.addEventListener("pointerup", onCardDragEnd);
}

// —— 串件卡片拖曳（换阶段 / 调行序） ——
interface PartDrag { mode: "move" | "resize-left" | "resize-right"; chartId: string; partId: string; el: HTMLElement; startX: number; startY: number; n: number; colW: number; rowH: number; origStage: number; origOrder: number; curStage: number; curOrder: number }
let partDrag: PartDrag | null = null;
function onPartDragMove(e: PointerEvent): void {
  if (!partDrag) return;
  const d = partDrag;
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  const ds = Math.round(dx / d.colW);
  const dr = Math.round(dy / d.rowH);
  const chart = findChart(d.chartId);
  d.curStage = clamp(d.origStage + ds, 0, d.n - 1);
  const maxOrder = (chart?.parts || []).filter((x) => x.id !== d.partId && x.executeStage === d.curStage).length;
  d.curOrder = clamp(d.origOrder + dr, 0, maxOrder);
  d.el.style.transform = `translate(${ds * d.colW}px, ${dr * d.rowH}px)`;
  d.el.title = `阶段「${chart?.stages[d.curStage]?.name ?? ""}」 · 行 ${d.curOrder + 1}`;
}
function onPartDragEnd(): void {
  if (partDrag) {
    const d = partDrag;
    const chart = findChart(d.chartId);
    const p = chart?.parts.find((x) => x.id === d.partId);
    if (chart && p) {
      p.executeStage = d.curStage;
      setPartOrder(chart, p, d.curOrder);
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
function startPartDrag(e: PointerEvent, chartId: string, partId: string): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const p = chart.parts.find((x) => x.id === partId); if (!p) return;
  const el = (e.currentTarget as HTMLElement).closest(".gantt-card") as HTMLElement;
  const n = chart.stages.length;
  const grid = el.closest(".gantt-grid") as HTMLElement | null;
  const colW = grid ? grid.getBoundingClientRect().width / n : 160;
  const rowH = el.offsetHeight || 60;
  const origStage = (typeof p.executeStage === "number" && p.executeStage >= 0) ? p.executeStage : 0;
  partDrag = { mode: "move", chartId, partId, el, startX: e.clientX, startY: e.clientY, n, colW, rowH, origStage, origOrder: p.order ?? 0, curStage: origStage, curOrder: p.order ?? 0 };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onPartDragMove);
  window.addEventListener("pointerup", onPartDragEnd);
}

// —— 未分配串件拖到甘特图阶段列（分配） ——
let unassignedDrag: { chartId: string; partId: string; el: HTMLElement; n: number; over: boolean; targetStage: number; grid: HTMLElement | null } | null = null;
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
    const chart = findChart(d.chartId);
    const p = chart?.parts.find((x) => x.id === d.partId);
    if (chart && p && d.over && d.targetStage >= 0) {
      p.executeStage = d.targetStage;
      p.order = chart.parts.filter((x) => x.id !== p.id && x.executeStage === d.targetStage).length;
    }
    d.el.style.opacity = "";
    save();
  }
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onUnassignedDragMove);
  window.removeEventListener("pointerup", onUnassignedDragEnd);
  unassignedDrag = null;
}
function startUnassignedDrag(e: PointerEvent, chartId: string, partId: string): void {
  e.preventDefault();
  const chart = findChart(chartId); if (!chart) return;
  const p = chart.parts.find((x) => x.id === partId); if (!p) return;
  const el = (e.currentTarget as HTMLElement).closest(".gantt-card") as HTMLElement;
  const grid = el.closest(".gp-card")?.querySelector(".gantt-grid") as HTMLElement | null;
  unassignedDrag = { chartId, partId, el, n: chart.stages.length, over: false, targetStage: -1, grid };
  document.body.style.userSelect = "none";
  el.style.opacity = "0.85";
  el.style.zIndex = "999";
  window.addEventListener("pointermove", onUnassignedDragMove);
  window.addEventListener("pointerup", onUnassignedDragEnd);
}

// —— 阶段列头拖曳换序 ——
let stageColDrag: { chartId: string; idx: number; el: HTMLElement; startX: number; colW: number; n: number; target: number } | null = null;
function onStageColDragMove(e: PointerEvent): void {
  if (!stageColDrag) return;
  const ds = Math.round((e.clientX - stageColDrag.startX) / stageColDrag.colW);
  stageColDrag.target = clamp(stageColDrag.idx + ds, 0, stageColDrag.n - 1);
  stageColDrag.el.style.transform = `translateX(${ds * stageColDrag.colW}px)`;
}
function onStageColDragEnd(): void {
  if (stageColDrag) {
    const d = stageColDrag;
    d.el.style.opacity = "";
    d.el.style.zIndex = "";
    d.el.style.transform = "";
    if (d.target !== d.idx) { moveStage(d.chartId, d.idx, d.target); save(); }
  }
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
  stageColDrag = { chartId, idx, el, startX: e.clientX, colW, n: chart.stages.length, target: idx };
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
  chart.parts.forEach((p) => {
    if (typeof p.executeStage === "number" && p.executeStage >= idx) p.executeStage++;
  });
  save();
}

// —— 表单工序卡片纵移调行序 ——
let formCardDrag: { chartId: string; cardId: string; el: HTMLElement; startY: number; rowH: number; origOrder: number; curOrder: number } | null = null;
function onFormCardDragMove(e: PointerEvent): void {
  if (!formCardDrag) return;
  const dr = Math.round((e.clientY - formCardDrag.startY) / formCardDrag.rowH);
  formCardDrag.curOrder = Math.max(0, formCardDrag.origOrder + dr);
  formCardDrag.el.style.transform = `translateY(${dr * formCardDrag.rowH}px)`;
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
async function saveAsTemplate(): Promise<void> {
  const s = state.value; if (!s) return;
  const name = saveTplName.value.trim();
  if (!name) { props.store.notify("请输入模板名称"); return; }
  try {
    await backend.createEngTemplate({ name, state: JSON.parse(JSON.stringify(s)) });
    props.store.notify(`已保存模板：${name}`);
    saveTplName.value = "";
    await openTplModal();
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板保存失败");
  }
}
async function overwriteTemplate(t: { _id: string; name: string }): Promise<void> {
  const s = state.value; if (!s) return;
  if (!window.confirm(`确认覆盖模板“${t.name}”？当前甘特数据将写入该模板。`)) return;
  try {
    await backend.updateEngTemplate(t._id, { name: t.name, state: JSON.parse(JSON.stringify(s)) });
    props.store.notify(`已覆盖模板：${t.name}`);
    await openTplModal();
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板覆盖失败");
  }
}
async function deleteTemplate(t: { _id: string; name: string }): Promise<void> {
  if (!window.confirm(`确认删除模板“${t.name}”？`)) return;
  try {
    await backend.deleteEngTemplate(t._id);
    templates.value = templates.value.filter((x) => x._id !== t._id);
    props.store.notify("模板已删除");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板删除失败");
  }
}
async function duplicateTemplate(t: { _id: string }): Promise<void> {
  try {
    await backend.duplicateEngTemplate(t._id);
    props.store.notify("模板已复制");
    await openTplModal();
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板复制失败");
  }
}

// ===== 物品备注 toggle（收起/展开） =====
const expandedNotes = ref<Set<string>>(new Set());
function toggleNote(id: string): void {
  const n = new Set(expandedNotes.value);
  if (n.has(id)) n.delete(id); else n.add(id);
  expandedNotes.value = n;
}

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
  if ((a as any).manager) arrParts.push(`项目经理 ${(a as any).manager}`);
  if ((a as any).dutyGroup) arrParts.push(`值班组 ${(a as any).dutyGroup}`);
  if ((a as any).location) arrParts.push(`执行地点 ${(a as any).location}`);
  if ((a as any).orderNo) arrParts.push(`指令号 ${(a as any).orderNo}`);
  if ((a as any).orderName) arrParts.push(`指令名称 ${(a as any).orderName}`);
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
    chart.parts.forEach((p) => {
      const st = (typeof p.executeStage === "number" && p.executeStage >= 0 && chart.stages[p.executeStage]) ? chart.stages[p.executeStage].name : "未分配";
      body += `<tr><td>${esc(p.type)}</td><td>${esc(p.content)}</td><td>${esc(p.owner)}</td><td>${esc(p.participants)}</td><td>${esc(p.note)}</td><td>${esc(st)}</td></tr>`;
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
  const s = state.value; if (!s) return;
  if (!s.charts.length) { props.store.notify("没有数据"); return; }
  const target = mainAreaRef.value;
  if (!target) return;
  try {
    const html2canvas = (await import("html2canvas")).default;
    props.store.notify("正在渲染图片…");
    const canvas = await html2canvas(target, { scale: 1.5, backgroundColor: "#ffffff", useCORS: true });
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `换发准备单_${tab.value === "gantt" ? "甘特图" : "表单"}_${stampDate()}.jpg`);
      else props.store.notify("图片导出失败");
    }, "image/jpeg", 0.92);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "图片导出失败");
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
    // 串件 sheet：所有 DAY 串件合并
    const partRows: unknown[][] = [["DAY", "类型", "内容", "负责人", "参与人", "备注", "执行阶段"]];
    s.charts.forEach((chart) => {
      chart.parts.forEach((p) => {
        const st = (typeof p.executeStage === "number" && chart.stages[p.executeStage]) ? chart.stages[p.executeStage].name : "未分配";
        partRows.push([`DAY ${chart.day}`, p.type || "", p.content || "", p.owner || "", p.participants || "", p.note || "", st]);
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
    props.store.notify(e instanceof Error ? e.message : "xlsx 导出失败");
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
  const spRows = getSpRows();
  const sp: unknown[][] = [["序号", "类型", "串件内容", "工卡号", "工卡名称", "领用人"]];
  spRows.forEach((x, i) => {
    sp.push([i + 1, x.type || "", x.content || "", x.jc || "", x.name || "", ""]);
  });
  if (!wpEng.length && !spRows.length) { props.store.notify("手册清单暂无数据"); return; }
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(wpEng);
    ws1["!cols"] = [{ wch: 6 }, { wch: 24 }, { wch: 50 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws1, "手册清单");
    if (spRows.length) {
      const ws2 = XLSX.utils.aoa_to_sheet(sp);
      ws2["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 26 }, { wch: 24 }, { wch: 40 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws2, "串件工卡");
    }
    XLSX.writeFile(wb, `手册清单_${stampDate()}.xlsx`);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "xlsx 导出失败");
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
    props.store.notify(e instanceof Error ? e.message : "xlsx 导出失败");
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
    props.store.notify(`串件${isAir ? "航材" : "工具"}导入完成：${n} 条`);
  } catch (err) {
    props.store.notify(err instanceof Error ? err.message : "解析失败");
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
      const dayMatch = name.match(/DAY(\d+)/);
      let chart = dayMatch ? s.charts.find((c) => c.day === Number(dayMatch[1])) : undefined;
      if (!chart) { chart = s.charts[0]; }
      if (!chart) return;
      const stageMap = new Map<string, number>();
      chart.stages.forEach((st, i) => stageMap.set(st.name, i));
      rows.slice(1).forEach((row) => {
        const stageName = String(row[0] || "").trim();
        const content = String(row[1] || "").trim();
        if (!content) return;
        let si = stageMap.get(stageName);
        if (si === undefined) { chart!.stages.push({ id: genId(), name: stageName || "新阶段" }); si = chart!.stages.length - 1; stageMap.set(stageName, si); }
        chart!.cards.push({ id: genId(), laneId: "", content, owner: String(row[2] || ""), participants: String(row[3] || ""), note: String(row[4] || ""), startStage: si, endStage: si, order: chart!.cards.length });
        added++;
      });
    });
    save();
    props.store.notify(`xlsx 导入完成：工序 ${added} 条`);
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "xlsx 解析失败");
  }
}
</script>

<template>
  <div class="gantt-page" :class="{ 'gantt-wide': tab === 'gantt' }">
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
    <div class="main-area" ref="mainAreaRef">
      <div class="subpage-head">
        <input class="gp-title-input" v-model="templateName" placeholder="工作准备单（甘特）" @change="save" @input="save" />
      </div>
      <!-- 子页功能按钮：统一放在子页标题行下首行 -->
      <div class="subpage-toolbar">
        <button class="ghost" @click="openTplModal(false)">调取模板</button>
        <button class="ghost" @click="openTplModal(true)">保存模板</button>
        <span class="toolbar-sep" />
        <template v-if="tab === 'form'">
          <button class="ghost" @click="exportDocx">导出 Word</button>
          <button class="ghost" @click="exportAllImage">导出图片</button>
          <button class="ghost" @click="exportAllXlsx">导出表格</button>
          <label class="button ghost">导入表格<input hidden type="file" accept=".xlsx,.xls" @change="importAllXlsx" /></label>
        </template>
        <button v-if="tab === 'gantt'" class="ghost" @click="exportAllImage">导出图片</button>
        <button v-if="tab === 'docs'" class="ghost" @click="exportDocsXlsx">表格导出</button>
        <template v-if="tab === 'airparts' || tab === 'tools'">
          <button class="ghost" @click="exportPartsXlsx">表格导出</button>
          <label class="button ghost">表格导入<input hidden type="file" accept=".xlsx,.xls" @change="importPartsXlsx" /></label>
        </template>
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
          <!-- 全局飞机/项目信息 -->
          <section class="gp-section">
            <div class="gp-sec-title">飞机信息</div>
            <div v-for="(a, i) in aircrafts" :key="a.id" class="meta-group-card">
              <div class="meta-group-head"><span>飞机 {{ i + 1 }}</span><button class="icon-btn" @click="removeAircraft(a.id)">×</button></div>
              <div class="meta-grid meta-grid-4">
                <label class="gpf"><span class="gpf-label">机号</span><input v-model="a.reg" list="gp-aircraft-numbers" @change="onAircraftRegChange(a)" @input="save" /></label>
                <label class="gpf"><span class="gpf-label">FSN</span><input v-model="a.fsn" @change="onAircraftFieldEdited(a)" @input="save" /></label>
                <label class="gpf"><span class="gpf-label">MSN</span><input v-model="a.msn" @change="onAircraftFieldEdited(a)" @input="save" /></label>
                <label class="gpf"><span class="gpf-label">发动机</span><input v-model="a.engine" @change="onAircraftFieldEdited(a)" @input="save" /></label>
                <label class="gpf"><span class="gpf-label">机型</span><input v-model="a.type" @change="onAircraftFieldEdited(a)" @input="save" /></label>
                <label class="gpf"><span class="gpf-label">ETOPS</span><input v-model="a.etops" @change="onAircraftFieldEdited(a)" @input="save" /></label>
                <label class="gpf"><span class="gpf-label">ELT-DT</span><input v-model="a.eltDt" @change="onAircraftFieldEdited(a)" @input="save" /></label>
              </div>
            </div>
            <button class="gp-add" @click="addAircraft">+ 新增飞机</button>
          </section>

          <section class="gp-section">
            <div class="gp-sec-title">项目安排</div>
            <div class="arrange-row arrange-row-3">
              <label class="gpf"><span class="gpf-label">项目经理</span><textarea class="textwrap" rows="1" v-model="(arrangement as any).manager" @input="save"></textarea></label>
              <label class="gpf"><span class="gpf-label">值班组</span><textarea class="textwrap" rows="1" v-model="(arrangement as any).dutyGroup" @input="save"></textarea></label>
              <label class="gpf"><span class="gpf-label">执行地点</span><textarea class="textwrap" rows="1" v-model="(arrangement as any).location" @input="save"></textarea></label>
            </div>
            <div class="arrange-row arrange-participants-row">
              <label class="gpf"><span class="gpf-label">参与人员</span><textarea class="participant-input textwrap" rows="1" v-model="participantInput" placeholder="例如：张三、李四（停止编辑即同步名单）" @keydown="onParticipantInputKeydown" @blur="onParticipantInputBlur"></textarea></label>
            </div>
            <div class="arrange-row arrange-row-2">
              <label class="gpf"><span class="gpf-label">指令号</span><textarea class="textwrap" rows="1" v-model="(arrangement as any).orderNo" @input="save"></textarea></label>
              <label class="gpf"><span class="gpf-label">指令名称</span><textarea class="textwrap" rows="1" v-model="(arrangement as any).orderName" @input="save"></textarea></label>
            </div>
            <div class="arrange-items">
              <div v-for="it in arrangementItems" :key="it.id" class="arrange-item">
                <label class="gpf"><span class="gpf-label">内容</span><textarea class="textwrap" rows="1" v-model="it.content" @input="save"></textarea></label>
                <label class="gpf"><span class="gpf-label">安排</span><textarea class="textwrap" rows="1" v-model="it.assign" @input="save"></textarea></label>
                <button class="icon-btn" @click="removeArrangementItem(it.id)">×</button>
              </div>
            </div>
            <button class="gp-add" @click="addArrangementItem">+ 新增安排</button>
          </section>

          <section class="gp-section">
            <div class="gp-sec-title">部件卡片</div>
            <div v-for="(c, i) in components" :key="c.id" class="component-card">
              <div class="meta-group-head">
                <label class="gpf component-name-wrap"><span class="gpf-label">部件卡片 {{ i + 1 }} 名称</span><input v-model="c.name" class="component-name-input" @input="save" /></label>
                <button class="icon-btn" @click="removeComponent(c.id)">×</button>
              </div>
              <div class="component-cols">
                <div class="component-col">
                  <div class="component-tag off">拆下件</div>
                  <label class="gpf"><span class="gpf-label">件号</span><textarea class="textwrap" rows="1" v-model="c.offPn" @input="save"></textarea></label>
                  <label class="gpf"><span class="gpf-label">序号</span><textarea class="textwrap" rows="1" v-model="c.offSn" @input="save"></textarea></label>
                </div>
                <div class="component-col">
                  <div class="component-tag on">装上件</div>
                  <label class="gpf"><span class="gpf-label">件号</span><textarea class="textwrap" rows="1" v-model="c.onPn" @input="save"></textarea></label>
                  <label class="gpf"><span class="gpf-label">序号</span><textarea class="textwrap" rows="1" v-model="c.onSn" @input="save"></textarea></label>
                </div>
              </div>
            </div>
            <button class="gp-add" @click="addComponent">+ 新增部件卡片</button>
          </section>

          <!-- 每个 DAY 的表单卡片 -->
          <section v-for="chart in state.charts" :key="chart.id" class="gp-card" :id="'day-' + chart.id">
            <div class="chart-header">
              <div class="chart-title-row">
                <button class="collapse-btn" @click="toggleCollapse(chart.id)" :title="chart.collapsed ? '展开本天' : '收起本天'">{{ chart.collapsed ? '▶' : '▼' }}</button>
                <input class="date-input" type="date" v-model="chart.date" @change="save" title="日期(日历选择)" />
                <span class="day-label">DAY</span><input v-model.number="chart.day" class="day-input" @change="save" title="DAY 计数" />
                <input v-model="chart.title" class="chart-title-input" @change="save" title="标题" />
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
                  <input v-model="r.label" class="resp-label-input" title="负责内容" @input="save" />
                  <span class="resp-colon">:</span>
                  <NameSuggest :model-value="r.name" :suggestions="participantSuggestions" placeholder="姓名" @update:model-value="r.name = $event; save()" />
                  <button class="icon-btn resp-del" @click="removeResp(chart.id, r.id)">×</button>
                </div>
                <div class="resp-cell resp-add"><button @click="addResp(chart.id)">+ 添加安排</button></div>
              </div>

              <div class="gp-sec-title">工序卡片（按起阶段分组）</div>
              <div class="gp-stage-list">
                <div v-for="(st, si) in chart.stages" :key="st.id" class="form-stage-card">
                  <div class="form-stage-head">
                    <div class="form-stage-drag" title="拖动调整阶段顺序" @pointerdown="startFormStageDrag($event, chart.id, si)">⠿</div>
                    <input v-model="st.name" @input="save" />
                    <button class="icon-btn" title="在当前位置前插入阶段" @click="insertStage(chart.id, si)">+插</button>
                    <button class="icon-btn" @click="removeStage(chart.id, si)">×</button>
                  </div>
                  <div class="form-stage-body">
                    <div v-for="card in cardsOfStage(chart, si)" :key="card.id" class="form-card-row">
                      <div class="form-card-drag" title="拖动调行序" @pointerdown="startFormCardDrag($event, chart.id, card.id)">⠿</div>
                      <textarea class="textwrap" rows="1" v-model="card.content" placeholder="工作内容" @input="save"></textarea>
                      <NameSuggest :model-value="card.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="card.owner = $event; save()" />
                      <NameSuggest :model-value="card.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="card.participants = $event; save()" />
                      <textarea class="textwrap" rows="1" v-model="card.note" placeholder="备注" @input="save"></textarea>
                      <span v-if="card.endStage > card.startStage" class="fc-span">持续至「{{ chart.stages[card.endStage]?.name }}」</span>
                      <button class="icon-btn" @click="deleteCard(chart.id, card.id)">×</button>
                    </div>
                    <div v-for="p in partsOfStage(chart, si)" :key="'p' + p.id" class="form-card-row part-form-row">
                      <span class="part-form-tag">{{ p.type }}</span>
                      <textarea class="textwrap" rows="1" v-model="p.content" placeholder="串件内容" @input="save"></textarea>
                      <NameSuggest :model-value="p.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="p.owner = $event; save()" />
                      <NameSuggest :model-value="p.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="p.participants = $event; save()" />
                      <textarea class="textwrap" rows="1" v-model="p.note" placeholder="备注" @input="save"></textarea>
                      <button class="icon-btn" @click="deletePart(chart.id, p.id)">×</button>
                    </div>
                    <div v-if="!cardsOfStage(chart, si).length && !partsOfStage(chart, si).length" class="stage-empty">无工序</div>
                  </div>
                  <button class="add-form-card-btn" @click="addCard(chart.id, si)">+ 添加工序卡片</button>
                </div>
              </div>

              <div class="gp-sec-title">串件 (工卡签署)</div>
              <div class="part-rule">执行阶段列：选择串件要执行的阶段，选中后该串件作为工序卡片显示在对应阶段列；未选择 = 未分配(橘黄色)。</div>
              <table class="parts-table">
                <thead><tr><th style="width:80px">类型</th><th>内容</th><th style="width:90px">负责人</th><th style="width:110px">参与人</th><th>备注</th><th style="width:130px">执行阶段</th><th class="col-act">×</th></tr></thead>
                <tbody>
                  <tr v-for="p in chart.parts" :key="p.id" :class="{ unassigned: isPartUnassigned(p) }">
                    <td>
                      <select :value="p.type" @change="p.type = ($event.target as HTMLSelectElement).value; save()">
                        <option v-for="t in DEFAULT_PARTS_TYPES" :key="t">{{ t }}</option>
                        <option v-if="!DEFAULT_PARTS_TYPES.includes(p.type)">{{ p.type }}</option>
                      </select>
                    </td>
                    <td><textarea class="textwrap" rows="1" v-model="p.content" placeholder="内容" @input="save"></textarea></td>
                    <td><NameSuggest :model-value="p.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="p.owner = $event; save()" /></td>
                    <td><NameSuggest :model-value="p.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="p.participants = $event; save()" /></td>
                    <td><textarea class="textwrap" rows="1" v-model="p.note" placeholder="备注" @input="save"></textarea></td>
                    <td>
                      <select :value="p.executeStage ?? ''" @change="p.executeStage = ($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value); save()">
                        <option value="">未选择</option>
                        <option v-for="(s, si) in chart.stages" :key="s.id" :value="si">{{ s.name }}</option>
                      </select>
                    </td>
                    <td><button class="icon-btn" @click="deletePart(chart.id, p.id)">×</button></td>
                  </tr>
                  <tr v-if="!chart.parts.length"><td colspan="7" style="color:var(--muted);text-align:center;padding:12px">暂无串件 — 点击下方"新增串件"</td></tr>
                </tbody>
              </table>
              <button class="gp-add" @click="addPart(chart.id)">+ 新增串件</button>
            </template>
          </section>

          <button class="add-day-card" @click="addChart"><span>+ 增加一天</span></button>
        </div>

        <!-- 甘特图 -->
        <div v-else-if="tab === 'gantt'" class="gp-gantt">
          <section v-for="chart in state.charts" :key="chart.id" class="gp-card" :id="'day-' + chart.id">
            <div class="chart-header">
              <div class="chart-title-row">
                <button class="collapse-btn" @click="toggleCollapse(chart.id)" :title="chart.collapsed ? '展开本天' : '收起本天'">{{ chart.collapsed ? '▶' : '▼' }}</button>
                <input class="date-input" type="date" v-model="chart.date" @change="save" />
                <span class="day-label">DAY</span><input v-model.number="chart.day" class="day-input" @change="save" />
                <input v-model="chart.title" class="chart-title-input" @change="save" />
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
                  <input v-model="r.label" class="resp-label-input" @input="save" /><span class="resp-colon">:</span>
                  <NameSuggest :model-value="r.name" :suggestions="participantSuggestions" placeholder="姓名" @update:model-value="r.name = $event; save()" />
                  <button class="icon-btn resp-del" @click="removeResp(chart.id, r.id)">×</button>
                </div>
                <div class="resp-cell resp-add"><button @click="addResp(chart.id)">+ 添加安排</button></div>
              </div>
              <div class="gantt-wrap">
                <div class="gantt-grid" :style="{ gridTemplateColumns: `repeat(${chart.stages.length}, minmax(40px, 1fr))`, gridTemplateRows: `44px repeat(${rowCountOf(chart)}, auto)` }">
                  <div v-for="(st, si) in chart.stages" :key="st.id" class="gantt-head" :style="{ gridColumn: si + 1, gridRow: 1 }">
                    <div class="stage-col-drag" title="拖动调整列位置" @pointerdown="startStageColDrag($event, chart.id, si)">⠿</div>
                    <input v-model="st.name" class="stage-name-input" @input="save" />
                    <button class="add-card-btn" title="本列添加工序" @click="addCard(chart.id, si)">+工序</button>
                    <button class="stage-ins-btn" title="在当前位置前插入阶段" @click="insertStage(chart.id, si)">+插</button>
                    <button class="stage-del-btn" title="删除阶段" @click="removeStage(chart.id, si)">×</button>
                  </div>
                  <div v-for="card in chart.cards" :key="card.id" class="card-slot" :style="{ gridColumn: `${card.startStage + 1}/${card.endStage + 2}`, gridRow: (ganttRows(chart)[card.id] ?? 0) + 2 }">
                    <div class="gantt-card">
                      <div class="card-grip" title="拖动: 横移改阶段 / 纵移调行序" @pointerdown="startCardDrag($event, 'move', chart.id, card.id)">⠿</div>
                      <div class="resize-l" title="拖左边缘改开始阶段" @pointerdown="startCardDrag($event, 'resize-left', chart.id, card.id)"></div>
                      <div class="resize-r" title="拖右边缘改结束阶段" @pointerdown="startCardDrag($event, 'resize-right', chart.id, card.id)"></div>
                      <div class="card-body">
                        <textarea class="f-content" v-model="card.content" placeholder="工作内容" @input="save" rows="1"></textarea>
                        <div class="people-row"><span class="pl">负责</span><NameSuggest :model-value="card.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="card.owner = $event; save()" /></div>
                        <div class="people-row"><span class="pl">参与</span><NameSuggest :model-value="card.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="card.participants = $event; save()" /></div>
                        <textarea class="f-note" v-model="card.note" placeholder="备注(红色提示)" @input="save" rows="1"></textarea>
                      </div>
                      <div class="card-foot"><button class="icon-btn danger" @click="deleteCard(chart.id, card.id)">×</button></div>
                    </div>
                  </div>
                  <div v-for="p in chart.parts.filter(x => !isPartUnassigned(x))" :key="'p' + p.id" class="card-slot" :style="{ gridColumn: `${(p.executeStage ?? 0) + 1}/${(p.executeStage ?? 0) + 2}`, gridRow: (ganttRows(chart)['part:' + p.id] ?? 0) + 2 }">
                    <div class="gantt-card part-item">
                      <span class="part-tag">{{ p.type }}</span>
                      <div class="card-grip" title="拖动: 换阶段 / 调行序" @pointerdown="startPartDrag($event, chart.id, p.id)">⠿</div>
                      <div class="card-body">
                        <textarea class="f-content" v-model="p.content" placeholder="串件内容" @input="save" rows="1"></textarea>
                        <div class="people-row"><span class="pl">负责</span><NameSuggest :model-value="p.owner" :suggestions="participantSuggestions" placeholder="负责人" @update:model-value="p.owner = $event; save()" /></div>
                        <div class="people-row"><span class="pl">参与</span><NameSuggest :model-value="p.participants" :suggestions="participantSuggestions" placeholder="参与人" @update:model-value="p.participants = $event; save()" /></div>
                        <textarea class="f-note" v-model="p.note" placeholder="备注(红色提示)" @input="save" rows="1"></textarea>
                      </div>
                      <div class="card-foot"><button class="icon-btn danger" @click="deletePart(chart.id, p.id)">×</button></div>
                    </div>
                  </div>
                </div>
                <div class="stage-edge" title="拖拽增减阶段数（右加左减）" @pointerdown="startStageDrag($event, chart.id)">⋮</div>
              </div>
              <div v-if="chart.parts.some(p => isPartUnassigned(p))" class="unassigned-banner">
                <div class="unassigned-banner-h">
                  <span>▲ 未分配串件 ({{ chart.parts.filter(p => isPartUnassigned(p)).length }})</span>
                  <span class="part-rule">未选择执行阶段的串件，在表单子页选择执行阶段即可分配</span>
                </div>
                <div class="unassigned-grid">
                  <div v-for="p in chart.parts.filter(x => isPartUnassigned(x))" :key="'u' + p.id" class="gantt-card unassigned">
                    <span class="card-warn">▲</span>
                    <div class="card-grip" title="拖动到甘特图阶段列以分配" @pointerdown="startUnassignedDrag($event, chart.id, p.id)">⠿</div>
                    <div class="card-body">
                      <input class="f-content" v-model="p.content" :placeholder="p.type + ' · (空)'" @input="save" />
                      <div class="people-row"><span class="pl">负责</span><span>{{ p.owner || '未指派' }}</span></div>
                      <div class="people-row"><span class="pl">参与</span><span>{{ p.participants || '' }}</span></div>
                      <input v-if="p.note" class="f-note" v-model="p.note" @input="save" />
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
          <section class="gp-card">
            <div class="gp-docs-head">
              <div class="gp-sec-title">工包工卡</div>
              <label class="button primary">依据工卡清单<input hidden type="file" accept=".xlsx,.xls" @change="importWorkDocList" /></label>
            </div>
            <table class="parts-table">
              <thead><tr><th>工卡号</th><th>工卡名称</th><th class="col-act">×</th></tr></thead>
              <tbody>
                <tr v-for="(x, i) in state.docs.wp" :key="'wp' + i">
                  <td><input v-model="(x as any).jc" placeholder="工卡号" @input="save" /></td>
                  <td><input v-model="(x as any).name" placeholder="工卡名称" @input="save" /></td>
                  <td><button class="icon-btn" @click="removeDoc('wp', i)">×</button></td>
                </tr>
              </tbody>
            </table>
            <button class="gp-add" @click="addDoc('wp')">+ 添加</button>
          </section>
          <section class="gp-card">
            <div class="gp-sec-title">换发工卡</div>
            <table class="parts-table">
              <thead><tr><th>工卡号</th><th>工卡名称</th><th class="col-act">×</th></tr></thead>
              <tbody>
                <tr v-for="(x, i) in state.docs.eng" :key="'eng' + i">
                  <td><input v-model="(x as any).jc" placeholder="工卡号" @input="save" /></td>
                  <td><input v-model="(x as any).name" placeholder="工卡名称" @input="save" /></td>
                  <td><button class="icon-btn" @click="removeDoc('eng', i)">×</button></td>
                </tr>
              </tbody>
            </table>
            <button class="gp-add" @click="addDoc('eng')">+ 添加</button>
          </section>
          <section class="gp-card">
            <div class="gp-sec-title">串件工卡</div>
            <table class="parts-table sp-table">
              <thead><tr><th style="width:14%">类型</th><th style="width:26%">串件内容</th><th style="width:24%">工卡号</th><th>工卡名称</th><th class="col-act">×</th></tr></thead>
              <tbody>
                <template v-for="x in getSpRows()" :key="x.uid">
                  <tr :class="{ 'sp-auto': x.source === 'auto' }">
                    <td :rowspan="isCombineType(x.type) ? 2 : 1">
                      <select :value="x.type" @change="editSpRowType(x, ($event.target as HTMLSelectElement).value)">
                        <option v-for="t in DEFAULT_PARTS_TYPES" :key="t" :value="t">{{ t }}</option>
                        <option v-if="x.type && !DEFAULT_PARTS_TYPES.includes(x.type)" :value="x.type">{{ x.type }}</option>
                      </select>
                    </td>
                    <td :rowspan="isCombineType(x.type) ? 2 : 1"><textarea class="sp-content" rows="1" :value="x.content" placeholder="串件内容" @input="editSpRowContent(x, ($event.target as HTMLTextAreaElement).value)"></textarea></td>
                    <td><input :value="x.jc" placeholder="工卡号" @input="editSpRowJc(x, ($event.target as HTMLInputElement).value)" /></td>
                    <td><textarea class="sp-name" rows="1" :value="x.name" placeholder="工卡名称" @input="editSpRowName(x, ($event.target as HTMLTextAreaElement).value)"></textarea></td>
                    <td><button v-if="x.source === 'manual'" class="icon-btn" @click="removeSpDoc(x)">×</button></td>
                  </tr>
                  <tr v-if="isCombineType(x.type)" class="sp-combine-row">
                    <td colspan="2">
                      <div class="sp-combine-flex">
                        <span class="sp-combine-label">工卡号+工卡名称</span>
                        <input class="sp-combine-input sp-combine-jc" :value="x.jc" placeholder="工卡号" @input="editSpRowJc(x, ($event.target as HTMLInputElement).value)" />
                        <span class="sp-combine-plus">+</span>
                        <input class="sp-combine-input sp-combine-name" :value="x.name" placeholder="工卡名称" @input="editSpRowName(x, ($event.target as HTMLInputElement).value)" />
                      </div>
                    </td>
                    <td></td>
                  </tr>
                </template>
              </tbody>
            </table>
            <div class="sp-table-note">橙底行 = 表单串件自动同步（类型/内容可改，改动同步到串件卡片）；白底行 = 手动添加（仅串件工卡使用，不影响串件卡片）；串件/拆装类型下方附「工卡号+工卡名称」汇总行。</div>
            <button class="gp-add" @click="addDoc('sp')">+ 添加</button>
          </section>
        </div>

        <!-- 串件航材 / 工具清单 -->
        <div v-else class="gp-parts">
          <div class="subpage-head">
            <h3>{{ tab === 'airparts' ? '串件航材清单' : '串件工具清单' }}</h3>
            <div class="subpage-actions">
              <label v-if="tab === 'airparts'" class="field dedupe-toggle"><input type="checkbox" v-model="airDedupeMode" /> 重复航材检查</label>
              <button class="ghost" @click="addPartList(partKind)">+ 新增卡片</button>
            </div>
          </div>
          <!-- 重复航材检查：按件号跨卡片分组，重复 ≥2 次列出 -->
          <section v-if="tab === 'airparts' && airDedupeMode" class="gp-card air-dedupe-card">
            <div class="gp-sec-title">重复航材（{{ airDedupeGroups.length }} 种件号）</div>
            <div v-if="airDedupeGroups.length" class="air-dedupe-list">
              <div v-for="g in airDedupeGroups" :key="g.pn" class="air-dedupe-item">
                <span class="ad-pn">{{ g.pn }}</span>
                <span class="ad-name">{{ g.name }}</span>
                <span class="ad-count">× {{ g.count }} 次</span>
                <span class="ad-cards" v-if="g.cards.length">{{ g.cards.join("、") }}</span>
              </div>
            </div>
            <div v-else class="pt-empty">暂无重复航材。</div>
          </section>
          <section v-for="card in (tab === 'airparts' ? state.airParts : state.toolParts)" :key="card.id" class="gp-card pt-card">
            <div class="pt-card-head">
              <input v-model="card.name" class="pt-card-name" placeholder="卡片名称(可输入或搜索串件内容)" list="gp-part-contents" @input="save" />
              <span class="pt-count">{{ card.items.length }} 项</span>
              <button class="icon-btn" @click="removePartList(partKind, card.id)">×</button>
            </div>
            <div class="pt-items">
              <div v-for="it in card.items" :key="it.id" class="pt-item" :class="{ 'pt-item-air': tab === 'airparts', 'pt-item-tool': tab === 'tools' }">
                <label v-if="tab === 'airparts'" class="m-field m-field-no"><span>件号</span><textarea rows="1" v-model="it.pn" class="m-name" @input="save"></textarea></label>
                <label class="m-field m-field-name"><span>名称</span><textarea rows="1" v-model="it.name" class="m-name" @input="save"></textarea></label>
                <label class="m-field m-field-qty"><span>数量</span><input v-model.number="it.qty" type="number" min="0" @input="save" /></label>
                <div class="m-ops">
                  <button class="pt-note-toggle" @click="toggleNote(it.id)">备注 {{ expandedNotes.has(it.id) ? '▾' : '▸' }}</button>
                  <button class="icon-btn" @click="removePartItem(partKind, card.id, it.id)">×</button>
                </div>
                <div v-if="expandedNotes.has(it.id)" class="pt-note-row"><textarea v-model="it.note" class="pt-note" placeholder="备注" @input="save"></textarea></div>
              </div>
              <div v-if="!card.items.length" class="pt-empty">暂无物品 — 点击「+ 增加物品」</div>
            </div>
            <button class="gp-add" @click="addPartItem(partKind, card.id)">+ 增加物品</button>
          </section>
          <div v-if="!(tab === 'airparts' ? state.airParts : state.toolParts).length" class="pt-empty-all">暂无卡片 — 点上方「+ 新增卡片」</div>
        </div>
      </template>

      <!-- 模板库弹窗（调取/保存共用：可加载、覆盖保存已有模板、新增模板命名） -->
      <div v-if="showTplModal" class="gp-modal" @click.self="showTplModal = false">
        <div class="gp-modal-card">
          <div class="gp-modal-head"><h3>模板库</h3><button class="icon-btn" @click="showTplModal = false">×</button></div>
          <div class="gp-save-tpl-row">
            <input ref="saveTplInputRef" v-model="saveTplName" placeholder="新模板名称" @keydown.enter="saveAsTemplate" />
            <button class="primary" @click="saveAsTemplate">保存为新模板</button>
          </div>
          <p v-if="templatesLoading" class="gp-empty">加载中…</p>
          <template v-else-if="templates.length">
            <div v-for="t in templates" :key="t._id" class="gp-tpl-row">
              <div class="gp-tpl-info" @click="applyTemplate(t)"><strong>{{ t.name }}</strong><span>{{ t.state.charts.length }} DAY · {{ t.state.charts.reduce((n, c) => n + c.cards.length, 0) }} 工序</span></div>
              <div class="gp-tpl-actions">
                <button class="ghost" @click="applyTemplate(t)">加载</button>
                <button class="ghost" @click="overwriteTemplate(t)">覆盖</button>
                <button class="ghost" @click="duplicateTemplate(t)">复制</button>
                <button class="ghost danger" @click="deleteTemplate(t)">删除</button>
              </div>
            </div>
          </template>
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
  padding: 14px; background: var(--card, #fff); border: 1px solid var(--line, #dde2ec);
  border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.participant-panel h3 { margin: 0 0 12px; font-size: 15px; color: var(--muted, #697386); font-weight: 650; }
.participant-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 4px; }
.participant-sec { font-size: 12px; color: var(--muted, #697386); font-weight: 700; margin: 10px 0 6px; border-left: 3px solid var(--blue, #4472c4); padding-left: 6px; }
.participant-day-label { font-size: 11.5px; color: var(--blue-dark, #2f5597); font-weight: 700; margin: 8px 0 4px; cursor: pointer; user-select: none; }
.participant-day-label:hover { color: var(--blue, #4472c4); text-decoration: underline; }
.participant-input {
  width: 100%; height: 32px; padding: 0 8px; border: 1.5px solid var(--line, #dde2ec); border-radius: 8px;
  font-size: 13px; margin-bottom: 4px;
}
.participant-input:focus { border-color: var(--focus, #8eaadb); outline: none; }
.chip {
  background: var(--blue-light, #d9e1f2); color: var(--blue-dark, #2f5597); border-radius: 999px;
  padding: 4px 8px; font-size: 12px; text-align: center; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; font-weight: 600;
}
.chip.match { background: #d5efc9; color: #256b16; border: 1px solid #9fd08c; }
.chip.manual { cursor: pointer; }
.chip.manual:hover { opacity: .8; }
.chip .chip-x { opacity: 0; margin-left: 3px; font-weight: 700; }
.chip.manual:hover .chip-x { opacity: 1; }
.participant-empty { color: var(--muted, #697386); font-size: 12px; grid-column: 1 / -1; text-align: center; padding: 12px 0; }

.main-area { flex: 1; min-width: 0; }
/* 主区内容：非甘特图子页 1100px 居中（参与人名单已放屏幕左侧，不受此限制）；甘特图子页全宽 */
.main-area > *:not(.gp-modal) { max-width: 1100px; margin-left: auto; margin-right: auto; width: 100%; }
.gantt-page.gantt-wide .main-area > *:not(.gp-modal) { max-width: none; }

/* ===== 子页抬头 / tab ===== */
.gp-tabs { margin: 8px 0 12px; }
.subpage-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 4px 0 10px; }
.subpage-head h3 { margin: 0; font-size: 18px; color: var(--blue-dark, #2f5597); }
.gp-title-input { flex: 1; min-width: 220px; max-width: 560px; height: 34px; padding: 0 12px; border: 1.5px solid transparent; border-radius: 8px; background: transparent; font-size: 18px; font-weight: 700; color: var(--blue-dark, #2f5597); }
.gp-title-input:hover { border-color: var(--line, #dde2ec); background: #fff; }
.gp-title-input:focus { border-color: var(--focus, #8eaadb); background: #fff; outline: none; }
.subpage-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.subpage-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 12px; padding-bottom: 4px; }
.subpage-toolbar:empty { display: none; }
.toolbar-sep { width: 1px; height: 20px; background: var(--line, #dde2ec); flex: 0 0 auto; }

/* ===== 通用卡片 ===== */
.gp-card { border: 1px solid var(--line, #dde2ec); border-radius: 12px; background: #fff; padding: 14px 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.gp-sec-title { font-size: 14px; font-weight: 700; color: var(--blue-dark, #2f5597); margin: 10px 0 8px; border-left: 3px solid var(--blue, #4472c4); padding-left: 8px; }
.gp-add { margin-top: 10px; }
.icon-btn { border: none; background: transparent; color: var(--danger, #c0392b); font-size: 14px; cursor: pointer; }

/* ===== chart 头部 ===== */
.chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 12px; flex-wrap: wrap; }
.chart-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.collapse-btn { min-height: 0; height: 26px; padding: 0 8px; font-size: 12px; }
.date-input { width: 148px; height: 32px; padding: 0 8px; border: 1.5px solid var(--blue, #4472c4); border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--blue-dark, #2f5597); text-align: center; }
.day-label { font-size: 13px; font-weight: 700; color: var(--blue-dark, #2f5597); }
.day-input { width: 34px; border: none; background: var(--blue-light, #d9e1f2); border-radius: 6px; font-weight: 700; color: var(--blue-dark, #2f5597); text-align: center; font-size: 13px; padding: 4px 2px; }
.chart-title-input { border: none; background: transparent; font-size: 17px; font-weight: 700; color: var(--blue-dark, #2f5597); outline: none; padding: 2px 4px; min-width: 80px; }
.chart-title-input:hover { background: var(--blue-light, #d9e1f2); border-radius: 4px; }
.chart-title-input:focus { background: #fff; border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus, #8eaadb); }
.chart-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }

/* ===== 顶部责任 ===== */
.resp-banner {
  background: linear-gradient(180deg, #edf2fc, #fff);
  border: 1px solid var(--line, #dde2ec); border-radius: 10px;
  padding: 10px 14px; margin: 0 0 12px;
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 16px;
}
.resp-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
.resp-label-input { width: 90px; flex-shrink: 0; padding: 2px 6px; outline: none; font-weight: 700; font-size: 13px; color: var(--blue-dark, #2f5597); background: transparent; border: none; border-bottom: 1px dashed transparent; }
.resp-label-input:focus { background: #fff; border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus, #8eaadb); }
.resp-colon { color: var(--muted, #697386); flex-shrink: 0; }
.resp-name { flex: 1; min-width: 60px; padding: 2px 6px; outline: none; font-weight: 600; font-size: 13px; background: transparent; border: none; border-bottom: 1px dashed transparent; }
.resp-name:focus { background: #fff; border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus, #8eaadb); }
.resp-del { opacity: 0; width: 22px; height: 22px; }
.resp-cell:hover .resp-del { opacity: 1; }
.resp-cell.resp-add { justify-content: flex-start; }
.resp-cell.resp-add button { font-size: 12px; height: 26px; padding: 0 10px; }

/* ===== 甘特网格 ===== */
.gantt-wrap { overflow-x: auto; margin: 0 -6px; padding: 0 6px 6px; display: flex; align-items: stretch; }
.gantt-grid {
  display: grid; min-width: 0; width: 100%; border: 1px solid var(--line, #dde2ec); border-radius: 10px;
  background: #fafbff; position: relative; flex: 1;
}
.stage-edge { flex-shrink: 0; width: 16px; cursor: ew-resize; background: var(--blue-light, #d9e1f2); border: 1px solid var(--line, #dde2ec); border-left: none; border-radius: 0 10px 10px 0; display: flex; align-items: center; justify-content: center; color: var(--blue-dark, #2f5597); font-weight: 700; user-select: none; touch-action: none; }
.stage-edge:hover { background: #cdddf4; }
.stage-ins-btn { width: auto; height: 20px; padding: 0 5px; border-radius: 3px; font-size: 11px; line-height: 18px; border: 1px solid var(--line, #dde2ec); background: #fff; color: var(--muted, #697386); flex-shrink: 0; }
.form-stage-drag, .form-card-drag { cursor: grab; color: var(--muted, #697386); font-size: 12px; user-select: none; touch-action: none; flex-shrink: 0; }
.form-stage-drag:active, .form-card-drag:active { cursor: grabbing; }
.fc-span { flex-shrink: 0; font-size: 11px; color: var(--blue-dark, #2f5597); background: var(--blue-light, #d9e1f2); padding: 2px 8px; border-radius: 4px; }
.gantt-head {
  background: linear-gradient(180deg, #edf2fc, #fff);
  border-right: 1px solid var(--line, #dde2ec); border-bottom: 1px solid var(--line, #dde2ec);
  padding: 6px 8px; display: flex; flex-direction: row; align-items: center; gap: 4px;
  position: relative; min-height: 44px;
}
.stage-name-input { flex: 1; min-width: 0; text-align: center; border: none; background: transparent; font-size: 13.5px; font-weight: 650; padding: 2px 0; color: var(--blue-dark, #2f5597); }
.stage-name-input:focus { background: #fff; border-radius: 4px; outline: none; box-shadow: 0 0 0 2px var(--focus, #8eaadb); }
.add-card-btn { width: auto; height: 20px; padding: 0 6px; border-radius: 3px; font-size: 11px; line-height: 18px; border: 1px solid var(--line, #dde2ec); background: #fff; color: var(--blue-dark, #2f5597); flex-shrink: 0; }
.stage-del-btn { width: 22px; height: 20px; padding: 0; border-radius: 3px; font-size: 11px; line-height: 18px; border: 1px solid var(--line, #dde2ec); background: #fff; color: var(--danger, #c0392b); flex-shrink: 0; }
.stage-col-drag { cursor: grab; color: var(--muted, #697386); font-size: 12px; user-select: none; touch-action: none; flex-shrink: 0; }
.stage-col-drag:active { cursor: grabbing; }
.corner-cell { background: #fff; border-right: 1px solid var(--line, #dde2ec); border-bottom: 1px solid var(--line, #dde2ec); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--muted, #697386); padding: 6px 8px; }
.lane-label-cell { background: #fff; border-right: 1px solid var(--line, #dde2ec); border-bottom: 1px dashed var(--line, #dde2ec); display: flex; align-items: center; justify-content: center; min-height: 72px; font-size: 12px; font-weight: 650; color: var(--blue-dark, #2f5597); }
.card-slot { position: relative; }
.stage-capsules { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.stage-capsule { font-size: 11.5px; font-weight: 600; color: var(--blue-dark, #2f5597); background: var(--blue-light, #d9e1f2); border: 1px solid var(--blue, #4472c4); border-radius: 999px; padding: 2px 10px; }

/* ===== 甘特卡片 ===== */
.gantt-card {
  margin: 2px; padding: 0; border-radius: 8px; background: #fff;
  border: 1.5px solid var(--focus, #8eaadb); box-shadow: 0 1px 3px rgba(0,0,0,.04); position: relative;
  display: flex; flex-direction: column; min-height: 64px; z-index: 2; transition: box-shadow .15s;
}
.gantt-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.08); z-index: 3; }
.gantt-card.unassigned { background: #ffe0b3; border-color: #e8a44d; }
.gantt-card.unassigned .card-warn { position: absolute; top: 0; left: 0; color: var(--danger, #c0392b); font-size: 10px; line-height: 1; padding: 1px 3px; z-index: 5; }
.gantt-card.part-item { border-color: #e8a44d; }
.part-tag { position: absolute; top: 2px; left: 6px; font-size: 10px; font-weight: 700; color: #b45309; z-index: 5; }
.card-grip { position: absolute; top: 0; left: 8px; right: 8px; height: 14px; cursor: grab; display: flex; align-items: center; justify-content: center; color: var(--muted, #697386); font-size: 9px; letter-spacing: 3px; user-select: none; touch-action: none; z-index: 4; }
.card-grip:active { cursor: grabbing; }
.resize-l, .resize-r { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 4; touch-action: none; }
.resize-l { left: 0; border-radius: 8px 0 0 8px; }
.resize-r { right: 0; border-radius: 0 8px 8px 0; }
.resize-l:hover, .resize-r:hover { background: rgba(142,170,219,.45); }
.card-body { padding: 16px 9px 6px; display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.f-content { font-size: 12.5px; font-weight: 600; outline: none; word-break: break-word; background: rgba(247,249,253,.6); padding: 2px 4px; border-radius: 3px; min-height: 18px; border: none; width: 100%; resize: none; font-family: inherit; overflow: hidden; }
.f-content:focus { background: #fff; box-shadow: 0 0 0 2px var(--focus, #8eaadb); }
.people-row { display: flex; align-items: center; gap: 4px; font-size: 11.5px; }
.people-row .pl { color: var(--muted, #697386); flex-shrink: 0; }
.f-owner, .f-part { outline: none; flex: 1; min-width: 0; word-break: break-word; border: none; background: transparent; font-size: 11.5px; padding: 1px 2px; resize: none; overflow: hidden; font-family: inherit; }
.f-owner { font-weight: 600; }
.f-owner:focus, .f-part:focus { background: #fff; box-shadow: 0 0 0 2px var(--focus, #8eaadb); border-radius: 3px; }
.f-note { font-size: 11.5px; color: var(--danger, #c0392b); outline: none; word-break: break-word; font-weight: 500; min-height: 14px; border: none; background: transparent; width: 100%; padding: 1px 2px; resize: none; font-family: inherit; overflow: hidden; }
.f-note:focus { background: #fff; box-shadow: 0 0 0 2px var(--focus, #8eaadb); border-radius: 3px; }
.card-foot { position: absolute; top: 2px; right: 4px; display: flex; gap: 2px; z-index: 5; }
.card-foot .icon-btn { font-size: 11px; padding: 0 4px; height: 16px; line-height: 14px; opacity: 0; transition: opacity .15s; }
.gantt-card:hover .card-foot .icon-btn { opacity: 1; }

/* ===== 未分配串件 ===== */
.unassigned-banner { margin: 12px 0 0; padding: 10px 12px; background: #ffe8c7; border: 1.5px solid #e8a44d; border-radius: 10px; }
.unassigned-banner-h { font-size: 13px; font-weight: 700; color: #b45309; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.unassigned-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }

/* ===== 表单段落 ===== */
.gp-section { border: 1px solid var(--line, #dde2ec); border-radius: 12px; background: #fff; padding: 0 16px 14px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); overflow: hidden; }
/* 飞机信息/项目安排/部件卡片 三节标题：蓝底白字行 */
.gp-section > .gp-sec-title {
  margin: 0 -16px 12px -16px; padding: 9px 16px; border-left: none; border-radius: 0;
  background: linear-gradient(100deg, var(--blue, #4472c4), var(--blue-dark, #2f5597)); color: #fff;
}
.meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.meta-grid-4 { grid-template-columns: repeat(4, 1fr); }
.meta-grid input, .arrange-row input, .arrange-item input, .component-col input {
  height: 32px; padding: 0 8px; border: 1.5px solid var(--line, #dde2ec); border-radius: 8px; font-size: 13px; width: 100%;
}
.meta-grid input:focus, .arrange-row input:focus, .arrange-item input:focus, .component-col input:focus { border-color: var(--focus, #8eaadb); outline: none; }
/* 飞机卡片轮廓 */
.meta-group-card { border: 1px solid var(--line, #dde2ec); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.meta-group-head { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; font-weight: 700; color: var(--blue-dark, #2f5597); margin-bottom: 8px; }
/* 项目安排按行绘制卡片轮廓 */
.arrange-row { display: grid; gap: 10px; margin-bottom: 10px; border: 1px solid var(--line, #dde2ec); border-radius: 8px; padding: 8px 10px; background: #fff; }
.arrange-row-3 { grid-template-columns: repeat(3, 1fr); }
.arrange-row-2 { grid-template-columns: repeat(2, 1fr); }
.arrange-participants-row { grid-template-columns: 1fr; }
.arrange-participants .participant-input { width: 100%; }
.arrange-items { margin-top: 4px; }
.arrange-item { display: grid; grid-template-columns: 1fr 1fr 28px; gap: 10px; align-items: end; margin-bottom: 8px; }
/* 部件卡片轮廓 */
.component-card { border: 1px solid var(--line, #dde2ec); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.component-name-input { flex: 1; min-width: 0; height: 30px; padding: 0 8px; border: 1.5px solid var(--line, #dde2ec); border-radius: 7px; font-size: 13px; font-weight: 700; color: var(--blue-dark, #2f5597); }
.component-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.component-col { display: flex; flex-direction: column; gap: 6px; }
.component-tag { align-self: flex-start; font-size: 11.5px; font-weight: 700; padding: 2px 10px; border-radius: 5px; }
.component-tag.off { background: #ffe0b3; color: #b45309; }
.component-tag.on { background: #d5ecdc; color: #1e6b3a; }

/* ===== 字段标签外置（空名称放填报栏外）+ 自动换行文本域 ===== */
.gpf { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.gpf-label { font-size: 11.5px; color: var(--muted, #697386); font-weight: 600; line-height: 1.2; }
.component-name-wrap { flex: 1; }
textarea.textwrap {
  resize: none; overflow: hidden; field-sizing: content;
  min-height: 20px; max-height: 140px; line-height: 1.4;
  word-break: break-word; overflow-wrap: break-word; white-space: pre-wrap;
  font-family: inherit;
}
.meta-grid input, .gpf input, .gpf textarea, .arrange-row textarea, .arrange-item textarea, .component-col textarea {
  min-height: 28px; padding: 4px 8px; border: 1.5px solid var(--line, #dde2ec); border-radius: 8px; font-size: 13px; width: 100%; box-sizing: border-box; background: #fff;
}
.gpf input:focus, .gpf textarea:focus { border-color: var(--focus, #8eaadb); outline: none; }
.participant-input.textwrap { height: auto; min-height: 32px; }

/* ===== 阶段卡片（表单） ===== */
.gp-stage-list { display: flex; flex-direction: column; gap: 10px; }
.form-stage-card { border: 1px solid var(--line, #dde2ec); border-radius: 10px; padding: 8px 10px; background: #fafbff; }
.form-stage-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.form-stage-head input { flex: 1; border: none; background: transparent; font-size: 13px; font-weight: 700; color: var(--blue-dark, #2f5597); padding: 4px; outline: none; }
.form-stage-head input:focus { background: #fff; border-radius: 4px; box-shadow: 0 0 0 2px var(--focus, #8eaadb); }
.form-stage-body { display: flex; flex-direction: column; gap: 6px; }
.form-card-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; border: 1px solid var(--line, #dde2ec); border-radius: 8px; padding: 6px 8px; background: #fff; }
.form-card-row input, .form-card-row textarea { flex: 1; min-width: 90px; padding: 3px 6px; border: 1px solid var(--line, #dde2ec); border-radius: 6px; font-size: 12.5px; font-family: inherit; }
.form-card-row textarea { resize: none; overflow: hidden; line-height: 1.4; word-break: break-word; }
.form-card-row input:first-child, .form-card-row textarea:first-of-type { flex: 1.5; }
.form-card-row input:focus, .form-card-row textarea:focus { border-color: var(--focus, #8eaadb); outline: none; }
.part-form-row { border-color: #f0d9b8; background: #fff6e8; }
.part-form-tag { flex-shrink: 0; font-size: 11px; font-weight: 700; color: #b45309; background: #ffe0b3; padding: 2px 6px; border-radius: 4px; }
.stage-empty { color: var(--muted, #697386); font-size: 12.5px; text-align: center; padding: 10px 0; }
.add-form-card-btn { margin-top: 6px; font-size: 12px; height: 26px; padding: 0 10px; }

/* ===== 串件表 ===== */
.parts-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.parts-table th, .parts-table td { border: 1px solid var(--line, #dde2ec); padding: 5px 6px; }
.parts-table th { background: var(--blue, #4472c4); color: #fff; font-weight: 650; font-size: 12px; text-align: left; }
.parts-table tr.unassigned { background: #ffe8c7; }
.parts-table select, .parts-table input { width: 100%; height: 28px; border: 1px solid var(--line, #dde2ec); border-radius: 7px; padding: 0 6px; font-size: 12.5px; background: #fff; }
.parts-table select:focus, .parts-table input:focus { border-color: var(--focus, #8eaadb); outline: none; }
.parts-table textarea { width: 100%; min-height: 28px; padding: 0 6px; border: 1px solid var(--line, #dde2ec); border-radius: 7px; font-size: 12.5px; background: #fff; resize: none; overflow: hidden; line-height: 1.4; word-break: break-word; font-family: inherit; }
.parts-table textarea:focus { border-color: var(--focus, #8eaadb); outline: none; }
.parts-table .ns-wrap { width: 100%; }
.parts-table .ns-input { font-size: 12.5px; }
.parts-table tr.sp-auto { background: #fff6e8; }
.part-rule { font-size: 11.5px; color: var(--muted, #697386); margin: 4px 0 6px; }
.col-act { width: 32px; text-align: center; }
/* 串件工卡：工卡号/名称两列 + 类型/内容自动换行 + 串件/拆装汇总行 */
.sp-content, .sp-name {
  width: 100%; border: 1px solid var(--line, #dde2ec); border-radius: 6px; padding: 3px 6px; font-size: 12.5px;
  resize: none; overflow: hidden; line-height: 1.4; word-break: break-word; overflow-wrap: break-word; font-family: inherit;
  box-sizing: border-box; background: #fff; min-height: 26px;
}
.sp-name { min-height: 26px; color: var(--text, #222); }
.sp-content { min-height: 26px; }
.sp-table select { width: 100%; height: 28px; border: 1px solid var(--line, #dde2ec); border-radius: 7px; padding: 0 4px; font-size: 12.5px; background: #fff; }
.sp-table-note { font-size: 11.5px; color: var(--muted, #697386); margin: 6px 0 2px; }
.sp-combine-row td { background: #f2f6fd; font-size: 12px; color: var(--blue-dark, #2f5597); padding: 4px 8px; }
.sp-combine-flex { display: flex; align-items: center; gap: 6px; min-width: 0; }
.sp-combine-label { font-weight: 700; color: var(--muted, #697386); white-space: nowrap; }
.sp-combine-plus { color: var(--muted, #697386); font-weight: 700; }
.sp-combine-input { height: 26px; border: 1px solid var(--line, #dde2ec); border-radius: 6px; padding: 0 6px; font-size: 12.5px; background: #fff; color: var(--text, #222); min-width: 0; box-sizing: border-box; }
.sp-combine-jc { flex: 0 0 130px; }
.sp-combine-name { flex: 1; min-width: 80px; }

/* ===== 串件航材/工具清单（pt-card） ===== */
.pt-card-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: linear-gradient(90deg, #edf2fc, #fff); border-radius: 11px 11px 0 0; border-bottom: 1px solid var(--line, #dde2ec); margin: -14px -16px 6px; }
.pt-card-name { flex: 1; min-width: 120px; height: 32px; padding: 0 8px; border: 1.5px solid var(--blue, #4472c4); border-radius: 7px; font-size: 14px; font-weight: 700; color: var(--blue-dark, #2f5597); }
.pt-card-name:focus { outline: none; border-color: var(--focus, #8eaadb); }
.pt-count { font-size: 12px; color: var(--muted, #697386); flex-shrink: 0; }
.pt-items { padding: 4px 0 8px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.pt-empty { color: var(--muted, #697386); font-size: 12.5px; text-align: center; padding: 10px 0; }
.pt-empty-all { text-align: center; color: var(--muted, #697386); padding: 40px 0; font-size: 13px; }
/* 物品卡片：参考 A检 航材清单 m-item 样式（件号/名称/数量带字段标签 + 自动换行） */
.pt-item { display: grid; grid-template-columns: 1.1fr 2fr 0.6fr auto; gap: 6px; align-items: stretch; border: 1px solid #e6e9f0; border-radius: 8px; padding: 6px 8px; background: #fff; word-break: break-word; }
.pt-item-tool { grid-template-columns: 2fr 0.6fr auto; }
.pt-item:hover { border-color: var(--blue, #4472c4); }
.m-field { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: #6b7280; min-width: 0; }
.m-field input, .m-name { padding: 5px 7px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 13px; min-width: 0; width: 100%; box-sizing: border-box; }
.m-name { padding: 5px 7px; font-size: 12px; line-height: 1.4; resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; font-family: inherit; min-height: 30px; }
.m-ops { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.pt-note-row { grid-column: 1 / -1; }
.pt-note { min-height: 28px; font-size: 12.5px; color: #666; outline: none; background: #f2f6fd; border: 1px dashed var(--line, #dde2ec); border-radius: 6px; padding: 4px 8px; resize: none; width: 100%; font-family: inherit; }
.pt-note-toggle { border: 1px solid var(--line, #dde2ec); background: #fff; border-radius: 6px; height: 26px; padding: 0 8px; font-size: 12px; color: var(--muted, #697386); cursor: pointer; flex-shrink: 0; }
.pt-note-toggle:hover { color: var(--blue-dark, #2f5597); border-color: var(--blue, #4472c4); }
.danger-text { color: var(--danger, #c0392b); }

/* ===== 重复航材检查 ===== */
.dedupe-toggle { display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--text, #222); }
.dedupe-toggle input { width: 15px; height: 15px; accent-color: var(--blue, #4472c4); }
.air-dedupe-card { border-color: #e8a44d; }
.air-dedupe-list { display: flex; flex-direction: column; gap: 6px; }
.air-dedupe-item { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border: 1px solid #f0d9b8; background: #fff6e8; border-radius: 8px; padding: 6px 10px; font-size: 13px; }
.ad-pn { font-weight: 700; color: var(--blue-dark, #2f5597); }
.ad-name { color: var(--text, #222); }
.ad-count { font-weight: 700; color: #b45309; }
.ad-cards { font-size: 11.5px; color: var(--muted, #697386); }

/* ===== 增加一天 ===== */
.add-day-card {
  display: flex; align-items: center; justify-content: center;
  width: 100%;
  border: 2px dashed var(--blue, #4472c4); border-radius: 12px; padding: 18px; margin-top: 14px;
  cursor: pointer; color: var(--blue, #4472c4); font-size: 15px; font-weight: 700; background: #f5f9ff;
  transition: background .15s, border-color .15s;
}
.add-day-card:hover { background: var(--blue-light, #d9e1f2); border-color: var(--blue-dark, #2f5597); }

/* ===== 手册清单头 ===== */
.gp-docs-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }

/* ===== 模板弹窗 ===== */
.gp-modal { position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); padding: 20px; }
.gp-modal-card { background: #fff; border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.25); width: 100%; max-width: 520px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; }
.gp-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line, #dde2ec); }
.gp-modal-head h3 { margin: 0; font-size: 16px; color: var(--blue-dark, #2f5597); }
.gp-save-tpl-row { display: flex; gap: 8px; padding: 12px 18px; border-bottom: 1px solid var(--line, #dde2ec); }
.gp-save-tpl-row input { flex: 1; height: 34px; padding: 0 10px; border: 1.5px solid var(--line, #dde2ec); border-radius: 8px; font-size: 13px; }
.gp-save-tpl-row input:focus { border-color: var(--focus, #8eaadb); outline: none; }
.gp-tpl-row { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--line, #dde2ec); cursor: pointer; }
.gp-tpl-row:hover { background: #f5f9ff; }
.gp-tpl-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.gp-tpl-info strong { font-size: 14px; color: var(--text, #222); }
.gp-tpl-info span { font-size: 12px; color: var(--muted, #697386); }
.gp-tpl-actions { display: flex; gap: 6px; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
.gp-empty { color: var(--muted, #697386); text-align: center; padding: 20px 0; }

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
  .subpage-toolbar { gap: 6px; }
  .form-card-row { align-items: stretch; }
  .form-card-row textarea { min-width: 100%; }
  .gantt-grid { min-width: 640px; }
}
</style>
