<script setup lang="ts">
import { onMounted, ref } from "vue";
import { backend } from "../api";
import { PROJECT_TYPES } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ close: [] }>();

interface ControlDoc { _id: string; type: string; fileName: string; cloudObjectId: string; uploadedAt?: string; }
const docs = ref<ControlDoc[]>([]);
const uploadType = ref<string>("A检");
const uploading = ref(false);

async function load(): Promise<void> {
  try {
    const res = await backend.listControlDocs();
    docs.value = (res.data || []) as ControlDoc[];
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "加载失败");
  }
}
onMounted(load);

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function onUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  uploading.value = true;
  try {
    const content = await fileToBase64(file);
    await backend.uploadControlDoc({ type: uploadType.value, fileName: file.name, content });
    props.store.notify(`已上传「${uploadType.value}」现场管控单：${file.name}`);
    await load();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "上传失败");
  } finally {
    uploading.value = false;
  }
}

async function onDownload(doc: ControlDoc): Promise<void> {
  try {
    const res = await backend.getControlDocUrl(doc._id);
    const url = res.data?.downloadUrl;
    if (!url) { props.store.notify("未获取到下载链接"); return; }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = doc.fileName || "";
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "获取下载链接失败");
  }
}

async function onDelete(doc: ControlDoc): Promise<void> {
  if (!window.confirm(`确认删除「${doc.type}」的现场管控单「${doc.fileName}」？`)) return;
  try {
    await backend.deleteControlDoc(doc._id);
    props.store.notify("已删除");
    await load();
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "删除失败");
  }
}
</script>

<template>
  <div class="cdm">
    <div class="cdm-head">
      <button class="ghost" @click="emit('close')">← 返回数据库</button>
      <h3>现场管控单维护</h3>
    </div>

    <div class="cdm-upload">
      <select v-model="uploadType" aria-label="项目类型">
        <option v-for="t in PROJECT_TYPES" :key="t" :value="t">{{ t }}</option>
      </select>
      <label class="button primary" :class="{ disabled: uploading }">{{ uploading ? '上传中…' : '上传现场管控单' }}
        <input hidden type="file" accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png" :disabled="uploading" @change="onUpload" />
      </label>
    </div>

    <p class="cdm-hint">每个项目类型保留一份现场管控单文件，上传同名文件会覆盖。工具清单子页的「下载现场管控单」按当前项目类型下载对应文件。</p>

    <table v-if="docs.length" class="cdm-table">
      <thead>
        <tr><th>项目类型</th><th>文件名</th><th>上传时间</th><th>fileid</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="doc in docs" :key="doc._id">
          <td>{{ doc.type }}</td>
          <td class="cdm-name">{{ doc.fileName }}</td>
          <td>{{ (doc.uploadedAt || '').slice(0, 19).replace('T', ' ') }}</td>
          <td class="cdm-id">{{ doc.cloudObjectId }}</td>
          <td class="cdm-ops">
            <button class="ghost" @click="onDownload(doc)">下载</button>
            <button class="danger" @click="onDelete(doc)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty-state">暂无现场管控单，请先上传。</div>
  </div>
</template>

<style scoped>
.cdm { padding: 4px 0 24px; }
.cdm-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.cdm-head h3 { margin: 0; font-size: 15px; }
.cdm-upload { display: flex; gap: 8px; margin-bottom: 8px; }
.cdm-upload select { min-height: 32px; padding: 4px 8px; border: 1px solid var(--focus); border-radius: var(--r-md); }
.cdm-hint { margin: 0 0 12px; font-size: 12px; color: var(--n7); }
.cdm-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--n3); border-radius: var(--r-md); overflow: hidden; font-size: 13px; }
.cdm-table th, .cdm-table td { padding: 8px 10px; border-bottom: 1px solid var(--n3); text-align: left; }
.cdm-table th { background: var(--n1); font-weight: 600; color: var(--n8); }
.cdm-name { word-break: break-all; }
.cdm-id { font-family: monospace; font-size: 11px; color: #697386; word-break: break-all; max-width: 260px; }
.cdm-ops { display: flex; gap: 6px; }
.cdm-ops button { min-height: 28px; padding: 3px 8px; font-size: 12px; }
</style>
