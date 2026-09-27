import * as XLSX from "xlsx";

export interface WorkCardParseResult {
  /** 上传工卡清单中 E 列与 G 列的全部非空单元格文本（合并去重）。 */
  workContents: string[];
  /** 命中条目数（E+G 合并去重后长度）。 */
  rowCount: number;
}

/**
 * 解析工卡清单 xlsx：按 Excel 字母位置读取 **E 列（工作内容）与 G 列** 的全部非空内容，
 * 合并去重后返回，供二级页面做工作卡片匹配比对使用。
 * 兼容不同文件：通过“工作内容”表头定位数据起始行（找不到则从头开始），
 * 但列固定按字母位置读取（E=索引4、G=索引6），不依赖表头列号。
 */
export function parseWorkCardXlsx(file: File): Promise<WorkCardParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      try {
        const buffer = new Uint8Array(reader.result as ArrayBuffer);
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        // 关键修复：部分导出工具把 !ref 限制为模板打印区（如本例 A1:N20），但真实数据
        // 可能延伸到第 75 行甚至数百行。SheetJS 的 sheet_to_json 只返回 !ref 范围内的行，
        // 会导致表尾“工作内容”被整体丢弃。这里直接遍历所有真实单元格地址，自行构建完整
        // 二维矩阵，彻底摆脱 !ref 范围限制；行数下限设为 200，确保能容纳大清单。
        const cellAddrs = Object.keys(sheet).filter((k) => !k.startsWith("!"));
        let maxRow = -1;
        let maxCol = -1;
        for (const addr of cellAddrs) {
          const { r, c } = XLSX.utils.decode_cell(addr);
          if (r > maxRow) maxRow = r;
          if (c > maxCol) maxCol = c;
        }
        const totalRows = Math.max(maxRow + 1, 200);
        const totalCols = Math.max(maxCol + 1, 8); // 至少覆盖到 G 列(索引 6)
        const rows: unknown[][] = Array.from({ length: totalRows }, () =>
          new Array(totalCols).fill("")
        );
        for (const addr of cellAddrs) {
          const { r, c } = XLSX.utils.decode_cell(addr);
          const cell = sheet[addr];
          const raw = cell != null
            ? (cell.v !== undefined ? cell.v : (cell.w !== undefined ? cell.w : ""))
            : "";
          rows[r][c] = raw;
        }

        // 在前 8 行内查找包含“工作内容”的表头行，用于确定数据起始行（跳过表头）。
        let headerRow = -1;
        for (let row = 0; row < Math.min(rows.length, 8); row++) {
          const cells = rows[row] || [];
          if (cells.some((cell) => String(cell ?? "").includes("工作内容"))) { headerRow = row; break; }
        }
        const startRow = headerRow >= 0 ? headerRow + 1 : 0;

        // 定位“工作内容”所在的列（按表头文本，而非写死列号），兼容不同模板。
        // 找不到时回退到 E 列(索引 4)；始终额外读取 G 列(索引 6)以保持旧行为。
        let contentCol = -1;
        if (headerRow >= 0) {
          const headerCells = rows[headerRow] || [];
          for (let col = 0; col < headerCells.length; col++) {
            if (String(headerCells[col] ?? "").includes("工作内容")) { contentCol = col; break; }
          }
        }
        const COL_E = 4;
        const COL_G = 6;
        const cols = new Set<number>();
        cols.add(contentCol >= 0 ? contentCol : COL_E);
        if (COL_G !== contentCol) cols.add(COL_G);
        const colList = [...cols];
        const seen = new Set<string>();
        const workContents: string[] = [];
        for (let row = startRow; row < rows.length; row++) {
          for (const col of colList) {
            const value = rows[row]?.[col];
            if (value !== undefined && value !== null && String(value).trim()) {
              const text = String(value).trim();
              if (!seen.has(text)) { seen.add(text); workContents.push(text); }
            }
          }
        }
        if (workContents.length === 0) throw new Error("未在表格的 E/G 列中找到有效内容");
        resolve({ workContents, rowCount: workContents.length });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("解析表格失败"));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export interface WorkCardListRow {
  /** 项次（序号来源）。 */
  项次: string;
  /** 工卡号（用于与工卡分配标准库匹配部位/分级）。 */
  工卡号: string;
  /** 工卡名称（E/G 列 ## 前内容；E 列无中文则取 G 列）。 */
  工卡名称: string;
}

export interface WorkCardListParseResult {
  /** C2：工作内容。 */
  工作内容: string;
  /** J2：机号。 */
  机号: string;
  /** M2：地点。 */
  地点: string;
  cards: WorkCardListRow[];
  /** E/G 列去重后的工卡内容，供航材清单“依据工卡清单”筛选/补充使用。 */
  workContents: string[];
}

export interface WorkCardSheetMatrix {
  rows: string[][];
}

/** 把工卡清单 xlsx 读成完整的二维文本矩阵，彻底摆脱 !ref 打印区范围限制。 */
export function buildSheetMatrix(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      try {
        const buffer = new Uint8Array(reader.result as ArrayBuffer);
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const cellAddrs = Object.keys(sheet).filter((k) => !k.startsWith("!"));
        let maxRow = -1;
        let maxCol = -1;
        for (const addr of cellAddrs) {
          const { r, c } = XLSX.utils.decode_cell(addr);
          if (r > maxRow) maxRow = r;
          if (c > maxCol) maxCol = c;
        }
        const totalRows = Math.max(maxRow + 1, 500);
        const totalCols = Math.max(maxCol + 1, 14); // 至少覆盖到 M 列(索引 12)
        const rows: string[][] = Array.from({ length: totalRows }, () =>
          new Array(totalCols).fill(""),
        );
        for (const addr of cellAddrs) {
          const { r, c } = XLSX.utils.decode_cell(addr);
          const cell = sheet[addr];
          const raw = cell != null
            ? (cell.v !== undefined ? cell.v : (cell.w !== undefined ? cell.w : ""))
            : "";
          rows[r][c] = raw == null ? "" : String(raw);
        }
        resolve(rows);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("解析表格失败"));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/** 取单元格文本在首个“##”之前的部分（用于工卡名称中英文分隔）。 */
function beforeSeparator(value: string): string {
  const idx = value.indexOf("##");
  return (idx >= 0 ? value.slice(0, idx) : value).trim();
}

/* ── 「例行工卡清单」结构签名校验 ──────────────────────────────────────────
 * 「依据工卡清单」只接受 AMES「工包八大件」里的**例行工卡清单**。该文件版式固定
 * （实测样例 B-6922_A68检，98 行数据）：
 *   ① 抬头（第 1 行合并区）「飞机定检工卡清单 / JOB CARD LIST OF AIRCRAFT PERIOD CHECK」
 *   ② 区块标题（第 4 行）「例行工作清单 / NORMAL JOB CARD LIST」← 用以区分非例行等其它八大件
 *   ③ 表头行「项次 / 工卡号 JOBCARD NO / 版次 / 工作内容 DESCRIPTION / MP项次 / 标识 / 工时」
 *   ④ B 列（工卡号列）形如 SMJC-A32-212300-02-1、EOJC-A32-77-0002（含 "JC" 段）
 * 上传别的表格（工具清单、航材清单、非例行工卡清单…）会解析出空工卡或错误工卡，
 * 并据此错误地增删工具/航材。因此在解析入口先做结构校验，不通过即中止导入并提示重新下载。
 *
 * ⚠️ 比对前必须先归一化（去掉全部空白并转大写）：表头单元格内含换行
 *    （如 "工卡号\nJOBCARD NO"），逐字比对会漏判。
 */
export const WORKCARD_LIST_HINT =
  "该文件不符合「例行工卡清单」格式，请从 AMES 上下载工包八大件中的例行工卡清单";
/** 该提示要求用户离开页面去 AMES 重新下载 → 需要比普通提示停留更久。 */
export const WORKCARD_LIST_HINT_MS = 8000;

/** 上传件不符合「例行工卡清单」结构时抛出；`missing` 保留缺失特征供日志排查。 */
export class WorkCardListFormatError extends Error {
  constructor(readonly missing: string[]) {
    super(WORKCARD_LIST_HINT);
    this.name = "WorkCardListFormatError";
  }
}

/** 归一化文本：去掉所有空白字符（含单元格内换行）并转大写。 */
function normalizeForMatch(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

/** 校验矩阵是否符合「例行工卡清单」版式；返回**缺失的特征**（可读中文，空数组表示通过）。 */
export function checkWorkCardListShape(rows: string[][]): string[] {
  const missing: string[] = [];
  const cells = rows.map((row) => (row ?? []).map(normalizeForMatch));
  const anyCell = (pred: (cell: string) => boolean): boolean => cells.some((row) => row.some(pred));
  // ① 抬头：飞机定检工卡清单 / JOB CARD LIST OF AIRCRAFT PERIOD CHECK
  if (!anyCell((c) => c.includes("飞机定检工卡清单") || c.includes("JOBCARDLISTOFAIRCRAFT"))) {
    missing.push("抬头「飞机定检工卡清单」");
  }
  // ② 例行区块：⚠️ 必须按**单元格开头**匹配，绝不能用「包含」——
  //    「非例行工作清单」包含子串「例行工作清单」，用 includes 会让非例行清单**误通过**
  //    （本轮实测踩到：反例文件改标题后仍判通过）。
  if (!anyCell((c) => c.startsWith("例行工作清单") || c.startsWith("NORMALJOBCARDLIST"))) {
    missing.push("区块标题「例行工作清单」");
  }
  // ③ 表头：工卡号 / JOBCARD NO
  if (!anyCell((c) => c.includes("工卡号") || c.includes("JOBCARDNO"))) {
    missing.push("表头「工卡号」");
  }
  // ④ B 列（工卡号列）须有形如 SMJC-/EOJC- 的工卡号
  if (!rows.some((row) => /JC/.test(normalizeForMatch(row?.[1])))) {
    missing.push("B 列工卡号（如 SMJC-/EOJC-）");
  }
  return missing;
}

/**
 * 解析“依据工卡清单”导入件（需求 8）：
 *  - C2 → 工作内容，J2 → 机号，M2 → 地点；
 *  - 从数据行（第 3 行起）读取 A 列（项次）、B 列（工卡号）、E 或 G 列（工卡名称）；
 *  - 工卡名称取 E 列 ## 前内容，若 E 列不含中文则改取 G 列；
 *  - 仅在 B 列（工卡号）非空时计入。
 *  - 解析前先做「例行工卡清单」结构校验，拿错文件时抛 `WorkCardListFormatError`。
 */
export function parseWorkCardList(file: File): Promise<WorkCardListParseResult> {
  return buildSheetMatrix(file).then((rows) => {
    // 结构校验前置：拿错文件立即中止，避免写入空工卡/错工卡并误增删工具与航材
    const missing = checkWorkCardListShape(rows);
    if (missing.length) throw new WorkCardListFormatError(missing);
    const 工作内容 = (rows[1]?.[2] ?? "").trim(); // C2
    const 机号 = (rows[1]?.[9] ?? "").trim(); // J2
    const 地点 = (rows[1]?.[12] ?? "").trim(); // M2
    const cards: WorkCardListRow[] = [];
    const seenWork = new Set<string>();
    const workContents: string[] = [];
    for (let r = 2; r < rows.length; r++) {
      const 项次 = (rows[r]?.[0] ?? "").trim(); // A 列
      const 工卡号 = (rows[r]?.[1] ?? "").trim(); // B 列
      const eVal = (rows[r]?.[4] ?? "").trim(); // E 列
      const gVal = (rows[r]?.[6] ?? "").trim(); // G 列
      // 收集 E/G 工卡内容（所有数据行，与 parseWorkCardXlsx 一致，供工具/航材依据工卡筛选）
      if (eVal && !seenWork.has(eVal)) { seenWork.add(eVal); workContents.push(eVal); }
      if (gVal && !seenWork.has(gVal)) { seenWork.add(gVal); workContents.push(gVal); }
      if (!工卡号) continue;
      // 剔除汇总/页脚行：工卡号单元格含"JOBCARD NO"或"SB NO."字样（如"工卡号 JOBCARD NO""SB号 SB NO."）。
      if (/jobcard\s*no/i.test(工卡号) || /sb\s*no/i.test(工卡号)) continue;
      // 工卡名称取值逻辑（按工卡号前缀决定取 E 列还是 G 列）：
      //   B 列含 "SMJC" → 取 E 列；
      //   B 列含 "EOJC"/"TZJC"/"MCO"/"MAO"/"ZBJC"/"DZJC"/"NRC"/"LMO" → 取 G 列；
      //   其它 → 不取值（工卡名称为空）。
      // 取值后返回 "##" 隔断符前字段，无隔断符则返回全部。
      const idUpper = 工卡号.toUpperCase();
      let source = "";
      if (idUpper.includes("SMJC")) {
        source = eVal;
      } else if (["EOJC", "TZJC", "MCO", "MAO", "ZBJC", "DZJC", "NRC", "LMO"].some((p) => idUpper.includes(p))) {
        source = gVal;
      }
      cards.push({ 项次, 工卡号, 工卡名称: beforeSeparator(source) });
    }
    return { 工作内容, 机号, 地点, cards, workContents };
  });
}
