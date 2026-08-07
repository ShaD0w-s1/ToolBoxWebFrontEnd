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
import { parseDay } from "../utils/format";

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
  const searchDay = ref("");
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
  function subsOf(cat: string): string[] { return [...new Set((active.value?.items || []).filter((item) => item.cat === cat).map((item) => item.sub))]; }
  function subTotal(cat: string, sub: string): number { return itemsOf(cat, sub).reduce((total, item) => total + (+item.qty || 0), 0); }
  function catTotal(cat: string): number { return (active.value?.items || []).filter((item) => item.cat === cat).reduce((total, item) => total + (+item.qty || 0), 0); }
  function allTotal(): number { return (active.value?.items || []).reduce((total, item) => total + (+item.qty || 0), 0); }
  function isCartDuplicate(name: string): boolean { return Boolean(active.value?.useCart && app.value.toolCart.some((item) => item.name.trim() === name.trim())); }

  function requireActive(): ToolState | null {
    return active.value;
  }

  function addCategory(name: string): void {
    const state = requireActive();
    if (!state || !name || state.categories.includes(name)) return;
    state.categories.push(name);
    state.items.push({ id: nextId++, cat: name, sub: "新工作1", name: "新物品", qty: 1 });
    persist();
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

  function addItem(cat: string, sub: string): void {
    const state = requireActive();
    if (!state) return;
    if (!state.categories.includes(cat)) state.categories.push(cat);
    state.items.push({ id: nextId++, cat, sub, name: "新物品", qty: 1 });
    persist();
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
    addCategory, renameCategory, deleteCategory, addSub, renameSub, deleteSub, forceExpandAll,
    importStandardSub, addItem, deleteItem, replaceActive, clearActive, setToolCart, loadRemote,
  };
}

export type ToolboxStore = ReturnType<typeof useToolbox>;
