<script setup lang="ts">
import { ref } from "vue";
import {
  AIRCRAFT_TYPES,
  STANDARD_LIB_KEYS,
  STANDARD_LIB_META,
  TEAMS,
  type AircraftType,
  type GanttPrepState,
  type Project,
} from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { backend } from "../api";
import { projectShareUrl } from "../services/sharing";
import NameCompare from "./NameCompare.vue";
import ControlDocMaintain from "./ControlDocMaintain.vue";
import ProjectFormModal from "./ProjectFormModal.vue";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-all": []; share: [] }>();
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
    props.store.notify("AIRNAV 密码错误，无法进入");
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
    engTemplates.value = Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "模板列表加载失败");
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
    props.store.notify("模板已删除");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "删除失败");
  }
}

async function duplicateEngTemplate(t: { _id: string; name: string }): Promise<void> {
  try {
    const res = await backend.duplicateEngTemplate(t._id);
    const doc = res.data;
    if (doc && typeof doc === "object") {
      engTemplates.value.unshift(doc as { _id: string; id: string; name: string; savedAt: string; state: GanttPrepState });
    }
    props.store.notify("模板已复制");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "复制失败");
  }
}

/** 模板库「编辑」：打开一个类项目页面（新建换发/APU 项目预载模板内容），调整内容后「保存模板→覆盖」写回。 */
function editEngTemplate(t: { name: string; state: GanttPrepState }): void {
  showEngTemplates.value = false;
  props.store.openEngTemplateForEdit(t.name, t.state);
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
      <div class="toolbar list-toolbar">
        <button class="primary" @click="startNew">+ 新建工作项目</button>
        <button @click="emit('export-all')">导出全部</button>
        <button @click="emit('share')">分享本页</button>
        <button @click="store.refresh()">刷新</button>
        <span class="spacer" />
        <input v-model="store.nameQuery.value" class="project-name-input" placeholder="搜索项目名称" aria-label="按项目名称搜索" />
        <select v-model="store.teamFilter.value" aria-label="按班组筛选">
          <option value="">班组：全部</option>
          <option v-for="team in TEAMS" :key="team">{{ team }}</option>
        </select>
        <input type="date" v-model="store.searchDay.value" class="date-search" aria-label="按执行日期查询" />
        <button @click="store.searchDay.value = ''; store.teamFilter.value = ''; store.nameQuery.value = ''">清除</button>
      </div>

      <p class="list-status">共 {{ store.filteredProjects.value.length }} 个工作项目</p>
      <div v-if="!store.filteredProjects.value.length" class="empty-state">尚无符合条件的工作项目。</div>
      <article v-for="project in store.filteredProjects.value" :key="project.id" class="project-card">
        <button class="project-main" @click="openInNewTab(project)">
          <strong>{{ project.name }}</strong>
          <span>{{ project.aircraftType }} · {{ project.executeDate || "未设置执行日期" }}</span>
        </button>
        <span class="card-meta">{{ project.type || "未选择类型" }}</span>
        <span class="card-meta">{{ project.team || "未分配班组" }}</span>
        <div class="actions">
          <button @click="editProject(project)">修订</button>
          <button @click="duplicate(project)">复制项目</button>
          <button class="danger" @click="remove(project)">删除</button>
        </div>
      </article>
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
            <article class="library-card compare-card">
              <div><strong>网站管理</strong><span>登录过的账号目录</span></div>
              <div class="library-actions">
                <button class="primary" @click="openSiteAdmin">打开管理</button>
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
          </div>
        </section>
      </template>
    </div>

    <div v-if="showSiteAdmin" class="site-admin-modal" @click.self="showSiteAdmin = false">
      <div class="site-admin-card">
        <div class="site-admin-head">
          <h3>网站管理 · 登录账号目录</h3>
          <button @click="showSiteAdmin = false">关闭</button>
        </div>
        <p v-if="accountsLoading" class="site-admin-empty">加载中…</p>
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
        <p v-if="engTemplatesLoading" class="site-admin-empty">加载中…</p>
        <template v-else-if="engTemplates.length">
          <div v-for="t in engTemplates" :key="t._id" class="eng-tpl-row">
            <div class="eng-tpl-info">
              <strong>{{ t.name }}</strong>
              <span>{{ templateSummary(t.state) }}</span>
            </div>
            <div class="eng-tpl-actions">
              <button @click="editEngTemplate(t)">编辑</button>
              <button @click="duplicateEngTemplate(t)">复制</button>
              <button class="danger" @click="deleteEngTemplate(t)">删除</button>
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
  border-radius: 8px;
  font-size: 14px;
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
  border: 1px solid #d7dbe4;
  border-radius: 6px;
  font-size: 14px;
}
.library-actions { display: flex; gap: 6px; }
.library-actions button { min-height: 28px; padding: 3px 7px; font-size: 12px; }
.db-group { margin-bottom: 20px; }
.db-group-title { font-size: 14px; font-weight: 700; color: #2f3b52; margin: 0 0 8px; padding-left: 4px; border-left: 4px solid #378add; }
.db-group-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.compare-card { border-color: #378add; }
.site-admin-modal { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center; background: rgba(17, 24, 39, 0.45); }
.site-admin-card { width: min(560px, calc(100% - 48px)); max-height: 80vh; overflow: auto; padding: 20px 24px; background: #fff; border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2); }
.site-admin-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.site-admin-head h3 { margin: 0; font-size: 16px; color: #2f3b52; }
.site-admin-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.site-admin-table th, .site-admin-table td { padding: 7px 10px; border-bottom: 1px solid #eef1f5; text-align: left; }
.site-admin-table th { color: #5f6b7a; font-weight: 600; background: #f6f8fb; }
.site-admin-empty { color: #8a94a3; text-align: center; padding: 20px 0; margin: 0; }
.eng-tpl-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid #eef1f5; border-radius: 8px; margin-bottom: 8px; }
.eng-tpl-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.eng-tpl-info strong { font-size: 14px; color: #2f3b52; }
.eng-tpl-info span { font-size: 12px; color: #8a94a3; }
.eng-tpl-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.eng-tpl-actions button { min-height: 28px; padding: 3px 10px; font-size: 12px; }
</style>
