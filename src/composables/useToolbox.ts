import { computed, reactive, ref, watch } from "vue";
import { backend, ApiError, type ApiEnvelope } from "../api";
import { startWatchRevision, stopWatchRevision } from "../services/realtime";
import {
  AIRCRAFT_TYPES,
  defaultApp,
  defaultGanttPrep,
  defaultPrepSheet,
  defaultStandardLibraries,
  defaultStandalonePrepSheet,
  defaultWorkcardAssignment,
  deepCopy,
  genUid,
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
  isStdWorkcardSection,
  type WorkcardAssignment,
  type AircraftType,
  type AircraftInfoPayload,
  type GanttPrepState,
  type Project,
  type ProjectField,
  type ProjectType,
  type SectionPayload,
  type StandalonePrepSheet,
  type StandaloneTemplateState,
  type StandardLib,
  type StandardLibKey,
  type StandardLibRow,
  type WorkcardSection,
  type ToolCartItem,
  type ToolboxApp,
  type ToolItem,
  type ToolState,
} from "../domain/toolbox";
import { parseDay } from "../utils/format";

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
  /** 换发/APU 甘特准备单当前子页（form/gantt/docs/airparts/tools），供 App.vue 判断是否甘特图全宽。 */
  const ganttTab = ref<"form" | "gantt" | "docs" | "airparts" | "tools">("form");
  const currentProjectId = ref<string | null>(null);
  /** 模板编辑模式（mode="edit"）创建的临时项目 id：关闭子页回列表时自动删除记录、不保存。 */
  const editingTemplateProjectId = ref<string | null>(null);
  const editingLibrary = ref<AircraftType | null>(null);
  const editingStdLib = ref<StandardLibKey | null>(null);
  /** 正在编辑的航材标准库机型（A320/B787）；与 editingLibrary 互斥。 */
  const editingMaterialLibrary = ref<AircraftType | null>(null);
  // 一级页筛选：执行日期时段（dateFrom/dateTo，YYYY-MM-DD；默认今日-5 ~ 今日+30，跨度上限 30 天由 UI 约束）。
  function dayOffsetStr(offset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  const dateFrom = ref(dayOffsetStr(-5));
  const dateTo = ref(dayOffsetStr(30));
  /** 项目类型多选（PROJECT_TYPES 子集）。 */
  const typeFilter = ref<string[]>([]);
  /** 执行班组多选（TEAMS 子集）。 */
  const teamFilters = ref<string[]>([]);
  // 一级页面按项目名称搜索（模糊、忽略大小写）。
  const nameQuery = ref("");
  const cloud = reactive<{ text: string; state: CloudState; available: boolean }>({ text: "连接中…", state: "warn", available: false });
  const toast = reactive({ message: "", visible: false, level: "info" as "info" | "ok" | "err" });
  const shared = ref(false);
  /** 导出图片时临时强制展开所有部位卡片，保证长图完整。 */
  const forceExpandAll = ref(false);
  /** 导出图片/导出 Word 进行中（App.vue exportImage / GanttPrep exportAllImage 置位），
   *  供各页「导出」按钮绑定 is-loading 禁用态，防止重复点击产生双份导出。 */
  const imageExportBusy = ref(false);
  /** 一级页面公告栏内容（云端共享）。 */
  const announcement = ref("");
  let announcementDirty = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const remoteSaving = ref(false);
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
  // —— 无密码身份标识（姓名 2-5 字符）：localStorage 记住，同设备免登录，后端记录登录账号目录 ——
  const IDENTITY_KEY = "toolbox_identity_name";
  const identityName = ref<string>(localStorage.getItem(IDENTITY_KEY) || "");
  const identityReady = computed(() => !!identityName.value);
  // —— 编辑会话（单输入框软锁）：本浏览器会话唯一 id + 用户设置（轮询频率/会话超时/终止保存）——
  const SESSION_KEY = "toolbox_session_id";
  const SETTINGS_KEY = "toolbox_sync_settings";
  let sessionId = localStorage.getItem(SESSION_KEY) || "";
  if (!sessionId) {
    sessionId = (crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    localStorage.setItem(SESSION_KEY, sessionId);
  }
  /** 同步设置（一级页数据库子页「系统设置」卡片读写，localStorage 持久化）。 */
  const syncSettings = reactive({
    pollMs: 2000,           // 前台轮询间隔（ms）：同步他人改动频率
    sessionTimeoutMs: 120000, // 编辑会话超时（ms）：超时自动保存并脱离编辑
    autoSaveOnEnd: true,    // 终止编辑（失焦/切项目/关页）视为保存
  });
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<typeof syncSettings>;
    if (Number(saved.pollMs) >= 500 && Number(saved.pollMs) <= 20000) syncSettings.pollMs = Number(saved.pollMs);
    if (Number(saved.sessionTimeoutMs) >= 15000 && Number(saved.sessionTimeoutMs) <= 600000) syncSettings.sessionTimeoutMs = Number(saved.sessionTimeoutMs);
    if (typeof saved.autoSaveOnEnd === "boolean") syncSettings.autoSaveOnEnd = saved.autoSaveOnEnd;
  } catch { /* 设置损坏则用默认 */ }
  function persistSettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(syncSettings));
  }
  // 本地正在编辑的输入框 key -> 最近一次活动时间戳（Date.now()）。
  const editingLocal = reactive(new Map<string, number>());
  /** 编辑免并发窗口：自最近一次真实编辑动作（focus/input）起 120s 内视为“编辑会话中”。
   *  期间发生 409 乐观锁冲突 → 静默采纳远端版本 + 保留本地修改延后重试，不再弹「并发修改」打断输入。 */
  let editingWindowUntil = 0;
  const EDITING_GRACE_MS = 120_000;
  function isEditingWindow(): boolean {
    return editingLocal.size > 0 || Date.now() < editingWindowUntil;
  }
  // 远端其他用户正在编辑的 key -> 姓名（轮询拉取，用于渲染黄锁 + disabled）。
  const editingByOthers = reactive(new Map<string, string>());
  // 他人编辑快照刷新计数：UI 组件绑定时读取它触发重渲染（disabled/class 跟随黄锁）。
  const lockVersion = ref(0);
  let editingTimer: ReturnType<typeof setInterval> | undefined;
  let editingKeepalive: ReturnType<typeof setInterval> | undefined;
  let lastReportedSnapshot = ""; // 上次成功上报的 key 快照，仅变化时上报（事件驱动，无节流）
  let pidWatchStopper: (() => void) | undefined;
  /** 上报编辑会话快照。pid 为空默认当前项目；force=true 强制上报（释放/超时用，无视快照去重）。
   *  持续编辑由 10s 保活定时器续期，后端 TTL 60s 兜底自动释放。 */
  async function reportEditingHeartbeat(pidOverride?: string, force = false): Promise<void> {
    const pid = pidOverride ?? currentProjectId.value;
    if (!pid || !identityName.value.trim()) return;
    const key = editingLocal.size ? [...editingLocal.keys()].join("\u0001") : "";
    if (!force && !pidOverride && key === lastReportedSnapshot) return; // 集合未变化：交给保活定时器
    try {
      await backend.reportEditing({ session_id: sessionId, name: identityName.value.trim(), project_id: pid, key: key.slice(0, 1800) });
      if (!pidOverride) lastReportedSnapshot = key;
    } catch { /* 上报失败忽略（下次变化或保活重试） */ }
  }
  /** 拉取他人编辑会话（前台每 1s 一次，仅当前打开某项目时；后台标签页由 startEditingSync 跳过）。 */
  async function fetchEditingOthers(): Promise<void> {
    const pid = currentProjectId.value;
    if (!pid || document.hidden) return;
    try {
      const res = await backend.listEditing(pid, sessionId);
      const data = (res as { data?: unknown }).data;
      const list = Array.isArray(data) ? (data as Array<{ session_id: string; name: string; key: string }>) : [];
      const next = new Map<string, string>();
      for (const item of list) {
        for (const key of String(item.key || "").split("\u0001")) {
          if (key) next.set(key, String(item.name || ""));
        }
      }
      let changed = false;
      const stale: string[] = [];
      for (const key of editingByOthers.keys()) if (!next.has(key)) stale.push(key);
      for (const key of stale) { editingByOthers.delete(key); changed = true; }
      for (const [key, name] of next) { if (editingByOthers.get(key) !== name) { editingByOthers.set(key, name); changed = true; } }
      if (changed) lockVersion.value += 1;
    } catch { /* 拉取失败忽略 */ }
  }
  function fieldOfEditKey(key: string): ProjectField | null {
    const f = key.split("|")[0] as ProjectField;
    return ["data", "materialList", "prepSheet", "workcardAssignment", "standalonePrepSheet", "ganttPrep", "meta"].includes(f) ? f : null;
  }
  /** 物品行编辑门：工具/航材清单任一行仍在编辑会话中（含新增行未失焦/输入中）→ true。
   *  此时整字段远端推送会携带“编辑到一半的不完整内容”，须等 blur/超时结束会话后再推送。 */
  function isItemRowEditing(): boolean {
    for (const key of editingLocal.keys()) {
      if (key.startsWith("data|item|") || key.startsWith("materialList|item|")) return true;
    }
    return false;
  }
  /** 按项目保存指定顶层字段（不带项目切换的轻量 persist，纯标记 dirty + 450ms 防抖推送）。 */
  function persistFieldOfProject(pid: string, field: ProjectField): void {
    let set = dirtyFields.get(pid);
    if (!set) { set = new Set(); dirtyFields.set(pid, set); }
    set.add(field);
    clearTimeout(saveTimer);
    if (cloud.available) saveTimer = setTimeout(saveRemote, 450);
  }
  /** focus：登记正在编辑的输入框。key = "session|field|entity|subField…"（field 置于第 2 段便于保存映射）。 */
  function beginEdit(key: string): void {
    if (!key) return;
    editingLocal.set(key, Date.now());
    editingWindowUntil = Date.now() + EDITING_GRACE_MS;
    void reportEditingHeartbeat();
  }
  /** 输入中刷新活动时间（超时判定用）+ 顺延免并发窗口。 */
  function touchEdit(key: string): void {
    const ts = editingLocal.get(key);
    if (ts !== undefined) {
      editingLocal.set(key, Date.now());
      editingWindowUntil = Date.now() + EDITING_GRACE_MS;
    }
  }
  /** 收集指定项目下全部编辑会话涉及字段并保存落盘（供项目切换/关页前调用）。 */
  function flushEditingProject(pid: string): void {
    if (!editingLocal.size) return;
    const fields = new Set<ProjectField>();
    for (const key of editingLocal.keys()) {
      const f = fieldOfEditKey(key);
      if (f) fields.add(f);
    }
    editingLocal.clear();
    if (fields.size && syncSettings.autoSaveOnEnd) {
      for (const f of fields) persistFieldOfProject(pid, f);
    }
  }
  /** blur/终止：保存当前输入框所在字段并释放该输入框的编辑会话。 */
  function endEdit(key: string): void {
    if (!editingLocal.has(key)) return;
    editingLocal.delete(key);
    const pid = currentProjectId.value;
    const f = fieldOfEditKey(key);
    if (pid && f && syncSettings.autoSaveOnEnd) persistFieldOfProject(pid, f);
    void reportEditingHeartbeat();
  }
  /** 切项目 / 关页：终止当前项目全部编辑会话（保存并释放）。 */
  function endAllEditing(): void {
    const pid = currentProjectId.value;
    if (!pid || !editingLocal.size) return;
    flushEditingProject(pid);
    lastReportedSnapshot = ""; // 强制上报空快照 → 释放
    void reportEditingHeartbeat(pid, true);
  }
  /** 他人是否正在编辑该 key（UI 用于 disabled + 亮黄）。 */
  function isLockedByOther(key: string): boolean { return editingByOthers.has(key); }
  function lockOwnerOf(key: string): string { return editingByOthers.get(key) || ""; }
  /** 本端是否正在编辑该 key（含正在输入/刚聚焦未 blur）。用于防“他人锁把正在输入的框强踢”。 */
  function isEditingHere(key: string): boolean { return editingLocal.has(key); }
  function startEditingSync(): void {
    if (editingTimer) return;
    editingTimer = setInterval(() => {
      // 1) 会话超时：超过 timeoutMs 未活动 → 自动保存该字段并脱离编辑（设置项②，未断网也生效）。
      const timeoutMs = syncSettings.sessionTimeoutMs;
      const now = Date.now();
      const expired: string[] = [];
      for (const [key, ts] of editingLocal) if (now - ts > timeoutMs) expired.push(key);
      if (expired.length) {
        const pid = currentProjectId.value;
        const fields = new Set<ProjectField>();
        for (const key of expired) { editingLocal.delete(key); const f = fieldOfEditKey(key); if (f) fields.add(f); }
        if (pid && fields.size && syncSettings.autoSaveOnEnd) {
          for (const f of fields) persistFieldOfProject(pid, f);
          notify("编辑会话超时，已自动保存并脱离编辑状态");
        }
        lastReportedSnapshot = "";
        if (pid) void reportEditingHeartbeat(pid, true);
      }
      // 2) 编辑保活续期：每 ~12s 上报一次当前快照（后端 TTL 60s，连续编辑不丢锁）。
      if (editingLocal.size) {
        if (!editingKeepalive) {
          editingKeepalive = setInterval(() => { void reportEditingHeartbeat(undefined, true); }, 12000);
        }
      } else if (editingKeepalive) {
        clearInterval(editingKeepalive);
        editingKeepalive = undefined;
      }
    }, 3000);
    // 3) 他人编辑态拉取：独立 1s 前台定时器（黄锁实时性；后台标签页已 endAllEditing，跳过省流量）。
    setInterval(() => { void fetchEditingOthers(); }, 1000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { endAllEditing(); flushPersist(); } });
    window.addEventListener("beforeunload", () => { endAllEditing(); flushPersist(); });
    if (!pidWatchStopper) {
      pidWatchStopper = watch(currentProjectId, (next, prev) => {
        if (prev && next !== prev && editingLocal.size) {
          flushEditingProject(prev);
          editingLocal.clear();
          lastReportedSnapshot = "";
          void reportEditingHeartbeat(prev, true); // 用旧项目 pid 释放
        }
        lockVersion.value += 1;
      });
    }
  }
  // —— 网站同时在线人数（账号胶囊黄色徽标）：每 60s 身份心跳保活 last_seen + 拉取 online-count（后端按 5 分钟窗口统计）——
  const onlineCount = ref(0);
  let onlineTimer: ReturnType<typeof setInterval> | undefined;
  async function pingOnline(): Promise<void> {
    if (identityName.value.trim()) {
      try { await backend.recordIdentity(identityName.value.trim()); } catch { /* 心跳失败忽略 */ }
    }
    try {
      const res = await backend.onlineCount();
      onlineCount.value = Number((res.data as { count?: number } | undefined)?.count) || 0;
    } catch { /* 计数失败忽略，保留上次值 */ }
  }
  function startOnlinePing(): void {
    if (onlineTimer) return;
    onlineTimer = setInterval(() => { void pingOnline(); }, 60000);
    void pingOnline();
  }

  // —— 更新机型标准库弹窗（机号+FSN+MSN+发动机+机型+ETOPS+ELT-DT 全必填，确认后更新/补充标准库）——
  const aircraftUpdate = ref<AircraftInfoPayload | null>(null);

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
  /** 从工作准备单的"机型"字段推断机型：含 320/321 → A320，含 787 → B787，无数据 → null（"无"，禁止跨机型标准库引用）。
   *  单独项目从单项准备单的机型字段推断。 */
  const aircraftTypeFromPrep = computed<AircraftType | null>(() => {
    const prep = currentProject.value?.prepSheet?.base?.机型;
    const sp = currentProject.value?.standalonePrepSheet?.base?.机型;
    const raw = String(prep || sp || "").toUpperCase();
    if (raw.includes("787")) return "B787";
    if (raw.includes("320") || raw.includes("321")) return "A320";
    return null;
  });
  /** 生效机型：优先工作准备单/单项准备单机型字段推断；单独项目无机型信息时回退到项目手动选择的机型
   *  （currentProject.aircraftType，单独项目允许在工具/航材清单子页手动指定）。 */
  const effectiveAircraftType = computed<AircraftType | null>(() => {
    const inferred = aircraftTypeFromPrep.value;
    if (inferred) return inferred;
    const p = currentProject.value;
    if (p && p.type === "单独项目" && AIRCRAFT_TYPES.includes(p.aircraftType)) return p.aircraftType;
    return null;
  });
  /** “添加部位”下拉里可选择的“来自标准数据库”的部位列表（当前机型的全部标准部位）。 */
  const standardCategories = computed<string[]>(() => {
    const type = editingLibrary.value ?? effectiveAircraftType.value;
    if (!type) return [];
    return app.value.libraries[type]?.categories || [];
  });
  /** 航材清单当前编辑目标：航材标准库（库模式）或当前项目的航材清单。 */
  const materialActive = computed<ToolState | null>(() => {
    if (editingMaterialLibrary.value) return app.value.materialLibraries[editingMaterialLibrary.value];
    return currentProject.value?.materialList || null;
  });
  /** 航材标准库的部位列表（用于航材清单“添加部位”下拉与标准库替换）。 */
  const standardMaterialCategories = computed<string[]>(() => {
    const type = editingMaterialLibrary.value ?? effectiveAircraftType.value;
    if (!type) return [];
    return app.value.materialLibraries[type]?.categories || [];
  });
  /** 航材清单的部位列表：库模式用航材库自身 categories；项目模式用航材清单自身 categories
   *  （与工具清单解耦，不再共享 data.categories）。项目模式不强制展示默认部位：
   *  仅显示已登记的部位 + 有物品的部位（无数据时不展示默认部位卡片）。 */
  const materialCategories = computed<string[]>(() => {
    if (editingMaterialLibrary.value) return app.value.materialLibraries[editingMaterialLibrary.value]?.categories || [];
    const p = currentProject.value;
    if (!p) return [];
    const base = [...p.materialList.categories];
    // 兜底：物品里出现但未登记的部位也显示（兼容旧数据 / categories 尚未回填）
    for (const it of p.materialList.items) if (it.cat && !base.includes(it.cat)) base.push(it.cat);
    return base;
  });
  const filteredProjects = computed(() => {
    const name = nameQuery.value.trim().toLowerCase();
    const typeSet = new Set(typeFilter.value);
    const teamSet = new Set(teamFilters.value);
    // 执行日期时段：from/to（YYYY-MM-DD），空端不限；执行日期需落在闭区间 [from, to] 内。
    const from = dateFrom.value.trim() ? parseDay(dateFrom.value.trim()) : null;
    const to = dateTo.value.trim() ? parseDay(dateTo.value.trim()) : null;
    return app.value.projects.filter((project) => {
      if (typeSet.size && !typeSet.has(project.type || "")) return false;
      if (teamSet.size && !teamSet.has(project.team)) return false;
      if (name && !project.name.toLowerCase().includes(name)) return false;
      if (!from && !to) return true;
      const ed = parseDay(project.executeDate.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"));
      if (!ed) return false;
      if (from && ed.getTime() < from.getTime()) return false;
      if (to && ed.getTime() > to.getTime()) return false;
      return true;
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

  // —— toast 语义化分级（UI_DESIGN_SPEC §7.2）：guessLevel 内容推断兜底 ——
  // 仅作兜底——新代码一律显式传 level，或用 notifyOk / notifyErr。
  const ERR_HINT = /失败|错误|异常|无法|不能|超时|中断|已存在|不存在|请勿|缺少|无效|拒/;
  const OK_HINT = /完成|成功|已保存|已复制|已上传|已删除|已同步|已导入|已导出|已添加|已更新/;
  function guessLevel(msg: string): "info" | "ok" | "err" {
    if (ERR_HINT.test(msg)) return "err";
    if (OK_HINT.test(msg)) return "ok";
    return "info";
  }

  function notify(message: string, level?: "info" | "ok" | "err"): void {
    toast.message = message;
    toast.level = level ?? guessLevel(message);
    toast.visible = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.visible = false; }, 2200);
  }
  const notifyOk = (m: string): void => notify(m, "ok");
  const notifyErr = (m: string): void => notify(m, "err");

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

  // —— 本地落盘策略：结构性操作（增删行/导入/导出/保存按钮等）走 persist() 立即落盘；
  //    输入格每键走 queuePersist()：只标脏 + 调度远程保存，localStorage 的全量序列化延迟到
  //    250ms 停顿时才执行一次——打字过程不再每键同步 JSON.stringify(app)+setItem
  //   （app 含全部标准库与项目，MB 级，移动端每键阻塞几十~上百 ms，是机号格等输入卡顿的根源）。
  //   页面 hidden/beforeunload 时 flushPersist() 兜底，保证最后输入的 250ms 内内容不丢。
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  function persistNow(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
  }
  function flushPersist(): void {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = undefined; persistNow(); }
  }
  function scheduleRemoteSave(): void {
    clearTimeout(saveTimer);
    if (cloud.available) saveTimer = setTimeout(() => { void saveRemote(); }, 450);
  }
  function persist(): void {
    persistNow();
    markCurrentDirty();
    scheduleRemoteSave();
  }
  /** 高频编辑路径（输入格/数量步进/拖拽/机号回填）防抖落盘：立即标脏 + 调度远程保存；
   *  localStorage 全量写入（app 为 MB 级，同步 setItem 单次数百 ms~1s）改为【空闲 8s】才写一次，
   *  切后台/关页/刷新由 flushPersist()（visibilitychange hidden / beforeunload）兜底——
   *  编辑与增减数值过程主线程不再被大块同步写阻塞（2026-09-06 二次修复：250ms 停笔后全量写仍会造成 >1s 卡）。 */
  function queuePersist(): void {
    markCurrentDirty();
    scheduleRemoteSave();
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistNow(); }, 8000);
  }

  /** 显式以指定字段标记当前项目为脏并落盘（用于 meta 等非子页字段的变更）。 */
  function persistField(field: ProjectField): void {
    persistNow();
    markCurrentDirty(field);
    scheduleRemoteSave();
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
        const p = error.payload as { current_version?: number; details?: { current_version?: number } } | null;
        const current = typeof p?.current_version === "number"
          ? p.current_version
          : (typeof p?.details?.current_version === "number" ? p.details.current_version : undefined);
        if (typeof current === "number") {
          project.version = current;
          if (isEditingWindow()) {
            // 编辑会话中（输入中 / 无数据写入的编辑状态 120s 内）：静默采纳远端版本、保留本地 dirty，
            // 延后 2.5s 重试——不弹「并发修改」打断输入；窗口结束后的保存自然以新版本成功推送。
            dirtyProjects.add(project.id);
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => { void saveRemote(); }, 2500);
          } else {
            notify("检测到并发修改，将以你的修改为准重新保存");
            dirtyProjects.add(project.id);
          }
        } else {
          // 拿不到远端版本号：拉取最新避免用旧 version 无限重试
          dirtyProjects.add(project.id);
          loadRemote(true, false).catch(() => {});
        }
        return;
      }
      dirtyProjects.add(project.id);
      throw error;
    }
  }

  async function saveRemote(): Promise<void> {
    if (remoteSaving.value) {
      remotePending = true;
      return;
    }
    // 物品行编辑门：清单行仍在编辑（输入中/未失焦）时，保留脏标记并延迟重试，
    // 避免把“编辑到一半的不完整内容/新增空行”推送到远端回传给他人。
    if (isItemRowEditing()) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { void saveRemote(); }, 600);
      return;
    }
    remoteSaving.value = true;
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
      remoteSaving.value = false;
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
    // 模板编辑临时项目：关闭子页即删除记录（无需保存），云端 best-effort 同步删除
    const tplId = editingTemplateProjectId.value;
    if (tplId && currentProjectId.value === tplId) {
      editingTemplateProjectId.value = null;
      const p = app.value.projects.find((x) => x.id === tplId);
      if (p) {
        app.value.projects = app.value.projects.filter((x) => x.id !== tplId);
        if (cloud.available) {
          backend.deleteProject(tplId).catch(() => { /* best-effort */ });
        }
        persist();
      }
    }
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

  /** 校验 AIRNAV 密码并拉取登录过的账号目录（网站管理卡片用）。返回账号列表，失败/密码错返回 null。 */
  async function unlockSiteAdmin(password: string): Promise<Array<{ name: string; first_seen: string; last_seen: string; login_count: number }> | null> {
    try {
      const res = await backend.verifyAirnav(password);
      if (!res.verified || !res.token) return null;
      airnavToken = res.token;
      sessionStorage.setItem(AIRNAV_TOKEN_KEY, airnavToken);
      const accountsRes = await backend.listAccounts(res.token);
      return Array.isArray(accountsRes.data) ? accountsRes.data : [];
    } catch {
      return null;
    }
  }

  /** 设置无密码身份（姓名 2-5 字符）：写 localStorage + 后端记录登录账号目录。返回是否成功。 */
  async function setIdentity(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 5) {
      notify("姓名需为 2-5 个字符");
      return false;
    }
    identityName.value = trimmed;
    localStorage.setItem(IDENTITY_KEY, trimmed);
    if (cloud.available) {
      try {
        await backend.recordIdentity(trimmed);
      } catch {
        // 后端记录失败不阻塞本地身份（离线/后端不可用时仍可用）
      }
    }
    void pingOnline(); // 设置身份后立即心跳并刷新在线人数
    notify(`已登录：${trimmed}`);
    return true;
  }

  async function createProject(name: string, aircraftType: AircraftType = "A320", projectType: ProjectType | "" = "", executeDate = "", team = ""): Promise<void> {
    const project: Project = {
      id: globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      createdAt: Date.now(),
      executeDate,
      aircraftType,
      team,
      type: (PROJECT_TYPES as readonly string[]).includes(projectType) ? projectType : "",
      // 机型未确定（工作准备单「机型」字段为空）时不引用任何标准库内容，data 从空开始；
      // 填好机型后由 aircraftTypeFromPrep 推断 → setAircraftType 切换到对应机型标准库。
      data: normalizeState(),
      prepSheet: defaultPrepSheet(),
      workcardAssignment: defaultWorkcardAssignment(),
      standalonePrepSheet: defaultStandalonePrepSheet(),
      materialList: normalizeState(),
      ganttPrep: defaultGanttPrep(),
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
    const previous = currentProject.value.aircraftType;
    currentProject.value.aircraftType = type;
    // 机型改变：非单独项目先自动清空工具/航材清单数据（旧机型数据失效），再按新机型重新匹配
    // （机号回填 / 工卡导入 / 标准库引用均指向新机型）。
    // 单独项目工具/航材清单为用户自建部位，不随机型清空；仅同步工具/航材清单的机型标记（两子页同步）。
    if (currentProject.value.type !== "单独项目") {
      currentProject.value.data = normalizeState({ aircraftType: type });
      currentProject.value.materialList = normalizeState({ aircraftType: type });
    } else {
      currentProject.value.data.aircraftType = type;
      currentProject.value.materialList.aircraftType = type;
    }
    // 同时影响 meta / data / materialList 三个字段
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
    markField("meta");
    markField("data");
    markField("materialList");
    clearTimeout(saveTimer);
    if (cloud.available) saveTimer = setTimeout(saveRemote, 450);
    // 机型切换提示：非单独项目会清空工具/航材清单，需明确告知；单独项目仅同步机型标记。
    if (previous !== type) {
      if (currentProject.value.type === "单独项目") {
        notify(`机型已切换为 ${type}`);
      } else {
        notify(`机型已由 ${previous} 切换为 ${type}，工具/航材清单已清空`);
      }
    }
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
    const type: AircraftType | null = editingLibrary.value ?? effectiveAircraftType.value;
    if (!type) return null;
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
    const aircraftType = editingLibrary.value ?? effectiveAircraftType.value;
    if (!aircraftType) return;
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
    const type = editingLibrary.value ?? effectiveAircraftType.value;
    const lib = type ? app.value.libraries[type] : null;
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
    const newItem = { id: nextId++, uid: genUid(), cat, sub, name: "新物品", qty: 1 };
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
    const type = effectiveAircraftType.value;
    const sourceItems = type ? app.value.libraries[type].items.filter((item) => item.cat === sourceCat && item.sub === sourceSub) : [];
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
    const item = { id: nextId++, uid: genUid(), cat, sub, name: "新物品", qty: 1 };
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

  /** 清空当前项目的所有数据（工具清单 + 工作准备单 + 工卡分配清单 + 单项准备单 + 航材清单 + 换发/APU 甘特准备单与模板引用）。 */
  function clearProjectAllData(): void {
    const project = currentProject.value;
    if (!project) return;
    project.data = normalizeState();
    project.prepSheet = defaultPrepSheet();
    project.workcardAssignment = defaultWorkcardAssignment();
    project.standalonePrepSheet = defaultStandalonePrepSheet();
    project.materialList = normalizeState();
    project.ganttPrep = defaultGanttPrep();
    // 显式标记所有字段为脏：persist() 默认只标当前子页 editingField，会漏标其它字段，
    // 导致清空后其它字段未推送、被 loadRemote 用远端旧数据覆盖回（数据残留的根因）。
    markField("data");
    markField("prepSheet");
    markField("workcardAssignment");
    markField("standalonePrepSheet");
    markField("materialList");
    markField("ganttPrep");
    persist();
  }

  /** 清空工具清单（保留机型标记）并立即同步后端。 */
  async function clearToolListNow(): Promise<void> {
    const project = currentProject.value;
    if (!project) return;
    project.data = normalizeState({ aircraftType: project.aircraftType });
    markField("data");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
    clearTimeout(saveTimer);
    if (cloud.available) {
      try { await saveRemote(); } catch { /* saveRemote 内部已 notify */ }
    }
  }

  /** 清空航材清单（保留机型标记）并立即同步后端。 */
  async function clearMaterialListNow(): Promise<void> {
    const project = currentProject.value;
    if (!project) return;
    project.materialList = normalizeState({ aircraftType: project.aircraftType });
    markField("materialList");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
    clearTimeout(saveTimer);
    if (cloud.available) {
      try { await saveRemote(); } catch { /* saveRemote 内部已 notify */ }
    }
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
    const type = editingMaterialLibrary.value ?? effectiveAircraftType.value;
    if (!type) return;
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
    const type = editingMaterialLibrary.value ?? effectiveAircraftType.value;
    const lib = type ? app.value.materialLibraries[type] : null;
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
    state.items.push({ id: nextId++, uid: genUid(), cat, sub: `新类型${subs.length + 1}`, name: "", qty: 1, partNo: "" });
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
  function mAddItem(cat: string, sub: string, prepend = false): void {
    const state = requireMaterial();
    if (!state) return;
    const item = { id: nextId++, uid: genUid(), cat, sub, name: "", qty: 1, partNo: "" };
    // prepend=true 插入首项：新增类型卡按“首次出现顺序”自然显示在清单顶端
    if (prepend) state.items.unshift(item);
    else state.items.push(item);
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
    const type = editingMaterialLibrary.value ?? effectiveAircraftType.value;
    const lib = type ? app.value.materialLibraries[type] : null;
    return lib ? [...new Set(lib.items.map((it) => `${it.cat}||${it.sub}`))] : [];
  });
  /** 从航材标准库导入某类型到当前 (cat,sub)。 */
  function mImportStandardSub(cat: string, currentSub: string, key: string): void {
    const state = requireMaterial();
    if (!state || !key) return;
    const type = editingMaterialLibrary.value ?? effectiveAircraftType.value;
    const [sourceCat, sourceSub] = key.split("||");
    const source = type ? app.value.materialLibraries[type].items.filter((it) => it.cat === sourceCat && it.sub === sourceSub) : [];
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
    const type: AircraftType | null = editingMaterialLibrary.value ?? effectiveAircraftType.value;
    if (!type) return null;
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
  /** 在某工序组（gi）下方插入一个新的工序组（不含行 id 由 emptyProcessRow 分配）。 */
  function spInsertProcessGroup(gi: number): void {
    const p = currentProject.value; if (!p) return;
    const groups = p.standalonePrepSheet.processGroups;
    if (!Array.isArray(groups) || gi < 0 || gi >= groups.length) return;
    groups.splice(gi + 1, 0, { id: nextId++, name: `工序组 ${gi + 2}`, rows: [emptyProcessRow(), emptyProcessRow(), emptyProcessRow()] });
    markCurrentDirty(); persist();
  }
  /** 导入替换整份工序安排（数据不含 id，由 emptyProcessRow 重建行 id）。 */
  function spReplaceProcessGroups(data: Array<{ name: string; rows: Array<{ 工作步骤: string; 人员安排: string; "检测&必检": string; 备注: string }> }>): void {
    const p = currentProject.value; if (!p) return;
    p.standalonePrepSheet.processGroups = data.map((d, i) => ({
      id: nextId++,
      name: String(d.name || "").trim() || `工序组 ${i + 1}`,
      rows: (Array.isArray(d.rows) ? d.rows : []).map((r) => ({
        ...emptyProcessRow(),
        工作步骤: String(r?.工作步骤 ?? ""), 人员安排: String(r?.人员安排 ?? ""),
        "检测&必检": String(r?.["检测&必检"] ?? ""), 备注: String(r?.备注 ?? ""),
      })),
    }));
    markCurrentDirty(); persist();
  }
  /** 导入替换工卡签署安排（行 id 重建）。 */
  function spReplaceSigningRows(data: Array<{ 手册号: string; 工卡名: string; 签署人: string }>): void {
    const p = currentProject.value; if (!p) return;
    p.standalonePrepSheet.signingRows = (Array.isArray(data) ? data : []).map((r) => ({
      ...emptySigningRow(), 手册号: String(r?.手册号 ?? ""), 工卡名: String(r?.工卡名 ?? ""), 签署人: String(r?.签署人 ?? ""),
    }));
    markCurrentDirty(); persist();
  }
  function spRemoveProcessRow(groupIdx: number, rowId: number): void { const p = currentProject.value; if (!p) return; const g = p.standalonePrepSheet.processGroups[groupIdx]; if (!g) return; g.rows = g.rows.filter((r) => r.id !== rowId); markCurrentDirty(); persist(); }
  /** 工序组内行拖拽排序：把 rowId 行移动到 targetIndex 位置（拖拽落点，越界自动收敛）。 */
  function spMoveProcessRow(groupIdx: number, rowId: number, targetIndex: number): void {
    const p = currentProject.value; if (!p) return;
    const g = p.standalonePrepSheet.processGroups[groupIdx]; if (!g) return;
    const from = g.rows.findIndex((r) => r.id === rowId);
    if (from < 0) return;
    const rows = g.rows.slice();
    const [row] = rows.splice(from, 1);
    const to = Math.min(Math.max(targetIndex, 0), rows.length);
    rows.splice(to, 0, row);
    g.rows = rows;
    markCurrentDirty(); persist();
  }
  function spAddSigningRow(): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.signingRows.push(emptySigningRow()); markCurrentDirty(); persist(); }
  function spRemoveSigningRow(id: number): void { const p = currentProject.value; if (!p) return; p.standalonePrepSheet.signingRows = p.standalonePrepSheet.signingRows.filter((r) => r.id !== id); markCurrentDirty(); persist(); }
  /** 单项准备单机号变更 → 从飞机信息标准库回填 FSN/MSN/发动机/机型/ETOPS/ELT-DT（本地查不到时走公开接口兜底，无需 AIRNAV 授权）。 */
  async function spOnAircraftChange(): Promise<void> {
    const p = currentProject.value; if (!p) return;
    const raw = p.standalonePrepSheet.base.机号.trim(); if (!raw) return;
    const target = normalizeAircraftReg(raw);
    if (!target) return;
    p.standalonePrepSheet.base.机号 = target;
    const match = await fetchAircraftInfo(target);
    const b = p.standalonePrepSheet.base;
    if (match) {
      b.FSN = String(match["FSN"] || ""); b.MSN = String(match["MSN"] || ""); b.机型 = String(match["机型"] || "");
      b.发动机 = String(match["发动机"] || ""); b.ETOPS = String(match["ETOPS"] || ""); b["ELT-DT"] = String(match["ELT-DT"] || "");
    }
    maybePromptAircraftUpdate(b);
    queuePersist();
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
    queuePersist();
  }

  /** 把已分配工卡在分组之间移动。目标为标准部位 → 同步标准库部位；目标为临时分组 → 仅存本项目不写库。 */
  function moveCard(from: string, index: number, to: string): void {
    const a = currentProject.value?.workcardAssignment;
    if (!a || from === to) return;
    const [card] = a.sections[from].cards.splice(index, 1);
    if (!card) return;
    if (!a.sections[to]) a.sections[to] = { personnel: {}, cards: [], extra: [] }; // 目标分组若曾被删除则重建
    if (isStdWorkcardSection(to)) {
      // 移动到标准部位时重置子部位为目标部位默认值（AV CB → "AV"）并同步回标准库
      card.部位 = AREA_BY_SECTION[to as WorkcardSection];
      upsertWorkcardStdLib(card.工卡号, card.工卡名称, AREA_BY_SECTION[to as WorkcardSection], card.工卡分级);
    } else {
      // 临时分组：不写标准库
      card.部位 = to;
    }
    a.sections[to].cards.push(card);
    queuePersist();
  }

  /** 把「未分配部位」工卡指定分组后插入。目标为标准部位 → 写入工卡分配标准库；临时分组 → 不写库。 */
  function moveUnassignedToSection(index: number, to: string): void {
    const a = currentProject.value?.workcardAssignment;
    if (!a) return;
    const [card] = a.unassigned.splice(index, 1);
    if (!card) return;
    if (!a.sections[to]) a.sections[to] = { personnel: {}, cards: [], extra: [] };
    if (isStdWorkcardSection(to)) {
      card.部位 = AREA_BY_SECTION[to as WorkcardSection];
      upsertWorkcardStdLib(card.工卡号, card.工卡名称, AREA_BY_SECTION[to as WorkcardSection], card.工卡分级);
    } else {
      card.部位 = to;
    }
    a.sections[to].cards.push(card);
    queuePersist();
  }

  /** 删除「未分配部位」中的某条工卡。 */
  function deleteUnassigned(index: number): void {
    const a = currentProject.value?.workcardAssignment;
    if (!a) return;
    a.unassigned.splice(index, 1);
    queuePersist();
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

  /** 按机号查询飞机信息（FSN/MSN/机型/发动机/ETOPS/ELT-DT），供机号回填展示。
   *  优先查本地标准库（已随 loadRemote 全量公开拉取常驻，2026-09-06 放开读取）；
   *  本地查不到时走公开单机信息接口（/api/aircraft-info/，免授权）兜底，
   *  并把结果合并进本地缓存（只读展示，不标脏）。 */
  /** 机号信息查询去重：同机号 60s TTL 结果缓存（含“查无”）+ in-flight 合并，
   *  消除同一机号重复失焦/重复 change 导致的重复 /api/aircraft-info/ 请求。 */
  const aircraftInfoCache = new Map<string, { at: number; row: StandardLibRow | null }>();
  const aircraftInfoInflight = new Map<string, Promise<StandardLibRow | null>>();
  const AIRCRAFT_INFO_CACHE_TTL = 60_000;
  async function fetchAircraftInfo(regNo: string): Promise<StandardLibRow | null> {
    const target = (regNo || "").trim();
    if (!target) return null;
    const local = lookupAircraftRow(target);
    if (local) return local;
    const hit = aircraftInfoCache.get(target);
    if (hit && Date.now() - hit.at < AIRCRAFT_INFO_CACHE_TTL) return hit.row;
    if (!cloud.available) return null;
    const inflight = aircraftInfoInflight.get(target);
    if (inflight) return inflight;
    const task = (async (): Promise<StandardLibRow | null> => {
      try {
        const res = await backend.getAircraftInfo(target);
        const row = res?.data as StandardLibRow | null | undefined;
        if (row && String(row["飞机号"] || "").trim() === target) {
          const rows = app.value.standardLibraries.aircraft_info?.rows;
          if (rows && !rows.some((r) => String(r["飞机号"] || "").trim() === target)) {
            rows.push({ ...row });
          }
          aircraftInfoCache.set(target, { at: Date.now(), row });
          return row;
        }
        aircraftInfoCache.set(target, { at: Date.now(), row: null });
      } catch {
        // 忽略网络/接口错误，回退到"新增空行"逻辑；缓存 60s 防连点重复请求
        aircraftInfoCache.set(target, { at: Date.now(), row: null });
      }
      return null;
    })();
    aircraftInfoInflight.set(target, task);
    try {
      return await task;
    } finally {
      aircraftInfoInflight.delete(target);
    }
  }

  /** 机号规范化：支持 B-XXXX（6 字符）或 XXXX（4 字符，自动补 B- 前缀）。非法返回空串。 */
  function normalizeAircraftReg(input: string): string {
    const s = (input || "").trim().toUpperCase();
    if (/^B-[A-Z0-9]{4}$/.test(s)) return s;
    if (/^[A-Z0-9]{4}$/.test(s)) return `B-${s}`;
    return "";
  }

  /** 打开/关闭「更新机型标准库」弹窗。 */
  function openAircraftUpdate(data: AircraftInfoPayload): void { aircraftUpdate.value = { ...data }; }
  function closeAircraftUpdate(): void { aircraftUpdate.value = null; }

  /** 机号输入后检测：标准库中索引不到该机号 → 弹「更新机型标准库」（新增场景，代入已输入/回传数据）。 */
  function maybePromptAircraftUpdate(base: AircraftInfoPayload): void {
    const reg = normalizeAircraftReg(base.机号);
    if (!reg) return;
    if (lookupAircraftRow(reg)) return;
    openAircraftUpdate({ 机号: reg, FSN: base.FSN, MSN: base.MSN, 机型: base.机型, 发动机: base.发动机, ETOPS: base.ETOPS, "ELT-DT": base["ELT-DT"] });
  }

  /** 机型字段（FSN/MSN/机型/发动机/ETOPS/ELT-DT）编辑后检测：机号在库中且任一字段与库中不同 → 弹「更新机型标准库」（更新场景）。 */
  function maybePromptAircraftDiff(base: AircraftInfoPayload): void {
    const reg = normalizeAircraftReg(base.机号);
    if (!reg) return;
    const existing = lookupAircraftRow(reg);
    if (!existing) return;
    const fields: Array<"FSN" | "MSN" | "机型" | "发动机" | "ETOPS" | "ELT-DT"> = ["FSN", "MSN", "机型", "发动机", "ETOPS", "ELT-DT"];
    const diff = fields.some((k) => String(existing[k] || "").trim() !== String(base[k] || "").trim());
    if (diff) {
      openAircraftUpdate({ 机号: reg, FSN: base.FSN, MSN: base.MSN, 机型: base.机型, 发动机: base.发动机, ETOPS: base.ETOPS, "ELT-DT": base["ELT-DT"] });
    }
  }

  /** 保存机型数据到标准库（弹窗确认后）：校验全字段非空 → 后端 upsert → 本地更新 → 关闭弹窗。 */
  async function saveAircraftToLib(data: AircraftInfoPayload): Promise<boolean> {
    const keys: Array<keyof AircraftInfoPayload> = ["机号", "FSN", "MSN", "发动机", "机型", "ETOPS", "ELT-DT"];
    for (const k of keys) {
      if (!String(data[k] ?? "").trim()) { notify(`请填写「${k}」`); return false; }
    }
    const reg = normalizeAircraftReg(data.机号);
    if (!reg) { notify("机号格式应为 B-XXXX（或 XXXX）"); return false; }
    const row: StandardLibRow = { 飞机号: reg, FSN: String(data.FSN), MSN: String(data.MSN), 机型: String(data.机型), 发动机: String(data.发动机), ETOPS: String(data.ETOPS), "ELT-DT": String(data["ELT-DT"]) };
    if (cloud.available) {
      try {
        await backend.addAircraftInfo(row);
      } catch (error) {
        notify(errorMessage(error, "更新机型标准库失败"));
        return false;
      }
    }
    const existing = lookupAircraftRow(reg);
    if (existing) {
      for (const k of keys) existing[k] = String(data[k] ?? "");
    } else {
      const cols = STANDARD_LIB_META.aircraft_info.rowKeys;
      const newRow: StandardLibRow = {};
      for (const col of cols) newRow[col] = "";
      for (const k of keys) newRow[k] = String(data[k] ?? "");
      newRow["飞机号"] = reg;
      app.value.standardLibraries.aircraft_info.rows.push(newRow);
    }
    // 回填到当前项目表单（工作准备单/单项准备单）的 base 字段，使表单立即显示保存的机型数据
    const p = currentProject.value;
    if (p) {
      const fillBase = (base?: AircraftInfoPayload): void => {
        if (!base) return;
        if (normalizeAircraftReg(base.机号) === reg) {
          base.机号 = reg;
          base.FSN = String(data.FSN);
          base.MSN = String(data.MSN);
          base.机型 = String(data.机型);
          base.发动机 = String(data.发动机);
          base.ETOPS = String(data.ETOPS);
          base["ELT-DT"] = String(data["ELT-DT"]);
        }
      };
      fillBase(p.prepSheet?.base as AircraftInfoPayload | undefined);
      fillBase(p.standalonePrepSheet?.base as AircraftInfoPayload | undefined);
      // 新机号加入机号下拉列表
      if (!aircraftNumberList.value.includes(reg)) aircraftNumberList.value.push(reg);
      persist();
    }
    closeAircraftUpdate();
    notify("机型标准库已更新");
    return true;
  }

  /** 合并两个 ToolState 的物品行（内容键对齐，本地优先）：本地正在编辑的行保留，
   *  远端新增的行并入（分配不冲突的新 id）。 */
  function mergeToolStateRows(local: ToolState, remote: ToolState): ToolState {
    const merged = [...local.items];
    /** 行指纹：排除名称/件号等“键字段”后的身份（部位+类型+件号+数量），改名/改件号不应变成新行。 */
    const sameFingerprint = (l: ToolItem, r: ToolItem): boolean =>
      (l.cat || "") === (r.cat || "") && (l.sub || "") === (r.sub || "")
      && String(l.partNo || "") === String(r.partNo || "")
      && (Number(l.qty) || 0) === (Number(r.qty) || 0);
    /** 远端草稿行（空行 / 新增占位“新物品”）：不并入，避免“编辑到一半的新增卡片”回传本地。 */
    const isDraftRow = (it: ToolItem): boolean => {
      const name = String(it.name || "").trim();
      const partNo = String(it.partNo || "").trim();
      if (!name && !partNo && (Number(it.qty) || 0) <= 0) return true;
      if (name === "新物品" && !partNo && (Number(it.qty) || 0) === 1) return true;
      return false;
    };
    const localKeys = new Set(local.items.map((it) => itemKey(it)));
    let updatedCount = 0;
    const remoteOnly: ToolItem[] = [];
    // 本端有行正在编辑（输入中）时：不采纳远端“同名/孪生行”更新，避免打断输入；新行仍并入。
    const editingActive = isItemRowEditing();
    for (const r of remote.items) {
      if (localKeys.has(itemKey(r))) continue; // 同内容键已存在：本地优先（note 由下方字段级处理）
      if (isDraftRow(r)) continue;
      if (!editingActive) {
        // 同一行（持久 uid 相等 或 指纹+备注一致）的“改名/更新”：同步远端值，不新增复制行
        const twin = merged.find((l) => (Boolean(r.uid && l.uid) ? l.uid === r.uid : false)
          || (sameFingerprint(l, r) && (l.note || "") === (r.note || "")));
        if (twin) {
          twin.name = r.name;
          twin.qty = r.qty;
          if (r.partNo !== undefined) twin.partNo = r.partNo;
          if (!noteDirtyKeys.has(itemKey(twin))) twin.note = r.note || "";
          if (!twin.uid && r.uid) twin.uid = r.uid; // 本地旧数据补 uid，此后身份稳定
          updatedCount += 1;
          continue;
        }
      }
      remoteOnly.push(r);
    }
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
    if (remoteOnly.length === 0 && !noteChanged && updatedCount === 0) return local;
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
    // 合并键 = 本地现有分组（标准部位在前保持顺序；本地已删除的标准键不复活）+ 远端新增的临时分组。
    const localKeys = Object.keys(local.sections);
    const remoteKeys = Object.keys(remote.sections);
    const keyOrder = [
      ...WORKCARD_SECTIONS.filter((k) => localKeys.includes(k)),
      ...localKeys.filter((k) => !isStdWorkcardSection(k)),
      ...remoteKeys.filter((k) => !isStdWorkcardSection(k) && !(k in local.sections)),
    ];
    for (const section of keyOrder) {
      const ls = local.sections[section];
      const rs = remote.sections[section];
      if (!ls) { merged.sections[section] = deepCopy(rs); continue; }
      if (!rs) { merged.sections[section] = deepCopy(ls); continue; }
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

  /** 换发/APU 甘特准备单行级合并：本地编辑优先（本地 chart/card/part 全保留），远端新增的行（本地无对应 id）并入，
   *  避免两人改不同 DAY（chart）时后保存者整体覆盖前者。docs/meta/manualParticipants 无稳定行 id，保持本地优先。 */
  function mergeGanttPrep(local: GanttPrepState, remote: GanttPrepState, localDirty: boolean): GanttPrepState {
    if (!localDirty) return remote;
    const mergeById = <T extends { id: string }>(l: T[], r: T[]): T[] => {
      const ids = new Set(l.map((x) => x.id));
      const merged = [...l];
      for (const item of r) if (!ids.has(item.id)) merged.push(deepCopy(item));
      return merged;
    };
    const localChartIds = new Set(local.charts.map((c) => c.id));
    const charts = local.charts.map((lc) => {
      const rc = remote.charts.find((c) => c.id === lc.id);
      if (!rc) return lc;
      return { ...lc, cards: mergeById(lc.cards, rc.cards), parts: mergeById(lc.parts, rc.parts) };
    });
    for (const rc of remote.charts) if (!localChartIds.has(rc.id)) charts.push(deepCopy(rc));
    return {
      ...local,
      charts,
      airParts: mergeById(local.airParts, remote.airParts),
      toolParts: mergeById(local.toolParts, remote.toolParts),
      spArrangements: mergeById(local.spArrangements || [], remote.spArrangements || []),
    };
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
      ganttPrep: mergeGanttPrep(local.ganttPrep, remote.ganttPrep, dirty("ganttPrep")),
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
        // 飞机信息读取已放开为公开（2026-09-06，后端 GET 不再要求 AIRNAV token）：
        // 无条件全量拉取到本地，机号回填/下拉全部本地命中，输入框不依赖逐机号网络单查。
        backend.getStandardLibrary("aircraft_info").catch(() => null),
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
      } else {
        // 拉取失败/为空时保留本地已有的飞机信息（不因单次网络失败而清空）。
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
    if (pollingPaused || syncing.value || remoteSaving.value) { scheduleNextPoll(); return; }
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
    // 短轮询间隔可配（系统设置·轮询频率，默认 2s）；后台标签页自动放宽到 10s 省调用。
    const base = document.hidden ? 10000 : syncSettings.pollMs;
    const interval = Math.max(500, Math.min(base, 20000));
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
    if (seq && seq !== lastRevision && !syncing.value && !remoteSaving.value) {
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

  /** 换发/APU 甘特准备单：标记 ganttPrep 字段脏并落盘（供 GanttPrep.vue 编辑后保存）。 */
  function saveGantt(): void {
    markField("ganttPrep");
    persist();
  }
  /** GanttPrep 输入格的防抖落盘版（saveGantt 语义，localStorage 250ms 合并）。 */
  function queueSaveGantt(): void {
    markField("ganttPrep");
    queuePersist();
  }

  /** 把模板 state 灌入当前项目的 ganttPrep（深拷贝，避免与模板库共享引用）。
   *  name 为模板名，灌入后作为「当前模板名称」显示在标题行（可编辑）。 */
  function applyGanttTemplate(state: GanttPrepState, name = ""): void {
    const project = currentProject.value;
    if (!project) return;
    project.ganttPrep = deepCopy(state);
    project.ganttPrep.currentTemplateName = name || state.currentTemplateName || "";
    saveGantt();
  }

  /** 模板库入口：新建「换发/APU」项目预载模板内容。mode="edit" 打开模板编辑页（改完「保存模板 → 覆盖」写回）；
   *  mode="apply" 用模板创建实际项目（不挂模板名，避免误覆盖）。 */
  async function openEngTemplateForEdit(name: string, state: GanttPrepState, mode: "edit" | "apply" = "edit"): Promise<void> {
    await createProject(name, "A320", "换发/APU");
    const project = currentProject.value;
    if (!project) return;
    // mode="edit"：临时项目记录，关闭子页（backToList）自动删除、不保存
    editingTemplateProjectId.value = mode === "edit" ? project.id : null;
    project.ganttPrep = deepCopy(state);
    project.ganttPrep.currentTemplateName = mode === "edit" ? name : "";
    markField("ganttPrep");
    persist();
    notify(mode === "edit"
      ? `已打开模板编辑页「${name}」，修改后点「保存模板 → 覆盖」写回模板`
      : `已用模板「${name}」创建项目，请完善内容`);
  }

  /** 模板库入口：新建单独项目预载模板内容（准备单 + 航材清单 + 工具清单）。
   *  mode="edit" 打开模板编辑页（改完「保存模板 → 覆盖」写回）；mode="apply" 用模板创建实际项目。 */
  async function openStandaloneTemplateForEdit(name: string, state: StandaloneTemplateState, mode: "edit" | "apply" = "edit"): Promise<void> {
    await createProject(name, "A320", "单独项目");
    const project = currentProject.value;
    if (!project) return;
    // mode="edit"：临时项目记录，关闭子页（backToList）自动删除、不保存
    editingTemplateProjectId.value = mode === "edit" ? project.id : null;
    const prep = deepCopy(state.prep) as StandalonePrepSheet;
    prep.title = name; // 模板编辑/引用：标题直接用模板名称
    project.standalonePrepSheet = prep;
    markField("standalonePrepSheet");
    if (state.material) { project.materialList = deepCopy(state.material) as ToolState; markField("materialList"); }
    if (state.tools) { project.data = deepCopy(state.tools) as ToolState; markField("data"); }
    persist();
    notify(mode === "edit"
      ? `已打开模板编辑页「${name}」，修改后点「保存模板 → 覆盖」写回模板`
      : `已用模板「${name}」创建项目，请填写基础信息并完善内容`);
  }

  /** 模板脱敏：清空所有含人名的字段（人员安排/必检/签署人等），只保留业务内容（工序/部件/工作等）。
   *  深拷贝后原地清空，避免污染原项目数据。 */
  function stripNamesFromStandalone(s: StandalonePrepSheet): StandalonePrepSheet {
    const copy = deepCopy(s) as StandalonePrepSheet;
    const personKeys = [
      "项目负责人", "值班组", "主卡签署", "必检", "参与人员", "工具负责", "工具参与",
      "航材负责", "航材参与", "工卡负责", "工卡打印", "试车人员", "报工/完工反馈", "运输跟踪", "飞机监护",
    ] as const;
    for (const k of personKeys) (copy.personnel as unknown as Record<string, string>)[k] = "";
    if (Array.isArray(copy.personnel.extra)) copy.personnel.extra.forEach((e) => { e.人员 = ""; });
    copy.processGroups?.forEach((g) => g.rows?.forEach((r) => { r.人员安排 = ""; r["检测&必检"] = ""; }));
    copy.signingRows?.forEach((r) => { r.签署人 = ""; });
    return copy;
  }

  /** 把当前项目的单项工作准备单 + 航材/工具清单保存为「单项工作模板」。
   *  不含 base 基础信息、不含人员姓名；清单为空时置 null（旧模板仅含准备单）。
   *  传 templateId 时覆盖已有模板；返回模板 _id 供后续覆盖保存用。 */
  async function saveStandaloneTemplate(name: string, templateId?: string): Promise<string | null> {
    const p = currentProject.value; if (!p) return null;
    const emptyList = (s?: ToolState | null): boolean => !s || ((s.categories?.length ?? 0) === 0 && (s.items?.length ?? 0) === 0);
    const snapshot: StandaloneTemplateState = {
      prep: stripNamesFromStandalone(p.standalonePrepSheet),
      material: emptyList(p.materialList) ? null : deepCopy(p.materialList),
      tools: emptyList(p.data) ? null : deepCopy(p.data),
    };
    snapshot.prep.base = defaultStandalonePrepSheet().base;
    try {
      if (templateId) {
        await backend.updateStandaloneTemplate(templateId, { name, state: snapshot });
        notify(`已覆盖模板：${name}`);
        return templateId;
      }
      const res = await backend.createStandaloneTemplate({ name, state: snapshot });
      const doc = res.data as { _id?: string } | undefined;
      notify(`已保存模板：${name}`);
      return doc?._id ?? null;
    } catch (e) {
      notify(e instanceof Error ? e.message : "模板保存失败");
      return null;
    }
  }

  /** 把「单项工作模板」灌入当前项目：准备单（保留当前 base，标题=模板名称）+ 航材/工具清单整体替换（若模板带清单）。
   *  深拷贝、重算 nextId 防 id 冲突。 */
  function applyStandaloneTemplate(state: StandaloneTemplateState, tplName?: string): void {
    const p = currentProject.value; if (!p) return;
    const prep = deepCopy(state.prep) as StandalonePrepSheet;
    if (p.standalonePrepSheet?.base) prep.base = p.standalonePrepSheet.base;
    if (tplName) prep.title = tplName; // 调取模板后名称用模板名
    p.standalonePrepSheet = prep;
    markField("standalonePrepSheet");
    if (state.material) { p.materialList = deepCopy(state.material) as ToolState; markField("materialList"); }
    if (state.tools) { p.data = deepCopy(state.tools) as ToolState; markField("data"); }
    computeNextId();
    persist();
    const extra = [state.material ? "航材清单" : "", state.tools ? "工具清单" : ""].filter(Boolean);
    notify(extra.length ? `已加载模板（含${extra.join("、")}）` : "已加载模板");
  }

  return {
    app, screen, listTab, detailTab, ganttTab, currentProject, editingLibrary, editingStdLib, editingMaterialLibrary,
    active, materialActive, materialCategories, standardMaterialCategories, mStandardSubs,
    detailTitle, stdLibActive, stdLibTitle, aircraftNumbers, aircraftTypeFromPrep, effectiveAircraftType,
    dateFrom, dateTo, typeFilter, teamFilters, nameQuery, filteredProjects, cloud, toast, shared, imageExportBusy,
    notify, notifyOk, notifyErr, persist, queuePersist, replaceApp, openProject, openLibrary, openCart, openMaterialLibrary, openStdLib, backToList,
    createProject, deleteProject, duplicateProject, updateProject, updateProjectType, setAircraftType, saveStdLib,
    itemsOf, subsOf, catTotal, allTotal, isCartDuplicate,
    addNewCategory, addCategoryFromStandard, standardCategories, renameCategory, replaceCategoryFromStandard, deleteCategory, addSub, renameSub, deleteSub, forceExpandAll,
    importStandardSub, addItem, deleteItem, mergeImportedSections, replaceActive, clearProjectAllData, clearToolListNow, clearMaterialListNow, setToolCart, loadRemote, refresh, saveNow,
    syncSubToLibrary,
    mSubsOf, mItemsOf, mCatTotal, mAllTotal, mCategoryList,
    mAddCategory, mAddCategoryFromStandard, mReplaceCategoryFromStandard, mAddNewCategory, mRenameCategory, mDeleteCategory, mAddSub, mRenameSub, mDeleteSub, mAddItem, mDeleteItem,
    mImportStandardSub, mSyncSubToMaterialLib, saveMaterialLibraryNow, replaceMaterialActive, mergeMaterialSections, mergeMaterialImport, markNoteDirty,
    spOnAircraftChange, spAddWork, spRemoveWork, spAddPart, spRemovePart, spAddArrange, spRemoveArrange,
    spAddProcessGroup, spRemoveProcessGroup, spInsertProcessGroup, spAddProcessRow, spRemoveProcessRow, spMoveProcessRow, spReplaceProcessGroups, spAddSigningRow, spRemoveSigningRow, spReplaceSigningRows,
    moveCard, moveUnassignedToSection, deleteUnassigned, upsertWorkcardStdLib,
    sortAvCbCards,
    lookupAircraftRow, fetchAircraftInfo,
    normalizeAircraftReg, openAircraftUpdate, closeAircraftUpdate, saveAircraftToLib, maybePromptAircraftUpdate, maybePromptAircraftDiff, aircraftUpdate,
    renamePrepTitle, addPrepItem, removePrepItem,
    startAutoSync, startPolling, stopPolling, setEditingField, isFlashing, syncing, remoteSaving,
    unlockAircraftInfo, startWatch, stopWatch, syncRealtimeMode, watchActive,
    announcement, setAnnouncement, saveAnnouncement,
    saveLibraryNow, saveCartNow, saveStdLibNow,
    identityName, identityReady, setIdentity, unlockSiteAdmin, onlineCount, startOnlinePing,
    syncSettings, persistSettings, sessionId, beginEdit, touchEdit, endEdit, endAllEditing, startEditingSync,
    isLockedByOther, lockOwnerOf, isEditingHere, editingLocal, editingByOthers, lockVersion,
    saveGantt, queueSaveGantt, applyGanttTemplate, openEngTemplateForEdit,
    saveStandaloneTemplate, applyStandaloneTemplate, openStandaloneTemplateForEdit,
  };
}

export type ToolboxStore = ReturnType<typeof useToolbox>;
