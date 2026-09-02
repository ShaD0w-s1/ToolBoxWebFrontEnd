<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  AIRCRAFT_TYPES,
  PROJECT_TYPES,
  STANDARD_LIB_KEYS,
  STANDARD_LIB_META,
  TEAMS,
  defaultGanttPrep,
  defaultStandalonePrepSheet,
  normalizeStandaloneTemplateState,
  type AircraftType,
  type GanttPrepState,
  type Project,
  type StandaloneTemplateState,
} from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { backend } from "../api";
import { projectShareUrl } from "../services/sharing";
import NameCompare from "./NameCompare.vue";
import ControlDocMaintain from "./ControlDocMaintain.vue";
import ProjectFormModal from "./ProjectFormModal.vue";
import MultiSelect from "./MultiSelect.vue";
import DateRangePicker from "./DateRangePicker.vue";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ share: [] }>();

/** 系统设置（数据库子页卡片）：轮询频率 / 会话超时 / 终止编辑视为保存（持久化到 localStorage）。 */
function setPollMs(ms: number): void {
  props.store.syncSettings.pollMs = Math.max(500, Math.min(ms, 20000));
  props.store.persistSettings();
  props.store.startPolling(); // 重启轮询使新间隔立即生效
  props.store.notify(`轮询频率已设为 ${ms / 1000}s`, "ok");
}
function setSessionTimeout(ms: number): void {
  props.store.syncSettings.sessionTimeoutMs = Math.max(15000, Math.min(ms, 600000));
  props.store.persistSettings();
  props.store.notify(`会话超时已设为 ${ms / 1000}s`, "ok");
}
function setAutoSaveOnEnd(on: boolean): void {
  props.store.syncSettings.autoSaveOnEnd = on;
  props.store.persistSettings();
  props.store.notify(on ? "已开启：终止编辑（失焦/切页）自动保存" : "已关闭：终止编辑不自动保存", on ? "ok" : "info");
}
// 新建项目弹窗：true=显示。
const showCreateModal = ref(false);
// 修订弹窗目标项目：null=隐藏，否则为该项目的修订弹窗。
const editTarget = ref<Project | null>(null);
const editingAnnouncement = ref(false);
const announcementDraft = ref("");
// 类型工作名称对照页面：null=隐藏，否则为机型（A320/B787）。
const nameCompareType = ref<AircraftType | null>(null);
// 现场管控单维护页面：true=显示。
const showControlDoc = ref(false);
// 网站管理：登录过的账号目录（需 AIRNAV 密码）。
const showSiteAdmin = ref(false);
const accounts = ref<Array<{ name: string; first_seen: string; last_seen: string; login_count: number }>>([]);
const accountsLoading = ref(false);
// 换发/APU 模板库：模板列表弹窗。
const showEngTemplates = ref(false);
const engTemplates = ref<Array<{ _id: string; id: string; name: string; savedAt: string; state: GanttPrepState }>>([]);
const engTemplatesLoading = ref(false);
// 单项工作模板库（单独项目）：模板列表弹窗。
const showStandaloneTemplates = ref(false);
const standaloneTemplates = ref<Array<{ _id: string; id: string; name: string; savedAt: string; state: StandaloneTemplateState }>>([]);
const standaloneTemplatesLoading = ref(false);

async function startNew(): Promise<void> {
  showCreateModal.value = true;
}

/** 修订项目（名称 / 执行班组 / 执行日期）。 */
function editProject(project: Project): void {
  editTarget.value = project;
}

function remove(project: Project): void {
  if (window.confirm(`确认删除“${project.name}”？`)) props.store.deleteProject(project);
}

/** 在新标签页打开二级页面（工作项目详情）。 */
function openInNewTab(project: Project): void {
  window.open(projectShareUrl(project), "_blank");
}

/** 复制项目：按当前项目数据新建一个“原名+副本”的工作项目。 */
function duplicate(project: Project): void {
  props.store.duplicateProject(project);
}

/** 编辑标准库/工具车前先确认，避免误触进入大段编辑界面。 */
function editLibrary(type: AircraftType): void {
  if (window.confirm("确认维护标准库？")) props.store.openLibrary(type);
}
function editCart(): void {
  if (window.confirm("确认维护工具车？")) props.store.openCart();
}
/** 编辑标准库前先确认；飞机信息标准库需经后端校验 AIRNAV 密码通过才能进入（读取也受保护）。 */
async function editStdLib(k: typeof STANDARD_LIB_KEYS[number]): Promise<void> {
  if (k === "aircraft_info") {
    const pwd = window.prompt("请输入 AIRNAV 密码：");
    if (pwd === null) return;
    if (!pwd) { props.store.notify("请输入 AIRNAV 密码"); return; }
    if (await props.store.unlockAircraftInfo(pwd)) props.store.openStdLib(k);
    return;
  }
  if (window.confirm("确认维护标准库？")) props.store.openStdLib(k);
}
/** 编辑航材标准库前先确认。 */
function editMaterialLibrary(type: AircraftType): void {
  if (window.confirm("确认维护航材标准库？")) props.store.openMaterialLibrary(type);
}

/** 网站管理：AIRNAV 密码门校验通过后展示登录过的账号目录。 */
async function openSiteAdmin(): Promise<void> {
  const pwd = window.prompt("请输入 AIRNAV 密码：");
  if (pwd === null) return;
  if (!pwd) { props.store.notify("请输入 AIRNAV 密码"); return; }
  accountsLoading.value = true;
  const list = await props.store.unlockSiteAdmin(pwd);
  accountsLoading.value = false;
  if (list === null) {
    props.store.notify("AIRNAV 密码错误，无法进入", "err");
    return;
  }
  accounts.value = list;
  showSiteAdmin.value = true;
}

/** 换发/APU 模板库：拉取模板列表并打开弹窗。 */
async function openEngTemplates(): Promise<void> {
  engTemplatesLoading.value = true;
  showEngTemplates.value = true;
  try {
    const res = await backend.listEngTemplates();
    engTemplates.value = (Array.isArray(res.data) ? res.data : []).slice().sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板列表加载失败", "err");
  } finally {
    engTemplatesLoading.value = false;
  }
}

function templateSummary(state: GanttPrepState | undefined): string {
  const charts = state?.charts?.length ?? 0;
  const cards = (state?.charts || []).reduce((n, c) => n + (c.cards?.length ?? 0), 0);
  const parts = (state?.charts || []).reduce((n, c) => n + (c.parts?.length ?? 0), 0);
  return `${charts} DAY · ${cards} 工序 · ${parts} 串件`;
}

async function deleteEngTemplate(t: { _id: string; name: string }): Promise<void> {
  if (!window.confirm(`确认删除模板“${t.name}”？`)) return;
  try {
    await backend.deleteEngTemplate(t._id);
    engTemplates.value = engTemplates.value.filter((x) => x._id !== t._id);
    props.store.notify("模板已删除", "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "删除失败", "err");
  }
}

async function duplicateEngTemplate(t: { _id: string; name: string }): Promise<void> {
  try {
    const res = await backend.duplicateEngTemplate(t._id);
    const doc = res.data;
    if (doc && typeof doc === "object") {
      engTemplates.value.unshift(doc as { _id: string; id: string; name: string; savedAt: string; state: GanttPrepState });
      engTemplates.value.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    }
    props.store.notify("模板已复制", "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "复制失败", "err");
  }
}

/** 模板库「改名」：改名后本地同步并保持名称排序。 */
async function renameEngTemplate(t: { _id: string; name: string }): Promise<void> {
  const name = window.prompt("请输入新模板名称", t.name)?.trim();
  if (!name || name === t.name) return;
  try {
    const found = engTemplates.value.find((x) => x._id === t._id);
    await backend.updateEngTemplate(t._id, { name, state: found?.state ?? ({} as unknown as GanttPrepState) });
    t.name = name;
    engTemplates.value.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    props.store.notify("模板已改名");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "改名失败", "err");
  }
}

/** 模板库「编辑」：打开一个类项目页面（新建换发/APU 项目预载模板内容），调整内容后「保存模板→覆盖」写回。 */
function editEngTemplate(t: { name: string; state: GanttPrepState }): void {
  showEngTemplates.value = false;
  props.store.openEngTemplateForEdit(t.name, t.state, "edit");
}
const newEngTplName = ref("");
/** 新增换发/APU 模板：命名后新建空白模板并打开编辑页（编辑完「保存为新模板」创建）。 */
function addEngTemplate(): void {
  const name = newEngTplName.value.trim();
  if (!name) { props.store.notify("请输入模板名称"); return; }
  showEngTemplates.value = false;
  newEngTplName.value = "";
  props.store.openEngTemplateForEdit(name, defaultGanttPrep());
}

/** 单项工作模板库（单独项目）：拉取模板列表并打开弹窗。 */
async function openStandaloneTemplates(): Promise<void> {
  standaloneTemplatesLoading.value = true;
  showStandaloneTemplates.value = true;
  try {
    const res = await backend.listStandaloneTemplates();
    standaloneTemplates.value = (Array.isArray(res.data) ? res.data : []).map((d) => ({ ...d, state: normalizeStandaloneTemplateState(d.state) })).slice().sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板列表加载失败", "err");
  } finally {
    standaloneTemplatesLoading.value = false;
  }
}

function standaloneTemplateSummary(state: StandaloneTemplateState): string {
  const prep = state.prep;
  const groups = prep?.processGroups?.length ?? 0;
  const rows = (prep?.processGroups || []).reduce((n, g) => n + (g.rows?.length ?? 0), 0);
  const parts: string[] = [];
  if (state.material) parts.push("航材");
  if (state.tools) parts.push("工具");
  const tag = parts.length ? ` · 带${parts.join("/")}清单` : "";
  return `${groups} 工序组 · ${rows} 工序行${tag}`;
}

async function deleteStandaloneTemplate(t: { _id: string; name: string }): Promise<void> {
  if (!window.confirm(`确认删除模板“${t.name}”？`)) return;
  try {
    await backend.deleteStandaloneTemplate(t._id);
    standaloneTemplates.value = standaloneTemplates.value.filter((x) => x._id !== t._id);
    props.store.notify("模板已删除", "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "删除失败", "err");
  }
}

async function duplicateStandaloneTemplate(t: { _id: string; name: string }): Promise<void> {
  try {
    const res = await backend.duplicateStandaloneTemplate(t._id);
    const doc = res.data;
    if (doc && typeof doc === "object") {
      standaloneTemplates.value.unshift(doc as { _id: string; id: string; name: string; savedAt: string; state: StandaloneTemplateState });
      standaloneTemplates.value = standaloneTemplates.value.map((x) => ({ ...x, state: normalizeStandaloneTemplateState(x.state) })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    }
    props.store.notify("模板已复制", "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "复制失败", "err");
  }
}

/** 单项工作模板「改名」：改名后本地同步并保持名称排序（与换发/APU 模板库一致）。 */
async function renameStandaloneTemplate(t: { _id: string; name: string }): Promise<void> {
  const name = window.prompt("请输入新模板名称", t.name)?.trim();
  if (!name || name === t.name) return;
  try {
    const found = standaloneTemplates.value.find((x) => x._id === t._id);
    await backend.updateStandaloneTemplate(t._id, { name, state: found?.state ?? ({} as unknown as StandaloneTemplateState) });
    t.name = name;
    standaloneTemplates.value.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    props.store.notify("模板已改名");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "改名失败", "err");
  }
}

/** 单项工作模板「编辑」：新建单独项目预载模板内容（准备单+航材/工具清单），调整后「保存模板→覆盖」写回。 */
function editStandaloneTemplate(t: { name: string; state: StandaloneTemplateState }): void {
  showStandaloneTemplates.value = false;
  props.store.openStandaloneTemplateForEdit(t.name, t.state, "edit");
}

const newStandaloneTplName = ref("");
/** 新增单项工作模板：命名后新建空白模板并打开编辑页（编辑完「保存为新模板」创建）。 */
function addStandaloneTemplate(): void {
  const name = newStandaloneTplName.value.trim();
  if (!name) { props.store.notify("请输入模板名称"); return; }
  showStandaloneTemplates.value = false;
  newStandaloneTplName.value = "";
  props.store.openStandaloneTemplateForEdit(name, { prep: defaultStandalonePrepSheet(), material: null, tools: null });
}

/** 公告栏编辑。 */
function startEditAnnouncement(): void {
  announcementDraft.value = props.store.announcement.value;
  editingAnnouncement.value = true;
}
function saveAnnouncement(): void {
  props.store.setAnnouncement(announcementDraft.value.trim());
  editingAnnouncement.value = false;
}
function cancelEditAnnouncement(): void {
  editingAnnouncement.value = false;
}

// —— 项目卡片操作 split button（修订主按钮 + 下拉复制/删除） ——
const openCardMenu = ref<string | null>(null);
function toggleCardMenu(id: string): void {
  openCardMenu.value = openCardMenu.value === id ? null : id;
}
function closeCardMenu(): void { openCardMenu.value = null; }
onMounted(() => document.addEventListener("click", closeCardMenu));
onBeforeUnmount(() => document.removeEventListener("click", closeCardMenu));

// —— 项目目录导出（系统设置卡）：按执行日期区间导出 名称/类型/执行班组/执行日期 ——
// 默认区间：本月 1 日 ~ 今天
function monthBounds(): { from: string; to: string } {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return { from: `${now.getFullYear()}-${m}-01`, to: `${now.getFullYear()}-${m}-${d}` };
}
const dirBounds = monthBounds();
const dirFrom = ref(dirBounds.from);
const dirTo = ref(dirBounds.to);
/** 执行日期 YYYYMMDD → 显示 YYYY-MM-DD（历史数据可能带连字符，宽容处理）。 */
function fmtExecDate(v: string): string {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : String(v || "");
}
async function exportProjectDir(): Promise<void> {
  const from = (dirFrom.value || "").replace(/\D/g, "");
  const to = (dirTo.value || "").replace(/\D/g, "");
  if (!from || !to) { props.store.notify("请先选择开始/结束日期", "err"); return; }
  if (to < from) { props.store.notify("结束日期不能早于开始日期", "err"); return; }
  const list = props.store.app.value.projects
    .filter((p) => { const k = String(p.executeDate || "").replace(/\D/g, ""); return k.length === 8 && k >= from && k <= to; })
    .slice()
    .sort((a, b) => String(a.executeDate).localeCompare(String(b.executeDate)) || a.name.localeCompare(b.name, "zh-CN"));
  if (!list.length) { props.store.notify("该日期区间内没有项目", "info"); return; }
  try {
    const XLSX = await import("xlsx");
    const aoa: unknown[][] = [["序号", "项目名称", "类型", "执行班组", "执行日期"]];
    list.forEach((p, i) => aoa.push([i + 1, p.name, p.type || "未选择", p.team || "未分配", fmtExecDate(p.executeDate)]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "项目目录");
    XLSX.writeFile(wb, `项目目录_${dirFrom.value}_${dirTo.value}.xlsx`);
    props.store.notify(`已导出 ${list.length} 个项目`, "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "导出失败", "err");
  }
}

// —— 批量删除未设置执行日期的云端项目 ——
async function batchDeleteNoDate(): Promise<void> {
  const list = props.store.app.value.projects.filter((p) => !p.executeDate);
  if (!list.length) { props.store.notify("没有未设置执行日期的项目", "ok"); return; }
  if (!window.confirm(`确认删除 ${list.length} 个未设置执行日期的项目？此操作不可撤销！`)) return;
  let ok = 0;
  let fail = 0;
  for (const p of list) {
    try {
      if (props.store.cloud.available) await backend.deleteProject(p.id);
      props.store.app.value.projects = props.store.app.value.projects.filter((x) => x.id !== p.id);
      ok++;
    } catch {
      fail++;
    }
  }
  props.store.persist();
  props.store.notify(fail ? `已删除 ${ok} 个，失败 ${fail} 个` : `已删除 ${ok} 个未设置执行日期的项目`, fail ? "err" : "ok");
}
</script>

<template>
  <section>
    <!-- 公告栏（云端共享） -->
    <div class="announcement-bar">
      <template v-if="!editingAnnouncement">
        <span class="announcement-label">公告</span>
        <span class="announcement-content" :class="{ empty: !store.announcement.value }">{{ store.announcement.value || "暂无公告" }}</span>
        <button class="announcement-edit" @click="startEditAnnouncement">编辑</button>
      </template>
      <template v-else>
        <input v-model="announcementDraft" class="announcement-input" placeholder="输入公告内容（所有用户可见）" @keydown.enter="saveAnnouncement" @keydown.escape="cancelEditAnnouncement" />
        <button class="primary" @click="saveAnnouncement">保存</button>
        <button @click="cancelEditAnnouncement">取消</button>
      </template>
    </div>

    <nav class="tabs">
      <button class="tab" :class="{ active: store.listTab.value === 'tools' }" @click="store.listTab.value = 'tools'">项目列表</button>
      <button class="tab" :class="{ active: store.listTab.value === 'db' }" @click="store.listTab.value = 'db'">数据库</button>
    </nav>

    <template v-if="store.listTab.value === 'tools'">
      <!-- 项目列表子页：现有宽度内左右分栏（左 1/3 功能区，右 2/3 列表） -->
      <div class="list-split">
        <!-- 左侧 1/3：功能按钮区 -->
        <aside class="list-side">
          <button class="primary side-new" @click="startNew">+ 新建工作项目</button>
          <div class="side-row">
            <button title="复制本页链接，对方打开后自动定位" @click="emit('share')">分享本页</button>
            <button title="强制同步数据" @click="store.refresh()">刷新</button>
          </div>
          <div class="side-divider" />
          <div class="side-title">筛选条件</div>

          <div class="side-field">
            <span class="side-label">执行日期（时段，最多 30 天）</span>
            <DateRangePicker :from="store.dateFrom.value" :to="store.dateTo.value" @update:from="store.dateFrom.value = $event" @update:to="store.dateTo.value = $event" />
          </div>

          <div class="side-field">
            <span class="side-label">项目名称（模糊搜索）</span>
            <div class="side-search-wrap">
              <input v-model="store.nameQuery.value" class="inp" placeholder="搜索项目名称" aria-label="按项目名称搜索" />
              <button v-if="store.nameQuery.value" class="side-clear-x" title="清空搜索" @click="store.nameQuery.value = ''">×</button>
            </div>
          </div>

          <div class="side-field">
            <span class="side-label">项目类型</span>
            <MultiSelect :options="[...PROJECT_TYPES]" v-model="store.typeFilter.value" placeholder="类型：全部" />
          </div>

          <div class="side-field">
            <span class="side-label">执行班组</span>
            <MultiSelect :options="[...TEAMS]" v-model="store.teamFilters.value" placeholder="班组：全部" />
          </div>
        </aside>

        <!-- 右侧 2/3：项目列表 -->
        <div class="list-main">
          <div class="list-main-head">
            <p class="list-status">共 {{ store.filteredProjects.value.length }} 个工作项目</p>
          </div>
          <div v-if="!store.filteredProjects.value.length" class="empty-state">尚无符合条件的工作项目。</div>
          <article v-for="project in store.filteredProjects.value" :key="project.id" class="project-card">
            <button class="project-main" @click="openInNewTab(project)">
              <strong>{{ project.name }}</strong>
              <span>{{ project.aircraftType }} · {{ project.executeDate || "未设置执行日期" }}</span>
            </button>
            <span class="card-meta">{{ project.type || "未选择类型" }}</span>
            <span class="card-meta">{{ project.team || "未分配班组" }}</span>
            <div class="card-split" @click.stop>
              <button class="cs-main" @click="editProject(project)">修订</button>
              <button class="cs-arrow" title="更多操作" @click="toggleCardMenu(project.id)">▾</button>
              <div v-if="openCardMenu === project.id" class="cs-menu">
                <button @click="closeCardMenu(); duplicate(project)">复制项目</button>
                <button class="danger" @click="closeCardMenu(); remove(project)">删除</button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </template>

    <div v-else class="database-grid">
      <NameCompare v-if="nameCompareType" :store="store" :type="nameCompareType" @close="nameCompareType = null" />
      <ControlDocMaintain v-else-if="showControlDoc" :store="store" @close="showControlDoc = false" />

      <template v-else>
        <section class="db-group">
          <h3 class="db-group-title">工具库</h3>
          <div class="db-group-cards">
            <article v-for="type in AIRCRAFT_TYPES" :key="type" class="library-card">
              <div><strong>{{ type }} 工具标准库</strong><span>{{ store.app.value.libraries[type].items.length }} 项物品</span></div>
              <div class="library-actions">
                <button class="primary" @click="editLibrary(type)">编辑标准库</button>
              </div>
            </article>
            <article class="library-card cart-card">
              <div><strong>工具车数据库</strong><span>{{ store.app.value.toolCart.length }} 项物品</span></div>
              <div class="library-actions">
                <button class="primary" @click="editCart">编辑工具车</button>
              </div>
            </article>
          </div>
        </section>

        <section class="db-group">
          <h3 class="db-group-title">航材库</h3>
          <div class="db-group-cards">
            <article v-for="type in AIRCRAFT_TYPES" :key="`m-${type}`" class="library-card">
              <div><strong>{{ type }} 航材标准库</strong><span>{{ store.app.value.materialLibraries[type].items.length }} 项航材</span></div>
              <div class="library-actions">
                <button class="primary" @click="editMaterialLibrary(type)">编辑标准库</button>
              </div>
            </article>
          </div>
        </section>

        <section class="db-group">
          <h3 class="db-group-title">基准库</h3>
          <div class="db-group-cards">
            <article v-for="k in STANDARD_LIB_KEYS" :key="k" class="library-card">
              <div><strong>{{ STANDARD_LIB_META[k].label }}</strong><span>{{ store.app.value.standardLibraries[k].rows.length }} 行</span></div>
              <div class="library-actions">
                <button class="primary" @click="editStdLib(k)">编辑标准库</button>
              </div>
            </article>
            <article class="library-card compare-card">
              <div><strong>类型工作名称对照</strong><span>航材 ↔ 工具 名称对照</span></div>
              <div class="library-actions">
                <button class="primary" @click="nameCompareType = 'A320'">打开对照</button>
              </div>
            </article>
            <article class="library-card compare-card">
              <div><strong>现场管控单维护</strong><span>上传/下载现场管控单</span></div>
              <div class="library-actions">
                <button class="primary" @click="showControlDoc = true">打开维护</button>
              </div>
            </article>
          </div>
        </section>

        <section class="db-group">
          <h3 class="db-group-title">模板库</h3>
          <div class="db-group-cards">
            <article class="library-card compare-card">
              <div><strong>换发/APU 模板库</strong><span>甘特工作准备单机型模板</span></div>
              <div class="library-actions">
                <button class="primary" @click="openEngTemplates">打开模板库</button>
              </div>
            </article>
            <article class="library-card compare-card">
              <div><strong>单项工作模板库</strong><span>单独项目工作准备单模板</span></div>
              <div class="library-actions">
                <button class="primary" @click="openStandaloneTemplates">打开模板库</button>
              </div>
            </article>
          </div>
        </section>

        <!-- 系统设置（数据库子页卡片）：项目目录导出 + 数据维护（协同编辑设置已移入网站管理弹窗） -->
        <section class="db-group">
          <h3 class="db-group-title">系统设置</h3>
          <div class="db-group-cards">
            <article class="library-card settings-card">
              <div class="settings-row">
                <div class="settings-field">
                  <label>导出项目目录</label>
                  <div class="settings-dir-row">
                    <input class="inp settings-date" type="date" v-model="dirFrom" aria-label="开始日期" />
                    <span class="settings-dir-sep">至</span>
                    <input class="inp settings-date" type="date" v-model="dirTo" aria-label="结束日期" />
                    <button class="primary" @click="exportProjectDir" title="按执行日期区间导出 项目名称/类型/执行班组/执行日期（.xlsx）">导出</button>
                  </div>
                  <span>按执行日期区间导出 项目名称 / 类型 / 执行班组 / 执行日期（.xlsx 格式）。</span>
                </div>
                <div class="settings-field">
                  <label>数据维护</label>
                  <div class="settings-dir-row">
                    <button class="danger" @click="batchDeleteNoDate" title="批量删除云端储存的未设置执行日期的项目">清理无日期项目</button>
                    <button @click="openSiteAdmin" title="登录账号目录 + 协同编辑设置（需 AIRNAV 密码）">网站管理</button>
                  </div>
                  <span>清理无日期项目：批量删除未设置执行日期的云端项目；网站管理：账号目录与协同编辑设置（需 AIRNAV 密码）。</span>
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>
    </div>

    <div v-if="showSiteAdmin" class="site-admin-modal" @click.self="showSiteAdmin = false">
      <div class="site-admin-card">
        <div class="site-admin-head">
          <h3>网站管理</h3>
          <button @click="showSiteAdmin = false">关闭</button>
        </div>
        <div class="admin-sec-title">协同编辑设置（本机浏览器）</div>
        <div class="settings-row admin-settings">
          <div class="settings-field">
            <label>轮询频率（前台）</label>
            <span class="tip-el" data-tip="同步他人改动到本机的间隔；后台标签页自动放宽到 10s。">
              <select :value="String(store.syncSettings.pollMs)" @change="setPollMs(Number(($event.target as HTMLSelectElement).value))">
                <option value="500">0.5s（最快，请求最多）</option>
                <option value="1000">1s</option>
                <option value="2000">2s（推荐）</option>
                <option value="3000">3s</option>
                <option value="5000">5s（省流量）</option>
              </select>
            </span>
          </div>
          <div class="settings-field">
            <label>编辑会话超时</label>
            <span class="tip-el" data-tip="输入框持续编辑超过该时长未失焦 → 自动保存并脱离编辑状态。">
              <select :value="String(store.syncSettings.sessionTimeoutMs)" @change="setSessionTimeout(Number(($event.target as HTMLSelectElement).value))">
                <option value="60000">60s</option>
                <option value="90000">90s</option>
                <option value="120000">120s（推荐）</option>
                <option value="180000">180s</option>
              </select>
            </span>
          </div>
          <div class="settings-field">
            <label>终止编辑视为保存</label>
            <label class="settings-toggle tip-el" data-tip="失焦 / 切换项目 / 关闭页面时，自动保存当前编辑内容并释放锁。">
              <input type="checkbox" :checked="store.syncSettings.autoSaveOnEnd" @change="setAutoSaveOnEnd(($event.target as HTMLInputElement).checked)" />
              <span>{{ store.syncSettings.autoSaveOnEnd ? "已开启" : "已关闭" }}</span>
            </label>
          </div>
        </div>
        <div class="admin-sec-title">登录账号目录</div>
        <p v-if="accountsLoading" class="loading-state">加载中…</p>
        <table v-else-if="accounts.length" class="site-admin-table">
          <thead>
            <tr><th>姓名</th><th>登录次数</th><th>首次登录</th><th>最近登录</th></tr>
          </thead>
          <tbody>
            <tr v-for="a in accounts" :key="a.name">
              <td>{{ a.name }}</td>
              <td>{{ a.login_count }}</td>
              <td>{{ a.first_seen ? new Date(a.first_seen).toLocaleString() : "-" }}</td>
              <td>{{ a.last_seen ? new Date(a.last_seen).toLocaleString() : "-" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="site-admin-empty">暂无登录账号。</p>
      </div>
    </div>

    <div v-if="showEngTemplates" class="site-admin-modal" @click.self="showEngTemplates = false">
      <div class="site-admin-card">
        <div class="site-admin-head">
          <h3>换发/APU 模板库</h3>
          <button @click="showEngTemplates = false">关闭</button>
        </div>
        <div class="site-admin-newtpl">
          <input v-model="newEngTplName" placeholder="新模板名称" @keydown.enter="addEngTemplate" />
          <button class="primary" @click="addEngTemplate">新增模板</button>
        </div>
        <p v-if="engTemplatesLoading" class="loading-state">加载中…</p>
        <template v-else-if="engTemplates.length">
          <div v-for="t in engTemplates" :key="t._id" class="eng-tpl-row">
            <div class="eng-tpl-info">
              <strong>{{ t.name }}</strong>
              <span>{{ templateSummary(t.state) }}</span>
            </div>
            <div class="eng-tpl-actions">
              <button @click="editEngTemplate(t)">编辑</button>
              <button @click="renameEngTemplate(t)">改名</button>
              <button @click="duplicateEngTemplate(t)">复制</button>
              <button class="danger" @click="deleteEngTemplate(t)">删除</button>
            </div>
          </div>
        </template>
        <p v-else class="site-admin-empty">暂无模板。</p>
      </div>
    </div>

    <div v-if="showStandaloneTemplates" class="site-admin-modal" @click.self="showStandaloneTemplates = false">
      <div class="site-admin-card">
        <div class="site-admin-head">
          <h3>单项工作模板库</h3>
          <button @click="showStandaloneTemplates = false">关闭</button>
        </div>
        <div class="site-admin-newtpl">
          <input v-model="newStandaloneTplName" placeholder="新模板名称" @keydown.enter="addStandaloneTemplate" />
          <button class="primary" @click="addStandaloneTemplate">新增模板</button>
        </div>
        <p v-if="standaloneTemplatesLoading" class="loading-state">加载中…</p>
        <template v-else-if="standaloneTemplates.length">
          <div v-for="t in standaloneTemplates" :key="t._id" class="eng-tpl-row">
            <div class="eng-tpl-info">
              <strong>{{ t.name }}</strong>
              <span>{{ standaloneTemplateSummary(t.state) }}</span>
            </div>
            <div class="eng-tpl-actions">
              <button @click="editStandaloneTemplate(t)">编辑</button>
              <button @click="renameStandaloneTemplate(t)">改名</button>
              <button @click="duplicateStandaloneTemplate(t)">复制</button>
              <button class="danger" @click="deleteStandaloneTemplate(t)">删除</button>
            </div>
          </div>
        </template>
        <p v-else class="site-admin-empty">暂无模板。</p>
      </div>
    </div>

    <ProjectFormModal v-if="showCreateModal" :store="store" mode="create" @close="showCreateModal = false" />
    <ProjectFormModal v-if="editTarget" :store="store" mode="edit" :project="editTarget" @close="editTarget = null" />
  </section>
</template>

<style scoped>
.announcement-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: linear-gradient(90deg, #fff8e1, #fff3c4);
  border: 1px solid #f0d878;
  border-radius: var(--r-md);
  font-size: var(--fs-14);
}
.announcement-label {
  font-weight: 700;
  color: #b8860b;
  white-space: nowrap;
}
.announcement-content {
  flex: 1 1 0;
  min-width: 0;
  color: #5a4a1a;
  white-space: pre-wrap;
  word-break: break-word;
}
.announcement-content.empty { color: #b0a880; font-style: italic; }
.announcement-edit { flex: 0 0 auto; }
.announcement-input {
  flex: 1 1 0;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: var(--fs-14);
}
.library-actions { display: flex; gap: 6px; }
.library-actions button { min-height: 28px; padding: 3px 7px; font-size: var(--fs-12); }
.db-group { margin-bottom: 20px; }
.db-group-title { font-size: var(--fs-14); font-weight: 700; color: var(--n8); margin: 0 0 8px; padding-left: 4px; border-left: 4px solid #378add; }
.db-group-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.compare-card { border-color: #378add; }
.site-admin-modal { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; -webkit-overflow-scrolling: touch; background: rgba(17, 24, 39, 0.45); }
.site-admin-card { width: min(560px, calc(100% - 48px)); max-height: none; margin: 24px auto; padding: 20px 24px; background: var(--n0); border-radius: var(--r-lg); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2); }
.site-admin-newtpl { display: flex; gap: 8px; margin-bottom: 12px; }
.site-admin-newtpl input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); }
.site-admin-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.site-admin-head h3 { margin: 0; font-size: var(--fs-16); color: var(--n8); }
.site-admin-table { width: 100%; border-collapse: collapse; font-size: var(--fs-13); }
.site-admin-table th, .site-admin-table td { padding: 7px 10px; border-bottom: 1px solid #eef1f5; text-align: left; }
.site-admin-table th { color: #5f6b7a; font-weight: 600; background: #f6f8fb; }
.site-admin-empty { color: #8a94a3; text-align: center; padding: 20px 0; margin: 0; }
.eng-tpl-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid #eef1f5; border-radius: var(--r-md); margin-bottom: 8px; }
.eng-tpl-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.eng-tpl-info strong { font-size: var(--fs-14); color: var(--n8); }
.eng-tpl-info span { font-size: var(--fs-12); color: #8a94a3; }
.eng-tpl-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.eng-tpl-actions button { min-height: 28px; padding: 3px 10px; font-size: var(--fs-12); }

/* ===== 项目列表子页：左 1/3 功能区 + 右 2/3 列表 ===== */
.list-split { display: flex; gap: 16px; align-items: flex-start; }
.list-side {
  flex: 0 0 33.3333%; min-width: 0;
  display: flex; flex-direction: column; gap: 12px;
  background: var(--n0); border: 1px solid var(--line); border-radius: var(--r-lg);
  padding: 14px; position: sticky; top: 8px;
}
.list-main { flex: 1 1 66.6667%; min-width: 0; }
.side-new {
  width: 100%; min-height: 72px; /* 2 倍标准按钮高度（36→72） */
  font-size: var(--fs-18); font-weight: 700; border-radius: var(--r-lg);
  letter-spacing: .5px;
}
.side-row { display: flex; gap: 8px; }
.side-row button { flex: 1; }
.side-divider { height: 1px; background: var(--line); margin: 2px 0; }
.side-title { font-size: var(--fs-14); font-weight: 700; color: var(--n8); }
.side-field { display: flex; flex-direction: column; gap: 6px; }
.side-label { font-size: var(--fs-12); font-weight: 600; color: var(--n9); }
/* 名称搜索：input + 内嵌红色 × */
.side-search-wrap { position: relative; display: flex; align-items: center; }
.side-search-wrap .inp { width: 100%; padding-right: 34px; }
/* 红色 ×（内嵌于搜索组件） */
.side-clear-x {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; padding: 0; border: none; border-radius: 50%;
  background: var(--danger-bg); color: var(--danger); font-size: var(--fs-14); line-height: 1;
  cursor: pointer; z-index: 2;
}
.side-clear-x:hover { background: #f9dcdc; }
/* 右侧列表头操作组 */
/* 项目卡片操作 split button：修订主按钮 + ▾ 下拉（复制/删除） */
.card-split { position: relative; display: inline-flex; align-items: stretch; flex: 0 0 auto; }
.cs-main {
  min-height: 30px; padding: 4px 14px;
  border: 1px solid var(--blue); border-right: none; border-radius: var(--r-sm) 0 0 var(--r-sm);
  background: var(--blue); color: var(--n0); font-size: var(--fs-12); font-weight: 600;
}
.cs-main:hover { background: var(--blue-dark); }
.cs-arrow {
  min-height: 30px; width: 26px; padding: 0;
  border: 1px solid var(--blue); border-radius: 0 var(--r-sm) var(--r-sm) 0;
  background: var(--n0); color: var(--blue-dark); font-size: var(--fs-10);
}
.cs-arrow:hover { background: var(--blue-bg); }
.cs-menu {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 60;
  min-width: 110px; padding: 4px;
  background: var(--n0); border: 1px solid var(--n3); border-radius: var(--r-md);
  box-shadow: var(--sh-2);
}
.cs-menu button {
  display: block; width: 100%; min-height: 30px; padding: 4px 12px;
  border: none; border-radius: var(--r-sm); background: transparent;
  color: var(--n8); font-size: var(--fs-13); text-align: left;
}
.cs-menu button:hover { background: var(--blue-bg); }
.cs-menu button.danger { color: var(--danger); }
.cs-menu button.danger:hover { background: var(--danger-bg); }
.list-main-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.list-main-head .list-status { margin: 0; }

/* 移动端：分栏改为上下堆叠 */
@media (max-width: 860px) {
  .list-split { flex-direction: column; }
  .list-side { flex: none; width: 100%; position: static; }
  .list-main { flex: none; width: 100%; }
}

/* 系统设置卡片（数据库子页）：轮询频率 / 会话超时 / 终止编辑视为保存 */
.settings-card { display: block; padding: 18px; }
.settings-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
.settings-field { display: flex; flex-direction: column; gap: 6px; }
.settings-field > label { font-weight: 600; font-size: var(--fs-13, 13px); color: var(--text, var(--n8)); }
.settings-field select {
  padding: 7px 10px; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-md, 8px);
  font-size: var(--fs-13, 13px); background: var(--n0, #fff); font-family: inherit;
}
.settings-field span { font-size: var(--fs-12, 12px); color: var(--muted, var(--n7)); line-height: 1.5; }
.settings-toggle { flex-direction: row; align-items: center; gap: 8px; font-weight: 400 !important; }
.settings-toggle input { width: 16px; height: 16px; accent-color: var(--proc-yellow, #FDCA17); }
/* 设置卡内行式操作（日期区间+导出 / 数据维护按钮） */
.settings-dir-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.settings-dir-row .settings-date { flex: 0 1 140px; min-width: 0; }
.settings-dir-row .settings-dir-sep { font-size: var(--fs-13, 13px); color: var(--n7, #888); flex: 0 0 auto; }
.settings-dir-row button { min-height: 34px; padding: 5px 12px; }
/* 网站管理弹窗：分节标题（同 db-group-title 小号风格） */
.admin-sec-title { font-size: var(--fs-13); font-weight: 700; color: var(--n8); margin: 14px 0 8px; padding-left: 4px; border-left: 4px solid #378add; }
.site-admin-card .admin-settings { margin-bottom: 4px; }
/* 选框 Tooltip：hover 选框控件显示说明（注释不再常显） */
.tip-el { position: relative; display: block; }
.settings-toggle.tip-el { display: inline-flex; }
.tip-el:hover::after {
  content: attr(data-tip);
  position: absolute; z-index: 40; bottom: calc(100% + 8px); left: 0;
  width: 250px; max-width: 80vw; padding: 7px 10px;
  background: #243447; color: #fff; font-size: var(--fs-12, 12px); line-height: 1.5;
  border-radius: var(--r-sm, 6px); box-shadow: var(--sh-2); white-space: normal; text-align: left;
  pointer-events: none;
}
</style>
