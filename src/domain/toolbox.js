export const AIRCRAFT_TYPES = ["A320", "B787"];
export const TEAMS = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "外站"];

export function sampleState() {
  let id = 1;
  const item = (cat, sub, name, qty) => ({ id: id++, cat, sub, name, qty });
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

export function defaultApp() {
  return {
    libraries: { A320: sampleState(), B787: sampleState() },
    projects: [],
    toolCart: [
      { name: "扳手", qty: 3 }, { name: "套筒", qty: 6 }, { name: "螺丝", qty: 10 },
      { name: "扎带", qty: 50 }, { name: "保险丝", qty: 30 }, { name: "胶带", qty: 5 },
    ],
  };
}

export function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeState(value = {}) {
  return {
    categories: Array.isArray(value.categories) ? value.categories : [],
    items: Array.isArray(value.items) ? value.items.map((entry) => ({
      id: entry.id,
      cat: String(entry.cat || ""),
      sub: String(entry.sub || ""),
      name: String(entry.name || ""),
      qty: Math.max(0, Number.parseInt(entry.qty, 10) || 0),
    })) : [],
    notes: value.notes && typeof value.notes === "object" ? value.notes : {},
    useCart: Boolean(value.useCart),
    aircraftType: value.aircraftType || "A320",
  };
}

export function normalizeApp(value = {}) {
  if (value.standard) {
    value.libraries ||= {};
    value.libraries.A320 ||= value.standard;
    value.libraries.B787 ||= deepCopy(value.standard);
  }
  const fallback = defaultApp();
  const libraries = value.libraries || fallback.libraries;
  return {
    libraries: Object.fromEntries(AIRCRAFT_TYPES.map((type) => [type, normalizeState(libraries[type] || fallback.libraries[type])])),
    projects: (value.projects || []).map((project) => ({
      ...project,
      aircraftType: project.aircraftType || "A320",
      team: project.team || "",
      data: normalizeState(project.data),
    })),
    toolCart: (value.toolCart || []).map((entry) => ({
      name: String(entry.name || ""),
      qty: Math.max(0, Number.parseInt(entry.qty, 10) || 0),
    })),
  };
}

export function stateFromSections(sections = [], useCart = false) {
  let id = 1;
  const categories = [];
  const notes = {};
  const items = [];
  for (const section of sections) {
    const cat = String(section.name || "未命名部位");
    if (!categories.includes(cat)) categories.push(cat);
    if (section.notes) notes[cat] = section.notes;
    for (const work of section.works || []) {
      for (const entry of work.items || []) {
        items.push({ id: id++, cat, sub: String(work.name || ""), name: String(entry.name || ""), qty: Math.max(0, Number.parseInt(entry.quantity ?? entry.qty, 10) || 0) });
      }
    }
  }
  return normalizeState({ categories, notes, items, useCart });
}

export function sectionsFromState(state) {
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

export function projectFromDocument(raw) {
  const doc = unwrapDocument(raw) || {};
  return {
    id: doc._id || doc.id,
    name: doc.name || "未命名项目",
    createdAt: doc.created_at ? new Date(doc.created_at).getTime() : Date.now(),
    aircraftType: doc.aircraft_type || "A320",
    team: doc.team || "",
    data: stateFromSections(doc.sections, doc.use_tool_cart),
  };
}

export function unwrapDocument(value) {
  if (Array.isArray(value)) return value[0] || null;
  if (value && Array.isArray(value.data)) return value.data[0] || null;
  if (value?.data && typeof value.data === "object") return value.data;
  return value && typeof value === "object" ? value : null;
}

export function projectPayload(project) {
  return {
    name: project.name,
    aircraft_type: project.aircraftType,
    team: project.team,
    sections: sectionsFromState(project.data),
    use_tool_cart: Boolean(project.data.useCart),
  };
}
