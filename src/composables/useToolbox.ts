import { computed, reactive, ref } from "vue";
import { backend, ApiError, type ApiEnvelope } from "../api";
import { startWatchRevision, stopWatchRevision } from "../services/realtime";
import {
  AIRCRAFT_TYPES,
  DEFAULT_CATEGORIES,
  defaultApp,
  defaultPrepSheet,
  defaultStandardLibraries,
  defaultStandalonePrepSheet,
  defaultWorkcardAssignment,
  deepCopy,
  emptyProcessRow,
  emptySigningRow,
  normalizeApp,
  normalizeState,
  normalizeStdLib,
  projectFromDocument,
  projectPayload,
  projectPartialPayload,
  itemKey,
  sectionsFromState,
  stateFromSections,
  unwrapDocument,
  PROJECT_TYPES,
  STANDARD_LIB_KEYS,
  STANDARD_LIB_META,
  AREA_BY_SECTION,
  WORKCARD_SECTIONS,
  type WorkcardAssignment,
  type AircraftType,
  type Project,
  type ProjectField,
  type ProjectType,
  type SectionPayload,
  type StandardLib,
  type StandardLibKey,
  type StandardLibRow,
  type WorkcardSection,
  type ToolCartItem,
  type ToolboxApp,
  type ToolItem,
  type ToolState,
} from "../domain/toolbox";
import { formatDay, parseDay } from "../utils/format";

const STORAGE_KEY = "categoryItemManager.v2";

type Screen = "list" | "detail" | "cart" | "stdlib";
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
  const editingStdLib = ref<StandardLibKey | null>(null);
  /** 正在编辑的航材标准库机型（A320/B787）；与 editingLibrary 互斥。 */
  const editingMaterialLibrary = ref<AircraftType | null>(null);
  // 一级页面日期筛选框：默认显示当日（输入 type=date 直接展示当天），清空后退回“全部”
  const searchDay = ref(formatDay(Date.now()));
  const teamFilter = ref("");
  // 一级页面按项目名称搜索（模糊、忽略大小写）。
  const nameQuery = ref("");
  const cloud = reactive<{ text: string; state: CloudState; available: boolean }>({ text: "连接中…", state: "warn", available: false });
  const toast = reactive({ message: "", visible: false });
  const shared = ref(false);
  /** 导出图片时临时强制展开所有部位卡片，保证长图完整。 */
  const forceExpandAll = ref(false);
  /** 一级页面公告栏内容（云端共享）。 */
  const announcement = ref("");
  let announcementDirty = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let remoteSaving = false;
  let remotePending = false;
  const dirtyProjects = new Set<string>();
  const dirtyTemplates = new Set<AircraftType>();
  const dirtyMaterialTemplates = new Set<AircraftType>();
  let dirtyToolCart = false;
  const dirtyStdLibs = new Set<StandardLibKey>();
  let nextId = 1;
  // —— 字段级 dirty + 同步状态（PR-A 轮询 / PR-B 字段合并 / PR-C 行合并） ——
  const dirtyFields = new Map<string, Set<ProjectField>>();
  let editingField: ProjectField = "data";
  const syncing = ref(false);
  const flashKeys = ref<Set<string>>(new Set());
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  // 记录「本地改过备注（note）的行」的 itemKey，用于行级合并时字段级处理 note（避免并发丢备注）。
  const noteDirtyKeys = new Set<string>();
  let lastRevision = "";
  let pollingTimer: ReturnType<typeof setTimeout> | null = null;
  let pollingPaused = false;
  let consecutiveFailures = 0;
  // —— AIRNAV 授权 token（飞机信息读取/编辑鉴权）+ watch 实时推送 ——
  const AIRNAV_TOKEN_KEY = "toolbox_airnav_token";
  let airnavToken = sessionStorage.getItem(AIRNAV_TOKEN_KEY) || "";
  const watchActive = ref(false); // 是否正使用 watch 实时推送（供 UI 图标变色）
  let watchEnabled = false; // 由远端配置下发决定
  let watchMaxUsers = 10;

  const currentProject = computed(() => app.value.projects.find((item) => item.id === currentProjectId.value) || null);
  const active = computed(() => editingLibrary.value ? app.value.libraries[editingLibrary.value] : currentProject.value?.data || null);
  const detailTitle = computed(() => {
    if (editingLibrary.value) return `${editingLibrary.value} 工具标准库`;
    if (editingMaterialLibrary.value) return `${editingMaterialLibrary.value} 航材标准库`;
    return currentProject.value?.name || "";
  });
  /** 当前打开的“表格型标准库”（飞机信息 / 320 / 787 工卡分配）。 */
  const stdLibActive = computed(() => editingStdLib.value ? app.value.standardLibraries[editingStdLib.value] : null);
  const stdLibTitle = computed(() => editingStdLib.value ? STANDARD_LIB_META[editingStdLib.value].label : "");
  /** 飞机信息标准库里的全部飞机号，供工作准备单机号下拉框模糊查询。
   *  优先用公开机号接口（不依赖 AIRNAV 授权），回退本地标准库机号。 */
  const aircraftNumberList = ref<string[]>([]);
  const aircraftNumbers = computed<string[]>(() => {
    if (aircraftNumberList.value.length) return aircraftNumberList.value;
    return (app.value.standardLibraries.aircraft_info?.rows || []).map((row) => String(row["飞机号"] || "")).filter(Boolean);
  });
  /** 从工作准备单的"机型"字段推断机型：含 320/321 → A320，含 787 → B787，无数据 → A320。
   *  单独项目从单项准备单的机型字段推断。 */
  const aircraftTypeFromPrep = computed<AircraftType>(() => {
    const prep = currentProject.value?.prepSheet?.base?.机型;
    const sp = currentProject.value?.standalonePrepSheet?.base?.机型;
    const raw = String(prep || sp || "").toUpperCase();
    if (raw.includes("787")) return "B787";
    if (raw.includes("320") || raw.includes("321")) return "A320";
    return "A320";
  });
  /** “添加部位”下拉里可选择的“来自标准数据库”的部位列表（当前机型的全部标准部位）。 */
  const standardCategories = computed<string[]>(() => {
    const type = editingLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    return app.value.libraries[type]?.categories || [];
  });
  /** 航材清单当前编辑目标：航材标准库（库模式）或当前项目的航材清单。 */
  const materialActive = computed<ToolState | null>(() => {
    if (editingMaterialLibrary.value) return app.value.materialLibraries[editingMaterialLibrary.value];
    return currentProject.value?.materialList || null;
  });
  /** 航材标准库的部位列表（用于航材清单“添加部位”下拉与标准库替换）。 */
  const standardMaterialCategories = computed<string[]>(() => {
    const type = editingMaterialLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    return app.value.materialLibraries[type]?.categories || [];
  });
  /** 航材清单的部位列表：库模式用航材库自身 categories；项目模式用航材清单自身 categories
   *  （与工具清单解耦，不再共享 data.categories）；A检 默认显示 ENG/AV CB/FC/LG/通用/接机（= DEFAULT_CATEGORIES）。 */
  const MATERIAL_DEFAULT_CATS = [...DEFAULT_CATEGORIES];
  const materialCategories = computed<string[]>(() => {
    if (editingMaterialLibrary.value) return app.value.materialLibraries[editingMaterialLibrary.value]?.categories || [];
    const p = currentProject.value;
    if (!p) return [];
    // A检 默认显示 6 个部位 + 已有部位；单独项目/其他用航材清单自身 categories（无默认）
    let base: string[];
    if (p.type === "A检") {
      base = [...MATERIAL_DEFAULT_CATS];
      for (const c of p.materialList.categories) if (!base.includes(c)) base.push(c);
    } else {
      base = [...p.materialList.categories];
    }
    // 兜底：物品里出现但未登记的部位也显示（兼容旧数据 / categories 尚未回填）
    for (const it of p.materialList.items) if (it.cat && !base.includes(it.cat)) base.push(it.cat);
    return base;
  });
  const filteredProjects = computed(() => {
    const query = parseDay(searchDay.value);
    const name = nameQuery.value.trim().toLowerCase();
    return app.value.projects.filter((project) => {
      if (teamFilter.value && project.team !== teamFilter.value) return false;
      if (name && !project.name.toLowerCase().includes(name)) return false;
      if (!query) return true;
      const delta = Math.abs(new Date(project.createdAt).setHours(0, 0, 0, 0) - query.setHours(0, 0, 0, 0));
      return delta <= 5 * 86400000;
    });
  });

  /** 所有标准库和项目共享递增编号，防止切换页面后发生键冲突。 */
  function computeNextId(): void {
    let maximum = 0;
    const states = [
      ...Object.values(app.value.libraries),
      ...Object.values(app.value.materialLibraries),
      ...app.value.projects.map((project) => project.data),
      ...app.value.projects.map((project) => project.materialList),
    ];
    for (const state of states) {
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

  function markProjectField(id: string, field: ProjectField): void {
    let set = dirtyFields.get(id);
    if (!set) { set = new Set(); dirtyFields.set(id, set); }
    set.add(field);
  }

  function markCurrentDirty(field?: ProjectField): void {
    if (editingLibrary.value) {
      dirtyTemplates.add(editingLibrary.value);
    } else if (editingMaterialLibrary.value) {
      dirtyMaterialTemplates.add(editingMaterialLibrary.value);
    } else if (editingStdLib.value) {
      dirtyStdLibs.add(editingStdLib.value);
    } else if (currentProject.value?.id) {
      dirtyProjects.add(currentProject.value.id);
      markProjectField(currentProject.value.id, field ?? editingField);
    } else if (screen.value === "cart") {
      dirtyToolCart = true;
    } else {
      for (const project of app.value.projects) if (project.id) dirtyProjects.add(project.id);
    }
  }

  /** 显式标记当前项目的某个顶层字段为脏（如 meta 变更）。 */
  function markField(field: ProjectField): void {
    const id = currentProject.value?.id;
    if (id) {
      dirtyProjects.add(id);
      markProjectField(id, field);
    }
  }

  /** 子页切换时设置「当前正在编辑的字段」，使 persist 自动归到正确字段。 */
  function setEditingField(field: ProjectField): void {
    editingField = field;
  }

  function markAllDirty(): void {
    for (const type of AIRCRAFT_TYPES) dirtyTemplates.add(type);
    for (const type of AIRCRAFT_TYPES) dirtyMaterialTemplates.add(type);
    for (const project of app.value.projects) if (project.id) dirtyProjects.add(project.id);
    for (const key of STANDARD_LIB_KEYS) dirtyStdLibs.add(key);
    dirtyToolCart = true;
  }

  function hasDirtyData(): boolean {
    return dirtyProjects.size > 0 || dirtyTemplates.size > 0 || dirtyMaterialTemplates.size > 0 || dirtyToolCart || dirtyStdLibs.size > 0;
  }

  function persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
    markCurrentDirty();
    clearTimeout(saveTimer);
    if (cloud.available) saveTimer = setTimeout(saveRemote, 450);
  }

  /** 显式以指定字段标记当前项目为脏并落盘（用于 meta 等非子页字段的变更）。 */
  function persistField(field: ProjectField): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
    markCurrentDirty(field);
    clearTimeout(saveTimer);
    if (cloud.available) saveTimer = setTimeout(saveRemote, 450);
  }

  /** 保存单个项目：字段级部分 PATCH + 乐观锁（version）。成功则递增本地版本；409 冲突则采纳远端版本并保留本地编辑稍后重试。 */
  async function saveProject(project: Project, fields?: Set<ProjectField>): Promise<void> {
    const payload = fields && fields.size ? projectPartialPayload(project, fields) : projectPayload(project);
    try {
      await backend.updateProject(project.id, payload, project.version);
      project.version += 1;
      dirtyFields.delete(project.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = (error.payload as { current_version?: number } | null)?.current_version;
        if (typeof current === "number") project.version = current;
        notify("检测到并发修改，将以你的修改为准重新保存");
        dirtyProjects.add(project.id);
        return;
      }
      dirtyProjects.add(project.id);
      throw error;
    }
  }

  async function saveRemote(): Promise<void> {
    if (remoteSaving) {
      remotePending = true;
      return;
    }
    remoteSaving = true;
    const projectIds = [...dirtyProjects];
    const templateTypes = [...dirtyTemplates];
    const materialTemplateTypes = [...dirtyMaterialTemplates];
    const saveToolCart = dirtyToolCart;
    const stdLibKeys = [...dirtyStdLibs];
    dirtyProjects.clear();
    dirtyTemplates.clear();
    dirtyMaterialTemplates.clear();
    dirtyToolCart = false;
    dirtyStdLibs.clear();
    try {
      cloud.text = "正在保存…";
      cloud.state = "warn";
      await Promise.all([
        ...projectIds.map((id) => app.value.projects.find((project) => project.id === id))
          .filter((project): project is Project => Boolean(project))
          .map((project) => saveProject(project, dirtyFields.get(project.id))),
        ...templateTypes.map((type) => backend.saveTemplate(type, sectionsFromState(app.value.libraries[type]))),
        ...materialTemplateTypes.map((type) => backend.saveMaterialTemplate(type, sectionsFromState(app.value.materialLibraries[type]))),
        ...(saveToolCart
          ? [backend.saveToolCart(app.value.toolCart.map((item) => ({ name: item.name, quantity: item.qty })))]
          : []),
        ...[...stdLibKeys].map((key) =>
          backend.saveStandardLibrary(key, (app.value.standardLibraries[key]?.rows || []).map((row) => ({ ...row })), key === "aircraft_info" ? airnavToken : undefined),
        ),
      ]);
      cloud.text = "已连接 Django · 数据已保存";
      cloud.state = "ok";
      noteDirtyKeys.clear();
    } catch (error) {
      for (const type of templateTypes) dirtyTemplates.add(type);
      for (const type of materialTemplateTypes) dirtyMaterialTemplates.add(type);
      for (const key of stdLibKeys) dirtyStdLibs.add(key);
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
    editingMaterialLibrary.value = null;
    currentProjectId.value = null;
    screen.value = "cart";
  }

  /** 打开航材标准库编辑页（A320/B787），复用二级页的航材清单渲染（库模式）。 */
  function openMaterialLibrary(type: AircraftType): void {
    editingMaterialLibrary.value = type;
    editingLibrary.value = null;
    currentProjectId.value = null;
    detailTab.value = "display";
    screen.value = "detail";
  }

  function backToList(): void {
    screen.value = "list";
    editingLibrary.value = null;
    editingMaterialLibrary.value = null;
    editingStdLib.value = null;
    currentProjectId.value = null;
  }

  function openStdLib(key: StandardLibKey): void {
    editingStdLib.value = key;
    editingLibrary.value = null;
    currentProjectId.value = null;
    screen.value = "stdlib";
  }

  function saveStdLib(key: StandardLibKey, rows: StandardLibRow[]): void {
    if (!app.value.standardLibraries[key]) app.value.standardLibraries[key] = { rows: [] };
    app.value.standardLibraries[key].rows = rows;
    persist();
  }

  /** 校验 AIRNAV 密码并解锁飞机信息标准库：成功后签发短期 token（sessionStorage 缓存），
   *  立即拉取飞机信息（读取受 token 保护）。返回是否成功。 */
  async function unlockAircraftInfo(password: string): Promise<boolean> {
    try {
      const res = await backend.verifyAirnav(password);
      if (!res.verified || !res.token) {
        notify("AIRNAV 密码错误，无法进入");
        return false;
      }
      airnavToken = res.token;
      sessionStorage.setItem(AIRNAV_TOKEN_KEY, airnavToken);
      try {
        const aiLib = await backend.getStandardLibrary("aircraft_info", airnavToken);
        const aiDoc = unwrapDocument(aiLib?.data);
        if (aiDoc && Array.isArray(aiDoc.rows)) {
          app.value.standardLibraries.aircraft_info = normalizeStdLib({ rows: aiDoc.rows as StandardLibRow[] });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
        }
      } catch { /* 拉取失败不阻塞进入编辑 */ }
      return true;
    } catch {
      notify("AIRNAV 校验失败，请稍后重试");
      return false;
    }
  }

  async function createProject(name: string, aircraftType: AircraftType = "A320", projectType: ProjectType | "" = ""): Promise<void> {
    const isStandalone = projectType === "单独项目";
    const project: Project = {
      id: globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      createdAt: Date.now(),
      aircraftType,
      team: "",
      type: (PROJECT_TYPES as readonly string[]).includes(projectType) ? projectType : "",
      // 单独项目工具清单从空开始（添加部位下拉过滤 ENG/FC/AV CB/LG）；其余类型从标准库带入。
      data: isStandalone ? normalizeState() : deepCopy(app.value.libraries[aircraftType]),
      prepSheet: defaultPrepSheet(),
      workcardAssignment: defaultWorkcardAssignment(),
      standalonePrepSheet: defaultStandalonePrepSheet(),
      materialList: normalizeState(projectType === "A检" ? { categories: [...DEFAULT_CATEGORIES] } : {}),
      version: 0,
    };
    if (cloud.available) {
      try {
        const result = await backend.createProject(projectPayload(project));
        project.id = String(result.data?._id || project.id);
        project.createdAt = result.data?.created_at ? new Date(String(result.data.created_at)).getTime() : project.createdAt;
        project.version = Number(result.data?.version) || 1;
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
    persistField("meta");
  }

  /** 修改项目类型（需求 8）。 */
  function updateProjectType(project: Project, newType: ProjectType | ""): void {
    if (project.type === newType) return;
    project.type = (PROJECT_TYPES as readonly string[]).includes(newType) ? newType : "";
    persistField("meta");
  }

  /** 复制项目：深拷贝当前项目全部数据（工具清单/工作准备单/工卡分配清单），默认命名“原名+副本”，云端创建并插入列表首位。 */
  async function duplicateProject(project: Project): Promise<void> {
    const copy: Project = {
      ...deepCopy(project),
      id: globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: `${project.name}副本`,
      createdAt: Date.now(),
      version: 0,
    };
    if (cloud.available) {
      try {
        const result = await backend.createProject(projectPayload(copy));
        copy.id = String(result.data?._id || copy.id);
        copy.createdAt = result.data?.created_at ? new Date(String(result.data.created_at)).getTime() : copy.createdAt;
        copy.version = Number(result.data?.version) || 1;
      } catch (error) { notify(errorMessage(error, "云端复制失败，已保存到本地")); }
    }
    app.value.projects.unshift(copy);
    persist();
    notify(`已复制为“${copy.name}”`);
  }

  function setAircraftType(type: AircraftType): void {
    if (!currentProject.value || !AIRCRAFT_TYPES.includes(type)) return;
    currentProject.value.aircraftType = type;
    // 单独项目工具清单/航材清单不随机型整体覆盖（用户自建部位）；仅同步航材清单机型标记。
    if (currentProject.value.type !== "单独项目") {
      currentProject.value.data = deepCopy(app.value.libraries[type]);
      currentProject.value.data.aircraftType = type;
    }
    currentProject.value.materialList.aircraftType = type;
    // 同时影响 meta / data / materialList 三个字段
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
    markField("meta");
    markField("data");
    markField("materialList");
    clearTimeout(saveTimer);
    if (cloud.available) saveTimer = setTimeout(saveRemote, 450);
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
  /** 全部合计；传入 cats 时仅统计指定部位（需求：统计本页显示的工具总数）。 */
  function allTotal(cats?: string[]): number {
    const items = active.value?.items || [];
    if (!cats) return items.reduce((total, item) => total + (+item.qty || 0), 0);
    const set = new Set(cats);
    return items.filter((item) => set.has(item.cat)).reduce((total, item) => total + (+item.qty || 0), 0);
  }
  function isCartDuplicate(name: string): boolean { return Boolean(active.value?.useCart && app.value.toolCart.some((item) => item.name.trim() === name.trim())); }

  /** 工具清单工作卡片“补充标准库”：将当前 (cat,sub) 的物品整体写入对应机型标准库
   *  （新增缺失物品 / 删减多余物品 / 同步数量），部位不存在则补建。
   *  目标库 = 正在编辑的标准库（若有），否则当前项目的机型对应库（A320 / B787）。
   *  写完内存后立即 await saveLibraryNow 推送云端（不依赖 persist 的 setTimeout / dirty tracking），确保可靠同步。 */
  async function syncSubToLibrary(cat: string, sub: string): Promise<AircraftType | null> {
    const type: AircraftType = editingLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    const lib = app.value.libraries[type];
    if (!lib) return null;
    const current = itemsOf(cat, sub);
    if (!lib.categories.includes(cat)) lib.categories.push(cat);
    // 移除标准库中该 (cat,sub) 的原有条目，再用当前工作卡片物品整体替换（补充 + 删减 + 数量同步）。
    lib.items = lib.items.filter((it) => !(it.cat === cat && it.sub === sub));
    computeNextId();
    for (const it of current) {
      lib.items.push({ id: nextId++, cat, sub, name: it.name, qty: it.qty });
    }
    persist(); // 写 localStorage + 标 dirty（项目态标 dirtyProjects）
    dirtyTemplates.add(type); // 显式标对应标准库为脏
    // 立即推送云端，不依赖 persist 的 450ms setTimeout / autoSync 时机
    try {
      await saveLibraryNow(type);
    } catch {
      // saveRemote 内部已 notify 错误；此处吞掉避免重复提示
    }
    return type;
  }

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

  /** 工具清单部位卡片：选择标准库部位时，整体替换该部位物品为本机型「工具标准库」数据。
   *  不跨标准库取（航材标准库的部位不会带入工具清单）。若该部位在工具标准库不存在，则仅改名、不导入物品。 */
  function replaceCategoryFromStandard(oldCat: string, standardName: string): void {
    const state = requireActive();
    if (!state || !standardName) return;
    const type = editingLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    const lib = app.value.libraries[type];
    const hasStd = !!(lib && lib.categories.includes(standardName));
    // 先把旧部位改名并入 standardName（不依赖 renameCategory 的 includes 守卫，兼容目标已存在的情形）
    const ci = state.categories.indexOf(oldCat);
    if (oldCat !== standardName && ci >= 0) state.categories[ci] = standardName;
    state.items.forEach((item) => { if (item.cat === oldCat) item.cat = standardName; });
    if (state.notes[oldCat]) { state.notes[standardName] = state.notes[oldCat]; delete state.notes[oldCat]; }
    // 整体替换该部位物品为标准库数据（仅本机型工具标准库）
    state.items = state.items.filter((item) => item.cat !== standardName);
    if (hasStd && lib) {
      if (!state.categories.includes(standardName)) state.categories.push(standardName);
      const libItems = lib.items.filter((item) => item.cat === standardName);
      computeNextId();
      for (const item of libItems) state.items.push({ ...deepCopy(item), id: nextId++, cat: standardName, sub: item.sub });
    }
    persist();
    notify(hasStd
      ? `已导入「${standardName}」（工具标准库）${ lib!.items.filter((item) => item.cat === standardName).length } 项物品`
      : `部位「${standardName}」在本机型工具标准库中不存在，已仅改名、未导入物品`);
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
    // 本库（工具标准库）无该工作名对应物品：仅带入名称（改名），不删除卡片、不清空物品
    if (sourceItems.length === 0) {
      if (sourceSub && sourceSub !== currentSub) renameSub(cat, currentSub, sourceSub);
      return;
    }
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

  /** 清空当前项目的所有数据（工具清单 + 工作准备单 + 工卡分配清单 + 单项准备单 + 航材清单）。 */
  function clearProjectAllData(): void {
    const project = currentProject.value;
    if (!project) return;
    project.data = normalizeState();
    project.prepSheet = defaultPrepSheet();
    project.workcardAssignment = defaultWorkcardAssignment();
    project.standalonePrepSheet = defaultStandalonePrepSheet();
    project.materialList = normalizeState();
    // 显式标记所有字段为脏：persist() 默认只标当前子页 editingField，会漏标其它字段，
    // 导致清空后其它字段未推送、被 loadRemote 用远端旧数据覆盖回（数据残留的根因）。
    markField("data");
    markField("prepSheet");
    markField("workcardAssignment");
    markField("standalonePrepSheet");
    markField("materialList");
    persist();
  }

  function setToolCart(items: ToolCartItem[]): void {
    app.value.toolCart = items;
    persist();
  }

  // ----- 航材清单 CRUD（航材清单用自身 categories，与工具清单解耦，不再共享 data.categories）-----
  function requireMaterial(): ToolState | null { return materialActive.value; }
  /** 航材部位名的可变来源数组：库模式→航材库；项目模式→materialList.categories（自身，不联动工具清单）。 */
  function materialCatsMut(): string[] | null {
    if (editingMaterialLibrary.value) return app.value.materialLibraries[editingMaterialLibrary.value]?.categories || null;
    return currentProject.value?.materialList?.categories ?? null;
  }
  function mCategoryList(): string[] { return materialCatsMut() || []; }
  function mSubsOf(cat: string): string[] {
    const state = requireMaterial();
    if (!state) return [];
    // 空 sub 归入"固定"类型，避免渲染无名类型卡片（与其他类型卡片格式一致）
    const subs = [...new Set(state.items.filter((it) => it.cat === cat).map((it) => (it.sub && it.sub.trim()) || "固定"))];
    const i = subs.findIndex((s) => s.includes("固定"));
    if (i > 0) { const [f] = subs.splice(i, 1); subs.unshift(f); }
    return subs;
  }
  function mItemsOf(cat: string, sub: string): ToolItem[] {
    const state = requireMaterial();
    if (!state) return [];
    const target = (sub && sub.trim()) || "固定";
    return state.items.filter((it) => it.cat === cat && (((it.sub && it.sub.trim()) || "固定") === target));
  }
  function mSubTotal(cat: string, sub: string): number { return mItemsOf(cat, sub).reduce((t, it) => t + (+it.qty || 0), 0); }
  function mCatTotal(cat: string): number {
    const state = requireMaterial();
    return state ? state.items.filter((it) => it.cat === cat).reduce((t, it) => t + (+it.qty || 0), 0) : 0;
  }
  function mAllTotal(cats?: string[]): number {
    const state = requireMaterial();
    if (!state) return 0;
    const items = state.items;
    if (!cats) return items.reduce((t, it) => t + (+it.qty || 0), 0);
    const set = new Set(cats);
    return items.filter((it) => set.has(it.cat)).reduce((t, it) => t + (+it.qty || 0), 0);
  }
  function mAddCategory(name: string): void {
    if (!name) return;
    const cats = materialCatsMut();
    if (cats && !cats.includes(name)) { cats.push(name); persist(); }
  }
  /** 从航材标准库添加一个部位：新建该部位并带入标准库里该部位的全部类型与物品。 */
  function mAddCategoryFromStandard(name: string): void {
    const state = requireMaterial();
    if (!state || !name) return;
    const type = editingMaterialLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    const lib = app.value.materialLibraries[type];
    if (!lib) return;
    mAddCategory(name);
    const libItems = lib.items.filter((it) => it.cat === name);
    for (const it of libItems) state.items.push({ ...deepCopy(it), id: nextId++, cat: name, sub: it.sub, partNo: it.partNo });
    persist();
  }
  /** 航材清单部位卡片：选择标准库部位时，整体替换该部位物品为本机型「航材标准库」数据。
   *  不跨标准库取（工具标准库的部位不会带入航材清单）。若该部位在航材标准库不存在，则仅改名、不导入物品。 */
  function mReplaceCategoryFromStandard(oldCat: string, standardName: string): void {
    const state = requireMaterial();
    if (!state || !standardName) return;
    const type = editingMaterialLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    const lib = app.value.materialLibraries[type];
    const hasStd = !!(lib && lib.categories.includes(standardName));
    if (oldCat !== standardName) mRenameCategory(oldCat, standardName);
    state.items = state.items.filter((it) => it.cat !== standardName);
    if (hasStd && lib) {
      const cats = materialCatsMut();
      if (cats && !cats.includes(standardName)) cats.push(standardName);
      const libItems = lib.items.filter((it) => it.cat === standardName);
      computeNextId();
      for (const it of libItems) state.items.push({ ...deepCopy(it), id: nextId++, cat: standardName, sub: it.sub, partNo: it.partNo });
    }
    persist();
    notify(hasStd
      ? `已导入「${standardName}」（航材标准库）${ lib!.items.filter((it) => it.cat === standardName).length } 项物品`
      : `部位「${standardName}」在本机型航材标准库中不存在，已仅改名、未导入物品`);
  }
  function mAddNewCategory(): string | null {
    const list = mCategoryList();
    let name = "未命名部位"; let i = 2;
    while (list.includes(name)) name = `未命名部位 ${i++}`;
    mAddCategory(name);
    return name;
  }
  function mRenameCategory(oldName: string, name: string): void {
    if (!name || name === oldName) return;
    const state = requireMaterial();
    if (!state) return;
    const cats = materialCatsMut();
    if (cats) { const idx = cats.indexOf(oldName); if (idx >= 0) cats[idx] = name; }
    state.items.forEach((it) => { if (it.cat === oldName) it.cat = name; });
    if (state.notes[oldName]) { state.notes[name] = state.notes[oldName]; delete state.notes[oldName]; }
    persist();
  }
  function mDeleteCategory(cat: string): void {
    const state = requireMaterial();
    if (!state) return;
    state.items = state.items.filter((it) => it.cat !== cat);
    delete state.notes[cat];
    const cats = materialCatsMut();
    if (cats) { const i = cats.indexOf(cat); if (i >= 0) cats.splice(i, 1); }
    persist();
  }
  function mAddSub(cat: string): void {
    const state = requireMaterial();
    if (!state) return;
    if (!mCategoryList().includes(cat)) mAddCategory(cat);
    const subs = mSubsOf(cat);
    state.items.push({ id: nextId++, cat, sub: `新类型${subs.length + 1}`, name: "", qty: 1, partNo: "" });
    persist();
  }
  function mRenameSub(cat: string, oldName: string, name: string): void {
    const state = requireMaterial();
    if (!state || !name || name === oldName) return;
    state.items.forEach((it) => { if (it.cat === cat && it.sub === oldName) it.sub = name; });
    persist();
  }
  function mDeleteSub(cat: string, sub: string): void {
    const state = requireMaterial();
    if (!state) return;
    state.items = state.items.filter((it) => !(it.cat === cat && it.sub === sub));
    persist();
  }
  function mAddItem(cat: string, sub: string): void {
    const state = requireMaterial();
    if (!state) return;
    state.items.push({ id: nextId++, cat, sub, name: "", qty: 1, partNo: "" });
    persist();
  }
  function mDeleteItem(id: number): void {
    const state = requireMaterial();
    if (!state) return;
    state.items = state.items.filter((it) => it.id !== id);
    persist();
  }
  /** 航材标准库里的 (部位||类型) 选项，供类型下拉模糊匹配/替换。 */
  const mStandardSubs = computed<string[]>(() => {
    const type = editingMaterialLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    const lib = app.value.materialLibraries[type];
    return lib ? [...new Set(lib.items.map((it) => `${it.cat}||${it.sub}`))] : [];
  });
  /** 从航材标准库导入某类型到当前 (cat,sub)。 */
  function mImportStandardSub(cat: string, currentSub: string, key: string): void {
    const state = requireMaterial();
    if (!state || !key) return;
    const type = editingMaterialLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    const [sourceCat, sourceSub] = key.split("||");
    const source = app.value.materialLibraries[type]?.items.filter((it) => it.cat === sourceCat && it.sub === sourceSub) || [];
    // 本库（航材标准库）无该类型名对应物品：仅带入名称（改名），不删除卡片、不清空物品
    if (source.length === 0) {
      if (sourceSub && sourceSub !== currentSub) mRenameSub(cat, currentSub, sourceSub);
      return;
    }
    let anchor = state.items.length;
    for (let i = 0; i < state.items.length; i++) { if (state.items[i].cat === cat && state.items[i].sub === currentSub) { anchor = i; break; } }
    state.items = state.items.filter((it) => !(it.cat === cat && it.sub === currentSub));
    state.items.splice(anchor, 0, ...source.map((it) => ({ ...deepCopy(it), id: nextId++, cat, sub: sourceSub })));
    persist();
  }
  /** 航材清单"补充标准库"：把当前 (cat,sub) 物品整体写入对应机型航材标准库，并立即推送。 */
  async function mSyncSubToMaterialLib(cat: string, sub: string): Promise<AircraftType | null> {
    const type: AircraftType = editingMaterialLibrary.value ?? currentProject.value?.aircraftType ?? "A320";
    const lib = app.value.materialLibraries[type];
    if (!lib) return null;
    const current = mItemsOf(cat, sub);
    if (!lib.categories.includes(cat)) lib.categories.push(cat);
    lib.items = lib.items.filter((it) => !(it.cat === cat && it.sub === sub));
    computeNextId();
    for (const it of current) lib.items.push({ id: nextId++, cat, sub, name: it.name, qty: it.qty, partNo: it.partNo });
    persist();
    dirtyMaterialTemplates.add(type);
    try { await saveMaterialLibraryNow(type); } catch { /* saveRemote 已 notify */ }
    return type;
  }
  /** 立即保存指定航材标准库到云端（完成按钮 / 补充标准库用）。 */
  async function saveMaterialLibraryNow(type: AircraftType): Promise<void> {
    dirtyMaterialTemplates.add(type);
    await saveRemote();
  }
  /** 导入 xlsx：整体替换航材清单（库模式替换航材标准库；项目模式替换项目航材清单）。 */
  function replaceMaterialActive(state: ToolState): void {
    if (editingMaterialLibrary.value) {
      app.value.materialLibraries[editingMaterialLibrary.value] = normalizeState(state);
    } else if (currentProject.value) {
      currentProject.value.materialList = normalizeState(state);
    }
    computeNextId();
    persist();
  }
  /** 导入部位.xlsx：合并到航材清单（只补不覆盖：新部位整体新增，已有部位仅补缺失的 物品）。 */
  function mergeMaterialSections(imported: ToolState): { addedCats: number; addedItems: number } {
    const state = requireMaterial();
    if (!state) return { addedCats: 0, addedItems: 0 };
    let addedCats = 0;
    let addedItems = 0;
    for (const cat of imported.categories) {
      if (!state.categories.includes(cat) && !mCategoryList().includes(cat)) {
        mAddCategory(cat);
        addedCats++;
      }
      const existingKeys = new Set(state.items.filter((it) => it.cat === cat).map((it) => `${it.sub} ${it.partNo} ${it.name}`));
      for (const item of imported.items.filter((entry) => entry.cat === cat)) {
        if (existingKeys.has(`${item.sub} ${item.partNo} ${item.name}`)) continue;
        state.items.push({ ...deepCopy(item), id: nextId++, cat, sub: item.sub, name: item.name, qty: item.qty, partNo: item.partNo });
        addedItems++;
      }
    }
    if (addedCats > 0 || addedItems > 0) persist();
    return { addedCats, addedItems };
  }

  /** 「导入补充表格」：按件号（空则按名称）匹配，相同信息保留、不同信息覆盖（名称/数量/件号）、
   *  新增信息追加。返回 { updated, added }。 */
  function mergeMaterialImport(imported: ToolState): { updated: number; added: number } {
    const state = requireMaterial();
    if (!state) return { updated: 0, added: 0 };
    let updated = 0;
    let added = 0;
    for (const cat of imported.categories) {
      if (!state.categories.includes(cat)) state.categories.push(cat);
    }
    for (const item of imported.items) {
      const key = (item.partNo || item.name).trim();
      const existing = state.items.find((it) => it.cat === item.cat && it.sub === item.sub && (it.partNo || it.name).trim() === key);
      if (existing) {
        let changed = false;
        if (existing.name !== item.name) { existing.name = item.name; changed = true; }
        if (existing.qty !== item.qty) { existing.qty = item.qty; changed = true; }
        if (item.partNo && existing.partNo !== item.partNo) { existing.partNo = item.partNo; changed = true; }
        if (changed) updated++;
      } else {
        state.items.push({ ...deepCopy(item), id: nextId++ });
        added++;
      }
    }
    if (updated > 0 || added > 0) persist();
    return { updated, added };
  }

  // ----- 单项准备单 CRUD -----
  function spRenameTitle(title: string): void {
    const p = currentProject.value; if (!p) return;
    p.standalonePrepSheet.title = title.trim() || "单项准备单";
    markCurrentDirty(); persist();
  }
  function spAddWork(): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.works.push({ id: nextId++, 指令号: "", 工作内容: "" }); markCurrentDirty(); persist(); }
  function spRemoveWork(id: number): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.works = p.standalonePrepSheet.works.filter((w) => w.id !== id); markCurrentDirty(); persist(); }
  function spAddPart(): void { const p = currentProject.value; if (!p) return; const idx = p.standalonePrepSheet.parts.length + 1; p.standalonePrepSheet.parts.push({ id: nextId++, name: `部件 ${idx}`, 拆下件号: "", 拆下序号: "", 装上件号: "", 装上序号: "" }); markCurrentDirty(); persist(); }
  function spRemovePart(id: number): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.parts = p.standalonePrepSheet.parts.filter((x) => x.id !== id); markCurrentDirty(); persist(); }
  function spAddArrange(): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.personnel.extra.push({ id: nextId++, 内容: "", 人员: "" }); markCurrentDirty(); persist(); }
  function spRemoveArrange(id: number): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.personnel.extra = p.standalonePrepSheet.personnel.extra.filter((x) => x.id !== id); markCurrentDirty(); persist(); }
  function spAddProcessGroup(): void {
    const p = currentProject.value; if (!p) return;
    const idx = p.standalonePrepSheet.processGroups.length + 1;
    p.standalonePrepSheet.processGroups.push({ id: nextId++, name: `工序组 ${idx}`, rows: [emptyProcessRow(), emptyProcessRow(), emptyProcessRow()] });
    markCurrentDirty(); persist();
  }
  function spRemoveProcessGroup(id: number): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.processGroups = p.standalonePrepSheet.processGroups.filter((g) => g.id !== id); markCurrentDirty(); persist(); }
  function spAddProcessRow(groupIdx: number): void { const p = currentProject.value; if (!p) return; const g = p.standalonePrepSheet.processGroups[groupIdx]; if (!g) return; g.rows.push(emptyProcessRow()); markCurrentDirty(); persist(); }
  function spRemoveProcessRow(groupIdx: number, rowId: number): void { const p = currentProject.value; if (!p) return; const g = p.standalonePrepSheet.processGroups[groupIdx]; if (!g) return; g.rows = g.rows.filter((r) => r.id !== rowId); markCurrentDirty(); persist(); }
  function spAddSigningRow(): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.signingRows.push(emptySigningRow()); markCurrentDirty(); persist(); }
  function spRemoveSigningRow(id: number): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.signingRows = p.standalonePrepSheet.signingRows.filter((r) => r.id !== id); markCurrentDirty(); persist(); }
  /** 单项准备单机号变更 → 从飞机信息标准库回填 FSN/MSN/发动机/机型/ETOPS/ELT-DT。 */
  function spOnAircraftChange(): void {
    const p = currentProject.value; if (!p) return;
    const target = p.standalonePrepSheet.base.机号.trim(); if (!target) return;
    const match = lookupAircraftRow(target);
    if (match) {
      const b = p.standalonePrepSheet.base;
      b.FSN = String(match["FSN"] || ""); b.MSN = String(match["MSN"] || ""); b.机型 = String(match["机型"] || "");
      b.发动机 = String(match["发动机"] || ""); b.ETOPS = String(match["ETOPS"] || ""); b["ELT-DT"] = String(match["ELT-DT"] || "");
    } else {
      const b = p.standalonePrepSheet.base;
      appendAircraftRow(target, { FSN: b.FSN, MSN: b.MSN, 机型: b.机型, 发动机: b.发动机, ETOPS: b.ETOPS, "ELT-DT": b["ELT-DT"] });
    }
    persist();
  }

  /** 把工卡分级/部位变更同步回「工卡分配标准库」（按工卡号 upsert）。 */
  function upsertWorkcardStdLib(工卡号: string, 工卡名称: string, 部位: string, 分级: string): void {
    const lib = app.value.standardLibraries["workcard_320"];
    if (!lib) return;
    const id = 工卡号.trim();
    const rows = lib.rows;
    const idx = rows.findIndex((r) => String(r["工卡号"] || "").trim() === id);
    // 保留原有 MP项目号（避免改分级/部位时清空标准库已有数据）。
    const mp = idx >= 0 ? String(rows[idx]["MP项目号"] || "") : "";
    const row: StandardLibRow = { 工卡号: id, 工卡名: 工卡名称, MP项目号: mp, 部位, 分级 };
    if (idx >= 0) rows[idx] = row;
    else rows.push(row);
    dirtyStdLibs.add("workcard_320");
    persist();
  }

  /** 把已分配工卡在部位之间移动，并同步标准库部位。 */
  function moveCard(from: WorkcardSection, index: number, to: WorkcardSection): void {
    const a = currentProject.value?.workcardAssignment;
    if (!a || from === to) return;
    const [card] = a.sections[from].cards.splice(index, 1);
    if (!card) return;
    // 移动到目标部位时重置子部位为目标部位默认值（AV CB → "AV"）
    card.部位 = AREA_BY_SECTION[to];
    a.sections[to].cards.push(card);
    upsertWorkcardStdLib(card.工卡号, card.工卡名称, AREA_BY_SECTION[to], card.工卡分级);
    persist();
  }

  /** 把「未分配部位」工卡指定部位后插入对应分组，并写入工卡分配标准库。 */
  function moveUnassignedToSection(index: number, to: WorkcardSection): void {
    const a = currentProject.value?.workcardAssignment;
    if (!a) return;
    const [card] = a.unassigned.splice(index, 1);
    if (!card) return;
    card.部位 = AREA_BY_SECTION[to];
    a.sections[to].cards.push(card);
    upsertWorkcardStdLib(card.工卡号, card.工卡名称, AREA_BY_SECTION[to], card.工卡分级);
    persist();
  }

  /** 删除「未分配部位」中的某条工卡。 */
  function deleteUnassigned(index: number): void {
    const a = currentProject.value?.workcardAssignment;
    if (!a) return;
    a.unassigned.splice(index, 1);
    persist();
  }

  /** 把「AV CB」分组的工卡按子部位（AV/CB）排序，AV 在前、CB 在后、未知最后。 */
  function sortAvCbCards(): void {
    const a = currentProject.value?.workcardAssignment;
    if (!a) return;
    const cards = a.sections["AV CB"].cards;
    const order = (area: string | undefined) =>
      area === "AV" ? 0 : area === "CB" ? 1 : 2;
    cards.sort((x, y) => order(x.部位) - order(y.部位));
  }

  /** 工作准备单卡片标题改名。 */
  function renamePrepTitle(title: string): void {
    const project = currentProject.value;
    if (!project) return;
    project.prepSheet.title = title.trim() || "工作准备单";
    markCurrentDirty();
    persist();
  }

  /** 添加一个新条目到工作准备单的某动态分组。 */
  function addPrepItem(group: "extraBase" | "roleExtras" | "miscExtras" | "extra"): void {
    const project = currentProject.value;
    if (!project) return;
    project.prepSheet[group].push({ title: "", value: "" });
    markCurrentDirty();
    persist();
  }

  /** 删除工作准备单某分组内指定下标的动态条目。 */
  function removePrepItem(group: "extraBase" | "roleExtras" | "miscExtras" | "extra", index: number): void {
    const project = currentProject.value;
    if (!project) return;
    if (index < 0 || index >= project.prepSheet[group].length) return;
    project.prepSheet[group].splice(index, 1);
    markCurrentDirty();
    persist();
  }

  /** 在飞机信息标准库中按机号查找整行（含 ETOPS / ELT-DT），找不到时返回 null。PrepSheet 用它做"基础信息 + 特殊构型"合并填充。 */
  function lookupAircraftRow(regNo: string): StandardLibRow | null {
    const target = (regNo || "").trim();
    if (!target) return null;
    const rows = app.value.standardLibraries.aircraft_info?.rows || [];
    return rows.find((row) => String(row["飞机号"] || "").trim() === target) || null;
  }

  /** 机号格式校验：仅 "B-"+4 个字母数字字符（如 B-1005、B-226N）视为合法，允许新增到标准库。 */
  function isValidAircraftReg(regNo: string): boolean {
    return /^B-[A-Za-z0-9]{4}$/.test((regNo || "").trim());
  }

  /** 在飞机信息标准库中追加一条新机号行。
   *  去重：已存在相同机号则返回原行（不新增）。
   *  格式校验：仅机号满足 "B-"+4字符 且标准库无匹配项才新增；否则不新增（返回 null）。 */
  function appendAircraftRow(regNo: string, extra: Partial<StandardLibRow> = {}): StandardLibRow | null {
    const target = (regNo || "").trim();
    if (!target) return null;
    const existing = lookupAircraftRow(target);
    if (existing) return existing;
    if (!isValidAircraftReg(target)) return null;
    const cols = STANDARD_LIB_META.aircraft_info.rowKeys;
    const row: StandardLibRow = {};
    for (const col of cols) row[col] = "";
    row["飞机号"] = target;
    for (const [key, value] of Object.entries(extra || {})) {
      if (value != null) row[key] = String(value);
    }
    app.value.standardLibraries.aircraft_info.rows.push(row);
    dirtyStdLibs.add("aircraft_info");
    persist();
    return row;
  }
  /** 飞机信息回传：机号已存在则更新其 MSN/FSN/机型/发动机/ETOPS/ELT-DT，不存在则新增。
   *  用于工作准备单/单项准备单编辑飞机参数后回写到「飞机信息标准库」。 */
  function upsertAircraftInfo(regNo: string, fields: Partial<StandardLibRow>): void {
    const target = (regNo || "").trim();
    if (!target) return;
    const existing = lookupAircraftRow(target);
    if (existing) {
      for (const [key, value] of Object.entries(fields || {})) {
        if (value != null && value !== "") existing[key] = String(value);
      }
    } else {
      appendAircraftRow(target, fields);
      return;
    }
    dirtyStdLibs.add("aircraft_info");
    persist();
  }

  /** 合并两个 ToolState 的物品行（内容键对齐，本地优先）：本地正在编辑的行保留，
   *  远端新增的行并入（分配不冲突的新 id）。 */
  function mergeToolStateRows(local: ToolState, remote: ToolState): ToolState {
    const localKeys = new Set(local.items.map((it) => itemKey(it)));
    const remoteOnly = remote.items.filter((it) => !localKeys.has(itemKey(it)));
    const merged = [...local.items];
    // 字段级 note 合并：本地刚改过 note 的行保留本地 note；否则采纳远端 note（解决并发改 note 丢失）。
    let noteChanged = false;
    for (const localIt of merged) {
      if (noteDirtyKeys.has(itemKey(localIt))) continue;
      const remoteIt = remote.items.find((r) => itemKey(r) === itemKey(localIt));
      if (remoteIt && (remoteIt.note || "") !== (localIt.note || "")) {
        localIt.note = remoteIt.note || "";
        noteChanged = true;
      }
    }
    if (remoteOnly.length > 0) {
      let maxId = local.items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0);
      for (const it of remoteOnly) merged.push({ ...deepCopy(it), id: ++maxId });
      nextId = maxId + 1;
      // 黄闪：标记本次并入的新行，供组件做短暂高亮
      flashKeys.value = new Set(remoteOnly.map((it) => itemKey(it)));
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashKeys.value = new Set(); }, 1500);
    }
    const categories = [...local.categories];
    for (const c of remote.categories) if (!categories.includes(c)) categories.push(c);
    for (const it of merged) if (it.cat && !categories.includes(it.cat)) categories.push(it.cat);
    if (remoteOnly.length === 0 && !noteChanged) return local;
    return { ...local, categories, items: merged, notes: { ...remote.notes, ...local.notes } };
  }

  /** 标记某航材物品行的备注被本地修改（清空或填写都算），供合并时字段级处理 note。 */
  function markNoteDirty(item: ToolItem): void {
    noteDirtyKeys.add(itemKey(item));
  }

  /** 工卡分配清单按「工卡号」行级合并：本地正在编辑时保留本地卡片，同时合并远端新增的工卡
   *  （避免整字段「本地为准」把别端新增的工卡丢掉）。相同工卡号仍以本地为准（本地编辑优先）。 */
  function mergeWorkcardAssignment(local: WorkcardAssignment, remote: WorkcardAssignment, localDirty: boolean): WorkcardAssignment {
    if (!localDirty) return remote;
    const merged: WorkcardAssignment = { sections: {} as WorkcardAssignment["sections"], unassigned: [...local.unassigned] };
    for (const section of WORKCARD_SECTIONS) {
      const ls = local.sections[section];
      const rs = remote.sections[section];
      const localIds = new Set(ls.cards.map((c) => String(c.工卡号 || "").trim()).filter(Boolean));
      const cards = [...ls.cards];
      for (const rc of rs.cards) {
        const rid = String(rc.工卡号 || "").trim();
        if (rid && !localIds.has(rid)) cards.push(deepCopy(rc));
      }
      merged.sections[section] = { personnel: { ...ls.personnel }, cards, extra: [...ls.extra] };
    }
    const localUnassignedIds = new Set(local.unassigned.map((c) => String(c.工卡号 || "").trim()).filter(Boolean));
    for (const rc of remote.unassigned) {
      const rid = String(rc.工卡号 || "").trim();
      if (rid && !localUnassignedIds.has(rid)) merged.unassigned.push(deepCopy(rc));
    }
    return merged;
  }

  /** 字段级合并单个项目：本地脏字段保留（data/materialList 脏时按内容键行合并），其余采用远端。 */
  function mergeProjectFields(local: Project, remote: Project, fields?: Set<ProjectField>): Project {
    const dirty = (f: ProjectField) => fields?.has(f) ?? false;
    return {
      ...local,
      name: dirty("meta") ? local.name : remote.name,
      aircraftType: dirty("meta") ? local.aircraftType : remote.aircraftType,
      team: dirty("meta") ? local.team : remote.team,
      type: dirty("meta") ? local.type : remote.type,
      data: dirty("data") ? mergeToolStateRows(local.data, remote.data) : remote.data,
      prepSheet: dirty("prepSheet") ? local.prepSheet : remote.prepSheet,
      workcardAssignment: mergeWorkcardAssignment(local.workcardAssignment, remote.workcardAssignment, dirty("workcardAssignment")),
      standalonePrepSheet: dirty("standalonePrepSheet") ? local.standalonePrepSheet : remote.standalonePrepSheet,
      materialList: dirty("materialList") ? mergeToolStateRows(local.materialList, remote.materialList) : remote.materialList,
      version: remote.version,
    };
  }

  /** 把远端数据合并进本地 app（非脏字段/实体才覆盖）。 */
  function applyRemoteMerge(remote: {
    libraries: Record<AircraftType, ToolState>;
    materialLibraries: Record<AircraftType, ToolState>;
    projects: Project[];
    toolCart: ToolCartItem[];
    standardLibraries: Record<StandardLibKey, StandardLib>;
  }): void {
    const nextLibraries = { ...app.value.libraries } as Record<AircraftType, ToolState>;
    for (const type of AIRCRAFT_TYPES) {
      if (!dirtyTemplates.has(type)) nextLibraries[type] = remote.libraries[type];
    }
    const nextMaterialLibraries = { ...app.value.materialLibraries } as Record<AircraftType, ToolState>;
    for (const type of AIRCRAFT_TYPES) {
      if (!dirtyMaterialTemplates.has(type)) nextMaterialLibraries[type] = remote.materialLibraries[type];
    }
    const localIds = new Set(app.value.projects.map((p) => p.id));
    const mergedProjects: Project[] = [];
    for (const local of app.value.projects) {
      const remoteProject = remote.projects.find((p) => p.id === local.id);
      if (remoteProject) {
        mergedProjects.push(mergeProjectFields(local, remoteProject, dirtyFields.get(local.id)));
      } else if (dirtyFields.has(local.id)) {
        mergedProjects.push(local); // 远端已删除但本地正在编辑：保留，等保存时以本地为准
      }
      // 否则：远端已删除且本地未编辑 → 丢弃
    }
    for (const remoteProject of remote.projects) {
      // 本地没有的新项目 → 追加
      if (!localIds.has(remoteProject.id)) mergedProjects.push(remoteProject);
    }
    const nextStdLibs = { ...app.value.standardLibraries } as Record<StandardLibKey, StandardLib>;
    for (const key of STANDARD_LIB_KEYS) {
      if (!dirtyStdLibs.has(key)) nextStdLibs[key] = remote.standardLibraries[key];
    }
    app.value = normalizeApp({
      libraries: nextLibraries,
      materialLibraries: nextMaterialLibraries,
      projects: mergedProjects,
      toolCart: dirtyToolCart ? app.value.toolCart : remote.toolCart,
      standardLibraries: nextStdLibs,
    });
  }

  async function loadRemote(merge = false, showOverlay = true): Promise<void> {
    if (showOverlay) syncing.value = true;
    cloud.text = "正在连接 Django 后端…";
    try {
      const status = await backend.status();
      if (!status.configured) {
        cloud.text = "后端已连接 · CloudBase 尚未配置";
        cloud.state = "warn";
        return;
      }
      const [projects, a320, b787, ma320, mb787, cart, aiLib, wc320, ann, cfg, nums] = await Promise.all([
        backend.listProjects(),
        backend.getTemplate("A320").catch(() => null),
        backend.getTemplate("B787").catch(() => null),
        backend.getMaterialTemplate("A320").catch(() => null),
        backend.getMaterialTemplate("B787").catch(() => null),
        backend.getToolCart().catch(() => null),
        // 飞机信息读取受 AIRNAV 授权保护：无 token 时跳过（保留本地缓存），避免 403 刷屏。
        airnavToken ? backend.getStandardLibrary("aircraft_info", airnavToken).catch(() => null) : Promise.resolve(null),
        backend.getStandardLibrary("workcard_320").catch(() => null),
        backend.getAnnouncement().catch(() => null),
        backend.getConfig().catch(() => null),
        backend.getAircraftNumbers().catch(() => null),
      ]);
      // 公开机号列表（不依赖 AIRNAV 授权），供机号下拉模糊搜索。
      const numsData = nums?.data;
      if (Array.isArray(numsData)) aircraftNumberList.value = numsData.filter((n): n is string => typeof n === "string");
      // 远端配置下发：watch 开关与阈值（方案C）。
      const cfgDoc = unwrapDocument(cfg?.data);
      watchEnabled = Boolean(cfgDoc?.watch_enabled);
      watchMaxUsers = Number.parseInt(String(cfgDoc?.watch_max_users ?? "10"), 10) || 10;
      const a320Document = unwrapDocument(a320?.data);
      const b787Document = unwrapDocument(b787?.data);
      const ma320Document = unwrapDocument(ma320?.data);
      const mb787Document = unwrapDocument(mb787?.data);
      const libraries: Record<AircraftType, ToolState> = {
        A320: a320Document ? stateFromSections((a320Document.sections || []) as SectionPayload[]) : app.value.libraries.A320,
        B787: b787Document ? stateFromSections((b787Document.sections || []) as SectionPayload[]) : app.value.libraries.B787,
      };
      const materialLibraries: Record<AircraftType, ToolState> = {
        A320: ma320Document ? stateFromSections((ma320Document.sections || []) as SectionPayload[]) : app.value.materialLibraries.A320,
        B787: mb787Document ? stateFromSections((mb787Document.sections || []) as SectionPayload[]) : app.value.materialLibraries.B787,
      };
      const cartDocument = unwrapDocument(cart?.data);
      const cartItems = Array.isArray(cartDocument?.items) ? cartDocument.items as Array<Record<string, unknown>> : [];
      const toolCart: ToolCartItem[] = cartItems.map((item) => ({ name: String(item.name || ""), qty: Math.max(0, Number.parseInt(String(item.quantity ?? item.qty), 10) || 0) }));
      const stdLibs = defaultStandardLibraries();
      const aiDoc = unwrapDocument(aiLib?.data);
      const wc320Doc = unwrapDocument(wc320?.data);
      if (aiDoc && Array.isArray(aiDoc.rows)) {
        stdLibs.aircraft_info = normalizeStdLib({ rows: aiDoc.rows as StandardLibRow[] });
      } else if (!airnavToken) {
        // 无授权 token 时读取被跳过：保留本地已有的飞机信息（不因无权限而清空）。
        stdLibs.aircraft_info = app.value.standardLibraries.aircraft_info || stdLibs.aircraft_info;
      }
      if (wc320Doc && Array.isArray(wc320Doc.rows)) stdLibs.workcard_320 = normalizeStdLib({ rows: wc320Doc.rows as StandardLibRow[] });
      const annDoc = unwrapDocument(ann?.data);
      if (!merge || !announcementDirty) {
        announcement.value = String(annDoc?.content || "");
        announcementDirty = false;
      }
      const remoteProjects = listDocuments(projects).map(projectFromDocument);
      if (merge) {
        applyRemoteMerge({ libraries, materialLibraries, projects: remoteProjects, toolCart, standardLibraries: stdLibs });
      } else {
        app.value = normalizeApp({ libraries, materialLibraries, projects: remoteProjects, toolCart, standardLibraries: stdLibs });
      }
      computeNextId();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
      cloud.available = true;
      cloud.text = "已连接 Django · 数据已同步";
      cloud.state = "ok";
      syncRealtimeMode();
    } catch (error) {
      cloud.text = "后端连接失败 · 正在使用本地缓存";
      cloud.state = "err";
      notify(errorMessage(error, "无法连接后端"));
    } finally {
      if (showOverlay) syncing.value = false;
    }
  }

  /** 手动刷新：先把本地未保存的改动推送到云端，再从云端拉取（仍有脏数据时走字段级合并，避免丢失编辑）。 */
  async function refresh(): Promise<void> {
    if (hasDirtyData()) {
      try { await saveRemote(); } catch { /* 推送失败也继续刷新 */ }
    }
    await loadRemote(hasDirtyData());
    notify("数据已刷新");
  }

  /** 强制同步一次：立即推送本地改动 + 立即拉取合并。
   *  供「依据工卡清单」等重量级操作后调用——不等 2s autoSync / 5s 轮询，
   *  本端立刻把改动推上云端，其余端会在下一轮轮询（3s）内拉到。 */
  async function forceSync(): Promise<void> {
    if (hasDirtyData()) {
      try { await saveRemote(); } catch { /* 推送失败也继续拉取 */ }
    }
    await loadRemote(true, false);
  }

  /** 立即保存：无视 autoSync 防抖间隔，把本地编辑过的内容立刻推送云端（不拉取）。 */
  async function saveNow(): Promise<void> {
    if (!hasDirtyData()) {
      notify("没有需要保存的改动");
      return;
    }
    try {
      await saveRemote();
      notify("已保存");
    } catch {
      notify("保存失败，请重试");
    }
  }

  /** 单次轮询：revision 有变化则做字段级合并。
   *  注意：不做「保存后重设基线」——那会越过别端的变更导致漏同步；
   *  保存后的轮询会检测到自己的写入并触发一次合并，等价于把最新远端拉齐。 */
  async function pollOnce(): Promise<void> {
    if (pollingPaused || syncing.value || remoteSaving) { scheduleNextPoll(); return; }
    try {
      const result = await backend.poll(lastRevision);
      lastRevision = String(result.revision || lastRevision);
      consecutiveFailures = 0;
      if (result.changed) await loadRemote(true, false);
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        pollingPaused = true;
        notify("同步轮询已暂停，请手动刷新");
        return;
      }
    }
    scheduleNextPoll();
  }

  function scheduleNextPoll(): void {
    if (pollingTimer) clearTimeout(pollingTimer);
    const interval = document.hidden ? 10000 : 3000;
    pollingTimer = setTimeout(pollOnce, interval);
  }

  function startPolling(): void {
    pollingPaused = false;
    consecutiveFailures = 0;
    scheduleNextPoll();
  }

  function stopPolling(): void {
    if (pollingTimer) { clearTimeout(pollingTimer); pollingTimer = null; }
  }

  // —— watch 实时推送（方案C：远端配置下发 + 轮询兜底）——
  /** watch 推送来的 revision 序号：有变化且空闲时触发一次增量合并。
   *  lastRevision 只在真正触发 loadRemote 时才前进——若正忙（同步/保存中），
   *  不前移基线，让下一轮 watch/轮询再次触发，避免「基线已前进但未拉取」导致漏同步。 */
  function applyWatchRevision(seq: string): void {
    if (seq && seq !== lastRevision && !syncing.value && !remoteSaving) {
      lastRevision = seq;
      void loadRemote(true, false);
    }
  }

  function startWatch(): void {
    if (watchActive.value) return;
    watchActive.value = true;
    // 注意：不停止轮询。轮询始终作为兜底（watch 提供亚秒级触发、轮询保证 3s 内同步），
    // 即使 watch 静默失败（onChange 不触发）也不会失去同步。
    void startWatchRevision(
      (seq) => applyWatchRevision(seq),
      () => {
        // watch 失败/超限（如连接数 > watch_max_users）→ 置灰，轮询兜底继续
        watchActive.value = false;
      },
    );
  }

  function stopWatch(): void {
    stopWatchRevision();
    watchActive.value = false;
  }

  /** 根据远端配置动态切换 watch / 轮询（loadRemote 读取配置后调用）。
   *  watch_max_users <= 0 时视为管理员禁用 watch，强制走轮询。
   *  无论 watch 是否启用，轮询始终在跑（兜底）。 */
  function syncRealtimeMode(): void {
    if (watchEnabled && watchMaxUsers > 0) {
      startWatch();
    } else {
      stopWatch();
    }
    if (!pollingTimer) startPolling();
  }

  /** 某个物品是否处于「远端并入」黄闪状态。 */
  function isFlashing(item: { cat: string; sub: string; name: string; partNo?: string }): boolean {
    return flashKeys.value.has(itemKey(item));
  }

  computeNextId();

  /** 保存公告到云端。 */
  async function saveAnnouncement(): Promise<void> {
    if (!announcementDirty) return;
    announcementDirty = false;
    try {
      await backend.saveAnnouncement(announcement.value);
    } catch (error) {
      announcementDirty = true;
      notify(errorMessage(error, "保存公告失败"));
    }
  }

  /** 立即保存指定工具标准库到云端（完成按钮用）。 */
  async function saveLibraryNow(type: AircraftType): Promise<void> {
    dirtyTemplates.add(type);
    await saveRemote();
  }
  /** 立即保存工具车到云端（完成按钮用）。 */
  async function saveCartNow(): Promise<void> {
    dirtyToolCart = true;
    await saveRemote();
  }
  /** 立即保存指定标准库到云端（完成按钮用）。 */
  async function saveStdLibNow(key: StandardLibKey): Promise<void> {
    dirtyStdLibs.add(key);
    await saveRemote();
  }

  /** 公告本地编辑（标记 dirty，由 autoSync 推送）。 */
  function setAnnouncement(value: string): void {
    announcement.value = value;
    announcementDirty = true;
  }

  /** 每 2 秒自动同步：有未保存的本地变更时推送到云端（兜底 persist 的 450ms 防抖，持续编辑时不丢数据）。 */
  let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  function autoSync(): void {
    if (hasDirtyData()) void saveRemote();
    if (announcementDirty) void saveAnnouncement();
  }
  function startAutoSync(intervalMs = 2000): void {
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    autoSyncTimer = setInterval(autoSync, intervalMs);
  }

  return {
    app, screen, listTab, detailTab, currentProject, editingLibrary, editingStdLib, editingMaterialLibrary,
    active, materialActive, materialCategories, standardMaterialCategories, mStandardSubs,
    detailTitle, stdLibActive, stdLibTitle, aircraftNumbers, aircraftTypeFromPrep,
    searchDay, teamFilter, nameQuery, filteredProjects, cloud, toast, shared,
    notify, persist, replaceApp, openProject, openLibrary, openCart, openMaterialLibrary, openStdLib, backToList,
    createProject, deleteProject, duplicateProject, updateProject, updateProjectType, setAircraftType, saveStdLib,
    itemsOf, subsOf, subTotal, catTotal, allTotal, isCartDuplicate,
    addNewCategory, addCategoryFromStandard, standardCategories, renameCategory, replaceCategoryFromStandard, deleteCategory, addSub, renameSub, deleteSub, forceExpandAll,
    importStandardSub, addItem, deleteItem, mergeImportedSections, replaceActive, clearActive, clearProjectAllData, setToolCart, loadRemote, refresh, forceSync, saveNow,
    syncSubToLibrary,
    mSubsOf, mItemsOf, mSubTotal, mCatTotal, mAllTotal, mCategoryList,
    mAddCategory, mAddCategoryFromStandard, mReplaceCategoryFromStandard, mAddNewCategory, mRenameCategory, mDeleteCategory, mAddSub, mRenameSub, mDeleteSub, mAddItem, mDeleteItem,
    mImportStandardSub, mSyncSubToMaterialLib, saveMaterialLibraryNow, replaceMaterialActive, mergeMaterialSections, mergeMaterialImport, markNoteDirty,
    spRenameTitle, spOnAircraftChange, spAddWork, spRemoveWork, spAddPart, spRemovePart, spAddArrange, spRemoveArrange,
    spAddProcessGroup, spRemoveProcessGroup, spAddProcessRow, spRemoveProcessRow, spAddSigningRow, spRemoveSigningRow,
    moveCard, moveUnassignedToSection, deleteUnassigned, upsertWorkcardStdLib,
    sortAvCbCards,
    lookupAircraftRow, appendAircraftRow, upsertAircraftInfo,
    renamePrepTitle, addPrepItem, removePrepItem,
    startAutoSync, startPolling, stopPolling, setEditingField, isFlashing, syncing,
    unlockAircraftInfo, startWatch, stopWatch, syncRealtimeMode, watchActive,
    announcement, setAnnouncement, saveAnnouncement,
    saveLibraryNow, saveCartNow, saveStdLibNow,
  };
}

export type ToolboxStore = ReturnType<typeof useToolbox>;
