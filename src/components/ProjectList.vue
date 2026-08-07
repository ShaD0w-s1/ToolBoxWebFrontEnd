<script setup lang="ts">
import { nextTick, ref } from "vue";
import { AIRCRAFT_TYPES, TEAMS, type AircraftType, type Project } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { formatDate } from "../utils/format";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-all": []; share: [] }>();
const newType = ref<AircraftType>("A320");
const newName = ref("");
const showNew = ref(false);
const newInput = ref<HTMLInputElement | null>(null);

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
  await props.store.createProject(name, newType.value);
  newName.value = "";
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

function updateTeam(project: Project, event: Event): void {
  props.store.updateProject(project, { team: (event.target as HTMLSelectElement).value });
}
</script>

<template>
  <section>
    <nav class="tabs">
      <button class="tab" :class="{ active: store.listTab.value === 'tools' }" @click="store.listTab.value = 'tools'">工具清单</button>
      <button class="tab" :class="{ active: store.listTab.value === 'db' }" @click="store.listTab.value = 'db'">数据库</button>
    </nav>

    <template v-if="store.listTab.value === 'tools'">
      <div class="toolbar list-toolbar">
        <button v-if="!showNew" class="primary" @click="startNew">+ 新建工作项目</button>
        <template v-else>
          <input ref="newInput" v-model="newName" class="project-name-input" placeholder="输入工作项目名称" @keydown.enter="createProject" />
          <button class="primary" @click="createProject">创建</button>
          <button @click="cancelNew">取消</button>
        </template>
        <button @click="emit('export-all')">导出全部</button>
        <button @click="emit('share')">分享本页</button>
        <span class="spacer" />
        <select v-model="store.teamFilter.value" aria-label="按班组筛选">
          <option value="">班组：全部</option>
          <option v-for="team in TEAMS" :key="team">{{ team }}</option>
        </select>
        <input type="date" v-model="store.searchDay.value" class="date-search" aria-label="按日期筛选" />
        <button @click="store.searchDay.value = ''; store.teamFilter.value = ''">清除</button>
      </div>

      <p class="list-status">共 {{ store.filteredProjects.value.length }} 个工作项目</p>
      <div v-if="!store.filteredProjects.value.length" class="empty-state">尚无符合条件的工作项目。</div>
      <article v-for="project in store.filteredProjects.value" :key="project.id" class="project-card">
        <button class="project-main" @click="store.openProject(project.id)">
          <strong>{{ project.name }}</strong>
          <span>{{ project.aircraftType }} · {{ formatDate(project.createdAt) }}</span>
        </button>
        <select :value="project.team" aria-label="项目班组" @change="updateTeam(project, $event)">
          <option value="">未分配班组</option>
          <option v-for="team in TEAMS" :key="team">{{ team }}</option>
        </select>
        <div class="actions">
          <button @click="rename(project)">改名</button>
          <button class="danger" @click="remove(project)">删除</button>
        </div>
      </article>
    </template>

    <div v-else class="database-grid">
      <article v-for="type in AIRCRAFT_TYPES" :key="type" class="library-card">
        <div><strong>{{ type }} 标准库</strong><span>{{ store.app.value.libraries[type].items.length }} 项物品</span></div>
        <button class="primary" @click="store.openLibrary(type)">编辑标准库</button>
      </article>
      <article class="library-card cart-card">
        <div><strong>工具车数据库</strong><span>{{ store.app.value.toolCart.length }} 项物品</span></div>
        <button class="primary" @click="store.openCart">编辑工具车</button>
      </article>
    </div>
  </section>
</template>
