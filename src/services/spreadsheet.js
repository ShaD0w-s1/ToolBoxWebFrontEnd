import * as XLSX from "xlsx";
import { normalizeState } from "../domain/toolbox";
import { download } from "../utils/format";

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });
}

export function exportState(state, name) {
  const rows = [["部位", "工作", "物品", "数量"]];
  for (const cat of state.categories) {
    for (const item of state.items.filter((entry) => entry.cat === cat)) rows.push([cat, item.sub, item.name, item.qty]);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "工具清单");
  const notes = [["部位", "备注"], ...state.categories.map((cat) => [cat, state.notes[cat] || ""])];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(notes), "部位备注");
  XLSX.writeFile(workbook, `${name || "工作项目"}.xlsx`);
}

export async function importState(file) {
  const workbook = XLSX.read(await readFile(file), { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.includes("工具清单")) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const header = rows.findIndex((row) => String(row[0]) === "部位" && String(row[1]) === "工作");
  const categories = [];
  const items = [];
  let id = 1;
  for (const row of rows.slice(Math.max(0, header + 1))) {
    const cat = String(row[0] || "").trim();
    const name = String(row[2] || "").trim();
    if (!cat || !name) continue;
    if (!categories.includes(cat)) categories.push(cat);
    items.push({ id: id++, cat, sub: String(row[1] || "").trim(), name, qty: Math.max(0, Number.parseInt(row[3], 10) || 0) });
  }
  const notes = {};
  const notesName = workbook.SheetNames.find((name) => name.includes("部位备注"));
  if (notesName) {
    const noteRows = XLSX.utils.sheet_to_json(workbook.Sheets[notesName], { header: 1, defval: "" });
    const noteHeader = noteRows.findIndex((row) => String(row[0]) === "部位");
    for (const row of noteRows.slice(Math.max(0, noteHeader + 1))) if (row[0]) notes[String(row[0]).trim()] = String(row[1] || "");
  }
  return normalizeState({ categories, items, notes });
}

export async function importCart(file) {
  const workbook = XLSX.read(await readFile(file), { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.includes("工具车")) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const header = rows.findIndex((row) => String(row[0]).match(/物品|名称/) && String(row[1]).includes("数量"));
  return rows.slice(Math.max(0, header + 1)).flatMap((row) => {
    const name = String(row[0] || "").trim();
    return name ? [{ name, qty: Math.max(0, Number.parseInt(row[1], 10) || 0) }] : [];
  });
}

export function exportJson(value, name = "全部工作项目数据.json") {
  download(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), name);
}

export function importJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); } catch (error) { reject(error); }
    };
    reader.readAsText(file);
  });
}
