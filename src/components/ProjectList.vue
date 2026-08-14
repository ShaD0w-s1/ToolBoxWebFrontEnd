<script setup lang="ts">
import { nextTick, ref } from "vue";
import {
  AIRCRAFT_TYPES,
  PROJECT_TYPES,
  STANDARD_LIB_KEYS,
  STANDARD_LIB_META,
  TEAMS,
  type AircraftType,
  type Project,
  type ProjectType,
} from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { formatDate } from "../utils/format";
import { projectShareUrl } from "../services/sharing";
import NameCompare from "./NameCompare.vue";
import ControlDocMaintain from "./ControlDocMaintain.vue";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-all": []; share: [] }>();
const newType = ref<AircraftType>("A320");
const newProjectType = ref<ProjectType | "">("A检");
const newName = ref("");
const showNew = ref(false);
const newInput = ref<HTMLInputElement | null>(null);
const editingAnnouncement = ref(false);
const announcementDraft = ref("");
// 类型工作名称对照页面：null=隐藏，否则为机型（A320/B787）。
const nameCompareType = ref<AircraftType | null>(null);
// 现场管控单维护页面：true=显示。
const showControlDoc = ref(false);

async function startNew(): Promise<void> {
  showNew.value = true;
  await nextTick();
  newInput.value?.focus();
}

async function createProject(): Promise<void> {
  const name = newName.value.trim();
  if (!name) {
    props.store.notify("请先输入工作项目名称");
    return;
  }
  await props.store.createProject(name, newType.value, newProjectType.value);
  newName.value = "";
  newProjectType.value = "A检";
  showNew.value = false;
}

function cancelNew(): void {
  newName.value = "";
  showNew.value = false;
}

function rename(project: Project): void {
  const name = window.prompt("请输入新的项目名称：", project.name);
  if (name?.trim()) props.store.updateProject(project, { name: name.trim() });
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

function updateTeam(project: Project, event: Event): void {
  props.store.updateProject(project, { team: (event.target as HTMLSelectElement).value });
}

function updateType(project: Project, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  props.store.updateProject(project, { type: (value || "") as ProjectType | "" });
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
        <button v-if="!showNew" class="primary" @click="startNew">+ 新建工作项目</button>
        <template v-else>
          <select v-model="newProjectType" aria-label="工作项目类型">
            <option value="">类型：不限</option>
            <option v-for="type in PROJECT_TYPES" :key="type">{{ type }}</option>
          </select>
          <input ref="newInput" v-model="newName" class="project-name-input" placeholder="输入工作项目名称" @keydown.enter="createProject" />
          <button class="primary" @click="createProject">创建</button>
          <button @click="cancelNew">取消</button>
        </template>
        <button @click="emit('export-all')">导出全部</button>
        <button @click="emit('share')">分享本页</button>
        <button @click="store.refresh()">刷新</button>
        <span class="spacer" />
        <input v-model="store.nameQuery.value" class="project-name-input" placeholder="搜索项目名称" aria-label="按项目名称搜索" />
        <select v-model="store.teamFilter.value" aria-label="按班组筛选">
          <option value="">班组：全部</option>
          <option v-for="team in TEAMS" :key="team">{{ team }}</option>
        </select>
        <input type="date" v-model="store.searchDay.value" class="date-search" aria-label="按日期筛选" />
        <button @click="store.searchDay.value = ''; store.teamFilter.value = ''; store.nameQuery.value = ''">清除</button>
      </div>

      <p class="list-status">共 {{ store.filteredProjects.value.length }} 个工作项目</p>
      <div v-if="!store.filteredProjects.value.length" class="empty-state">尚无符合条件的工作项目。</div>
      <article v-for="project in store.filteredProjects.value" :key="project.id" class="project-card">
        <button class="project-main" @click="openInNewTab(project)">
          <strong>{{ project.name }}</strong>
          <span>{{ project.aircraftType }} · {{ formatDate(project.createdAt) }}</span>
        </button>
        <select :value="project.team" aria-label="项目班组" @change="updateTeam(project, $event)">
          <option value="">未分配班组</option>
          <option v-for="team in TEAMS" :key="team">{{ team }}</option>
        </select>
        <select :value="project.type" class="type-select" aria-label="项目类型" @change="updateType(project, $event)">
          <option value="">类型：未选择</option>
          <option v-for="t in PROJECT_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
        <div class="actions">
          <button @click="rename(project)">改名</button>
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
          </div>
        </section>
      </template>
    </div>
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
</style>
