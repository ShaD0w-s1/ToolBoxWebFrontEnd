import * as XLSX from "xlsx";
import {
  PREP_MISC,
  PREP_PERSONNEL_LAYOUT,
  PREP_PERSONNEL_FULL_ROWS,
  WORKCARD_SECTIONS,
  normalizeState,
  type PrepSheet,
  type StandalonePrepSheet,
  type ToolCartItem,
  type ToolState,
  type WorkCardRow,
  type WorkcardAssignment,
} from "../domain/toolbox";
import { saveFile } from "../utils/format";

type SheetCell = string | number;

function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

/** 导出两个工作表：工具清单和部位备注。移动端通过 saveFile（系统分享）可靠保存。 */
export function exportState(state: ToolState, name: string): void {
  const rows: SheetCell[][] = [["部位", "工作", "物品", "数量"]];
  for (const cat of state.categories) {
    for (const item of state.items.filter((entry) => entry.cat === cat)) rows.push([cat, item.sub, item.name, item.qty]);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "工具清单");
  const notes: SheetCell[][] = [["部位", "备注"], ...state.categories.map((cat) => [cat, state.notes[cat] || ""])];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(notes), "部位备注");
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([data], `${name || "工作项目"}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  void saveFile(file).catch(() => {});
}

export async function importState(file: File): Promise<ToolState> {
  const workbook = XLSX.read(await readFile(file), { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.includes("工具清单")) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<SheetCell[]>(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const header = rows.findIndex((row) => String(row[0]) === "部位" && String(row[1]) === "工作");
  const categories: string[] = [];
  const items: ToolState["items"] = [];
  let id = 1;
  for (const row of rows.slice(Math.max(0, header + 1))) {
    const cat = String(row[0] || "").trim();
    const name = String(row[2] || "").trim();
    if (!cat || !name) continue;
    if (!categories.includes(cat)) categories.push(cat);
    items.push({ id: id++, cat, sub: String(row[1] || "").trim(), name, qty: Math.max(0, Number.parseInt(String(row[3]), 10) || 0) });
  }
  const notes: Record<string, string> = {};
  const notesName = workbook.SheetNames.find((name) => name.includes("部位备注"));
  if (notesName) {
    const noteRows = XLSX.utils.sheet_to_json<SheetCell[]>(workbook.Sheets[notesName], { header: 1, defval: "" });
    const noteHeader = noteRows.findIndex((row) => String(row[0]) === "部位");
    for (const row of noteRows.slice(Math.max(0, noteHeader + 1))) if (row[0]) notes[String(row[0]).trim()] = String(row[1] || "");
  }
  return normalizeState({ categories, items, notes });
}

/** 导入航材清单 xlsx：列 部位 / 类型 / 件号 / 名称 / 数量（与 exportMaterialList 格式一致）。 */
export async function importMaterialList(file: File): Promise<ToolState> {
  const workbook = XLSX.read(await readFile(file), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<SheetCell[]>(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const header = rows.findIndex((row) => String(row[0]) === "部位" && String(row[1]) === "类型");
  const categories: string[] = [];
  const items: ToolState["items"] = [];
  let id = 1;
  for (const row of rows.slice(Math.max(0, header + 1))) {
    const cat = String(row[0] || "").trim();
    const name = String(row[3] || "").trim();
    if (!cat || !name) continue;
    if (!categories.includes(cat)) categories.push(cat);
    items.push({
      id: id++, cat,
      sub: String(row[1] || "").trim(),
      name,
      qty: Math.max(0, Number.parseInt(String(row[4]), 10) || 0),
      partNo: String(row[2] || "").trim(),
    });
  }
  return normalizeState({ categories, items });
}

export async function importCart(file: File): Promise<ToolCartItem[]> {
  const workbook = XLSX.read(await readFile(file), { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.includes("工具车")) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<SheetCell[]>(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const header = rows.findIndex((row) => String(row[0]).match(/物品|名称/) && String(row[1]).includes("数量"));
  return rows.slice(Math.max(0, header + 1)).flatMap((row) => {
    const name = String(row[0] || "").trim();
    return name ? [{ name, qty: Math.max(0, Number.parseInt(String(row[1]), 10) || 0) }] : [];
  });
}

export function exportJson(value: unknown, name = "全部工作项目数据.json"): void {
  const file = new File([JSON.stringify(value, null, 2)], name, { type: "application/json" });
  void saveFile(file).catch(() => {});
}

export function importJson(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result))); } catch (error) { reject(error); }
    };
    reader.readAsText(file);
  });
}

/** 把标准库的行数据（对象数组）导出为 xlsx，首行为列名。移动端走 saveFile 系统分享。 */
export function exportTable(rows: Record<string, string>[], columns: string[], name: string): void {
  const aoa: SheetCell[][] = [columns, ...rows.map((row) => columns.map((col) => row[col] ?? ""))];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "标准库");
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([data], `${name || "标准库"}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  void saveFile(file).catch(() => {});
}

/** 解析标准库 xlsx：以首行为表头，后续每行转为以表头为键的对象。空行跳过。 */
export async function importTable(file: File): Promise<Record<string, string>[]> {
  const workbook = XLSX.read(await readFile(file), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, { header: 1, defval: "" });
  if (!aoa.length) return [];
  const header = aoa[0].map((cell) => String(cell ?? "").trim());
  const rows: Record<string, string>[] = [];
  for (const line of aoa.slice(1)) {
    const row: Record<string, string> = {};
    let hasValue = false;
    header.forEach((col, index) => {
      const value = String(line[index] ?? "").trim();
      row[col] = value;
      if (value) hasValue = true;
    });
    if (hasValue) rows.push(row);
  }
  return rows;
}

/** 把工作准备单导出为多 Sheet 的 xlsx，便于线下打印、归档与回执交接。 */
export function exportPrepSheet(sheet: PrepSheet, name: string): void {
  const workbook = XLSX.utils.book_new();
  const baseAoA: SheetCell[][] = [
    ["机号", "FSN", "MSN", "机型", "发动机", "ETOPS", "ELT-DT"],
    [
      sheet.base.机号, sheet.base.FSN, sheet.base.MSN, sheet.base.机型,
      sheet.base.发动机, sheet.base.ETOPS, sheet.base["ELT-DT"],
    ],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(baseAoA), "基础信息");

  const infoAoA: SheetCell[][] = [["项目", "内容"]];
  const infoFields = ["指令号", "工作内容", "地点", "落地航班", "落地时间", "次日起飞时间"];
  for (const key of infoFields) infoAoA.push([key, (sheet.base as Record<string, string>)[key] || ""]);
  infoAoA.push(["后三天过夜航班1", sheet.base.后三天过夜航班1]);
  infoAoA.push(["后三天过夜航班2", sheet.base.后三天过夜航班2]);
  infoAoA.push(["后三天过夜航班3", sheet.base.后三天过夜航班3]);
  for (const item of sheet.extraBase) infoAoA.push([item.title, item.value]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(infoAoA), "工作信息");

  const rolesAoA: SheetCell[][] = [["项目", "内容"]];
  for (const row of PREP_PERSONNEL_LAYOUT) {
    for (const cell of row) rolesAoA.push([cell.key, sheet.roles[cell.key] || ""]);
  }
  for (const key of PREP_PERSONNEL_FULL_ROWS) rolesAoA.push([key, sheet.roles[key] || ""]);
  for (const item of sheet.roleExtras) rolesAoA.push([item.title, item.value]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rolesAoA), "人员安排");

  const miscAoA: SheetCell[][] = [["项目", "内容"]];
  for (const item of PREP_MISC) miscAoA.push([item, sheet.misc[item] || ""]);
  for (const item of sheet.miscExtras) miscAoA.push([item.title, item.value]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(miscAoA), "杂项");

  const keepAoA: SheetCell[][] = [["项目", "内容"]];
  keepAoA.push(["DD", sheet.DD]);
  keepAoA.push(["FC", sheet.FC]);
  for (const item of sheet.extra) keepAoA.push([item.title, item.value]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(keepAoA), "保留项目");

  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([data], `${sheet.title || name || "工作准备单"}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  void saveFile(file).catch(() => {});
}

/** 把工作准备单导出为单 Sheet xlsx，与网页格式相同（需求 7）。 */
export function exportPrepSheetSingle(sheet: PrepSheet, name: string): void {
  type Cell = string | number;
  const aoa: Cell[][] = [];
  const blank = () => aoa.push([]);

  // 标题
  aoa.push([sheet.title || "工作准备单"]);
  blank();

  // 基础信息
  aoa.push(["基础信息"]);
  aoa.push(["机号", sheet.base.机号, "FSN", sheet.base.FSN, "MSN", sheet.base.MSN]);
  aoa.push(["发动机", sheet.base.发动机, "机型", sheet.base.机型, "ETOPS", sheet.base.ETOPS, "ELT-DT", sheet.base["ELT-DT"]]);
  aoa.push(["指令号", sheet.base.指令号, "工作内容", sheet.base.工作内容, "地点", sheet.base.地点]);
  aoa.push(["落地航班", sheet.base.落地航班, "落地时间", sheet.base.落地时间]);
  aoa.push(["后三天过夜航班", `${sheet.base.后三天过夜航班1} — ${sheet.base.后三天过夜航班2} — ${sheet.base.后三天过夜航班3}`]);
  for (const item of sheet.extraBase) aoa.push([item.title, item.value]);
  blank();

  // 人员安排
  aoa.push(["人员安排"]);
  for (const row of PREP_PERSONNEL_LAYOUT) {
    const line: Cell[] = [];
    for (const cell of row) { line.push(cell.key); line.push(sheet.roles[cell.key] || ""); }
    aoa.push(line);
  }
  for (const key of PREP_PERSONNEL_FULL_ROWS) aoa.push([key, sheet.roles[key] || ""]);
  for (const item of sheet.roleExtras) aoa.push([item.title, item.value]);
  blank();

  // 杂项
  aoa.push(["杂项"]);
  for (const item of PREP_MISC) aoa.push([item, sheet.misc[item] || ""]);
  for (const item of sheet.miscExtras) aoa.push([item.title, item.value]);
  blank();

  // 保留项目
  aoa.push(["保留项目"]);
  aoa.push(["DD", sheet.DD]);
  aoa.push(["FC", sheet.FC]);
  for (const item of sheet.extra) aoa.push([item.title, item.value]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "工作准备单");
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([data], `${sheet.title || name || "工作准备单"}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  void saveFile(file).catch(() => {});
}

/** 把工卡分配清单导出为单 Sheet xlsx：未分配部位 + 四部位（FC/LG/AV CB/ENG）的工卡安排 + 各部位人员安排/新增安排，全部放在同一个工作表。 */
export function exportWorkcardAssignment(assignment: WorkcardAssignment, name: string): void {
  type Cell = string | number;
  const aoa: Cell[][] = [];
  const blank = () => aoa.push([]);

  aoa.push([`工卡分配清单${name ? ` · ${name}` : ""}`]);
  blank();

  // 1) 工卡安排：未分配 + 各部位卡片，全部汇入同一张表
  aoa.push(["工卡安排"]);
  aoa.push(["分组", "序号", "工卡号", "工卡名称", "工卡分级", "参与人员", "工作签卡者", "必检"]);
  const pushCard = (group: string, card: WorkCardRow): void => {
    aoa.push([
      group,
      card.序号 || "",
      card.工卡号 || "",
      card.工卡名称 || "",
      card.工卡分级 || "",
      card.参与人员 || "",
      card.工作签卡者 || "",
      card.必检 || "",
    ]);
  };
  for (const card of assignment.unassigned) pushCard("未分配", card);
  for (const section of WORKCARD_SECTIONS) {
    for (const card of assignment.sections[section].cards) pushCard(section, card);
  }
  blank();

  // 2) 人员安排 + 新增安排：分组 / 项目 / 内容
  aoa.push(["人员安排"]);
  aoa.push(["分组", "项目", "内容"]);
  for (const section of WORKCARD_SECTIONS) {
    const data = assignment.sections[section];
    for (const [field, value] of Object.entries(data.personnel)) {
      if (value) aoa.push([section, field, value]);
    }
    for (const item of data.extra) {
      if (item.arrange || item.personnel) aoa.push([section, `安排:${item.arrange}`, item.personnel]);
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "工卡分配清单");
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([data], `${name || "工卡分配清单"}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  void saveFile(file).catch(() => {});
}

/** 「单独项目」单项准备单导出：单 Sheet，按 基础信息 / 部件信息 / 人员安排 / 工序安排 / 工卡签署 顺序输出。 */
export function exportStandalonePrep(sheet: StandalonePrepSheet, name: string): void {
  const aoa: SheetCell[][] = [];
  const blank = () => aoa.push([]);
  aoa.push([sheet.title || "单项准备单"]);
  blank();

  // 基础信息
  aoa.push(["基础信息"]);
  const b = sheet.base;
  aoa.push(["机号", b.机号, "FSN", b.FSN, "MSN", b.MSN, "发动机", b.发动机]);
  aoa.push(["机型", b.机型, "ETOPS", b.ETOPS, "ELT-DT", b["ELT-DT"], "地点", b.地点]);
  aoa.push(["落地航班", b.落地航班, "落地时间", b.落地时间, "起飞时间", b.起飞时间]);
  aoa.push(["指令号", "工作内容"]);
  for (const w of sheet.works) aoa.push([w.指令号, w.工作内容]);
  blank();

  // 部件信息
  aoa.push(["部件信息"]);
  aoa.push(["序号", "拆下件号", "拆下序号", "装上件号", "装上序号"]);
  sheet.parts.forEach((p, i) => aoa.push([i + 1, p.拆下件号, p.拆下序号, p.装上件号, p.装上序号]));
  blank();

  // 人员安排
  aoa.push(["人员安排"]);
  const pn = sheet.personnel;
  const pnRows: Array<[string, string]> = [
    ["项目负责人", pn.项目负责人], ["值班组", pn.值班组], ["主卡签署", pn.主卡签署], ["必检", pn.必检],
    ["参与人员", pn.参与人员], ["工具负责", pn.工具负责], ["工具参与", pn.工具参与],
    ["航材负责", pn.航材负责], ["航材参与", pn.航材参与], ["工卡负责", pn.工卡负责], ["工卡打印", pn.工卡打印],
    ["试车人员", pn.试车人员], ["报工/完工反馈", pn["报工/完工反馈"]], ["运输跟踪", pn.运输跟踪], ["飞机监护", pn.飞机监护],
  ];
  for (const [k, v] of pnRows) aoa.push([k, v]);
  aoa.push(["内容", "人员"]);
  for (const e of pn.extra) aoa.push([e.内容, e.人员]);
  blank();

  // 工序安排
  aoa.push(["工序安排"]);
  sheet.processGroups.forEach((g, gi) => {
    aoa.push([`工序组 ${gi + 1}`]);
    aoa.push(["工作步骤", "人员安排", "检测&必检"]);
    for (const r of g.rows) aoa.push([r.工作步骤, r.人员安排, r["检测&必检"]]);
  });
  blank();

  // 工卡签署安排
  aoa.push(["工卡签署安排"]);
  aoa.push(["手册号", "工卡名", "签署人"]);
  for (const r of sheet.signingRows) aoa.push([r.手册号, r.工卡名, r.签署人]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "单项准备单");
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([data], `${name || "单项准备单"}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  void saveFile(file).catch(() => {});
}

/** 航材清单导出：单 Sheet，列 部位 / 类型 / 件号 / 名称 / 数量。 */
export function exportMaterialList(state: ToolState, name: string): void {
  const aoa: SheetCell[][] = [["部位", "类型", "件号", "名称", "数量"]];
  for (const cat of state.categories) {
    const items = state.items.filter((it) => it.cat === cat);
    if (!items.length) { aoa.push([cat, "", "", "", ""]); continue; }
    for (const it of items) aoa.push([cat, it.sub, it.partNo || "", it.name, it.qty]);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "航材清单");
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([data], `${name || "航材清单"}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  void saveFile(file).catch(() => {});
}
