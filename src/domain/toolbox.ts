/** 支持的机型。新增机型时只需在这里扩展。 */
export const AIRCRAFT_TYPES = ["A320", "B787"] as const;
export type AircraftType = (typeof AIRCRAFT_TYPES)[number];

/** 管理端可分配的班组。 */
export const TEAMS = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "外站"] as const;

/** 项目（二级）页集中显示默认渲染的部位；其余已有部位需手动“新增部位”才显示。
 *  顺序即显示顺序（与 sectionColor 固定配色表一致）。标准库页不受此限制，显示全部。 */
export const DEFAULT_CATEGORIES = ["ENG", "AV CB", "FC", "LG", "通用", "接机"] as const;
export type DefaultCategory = (typeof DEFAULT_CATEGORIES)[number];

/** 新建工作项目时可选择的类型。空字符串表示历史遗留项目（仅有工具清单）。 */
export const PROJECT_TYPES = ["A检", "零散", "换发", "换APU", "单独项目"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** 一级页面新增的标准库。label 为展示名，rowKeys 为表格列顺序（导入/导出一致）。
 *  已删除 787 工卡分配标准库；320 工卡分配标准库更名为“工卡分配标准库”（单一工卡库）。 */
export const STANDARD_LIB_KEYS = ["aircraft_info", "workcard_320"] as const;
export type StandardLibKey = (typeof STANDARD_LIB_KEYS)[number];
export const STANDARD_LIB_META: Record<StandardLibKey, { label: string; rowKeys: string[] }> = {
  aircraft_info: { label: "飞机信息标准库", rowKeys: ["飞机号", "MSN", "FSN", "机型", "发动机", "ETOPS", "ELT-DT"] },
  workcard_320: { label: "工卡分配标准库", rowKeys: ["工卡号", "工卡名", "MP项目号", "部位", "分级"] },
};
export type StandardLibRow = Record<string, string>;
export interface StandardLib {
  rows: StandardLibRow[];
}

/** 工卡分配清单四个部位分组（FC=飞控 / LG=起落架 / AV CB=机上客舱 / ENG=发动机）。 */
export const WORKCARD_SECTIONS = ["FC", "LG", "AV CB", "ENG"] as const;
export type WorkcardSection = (typeof WORKCARD_SECTIONS)[number];
/** 标准库“部位”字段 → 工卡分配清单分组的映射（AV/CB 同归“机上客舱”）。 */
export const SECTION_BY_AREA: Record<string, WorkcardSection> = {
  FC: "FC",
  LG: "LG",
  ENG: "ENG",
  AV: "AV CB",
  CB: "AV CB",
};
/** 工卡分配清单分组 → 标准库“部位”字段取值（用于把卡片同步回工卡分配标准库）。 */
export const AREA_BY_SECTION: Record<WorkcardSection, string> = {
  FC: "FC",
  LG: "LG",
  ENG: "ENG",
  "AV CB": "AV",
};
/** 工卡分配清单的 7 列表头（已移除 工卡1级检查 / 工卡2级检查 / 工作准备抽查）。 */
export const WORKCARD_COLUMNS = [
  "序号",
  "工卡号",
  "工卡名称",
  "工卡分级",
  "参与人员",
  "工作签卡者",
  "必检",
] as const;

/** 工作准备单的人员安排角色（旧版 7 角色，仅用于向后兼容迁移）。 */
export const PREP_ROLES = [
  "项目经理",
  "航后及定检整机放行",
  "发动机区域放行",
  "起落架区域放行",
  "飞控区域放行",
  "电子区域放行",
  "客舱区域放行",
] as const;

/** 人员安排 4 列布局：每行描述若干格子，cols 表示该格子占的列宽（总和 = 4）。 */
export const PREP_PERSONNEL_LAYOUT: Array<Array<{ key: string; cols: number }>> = [
  [
    { key: "项目经理", cols: 1 },
    { key: "航后及定检整机放行", cols: 1 },
    { key: "试车人员", cols: 1 },
    { key: "发动机区域放行", cols: 1 },
  ],
  [
    { key: "起落架区域放行", cols: 1 },
    { key: "飞控区域放行", cols: 1 },
    { key: "电子区域放行", cols: 1 },
    { key: "客舱区域放行", cols: 1 },
  ],
  [
    { key: "航材负责人", cols: 1 },
    { key: "航材参与", cols: 3 },
  ],
  [
    { key: "工具负责人", cols: 1 },
    { key: "工具参与", cols: 3 },
  ],
  [
    { key: "工卡负责人", cols: 1 },
    { key: "工卡打印", cols: 3 },
  ],
  [
    { key: "航后负责", cols: 1 },
    { key: "飞机交接", cols: 1 },
    { key: "飞机监护", cols: 1 },
    { key: "PSI", cols: 1 },
  ],
];
/** 人员安排中占整行的条目（label + input 跨 4 列）。 */
export const PREP_PERSONNEL_FULL_ROWS = ["必检名单"] as const;
/** 人员安排中默认放入"新增安排"区域的条目（用 title+value 样式渲染）。 */
export const PREP_PERSONNEL_DEFAULT_EXTRAS = ["照片检查"] as const;

/** 工作准备单的杂项条目（模板第 14–20 行）。 */
export const PREP_MISC = [
  "接机(挥棒 & 停止线)",
  "接机放行",
  "拖机备份",
  "试车监护",
  "换轮&刹车 备份",
  "废油处理",
  "定检TLB填写",
  "收尾现场清洁",
  "编辑完工微信",
] as const;

/** 工作准备单的卡片/分组条目：标题可改名、内容可编辑、支持动态新增。 */
export interface PrepSheetItem {
  /** 标题（卡片标题或表项名）。空字符串表示占位行。 */
  title: string;
  /** 文本内容。 */
  value: string;
}
/** 旧版人员安排角色（主/参与两格）；仅用于向后兼容。 */
export interface PrepSheetRole {
  main: string;
  helper: string;
}
export interface PrepSheet {
  /** 卡片标题（可点击重命名）。 */
  title: string;
  /** 基础信息固定字段（机号 + 工作内容 + 时间 + 后三天过夜航班等）。 */
  base: {
    机号: string;
    FSN: string;
    MSN: string;
    发动机: string;
    机型: string;
    ETOPS: string;
    "ELT-DT": string;
    指令号: string;
    工作内容: string;
    地点: string;
    落地航班: string;
    落地时间: string;
    次日起飞时间: string;
    后三天过夜航班1: string;
    后三天过夜航班2: string;
    后三天过夜航班3: string;
    必检名单: string;
  };
  /** 基础信息：动态新增条目（用户点"+ 新增内容"添加）。 */
  extraBase: PrepSheetItem[];
  /** 人员安排：每个键对应一个输入格（单值）。 */
  roles: Record<string, string>;
  /** 人员安排：动态新增条目（默认含"照片检查"）。 */
  roleExtras: PrepSheetItem[];
  /** 杂项：模板内置 9 项（4 列布局）。 */
  misc: Record<string, string>;
  /** 杂项：动态新增条目。 */
  miscExtras: PrepSheetItem[];
  /** 保留项目 DD / FC 两条文本。 */
  DD: string;
  FC: string;
  /** 保留项目：动态新增条目（"DD/FC" 按钮添加的额外行）。 */
  extra: PrepSheetItem[];
}

export interface WorkCardRow {
  序号: string;
  工卡号: string;
  工卡名称: string;
  工卡分级: string;
  参与人员: string;
  工作签卡者: string;
  必检: string;
  /** 标准库子部位（AV/CB 区分用，FC/LG/ENG 等于 section；导入时从标准库填入，不显示为列）。 */
  部位?: string;
}

/** 工卡分配清单中“人员安排”里的“新增安排”条目（安排 + 人员）。 */
export interface WorkcardArrange {
  arrange: string;
  personnel: string;
}

export interface WorkcardSectionData {
  personnel: Record<string, string>;
  cards: WorkCardRow[];
  extra: WorkcardArrange[];
}

export interface WorkcardAssignment {
  sections: Record<WorkcardSection, WorkcardSectionData>;
  /** 未分配部位：导入时未能在标准库匹配到部位的工卡，等待用户在页面上指定部位。 */
  unassigned: WorkCardRow[];
}

/** 「单独项目」单项准备单 —— 基础信息里的工作条目（指令号 + 工作内容）。 */
export interface StandaloneWork {
  id: number;
  指令号: string;
  工作内容: string;
}
/** 部件信息：一组拆下件 / 装上件（部件名可编辑）。 */
export interface StandalonePart {
  id: number;
  name: string;
  拆下件号: string;
  拆下序号: string;
  装上件号: string;
  装上序号: string;
}
/** 人员安排里的「新增安排」条目（内容 + 人员）。 */
export interface StandaloneArrange {
  id: number;
  内容: string;
  人员: string;
}
/** 工序组里的一行（工作步骤 + 人员安排 + 检测&必检）。 */
export interface StandaloneProcessRow {
  id: number;
  工作步骤: string;
  人员安排: string;
  "检测&必检": string;
}
/** 工序安排里的一个工序组（含若干行，整组可删除；名称可改）。 */
export interface StandaloneProcessGroup {
  id: number;
  name: string;
  rows: StandaloneProcessRow[];
}
/** 工卡签署安排的一行（手册号 + 工卡名 + 签署人）。 */
export interface StandaloneSigningRow {
  id: number;
  手册号: string;
  工卡名: string;
  签署人: string;
}
/** 「单独项目」的专项工作准备单。 */
export interface StandalonePrepSheet {
  title: string;
  /** 基础信息固定字段（机号 / 飞机参数 / 航班 / 时间）。 */
  base: {
    机号: string;
    FSN: string;
    MSN: string;
    发动机: string;
    机型: string;
    ETOPS: string;
    "ELT-DT": string;
    地点: string;
    落地航班: string;
    落地时间: string;
    起飞时间: string;
  };
  /** 基础信息里的工作列表（指令号 + 工作内容，「新增工作」追加）。 */
  works: StandaloneWork[];
  /** 部件信息：若干部件组，「新增信息」追加。 */
  parts: StandalonePart[];
  /** 人员安排：固定角色 + 动态「新增安排」。 */
  personnel: {
    项目负责人: string;
    值班组: string;
    主卡签署: string;
    必检: string;
    参与人员: string;
    工具负责: string;
    工具参与: string;
    航材负责: string;
    航材参与: string;
    工卡负责: string;
    工卡打印: string;
    试车人员: string;
    "报工/完工反馈": string;
    运输跟踪: string;
    飞机监护: string;
    extra: StandaloneArrange[];
  };
  /** 工序安排：若干工序组（每组一个可删除的表格）。 */
  processGroups: StandaloneProcessGroup[];
  /** 工卡签署安排：单个表格若干行。 */
  signingRows: StandaloneSigningRow[];
}

export interface ToolItem {
  id: number;
  cat: string;
  sub: string;
  name: string;
  qty: number;
  /** 航材物品的件号；工具清单不使用该字段。 */
  partNo?: string;
}

export interface ToolState {
  categories: string[];
  items: ToolItem[];
  notes: Record<string, string>;
  useCart: boolean;
  aircraftType: AircraftType;
}

export interface ToolCartItem {
  name: string;
  qty: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  aircraftType: AircraftType;
  team: string;
  /** 空字符串表示尚未选择类型（历史遗留项目仅含工具清单）。 */
  type: ProjectType | "";
  data: ToolState;
  /** A检项目的两个子结构；非 A检项目这两个字段为空。 */
  prepSheet: PrepSheet;
  workcardAssignment: WorkcardAssignment;
  /** 「单独项目」的专项工作准备单；非单独项目为默认空值。 */
  standalonePrepSheet: StandalonePrepSheet;
  /** 「单独项目」的航材清单（部位与 data.categories 共享）；非单独项目为空。 */
  materialList: ToolState;
  /** 云端文档版本号（后端每次写入原子递增），用于乐观锁冲突检测。 */
  version: number;
}

export interface ToolboxApp {
  libraries: Record<AircraftType, ToolState>;
  /** 航材标准库（A320 / B787），结构与工具标准库一致（items 含 partNo）。 */
  materialLibraries: Record<AircraftType, ToolState>;
  projects: Project[];
  toolCart: ToolCartItem[];
  standardLibraries: Record<StandardLibKey, StandardLib>;
}

export interface SectionItemPayload { name: string; quantity: number; partNo?: string }
export interface WorkPayload { name: string; items: SectionItemPayload[] }
export interface SectionPayload { name: string; notes: string; works: WorkPayload[] }
export interface ProjectPayload {
  name: string;
  aircraft_type: AircraftType;
  team: string;
  /** 项目类型；空字符串表示未选择（历史遗留项目）。 */
  type?: ProjectType | "";
  sections: SectionPayload[];
  use_tool_cart: boolean;
  /** A检项目的工作准备单；非 A检项目为空对象。 */
  prep_sheet?: PrepSheet;
  /** A检项目的工卡分配清单；非 A检项目为空对象。 */
  workcard_assignment?: WorkcardAssignment;
  /** 「单独项目」的专项工作准备单；非单独项目为空对象。 */
  standalone_prep_sheet?: StandalonePrepSheet;
  /** 「单独项目」的航材清单（sections 结构）；非单独项目为空数组。 */
  material_list?: SectionPayload[];
}

type StateInput = Partial<ToolState>;
export type AppInput = Partial<ToolboxApp> & { standard?: ToolState };

/** 生成首次启动时使用的演示标准库。 */
export function sampleState(): ToolState {
  let id = 1;
  const item = (cat: string, sub: string, name: string, qty: number): ToolItem => ({ id: id++, cat, sub, name, qty });
  return normalizeState({
    categories: ["A", "B", "C", "D", "E"],
    items: [
      item("A", "项目A1", "螺丝", 10), item("A", "项目A1", "垫圈", 20),
      item("A", "项目A2", "电缆", 5), item("A", "项目A2", "接头", 8),
      item("B", "项目B1", "扳手", 3), item("B", "项目B1", "套筒", 6), item("B", "项目B2", "油脂", 2),
      item("C", "项目C1", "滤芯", 4), item("C", "项目C1", "密封圈", 12),
      item("D", "项目D1", "灯泡", 15), item("D", "项目D2", "保险丝", 30), item("D", "项目D2", "导线", 9),
      item("E", "项目E1", "胶带", 5), item("E", "项目E1", "扎带", 50), item("E", "项目E2", "标签", 100),
    ],
    notes: {},
    useCart: false,
  });
}

export function defaultPrepSheet(): PrepSheet {
  // 人员安排：从 PREP_PERSONNEL_LAYOUT + FULL_ROWS 初始化所有键为空字符串。
  const roles: Record<string, string> = {};
  for (const row of PREP_PERSONNEL_LAYOUT) {
    for (const cell of row) roles[cell.key] = "";
  }
  for (const key of PREP_PERSONNEL_FULL_ROWS) roles[key] = "";
  const misc: Record<string, string> = {};
  for (const item of PREP_MISC) misc[item] = "";
  return {
    title: "工作准备单",
    base: {
      机号: "", FSN: "", MSN: "", 发动机: "", 机型: "", ETOPS: "", "ELT-DT": "",
      指令号: "", 工作内容: "", 地点: "",
      落地航班: "", 落地时间: "", 次日起飞时间: "",
      后三天过夜航班1: "", 后三天过夜航班2: "", 后三天过夜航班3: "",
      必检名单: "",
    },
    extraBase: [],
    roles,
    roleExtras: PREP_PERSONNEL_DEFAULT_EXTRAS.map((title) => ({ title, value: "" })),
    misc,
    miscExtras: [],
    DD: "",
    FC: "",
    extra: [{ title: "", value: "" }], // 修复 5：保留项目默认一行空"新增"格式
  };
}

export function defaultWorkcardAssignment(): WorkcardAssignment {
  const sections = {} as Record<WorkcardSection, WorkcardSectionData>;
  for (const section of WORKCARD_SECTIONS) {
    sections[section] = { personnel: {}, cards: [], extra: [] };
  }
  return { sections, unassigned: [] };
}

let standaloneId = 1;
function spId(): number { return standaloneId++; }

/** 「单独项目」单项准备单默认值：基础信息一行空工作、无部件、一个空工序组（3 空行）、工卡签署 3 空行。 */
export function defaultStandalonePrepSheet(): StandalonePrepSheet {
  return {
    title: "单项准备单",
    base: {
      机号: "", FSN: "", MSN: "", 发动机: "", 机型: "", ETOPS: "", "ELT-DT": "",
      地点: "", 落地航班: "", 落地时间: "", 起飞时间: "",
    },
    works: [{ id: spId(), 指令号: "", 工作内容: "" }],
    parts: [],
    personnel: {
      项目负责人: "", 值班组: "", 主卡签署: "", 必检: "", 参与人员: "",
      工具负责: "", 工具参与: "", 航材负责: "", 航材参与: "",
      工卡负责: "", 工卡打印: "", 试车人员: "",
      "报工/完工反馈": "", 运输跟踪: "", 飞机监护: "",
      extra: [],
    },
    processGroups: [{ id: spId(), name: "工序组 1", rows: [emptyProcessRow(), emptyProcessRow(), emptyProcessRow()] }],
    signingRows: [emptySigningRow(), emptySigningRow(), emptySigningRow()],
  };
}

export function emptyProcessRow(): StandaloneProcessRow {
  return { id: spId(), 工作步骤: "", 人员安排: "", "检测&必检": "" };
}
export function emptySigningRow(): StandaloneSigningRow {
  return { id: spId(), 手册号: "", 工卡名: "", 签署人: "" };
}

export function defaultStandardLibraries(): Record<StandardLibKey, StandardLib> {
  return {
    aircraft_info: { rows: [] },
    workcard_320: { rows: [] },
  };
}

export function normalizeStdLib(value: Partial<StandardLib> = {}): StandardLib {
  const meta = STANDARD_LIB_META;
  const rows = Array.isArray(value.rows)
    ? value.rows.map((entry) => {
        const row: StandardLibRow = {};
        for (const key of Object.keys(entry || {})) row[String(key)] = String((entry as Record<string, unknown>)[key] ?? "");
        return row;
      })
    : [];
  void meta;
  return { rows };
}

/** 构造完整的本地初始数据，避免组件处理缺失字段。 */
export function defaultApp(): ToolboxApp {
  return {
    libraries: { A320: sampleState(), B787: sampleState() },
    materialLibraries: { A320: normalizeState(), B787: normalizeState() },
    projects: [],
    toolCart: [
      { name: "扳手", qty: 3 }, { name: "套筒", qty: 6 }, { name: "螺丝", qty: 10 },
      { name: "扎带", qty: 50 }, { name: "保险丝", qty: 30 }, { name: "胶带", qty: 5 },
    ],
    standardLibraries: defaultStandardLibraries(),
  };
}

export function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 统一清洗本地、导入文件和后端返回的数据。 */
export function normalizeState(value: StateInput = {}): ToolState {
  const aircraftType = AIRCRAFT_TYPES.includes(value.aircraftType as AircraftType) ? value.aircraftType as AircraftType : "A320";
  return {
    categories: Array.isArray(value.categories) ? value.categories.map(String) : [],
    items: Array.isArray(value.items) ? value.items.map((entry) => ({
      id: Number(entry.id) || 0,
      cat: String(entry.cat || ""),
      sub: String(entry.sub || ""),
      name: String(entry.name || ""),
      qty: Math.max(0, Number.parseInt(String(entry.qty), 10) || 0),
      partNo: entry.partNo != null ? String(entry.partNo) : "",
    })) : [],
    notes: value.notes && typeof value.notes === "object" ? value.notes : {},
    useCart: Boolean(value.useCart),
    aircraftType,
  };
}

export function normalizeApp(value: AppInput = {}): ToolboxApp {
  const fallback = defaultApp();
  const libraries = value.libraries || (value.standard ? { A320: value.standard, B787: deepCopy(value.standard) } : fallback.libraries);
  const materialLibraries = (value as { materialLibraries?: Record<AircraftType, ToolState> }).materialLibraries || fallback.materialLibraries;
  return {
    libraries: {
      A320: normalizeState(libraries.A320 || fallback.libraries.A320),
      B787: normalizeState(libraries.B787 || fallback.libraries.B787),
    },
    materialLibraries: {
      A320: normalizeState(materialLibraries.A320 || fallback.materialLibraries.A320),
      B787: normalizeState(materialLibraries.B787 || fallback.materialLibraries.B787),
    },
    projects: (value.projects || []).map((project) => ({
      ...project,
      id: String(project.id || ""),
      aircraftType: AIRCRAFT_TYPES.includes(project.aircraftType) ? project.aircraftType : "A320",
      team: project.team || "",
      type: (PROJECT_TYPES as readonly string[]).includes(project.type as string)
        ? (project.type as ProjectType)
        : "",
      data: normalizeState(project.data),
      prepSheet: (project.prepSheet as PrepSheet) || defaultPrepSheet(),
      workcardAssignment: (project.workcardAssignment as WorkcardAssignment) || defaultWorkcardAssignment(),
      standalonePrepSheet: (project.standalonePrepSheet as StandalonePrepSheet) || defaultStandalonePrepSheet(),
      materialList: normalizeState((project.materialList as StateInput) || {}),
      version: Number(project.version) || 0,
    })),
    toolCart: (value.toolCart || []).map((entry) => ({
      name: String(entry.name || ""),
      qty: Math.max(0, Number.parseInt(String(entry.qty), 10) || 0),
    })),
    standardLibraries: (value.standardLibraries || fallback.standardLibraries) as Record<StandardLibKey, StandardLib>,
  };
}

/** 把后端 sections 结构转换为前端便于编辑的扁平物品结构。 */
export function stateFromSections(sections: SectionPayload[] = [], useCart = false): ToolState {
  let id = 1;
  const categories: string[] = [];
  const notes: Record<string, string> = {};
  const items: ToolItem[] = [];
  for (const section of sections) {
    const cat = String(section.name || "未命名部位");
    if (!categories.includes(cat)) categories.push(cat);
    if (section.notes) notes[cat] = section.notes;
    for (const work of section.works || []) {
      for (const entry of work.items || []) {
        items.push({ id: id++, cat, sub: String(work.name || ""), name: String(entry.name || ""), qty: Math.max(0, Number(entry.quantity) || 0), partNo: entry.partNo != null ? String(entry.partNo) : "" });
      }
    }
  }
  return normalizeState({ categories, notes, items, useCart });
}

/** 把前端状态重新组装为后端 API 所需的 sections 结构。 */
export function sectionsFromState(state: ToolState): SectionPayload[] {
  // 部位列表 = state.categories + 物品里出现但未登记的部位（兜底：单独项目航材清单的部位
  // 与工具清单共享 data.categories，materialList.categories 可能为空，否则物品会被丢弃致不同步）。
  const cats = [...state.categories];
  for (const item of state.items) {
    if (item.cat && !cats.includes(item.cat)) cats.push(item.cat);
  }
  return cats.map((cat) => {
    const subNames = [...new Set(state.items.filter((item) => item.cat === cat).map((item) => item.sub))];
    return {
      name: cat,
      notes: state.notes[cat] || "",
      works: subNames.map((sub) => ({
        name: sub,
        items: state.items.filter((item) => item.cat === cat && item.sub === sub).map((item) => ({ name: item.name, quantity: item.qty, ...(item.partNo ? { partNo: item.partNo } : {}) })),
      })),
    };
  });
}

/** CloudBase 有时返回单对象、有时返回 data 数组，此处统一解包。 */
export function unwrapDocument(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) || null;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) return (record.data[0] as Record<string, unknown>) || null;
    if (record.data && typeof record.data === "object") return record.data as Record<string, unknown>;
    return record;
  }
  return null;
}

function prepSheetFromDoc(doc: Record<string, unknown>): PrepSheet {
  const sheet = defaultPrepSheet();
  const raw = (doc.prep_sheet && typeof doc.prep_sheet === "object" ? doc.prep_sheet : {}) as Record<string, unknown>;
  sheet.title = String(raw.title ?? sheet.title) || sheet.title;
  const rawBase = (raw.base && typeof raw.base === "object" ? raw.base : {}) as Record<string, unknown>;
  // 新版 base 里的固定字段直接读取。
  for (const key of Object.keys(sheet.base)) {
    const k = key as keyof typeof sheet.base;
    sheet.base[k] = String(rawBase[key] ?? "");
  }
  // 旧版 base 中"后三天过夜航班"是单值 → 迁移到 后三天过夜航班1。
  const legacyOvernight = String(rawBase["后三天过夜航班"] ?? "");
  if (legacyOvernight && !sheet.base.后三天过夜航班1) sheet.base.后三天过夜航班1 = legacyOvernight;
  // 旧版 extraBase 中可能有固定字段（指令号/工作内容/地点等）→ 迁移到 base。
  const legacyExtraKeys = ["指令号", "工作内容", "地点", "落地航班", "落地时间", "次日起飞时间", "次日起飞", "过夜航站"];
  if (Array.isArray(raw.extraBase)) {
    for (const entry of raw.extraBase as Array<Record<string, unknown>>) {
      const title = String(entry.title ?? "");
      const value = String(entry.value ?? "");
      if (!title || !value) continue;
      if (legacyExtraKeys.includes(title)) {
        const baseKey = title === "次日起飞" ? "次日起飞时间" : title === "过夜航站" ? "" : title;
        if (baseKey && baseKey in sheet.base) {
          (sheet.base as Record<string, string>)[baseKey] = value;
          continue;
        }
      }
      // 非固定字段 → 保留为动态条目。
      sheet.extraBase.push({ title, value });
    }
  }

  // 人员安排：新版 roles 是 Record<string, string>；旧版是 Record<string, {main, helper}>。
  const rawRoles = (raw.roles && typeof raw.roles === "object" ? raw.roles : {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(rawRoles)) {
    if (typeof val === "string") {
      sheet.roles[key] = val;
    } else if (val && typeof val === "object") {
      // 旧版 {main, helper} → 取 main 值。
      const entry = val as Record<string, unknown>;
      sheet.roles[key] = String(entry.main ?? "");
    }
  }
  // 确保新布局的所有键都存在（旧数据可能缺"试车人员""航材负责人"等新键）。
  for (const row of PREP_PERSONNEL_LAYOUT) {
    for (const cell of row) {
      if (!(cell.key in sheet.roles)) sheet.roles[cell.key] = "";
    }
  }
  for (const key of PREP_PERSONNEL_FULL_ROWS) {
    if (!(key in sheet.roles)) sheet.roles[key] = "";
  }

  const rawMisc = (raw.misc && typeof raw.misc === "object" ? raw.misc : {}) as Record<string, unknown>;
  for (const item of PREP_MISC) sheet.misc[item] = String(rawMisc[item] ?? "");
  // 旧版也可能带 roleExtras / miscExtras / extra 数组，向前兼容。
  if (Array.isArray(raw.roleExtras)) {
    sheet.roleExtras = (raw.roleExtras as Array<Record<string, unknown>>).map((entry) => ({ title: String(entry.title ?? ""), value: String(entry.value ?? "") }));
    // 确保默认的"照片检查"条目存在。
    for (const defaultTitle of PREP_PERSONNEL_DEFAULT_EXTRAS) {
      if (!sheet.roleExtras.some((item) => item.title === defaultTitle)) {
        sheet.roleExtras.unshift({ title: defaultTitle, value: "" });
      }
    }
  }
  if (Array.isArray(raw.miscExtras)) sheet.miscExtras = (raw.miscExtras as Array<Record<string, unknown>>).map((entry) => ({ title: String(entry.title ?? ""), value: String(entry.value ?? "") }));
  if (Array.isArray(raw.extra)) sheet.extra = (raw.extra as Array<Record<string, unknown>>).map((entry) => ({ title: String(entry.title ?? ""), value: String(entry.value ?? "") }));
  // 修复 5：旧版有固定 DD/FC 字段 → 迁移到 extra 数组（保留在保留项目卡片中作为"新增"格式行）。
  const legacyDD = String(raw.DD ?? "");
  const legacyFC = String(raw.FC ?? "");
  if (legacyDD) sheet.extra.unshift({ title: "DD", value: legacyDD });
  if (legacyFC) sheet.extra.unshift({ title: "FC", value: legacyFC });
  // 确保 extra 至少有一行空"新增"格式。
  if (sheet.extra.length === 0) sheet.extra = [{ title: "", value: "" }];
  sheet.DD = String(raw.DD ?? "");
  sheet.FC = String(raw.FC ?? "");
  return sheet;
}

function workcardAssignmentFromDoc(doc: Record<string, unknown>): WorkcardAssignment {
  const assignment = defaultWorkcardAssignment();
  const raw = (doc.workcard_assignment && typeof doc.workcard_assignment === "object" ? doc.workcard_assignment : {}) as Record<string, unknown>;
  const rawSections = (raw.sections && typeof raw.sections === "object" ? raw.sections : {}) as Record<string, unknown>;
  for (const section of WORKCARD_SECTIONS) {
    const entry = (rawSections[section] && typeof rawSections[section] === "object" ? rawSections[section] : {}) as Record<string, unknown>;
    const personnel = (entry.personnel && typeof entry.personnel === "object" ? entry.personnel : {}) as Record<string, unknown>;
    const cards = Array.isArray(entry.cards) ? (entry.cards as unknown[]) : [];
    const extras = Array.isArray(entry.extra) ? (entry.extra as unknown[]) : [];
    assignment.sections[section] = {
      personnel: Object.fromEntries(Object.entries(personnel).map(([k, v]) => [k, String(v ?? "")])),
      cards: cards.map((card) => {
        const row = (card && typeof card === "object" ? card : {}) as Record<string, unknown>;
        const out = {} as WorkCardRow;
        for (const col of WORKCARD_COLUMNS) out[col] = String(row[col] ?? "");
        return out;
      }),
      extra: extras.map((item) => {
        const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return { arrange: String(o.arrange ?? ""), personnel: String(o.personnel ?? "") };
      }),
    };
  }
  // 未分配部位：项目级数组，标准库无法匹配部位的工卡
  const unassignedRaw = Array.isArray(raw.unassigned) ? (raw.unassigned as unknown[]) : [];
  assignment.unassigned = unassignedRaw.map((card) => {
    const row = (card && typeof card === "object" ? card : {}) as Record<string, unknown>;
    const out = {} as WorkCardRow;
    for (const col of WORKCARD_COLUMNS) out[col] = String(row[col] ?? "");
    return out;
  });
  return assignment;
}

function standalonePrepSheetFromDoc(doc: Record<string, unknown>): StandalonePrepSheet {
  const sheet = defaultStandalonePrepSheet();
  const raw = (doc.standalone_prep_sheet && typeof doc.standalone_prep_sheet === "object" ? doc.standalone_prep_sheet : {}) as Record<string, unknown>;
  sheet.title = String(raw.title ?? sheet.title) || sheet.title;
  const rawBase = (raw.base && typeof raw.base === "object" ? raw.base : {}) as Record<string, unknown>;
  for (const key of Object.keys(sheet.base)) {
    (sheet.base as Record<string, string>)[key] = String(rawBase[key] ?? "");
  }
  if (Array.isArray(raw.works)) {
    sheet.works = (raw.works as Array<Record<string, unknown>>).map((w) => ({ id: spId(), 指令号: String(w?.指令号 ?? ""), 工作内容: String(w?.工作内容 ?? "") }));
  }
  if (Array.isArray(raw.parts)) {
    sheet.parts = (raw.parts as Array<Record<string, unknown>>).map((p, i) => ({
      id: spId(),
      name: String(p?.name ?? `部件 ${i + 1}`),
      拆下件号: String(p?.拆下件号 ?? ""), 拆下序号: String(p?.拆下序号 ?? ""),
      装上件号: String(p?.装上件号 ?? ""), 装上序号: String(p?.装上序号 ?? ""),
    }));
  }
  const rawP = (raw.personnel && typeof raw.personnel === "object" ? raw.personnel : {}) as Record<string, unknown>;
  for (const key of Object.keys(sheet.personnel)) {
    if (key === "extra") continue;
    (sheet.personnel as Record<string, unknown>)[key] = String(rawP[key] ?? "");
  }
  if (Array.isArray(rawP.extra)) {
    sheet.personnel.extra = (rawP.extra as Array<Record<string, unknown>>).map((e) => ({ id: spId(), 内容: String(e?.内容 ?? ""), 人员: String(e?.人员 ?? "") }));
  }
  if (Array.isArray(raw.processGroups)) {
    sheet.processGroups = (raw.processGroups as Array<Record<string, unknown>>).map((g, gi) => ({
      id: spId(),
      name: String(g?.name ?? `工序组 ${gi + 1}`),
      rows: Array.isArray(g?.rows) ? (g.rows as Array<Record<string, unknown>>).map((r) => ({ id: spId(), 工作步骤: String(r?.工作步骤 ?? ""), 人员安排: String(r?.人员安排 ?? ""), "检测&必检": String(r?.["检测&必检"] ?? "") })) : [],
    }));
  }
  if (Array.isArray(raw.signingRows)) {
    sheet.signingRows = (raw.signingRows as Array<Record<string, unknown>>).map((r) => ({ id: spId(), 手册号: String(r?.手册号 ?? ""), 工卡名: String(r?.工卡名 ?? ""), 签署人: String(r?.签署人 ?? "") }));
  }
  return sheet;
}

export function projectFromDocument(raw: unknown): Project {
  const doc = unwrapDocument(raw) || {};
  const aircraft = String(doc.aircraft_type || "A320").toUpperCase();
  const typeRaw = String(doc.type || "");
  return {
    id: String(doc._id || doc.id || ""),
    name: String(doc.name || "未命名项目"),
    createdAt: Date.parse(String(doc.created_at || "")) || Date.now(),
    aircraftType: AIRCRAFT_TYPES.includes(aircraft as AircraftType) ? aircraft as AircraftType : "A320",
    team: String(doc.team || ""),
    type: (PROJECT_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as ProjectType) : "",
    data: stateFromSections((doc.sections || []) as SectionPayload[], Boolean(doc.use_tool_cart)),
    prepSheet: prepSheetFromDoc(doc),
    workcardAssignment: workcardAssignmentFromDoc(doc),
    standalonePrepSheet: standalonePrepSheetFromDoc(doc),
    materialList: stateFromSections((doc.material_list || []) as SectionPayload[]),
    version: Number(doc.version) || 0,
  };
}

export function projectPayload(project: Project): ProjectPayload {
  return {
    name: project.name,
    aircraft_type: project.aircraftType,
    team: project.team,
    type: project.type,
    sections: sectionsFromState(project.data),
    use_tool_cart: Boolean(project.data.useCart),
    prep_sheet: project.prepSheet,
    workcard_assignment: project.workcardAssignment,
    standalone_prep_sheet: project.standalonePrepSheet,
    material_list: sectionsFromState(project.materialList),
  };
}

/** 项目顶层字段，用于字段级 dirty 追踪与非脏字段合并。 */
export type ProjectField = "data" | "materialList" | "prepSheet" | "workcardAssignment" | "standalonePrepSheet" | "meta";

/** 稳定的物品行身份：由「部位 + 工作/类型 + 物品名 + 件号」共同确定。
 *  跨客户端一致，替代未持久化的本地数字 id，用于按行合并（PR-C）。 */
export function itemKey(item: { cat: string; sub: string; name: string; partNo?: string }): string {
  return [item.cat, item.sub, item.name, item.partNo || ""].join("\u0001");
}

/** 只序列化「本地被编辑过的字段」，实现字段级部分 PATCH，
 *  避免把远端已更新的非脏字段覆盖掉（PR-B 的保存侧）。 */
export function projectPartialPayload(project: Project, fields: Set<ProjectField>): Partial<ProjectPayload> {
  const payload: Partial<ProjectPayload> = {};
  if (fields.has("data")) {
    payload.sections = sectionsFromState(project.data);
    payload.use_tool_cart = Boolean(project.data.useCart);
  }
  if (fields.has("materialList")) payload.material_list = sectionsFromState(project.materialList);
  if (fields.has("prepSheet")) payload.prep_sheet = project.prepSheet;
  if (fields.has("workcardAssignment")) payload.workcard_assignment = project.workcardAssignment;
  if (fields.has("standalonePrepSheet")) payload.standalone_prep_sheet = project.standalonePrepSheet;
  if (fields.has("meta")) {
    payload.name = project.name;
    payload.aircraft_type = project.aircraftType;
    payload.team = project.team;
    payload.type = project.type;
  }
  return payload;
}
