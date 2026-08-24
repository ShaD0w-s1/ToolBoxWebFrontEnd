<script setup lang="ts">
import { reactive, watch } from "vue";
import { PROJECT_TYPES, TEAMS, type Project, type ProjectType } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";

const props = defineProps<{ store: ToolboxStore; mode: "create" | "edit"; project?: Project | null }>();
const emit = defineEmits<{ close: [] }>();

const form = reactive({ name: "", team: "", type: "A检" as ProjectType | "", executeDate: "" });

watch(
  () => [props.mode, props.project?.id],
  () => {
    if (props.mode === "edit" && props.project) {
      form.name = props.project.name;
      form.team = props.project.team;
      form.type = props.project.type;
      form.executeDate = props.project.executeDate
        ? `${props.project.executeDate.slice(0, 4)}-${props.project.executeDate.slice(4, 6)}-${props.project.executeDate.slice(6, 8)}`
        : "";
    } else {
      form.name = "";
      form.team = "";
      form.type = "A检";
      form.executeDate = "";
    }
  },
  { immediate: true },
);

async function submit(): Promise<void> {
  const name = form.name.trim();
  if (!name) {
    props.store.notify("请先输入项目名称");
    return;
  }
  const executeDate = form.executeDate.replace(/-/g, "");
  if (props.mode === "create") {
    await props.store.createProject(name, "A320", form.type, executeDate, form.team);
  } else if (props.project) {
    props.store.updateProject(props.project, { name, team: form.team, type: form.type, executeDate });
  }
  emit("close");
}
</script>

<template>
  <div class="pfm-modal" @click.self="emit('close')">
    <div class="pfm-card">
      <h3>{{ mode === 'create' ? '新建工作项目' : '修订项目' }}</h3>
      <label class="pfm-field">
        <span>项目类型</span>
        <select v-model="form.type" aria-label="项目类型">
          <option v-if="mode === 'edit'" value="">未选择类型</option>
          <option v-for="t in PROJECT_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <label class="pfm-field">
        <span>项目名称</span>
        <input v-model="form.name" placeholder="输入项目名称" />
      </label>
      <label class="pfm-field">
        <span>执行班组</span>
        <select v-model="form.team" aria-label="执行班组">
          <option value="">未分配班组</option>
          <option v-for="team in TEAMS" :key="team">{{ team }}</option>
        </select>
      </label>
      <label class="pfm-field">
        <span>执行日期</span>
        <input type="date" v-model="form.executeDate" aria-label="执行日期" />
      </label>
      <div class="pfm-actions">
        <button class="ghost" @click="emit('close')">取消</button>
        <button class="primary" @click="submit">{{ mode === 'create' ? '创建' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pfm-modal {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(2px);
}
.pfm-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(380px, calc(100% - 48px));
  padding: 22px 26px;
  background: var(--n0);
  border-radius: var(--r-lg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.pfm-card h3 { margin: 0 0 4px; font-size: var(--fs-18); color: var(--n8); }
.pfm-field { display: flex; flex-direction: column; gap: 5px; font-size: var(--fs-13); color: #5f6b7a; }
.pfm-field input, .pfm-field select {
  min-height: 36px;
  padding: 7px 11px;
  border: 1px solid var(--focus);
  border-radius: var(--r-md);
  font-size: var(--fs-14);
  color: var(--blue-dark);
  background: var(--n1);
  transition: border-color var(--t-fast), box-shadow var(--t-fast), background var(--t-fast);
}
.pfm-field input:hover, .pfm-field select:hover { border-color: var(--n5); }
.pfm-field input:focus, .pfm-field select:focus {
  outline: none; background: var(--n0); border-color: var(--blue);
  box-shadow: 0 0 0 3px rgba(68, 114, 196, .16);
}
.pfm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
</style>
