import { computed, reactive, ref } from "vue";
import { backend, type ApiEnvelope } from "../api";
import {
  AIRCRAFT_TYPES,
  deepCopy,
  defaultApp,
  normalizeApp,
  normalizeState,
  projectFromDocument,
  projectPayload,
  sectionsFromState,
  stateFromSections,
  unwrapDocument,
  type AircraftType,
  type Project,
  type SectionPayload,
  type ToolCartItem,
  type ToolboxApp,
  type ToolItem,
  type ToolState,
} from "../domain/toolbox";
import { formatDay, parseDay } from "../utils/format";

const STORAGE_KEY = "categoryItemManager.v2";

type Screen = "list" | "detail" | "cart";
type ListTab = "tools" | "db";
type DetailTab = "display" | "database";
type CloudState = "ok" | "warn" | "err";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function loadCache(): ToolboxApp {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    return cached ? normalizeApp(JSON.parse(cached) as ToolboxApp) : defaultApp();
  } catch { return defaultApp(); }
}

function listDocuments(payload: ApiEnvelope<unknown>): unknown[] {
  const value = payload?.data ?? payload?.list ?? payload?.documents ?? payload?.items ?? [];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown[] }).data)) return (value as { data: unknown[] }).data;
  return [];
}

export function useToolbox() {
  const app = ref(loadCache());
  const screen = ref<Screen>("list");
  const listTab = ref<ListTab>("tools");
  const detailTab = ref<DetailTab>("display");
  const currentProjectId = ref<string | null>(null);
  const editingLibrary = ref<AircraftType | null>(null);
  // 一级页面日期筛选框：默认显示当日（输入 type=date 直接展示当天），清空后退回“全部”
  const searchDay = ref(formatDay(Date.now()));
  const teamFilter = ref("");
  const cloud = reactive<{ text: string; state: CloudState; available: boolean }>({ text: "连接中…", state: "warn", available: false });
  const toast = reactive({ message: "", visible: false });
  const shared = ref(false);
  /** 导出图片时临时强制展开所有部位卡片，保证长图完整。 */
  const forceExpandAll = ref(false);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let remoteSaving = false;
  let remotePending = false;
  const dirtyProjects = new Set<string>();
  const dirtyTemplates = new Set<AircraftType>();
  let dirtyToolCart = false;
  let nextId = 1;

  const currentProject = computed(() => app.value.projects.find((item) => item.id === currentProjectId.value) || null);
  const active = computed(() => editingLibrary.value ? app.value.libraries[editingLibrary.value] : currentProject.value?.data || null);
  const detailTitle = computed(() => editingLibrary.value ? `${editingLibrary.value} 标准库` : currentProject.value?.name || "");
  /** “添加部位”下拉里可选择的“来自标准数据库”的部位列表（当前机型的全部标准部位）。 */
  const standardCategories = computed<string[]>(() => {
    const type = editingLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    return app.value.libraries[type]?.categories || [];
  });
  const filteredProjects = computed(() => {
    const query = parseDay(searchDay.value);
    return app.value.projects.filter((project) => {
      if (teamFilter.value && project.team !== teamFilter.value) return false;
      if (!query) return true;
      const delta = Math.abs(new Date(project.createdAt).setHours(0, 0, 0, 0) - query.setHours(0, 0, 0, 0));
      return delta <= 5 * 86400000;
    });
  });

  /** 所有标准库和项目共享递增编号，防止切换页面后发生键冲突。 */
  function computeNextId(): void {
    let maximum = 0;
    for (const state of [...Object.values(app.value.libraries), ...app.value.projects.map((project) => project.data)]) {
      for (const item of state.items) maximum = Math.max(maximum, Number(item.id) || 0);
    }
    nextId = maximum + 1;
  }

  function notify(message: string): void {
    toast.message = message;
    toast.visible = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.visible = false; }, 2200);
  }

  function markCurrentDirty(): void {
    if (editingLibrary.value) {
      dirtyTemplates.add(editingLibrary.value);
    } else if (currentProject.value?.id) {
      dirtyProjects.add(currentProject.value.id);
    } else if (screen.value === "cart") {
      dirtyToolCart = true;
    } else {
      for (const project of app.value.projects) if (project.id) dirtyProjects.add(project.id);
    }
  }

  function markAllDirty(): void {
    for (const type of AIRCRAFT_TYPES) dirtyTemplates.add(type);
    for (const project of app.value.projects) if (project.id) dirtyProjects.add(project.id);
    dirtyToolCart = true;
  }

  function hasDirtyData(): boolean {
    return dirtyProjects.size > 0 || dirtyTemplates.size > 0 || dirtyToolCart;
  }

  function persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
    markCurrentDirty();
    clearTimeout(saveTimer);
    if (cloud.available) saveTimer = setTimeout(saveRemote, 450);
  }

  async function saveRemote(): Promise<void> {
    if (remoteSaving) {
      remotePending = true;
      return;
    }
    remoteSaving = true;
    const projectIds = [...dirtyProjects];
    const templateTypes = [...dirtyTemplates];
    const saveToolCart = dirtyToolCart;
    dirtyProjects.clear();
    dirtyTemplates.clear();
    dirtyToolCart = false;
    try {
      cloud.text = "正在保存…";
      cloud.state = "warn";
      await Promise.all([
        ...projectIds.map((id) => app.value.projects.find((project) => project.id === id))
          .filter((project): project is Project => Boolean(project))
          .map((project) => backend.updateProject(project.id, projectPayload(project))),
        ...templateTypes.map((type) => backend.saveTemplate(type, sectionsFromState(app.value.libraries[type]))),
        ...(saveToolCart
          ? [backend.saveToolCart(app.value.toolCart.map((item) => ({ name: item.name, quantity: item.qty })))]
          : []),
      ]);
      cloud.text = "已连接 Django · 数据已保存";
      cloud.state = "ok";
    } catch (error) {
      for (const id of projectIds) dirtyProjects.add(id);
      for (const type of templateTypes) dirtyTemplates.add(type);
      if (saveToolCart) dirtyToolCart = true;
      cloud.text = "保存失败 · 已保留本地缓存";
      cloud.state = "err";
      notify(errorMessage(error, "保存失败"));
    } finally {
      remoteSaving = false;
      if (remotePending || hasDirtyData()) {
        remotePending = false;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveRemote, 0);
      }
    }
  }

  function replaceApp(value: ToolboxApp): void {
    app.value = normalizeApp(value);
    computeNextId();
    markAllDirty();
    persist();
  }

  function openProject(id: string): void {
    currentProjectId.value = id;
    editingLibrary.value = null;
    detailTab.value = "display";
    screen.value = "detail";
  }

  function openLibrary(type: AircraftType): void {
    editingLibrary.value = type;
    currentProjectId.value = null;
    detailTab.value = "display";
    screen.value = "detail";
  }

  function openCart(): void {
    editingLibrary.value = null;
    currentProjectId.value = null;
    screen.value = "cart";
  }

  function backToList(): void {
    screen.value = "list";
    editingLibrary.value = null;
    currentProjectId.value = null;
  }

  async function createProject(name: string, aircraftType: AircraftType = "A320"): Promise<void> {
    const project: Project = {
      id: globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      createdAt: Date.now(),
      aircraftType,
      team: "",
      data: deepCopy(app.value.libraries[aircraftType]),
    };
    if (cloud.available) {
      try {
        const result = await backend.createProject(projectPayload(project));
        project.id = String(result.data?._id || project.id);
        project.createdAt = result.data?.created_at ? new Date(String(result.data.created_at)).getTime() : project.createdAt;
      } catch (error) { notify(errorMessage(error, "云端创建失败，已保存到本地")); }
    }
    app.value.projects.unshift(project);
    persist();
    openProject(project.id);
  }

  async function deleteProject(project: Project): Promise<void> {
    if (cloud.available) {
      try { await backend.deleteProject(project.id); } catch (error) { notify(errorMessage(error, "云端删除失败")); return; }
    }
    app.value.projects = app.value.projects.filter((item) => item.id !== project.id);
    persist();
  }

  function updateProject(project: Project, changes: Partial<Project>): void {
    Object.assign(project, changes);
    persist();
  }

  function setAircraftType(type: AircraftType): void {
    if (!currentProject.value || !AIRCRAFT_TYPES.includes(type)) return;
    currentProject.value.aircraftType = type;
    currentProject.value.data = deepCopy(app.value.libraries[type]);
    currentProject.value.data.aircraftType = type;
    persist();
  }

  function itemsOf(cat: string, sub: string): ToolItem[] { return active.value?.items.filter((item) => item.cat === cat && item.sub === sub) || []; }
  function subsOf(cat: string): string[] {
    const subs = [...new Set((active.value?.items || []).filter((item) => item.cat === cat).map((item) => item.sub))];
    // 名称为“固定”的工作卡片始终排在部位卡片首行（配合 CSS 全行 span）
    const fixedIndex = subs.findIndex((sub) => sub.trim() === "固定");
    if (fixedIndex > 0) {
      const [fixed] = subs.splice(fixedIndex, 1);
      subs.unshift(fixed);
    }
    return subs;
  }
  function subTotal(cat: string, sub: string): number { return itemsOf(cat, sub).reduce((total, item) => total + (+item.qty || 0), 0); }
  function catTotal(cat: string): number { return (active.value?.items || []).filter((item) => item.cat === cat).reduce((total, item) => total + (+item.qty || 0), 0); }
  function allTotal(): number { return (active.value?.items || []).reduce((total, item) => total + (+item.qty || 0), 0); }
  function isCartDuplicate(name: string): boolean { return Boolean(active.value?.useCart && app.value.toolCart.some((item) => item.name.trim() === name.trim())); }

  function requireActive(): ToolState | null {
    return active.value;
  }

  /** 添加空的新部位（未命名，无默认工作卡片），名称自动去重避免重复。返回新建的部位名。 */
  function addNewCategory(): string | null {
    const state = requireActive();
    if (!state) return null;
    let name = "未命名部位";
    let index = 2;
    while (state.categories.includes(name)) name = `未命名部位 ${index++}`;
    state.categories.push(name);
    persist();
    return name;
  }

  /** 从标准数据库添加一个部位卡片：若该部位已存在则仅补充项目里还没有的标准工作（按工作名去重），
   *  否则新建该部位并带入标准库里该部位的全部工作与物品。 */
  function addCategoryFromStandard(name: string): void {
    const state = requireActive();
    if (!state || !name) return;
    const aircraftType = editingLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    const lib = app.value.libraries[aircraftType];
    const libItems = (lib?.items || []).filter((item) => item.cat === name);
    if (state.categories.includes(name)) {
      const existingSubs = new Set(subsOf(name));
      let added = 0;
      for (const item of libItems) {
        if (existingSubs.has(item.sub)) continue;
        state.items.push({ ...deepCopy(item), id: nextId++, cat: name, sub: item.sub });
        added++;
      }
      persist();
      notify(added > 0 ? `已补充「${name}」的标准工作 ${added} 项` : `「${name}」已存在且无新增标准工作`);
      return;
    }
    state.categories.push(name);
    for (const item of libItems) state.items.push({ ...deepCopy(item), id: nextId++, cat: name, sub: item.sub });
    persist();
    notify(`已添加标准部位「${name}」`);
  }

  function renameCategory(oldName: string, name: string): void {
    const state = requireActive();
    if (!state || !name || name === oldName || state.categories.includes(name)) return;
    state.categories[state.categories.indexOf(oldName)] = name;
    state.items.forEach((item) => { if (item.cat === oldName) item.cat = name; });
    if (state.notes[oldName]) state.notes[name] = state.notes[oldName];
    delete state.notes[oldName];
    persist();
  }

  function deleteCategory(cat: string): void {
    const state = requireActive();
    if (!state) return;
    state.categories = state.categories.filter((item) => item !== cat);
    state.items = state.items.filter((item) => item.cat !== cat);
    delete state.notes[cat];
    persist();
  }

  function addSub(cat: string): void {
    const state = requireActive();
    if (!state) return;
    const subs = subsOf(cat);
    const fixedSub = subs.find((sub) => sub.trim() === "固定");
    const sub = `新工作${subs.length + 1}`;
    const newItem = { id: nextId++, cat, sub, name: "新物品", qty: 1 };
    if (fixedSub) {
      // 名称为「固定」的工作卡片默认占满首行，新增工作排到它下方第一格
      let anchor = state.items.length;
      for (let i = state.items.length - 1; i >= 0; i--) {
        if (state.items[i].cat === cat && state.items[i].sub === fixedSub) { anchor = i + 1; break; }
      }
      state.items.splice(anchor, 0, newItem);
    } else {
      state.items.push(newItem);
    }
    persist();
  }

  function renameSub(cat: string, oldName: string, name: string): void {
    const state = requireActive();
    if (!state || !name || name === oldName) return;
    state.items.forEach((item) => { if (item.cat === cat && item.sub === oldName) item.sub = name; });
    persist();
  }

  function deleteSub(cat: string, sub: string): void {
    const state = requireActive();
    if (!state) return;
    state.items = state.items.filter((item) => !(item.cat === cat && item.sub === sub));
    persist();
  }

  function importStandardSub(cat: string, currentSub: string, key: string): void {
    const state = requireActive();
    if (!state || !key) return;
    const [sourceCat, sourceSub] = key.split("||");
    const sourceItems = app.value.libraries[currentProject.value?.aircraftType || "A320"].items.filter((item) => item.cat === sourceCat && item.sub === sourceSub);
    // 记录当前工作在原数组中的首个位置，导入后插回该位置，保证工作卡片位置不变
    let anchor = state.items.length;
    for (let i = 0; i < state.items.length; i++) {
      if (state.items[i].cat === cat && state.items[i].sub === currentSub) { anchor = i; break; }
    }
    state.items = state.items.filter((item) => !(item.cat === cat && item.sub === currentSub));
    const imported = sourceItems.map((item) => ({ ...deepCopy(item), id: nextId++, cat, sub: sourceSub }));
    state.items.splice(anchor, 0, ...imported);
    persist();
  }

  /** 始终保留的部位：这些部位下的全部工作卡片不被删除。 */
  const KEEP_CATEGORIES = ["通用", "接机"];
  /** 工作卡片名称包含该字则保留。 */
  const FIXED_MARK = "固定";
  /** 名称与工卡工作内容需相同的连续汉字数。 */
  const MIN_MATCH_CHARS = 3;

  /** 比对用归一化：转小写，仅保留中文/字母/数字（去掉标点、空格、括号、全角符号等）。 */
  function normalizeMatch(text: string): string {
    return (text || "").toLowerCase().replace(/[^一-鿿a-z0-9]/g, "");
  }
  /** 在归一化基础上再去掉中文连接词，便于“起落架的润滑”与“主起落架和门的润滑”这类断词也能命中。 */
  function stripConnectors(text: string): string {
    return normalizeMatch(text).replace(/[的啦呢吧啊哟嗯哈和與及并或等等、与以及]/g, "");
  }
  /** needle 的字符是否按出现顺序全部能在 hay 中找到（不要求连续）。 */
  function isSubsequence(needle: string, hay: string): boolean {
    let i = 0;
    for (let j = 0; j < hay.length && i < needle.length; j++) {
      if (hay[j] === needle[i]) i++;
    }
    return i === needle.length;
  }

  /** 某工作卡片名称是否与任一工卡“工作内容”相关。命中规则（任一即可）：
   *  1) 名称整体（归一化后）被某条内容包含（兼容 RAT / 回油滤 及大小写差异）；
   *  2) 名称与内容存在 MIN_MATCH_CHARS 个连续相同字（双向，兼容“起落架”这类片段）；
   *  3) 去连接词后名称是内容的子序列（兼容“X的Y”↔“主X和门的Y”这类断词）。 */
  function sharesWorkContent(subName: string, workContents: string[]): boolean {
    const name = (subName || "").trim();
    if (!name) return false;
    const nNorm = normalizeMatch(name);
    if (nNorm.length === 0) return false;
    for (const content of workContents) {
      const cNorm = normalizeMatch(content);
      if (cNorm.length === 0) continue;
      // 1) 名称整体命中（归一化、大小写不敏感）
      if (cNorm.includes(nNorm)) return true;
      if (nNorm.length < MIN_MATCH_CHARS) continue;
      // 2) 双向连续 MIN_MATCH_CHARS 字
      let gramHit = false;
      for (let i = 0; i + MIN_MATCH_CHARS <= nNorm.length; i++) {
        if (cNorm.includes(nNorm.slice(i, i + MIN_MATCH_CHARS))) { gramHit = true; break; }
      }
      if (!gramHit) {
        for (let i = 0; i + MIN_MATCH_CHARS <= cNorm.length; i++) {
          if (nNorm.includes(cNorm.slice(i, i + MIN_MATCH_CHARS))) { gramHit = true; break; }
        }
      }
      if (gramHit) return true;
      // 3) 去连接词后子序列（兼容“起落架的润滑”↔“主起落架和门的润滑”）
      const ns = stripConnectors(name);
      const cs = stripConnectors(content);
      if (ns.length >= MIN_MATCH_CHARS && isSubsequence(ns, cs)) return true;
    }
    return false;
  }

  /** 计算需要删除的工作卡片键集合（cat::sub）。规则：通用/接机 部位全保留；名称含“固定”保留；
   *  其他部位名称与工卡工作内容有 MIN_MATCH_CHARS 个连续相同汉字则保留；其余删除。 */
  function subsToDeleteByWorkCard(workContents: string[]): Set<string> {
    const state = requireActive();
    const toDelete = new Set<string>();
    if (!state) return toDelete;
    for (const cat of state.categories) {
      const keepCategory = KEEP_CATEGORIES.includes(cat.trim());
      for (const sub of subsOf(cat)) {
        if (keepCategory) continue;
        if (sub.includes(FIXED_MARK)) continue;
        if (sharesWorkContent(sub, workContents)) continue;
        toDelete.add(`${cat}::${sub}`);
      }
    }
    return toDelete;
  }

  /** 预览：返回依据工卡清单将被删除的工作卡片数量（不修改数据）。 */
  function previewFilterByWorkCard(workContents: string[]): number {
    return subsToDeleteByWorkCard(workContents).size;
  }

  /** 执行：删除不符合规则的工作卡片，返回删除数量。 */
  function filterByWorkCard(workContents: string[]): number {
    const keys = subsToDeleteByWorkCard(workContents);
    const state = requireActive();
    if (!state || keys.size === 0) return 0;
    state.items = state.items.filter((item) => !keys.has(`${item.cat}::${item.sub}`));
    persist();
    return keys.size;
  }

  /** 计算应“从标准库补充”的工作卡片（部位, 工作）。规则：标准库某工作卡片名称与任一工卡内容有
   *  MIN_MATCH_CHARS 个连续相同汉字，且当前项目里该（部位, 工作）尚不存在，则纳入补充。 */
  function subsToAddFromStandard(workContents: string[]): Array<{ cat: string; sub: string }> {
    const state = requireActive();
    const aircraftType = currentProject.value?.aircraftType || "A320";
    const lib = app.value.libraries[aircraftType];
    if (!state || !lib) return [];
    const result: Array<{ cat: string; sub: string }> = [];
    const seen = new Set<string>();
    for (const cat of lib.categories) {
      const libSubs = [...new Set(lib.items.filter((item) => item.cat === cat).map((item) => item.sub))];
      for (const sub of libSubs) {
        const key = `${cat}::${sub}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!sharesWorkContent(sub, workContents)) continue;
        if (state.items.some((item) => item.cat === cat && item.sub === sub)) continue;
        result.push({ cat, sub });
      }
    }
    return result;
  }

  /** 预览：返回依据工卡清单将从标准库补充的工作卡片数量（不修改数据）。 */
  function previewAddFromStandard(workContents: string[]): number {
    return subsToAddFromStandard(workContents).length;
  }

  /** 执行：把标准库里与工卡相关、但当前项目缺失的工作卡片（含其物品）补到对应部位，返回补充数量。 */
  function addMissingFromStandard(workContents: string[]): number {
    const state = requireActive();
    const aircraftType = currentProject.value?.aircraftType || "A320";
    const lib = app.value.libraries[aircraftType];
    if (!state || !lib) return 0;
    const toAdd = subsToAddFromStandard(workContents);
    let added = 0;
    for (const { cat, sub } of toAdd) {
      if (!state.categories.includes(cat)) state.categories.push(cat);
      const libItems = lib.items.filter((item) => item.cat === cat && item.sub === sub);
      for (const item of libItems) state.items.push({ ...deepCopy(item), id: nextId++, cat, sub });
      added++;
    }
    if (added > 0) persist();
    return added;
  }

  function addItem(cat: string, sub: string, prepend = false): void {
    const state = requireActive();
    if (!state) return;
    if (!state.categories.includes(cat)) state.categories.push(cat);
    const item = { id: nextId++, cat, sub, name: "新物品", qty: 1 };
    // prepend=true 时插入到数据库首项（满足“添加行”默认显示在首行）；否则追加到末尾。
    if (prepend) state.items.unshift(item);
    else state.items.push(item);
    persist();
  }

  /** 导入“新部位.xlsx”时合并到当前标准库（仅标准库模式有效）：
   *  - xlsx 中的“部位”在标准库不存在 → 整体新增该部位及其数据；
   *  - 已存在 → 只补不覆盖：同部位下已有(工作,物品)不动，仅把库里没有的新条目补进去；
   *  - 备注仅补充库里没有的部位。
   *  返回新增的部位数与补充的物品数。 */
  function mergeImportedSections(imported: ToolState): { addedCats: number; addedItems: number } {
    const state = requireActive();
    if (!state || !editingLibrary.value) return { addedCats: 0, addedItems: 0 };
    let addedCats = 0;
    let addedItems = 0;
    for (const cat of imported.categories) {
      if (!state.categories.includes(cat)) {
        state.categories.push(cat);
        addedCats++;
      }
      const existingKeys = new Set(
        state.items.filter((item) => item.cat === cat).map((item) => `${item.sub} ${item.name}`),
      );
      for (const item of imported.items.filter((entry) => entry.cat === cat)) {
        if (existingKeys.has(`${item.sub} ${item.name}`)) continue;
        state.items.push({ ...deepCopy(item), id: nextId++, cat, sub: item.sub, name: item.name });
        addedItems++;
      }
    }
    for (const [cat, note] of Object.entries(imported.notes)) {
      if (note && !state.notes[cat]) state.notes[cat] = note;
    }
    if (addedCats > 0 || addedItems > 0) persist();
    return { addedCats, addedItems };
  }

  function deleteItem(id: number): void {
    const state = requireActive();
    if (!state) return;
    state.items = state.items.filter((item) => item.id !== id);
    persist();
  }

  function replaceActive(state: ToolState): void {
    if (editingLibrary.value) app.value.libraries[editingLibrary.value] = normalizeState(state);
    else if (currentProject.value) currentProject.value.data = normalizeState(state);
    computeNextId();
    persist();
  }

  function clearActive(): void {
    const state = requireActive();
    if (!state) return;
    Object.assign(state, normalizeState());
    persist();
  }

  function setToolCart(items: ToolCartItem[]): void {
    app.value.toolCart = items;
    persist();
  }

  async function loadRemote(): Promise<void> {
    cloud.text = "正在连接 Django 后端…";
    try {
      const status = await backend.status();
      if (!status.configured) {
        cloud.text = "后端已连接 · CloudBase 尚未配置";
        cloud.state = "warn";
        return;
      }
      const [projects, a320, b787, cart] = await Promise.all([
        backend.listProjects(),
        backend.getTemplate("A320").catch(() => null),
        backend.getTemplate("B787").catch(() => null),
        backend.getToolCart().catch(() => null),
      ]);
      const a320Document = unwrapDocument(a320?.data);
      const b787Document = unwrapDocument(b787?.data);
      const libraries: Record<AircraftType, ToolState> = {
        A320: a320Document ? stateFromSections((a320Document.sections || []) as SectionPayload[]) : app.value.libraries.A320,
        B787: b787Document ? stateFromSections((b787Document.sections || []) as SectionPayload[]) : app.value.libraries.B787,
      };
      const cartDocument = unwrapDocument(cart?.data);
      const cartItems = Array.isArray(cartDocument?.items) ? cartDocument.items as Array<Record<string, unknown>> : [];
      const toolCart: ToolCartItem[] = cartItems.map((item) => ({ name: String(item.name || ""), qty: Math.max(0, Number.parseInt(String(item.quantity ?? item.qty), 10) || 0) }));
      app.value = normalizeApp({ libraries, projects: listDocuments(projects).map(projectFromDocument), toolCart });
      computeNextId();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
      cloud.available = true;
      cloud.text = "已连接 Django · 数据已同步";
      cloud.state = "ok";
    } catch (error) {
      cloud.text = "后端连接失败 · 正在使用本地缓存";
      cloud.state = "err";
      notify(errorMessage(error, "无法连接后端"));
    }
  }

  computeNextId();
  return {
    app, screen, listTab, detailTab, currentProject, editingLibrary, active, detailTitle,
    searchDay, teamFilter, filteredProjects, cloud, toast, shared,
    notify, persist, replaceApp, openProject, openLibrary, openCart, backToList,
    createProject, deleteProject, updateProject, setAircraftType,
    itemsOf, subsOf, subTotal, catTotal, allTotal, isCartDuplicate,
    addNewCategory, addCategoryFromStandard, standardCategories, renameCategory, deleteCategory, addSub, renameSub, deleteSub, forceExpandAll,
    importStandardSub, addItem, deleteItem, mergeImportedSections, replaceActive, clearActive, setToolCart, loadRemote,
    previewFilterByWorkCard, filterByWorkCard, previewAddFromStandard, addMissingFromStandard,
  };
}

export type ToolboxStore = ReturnType<typeof useToolbox>;
