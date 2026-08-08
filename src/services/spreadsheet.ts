import * as XLSX from "xlsx";
import { normalizeState, type ToolCartItem, type ToolState } from "../domain/toolbox";
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
