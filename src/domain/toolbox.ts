/** 支持的机型。新增机型时只需在这里扩展。 */
export const AIRCRAFT_TYPES = ["A320", "B787"] as const;
export type AircraftType = (typeof AIRCRAFT_TYPES)[number];

/** 管理端可分配的班组。 */
export const TEAMS = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "外站"] as const;

/** 项目（二级）页集中显示默认渲染的部位；其余已有部位需手动“新增部位”才显示。
 *  顺序即显示顺序（与 sectionColor 固定配色表一致）。标准库页不受此限制，显示全部。 */
export const DEFAULT_CATEGORIES = ["ENG", "AV CB", "FC", "LG", "通用", "接机"] as const;
export type DefaultCategory = (typeof DEFAULT_CATEGORIES)[number];

export interface ToolItem {
  id: number;
  cat: string;
  sub: string;
  name: string;
  qty: number;
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
  data: ToolState;
}

export interface ToolboxApp {
  libraries: Record<AircraftType, ToolState>;
  projects: Project[];
  toolCart: ToolCartItem[];
}

export interface SectionItemPayload { name: string; quantity: number }
export interface WorkPayload { name: string; items: SectionItemPayload[] }
export interface SectionPayload { name: string; notes: string; works: WorkPayload[] }
export interface ProjectPayload {
  name: string;
  aircraft_type: AircraftType;
  team: string;
  sections: SectionPayload[];
  use_tool_cart: boolean;
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

/** 构造完整的本地初始数据，避免组件处理缺失字段。 */
export function defaultApp(): ToolboxApp {
  return {
    libraries: { A320: sampleState(), B787: sampleState() },
    projects: [],
    toolCart: [
      { name: "扳手", qty: 3 }, { name: "套筒", qty: 6 }, { name: "螺丝", qty: 10 },
      { name: "扎带", qty: 50 }, { name: "保险丝", qty: 30 }, { name: "胶带", qty: 5 },
    ],
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
    })) : [],
    notes: value.notes && typeof value.notes === "object" ? value.notes : {},
    useCart: Boolean(value.useCart),
    aircraftType,
  };
}

export function normalizeApp(value: AppInput = {}): ToolboxApp {
  const fallback = defaultApp();
  const libraries = value.libraries || (value.standard ? { A320: value.standard, B787: deepCopy(value.standard) } : fallback.libraries);
  return {
    libraries: {
      A320: normalizeState(libraries.A320 || fallback.libraries.A320),
      B787: normalizeState(libraries.B787 || fallback.libraries.B787),
    },
    projects: (value.projects || []).map((project) => ({
      ...project,
      id: String(project.id || ""),
      aircraftType: AIRCRAFT_TYPES.includes(project.aircraftType) ? project.aircraftType : "A320",
      team: project.team || "",
      data: normalizeState(project.data),
    })),
    toolCart: (value.toolCart || []).map((entry) => ({
      name: String(entry.name || ""),
      qty: Math.max(0, Number.parseInt(String(entry.qty), 10) || 0),
    })),
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
        items.push({ id: id++, cat, sub: String(work.name || ""), name: String(entry.name || ""), qty: Math.max(0, Number(entry.quantity) || 0) });
      }
    }
  }
  return normalizeState({ categories, notes, items, useCart });
}

/** 把前端状态重新组装为后端 API 所需的 sections 结构。 */
export function sectionsFromState(state: ToolState): SectionPayload[] {
  return state.categories.map((cat) => {
    const subNames = [...new Set(state.items.filter((item) => item.cat === cat).map((item) => item.sub))];
    return {
      name: cat,
      notes: state.notes[cat] || "",
      works: subNames.map((sub) => ({
        name: sub,
        items: state.items.filter((item) => item.cat === cat && item.sub === sub).map((item) => ({ name: item.name, quantity: item.qty })),
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

export function projectFromDocument(raw: unknown): Project {
  const doc = unwrapDocument(raw) || {};
  const aircraft = String(doc.aircraft_type || "A320").toUpperCase();
  return {
    id: String(doc._id || doc.id || ""),
    name: String(doc.name || "未命名项目"),
    createdAt: Date.parse(String(doc.created_at || "")) || Date.now(),
    aircraftType: AIRCRAFT_TYPES.includes(aircraft as AircraftType) ? aircraft as AircraftType : "A320",
    team: String(doc.team || ""),
    data: stateFromSections((doc.sections || []) as SectionPayload[], Boolean(doc.use_tool_cart)),
  };
}

export function projectPayload(project: Project): ProjectPayload {
  return {
    name: project.name,
    aircraft_type: project.aircraftType,
    team: project.team,
    sections: sectionsFromState(project.data),
    use_tool_cart: Boolean(project.data.useCart),
  };
}
