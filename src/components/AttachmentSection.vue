<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";
import type { AttachmentMeta } from "../domain/toolbox";
import { backend } from "../api";

/**
 * 准备单附件卡片（换发/APU + 单独项目 准备单子页末尾）。
 * - 元数据（名称/日期/下载/删除）挂在 prep 数据顶层（GanttPrepState.attachments / StandalonePrepSheet.attachments），
 *   随项目保存、随模板保存/调取全量透传（apply/merge 均 spread 全键）。
 * - 文件实体存云存储（fileKey 共享对象）：删除附件仅移引用（懒清理，见评估决策 A）。
 */
const props = defineProps<{ store: ToolboxStore }>();

const project = computed(() => props.store.currentProject.value);
const isEng = computed(() => project.value?.type === "换发/APU");
/** 附件容器（数组引用）。 */
function holder(): AttachmentMeta[] | null {
  const p = project.value;
  if (!p) return null;
  if (isEng.value) {
    if (!p.ganttPrep.attachments) p.ganttPrep.attachments = [];
    return p.ganttPrep.attachments;
  }
  if (p.type === "单独项目") {
    if (!p.standalonePrepSheet.attachments) p.standalonePrepSheet.attachments = [];
    return p.standalonePrepSheet.attachments;
  }
  return null;
}
const list = computed<AttachmentMeta[]>(() => holder() || []);

const uploading = ref(false);
const MAX_SIZE = 5 * 1024 * 1024; // base64 中转上限 8MB → 单文件建议 ≤5MB（安全余量）

function genId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* 忽略 */ }
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function onUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !props.store.identityName.value.trim()) {
    if (!file) return;
    props.store.notify("请先在上方设置姓名", "err");
    return;
  }
  if (file.size > MAX_SIZE) { props.store.notify("单个附件请勿超过 5MB（base64 中转上限）", "err"); return; }
  const arr = holder();
  if (!arr) { props.store.notify("当前项目类型不支持附件", "err"); return; }
  uploading.value = true;
  try {
    const content = await fileToBase64(file);
    const res = await backend.uploadPrepAttachment({ fileName: file.name, content });
    const meta = (res.data || {}) as { fileKey: string; name: string; size: number };
    if (!meta.fileKey) { props.store.notify("上传失败：未返回存储 key", "err"); return; }
    arr.push({ id: genId(), name: meta.name || file.name, fileKey: meta.fileKey, size: meta.size || file.size, uploadedAt: new Date().toISOString() });
    props.store.persist();
    props.store.notify(`附件已上传：${file.name}`, "ok");
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "上传失败", "err");
  } finally {
    uploading.value = false;
  }
}

const downloadingKey = ref("");
async function download(att: AttachmentMeta): Promise<void> {
  if (downloadingKey.value === att.fileKey) return;
  downloadingKey.value = att.fileKey;
  try {
    const res = await backend.getPrepAttachmentUrl(att.fileKey);
    const url = (res.data as { downloadUrl?: string } | undefined)?.downloadUrl;
    if (!url) { props.store.notify("未获取到下载链接", "err"); return; }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = att.name || "附件";
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (e) {
    props.store.notify(e instanceof Error ? e.message : "下载失败", "err");
  } finally {
    downloadingKey.value = "";
  }
}

function remove(att: AttachmentMeta): void {
  if (!window.confirm(`确认移除附件“${att.name}”？仅移除本准备单引用（云端文件保留，供模板/其它项目共享）。`)) return;
  const arr = holder();
  if (!arr) return;
  const idx = arr.findIndex((a) => a.id === att.id);
  if (idx >= 0) arr.splice(idx, 1);
  props.store.persist();
  props.store.notify("附件已移除", "ok");
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
</script>

<template>
  <section class="prep-block att-section">
    <div class="att-head">
      <h4>附件</h4>
      <div class="att-actions">
        <label class="button ghost" :class="{ disabled: uploading }">
          {{ uploading ? '上传中…' : '上传附件' }}
          <input hidden type="file" :disabled="uploading" @change="onUpload" />
        </label>
      </div>
    </div>
    <p v-if="!list.length" class="att-empty">暂无附件 — 上传与准备单相关的文件（图纸 / 手册 / 现场资料等），随模板保存与调取。</p>
    <div v-else class="att-list">
      <div v-for="att in list" :key="att.id" class="att-row">
        <span class="att-name" :title="att.name">{{ att.name }}</span>
        <span class="att-date">{{ fmtDate(att.uploadedAt) }}</span>
        <span class="att-size" v-if="att.size">{{ (att.size / 1024).toFixed(1) }}KB</span>
        <div class="att-ops">
          <button class="ghost" :disabled="downloadingKey === att.fileKey" @click="download(att)">{{ downloadingKey === att.fileKey ? '获取中…' : '下载' }}</button>
          <button class="ghost danger-cell" @click="remove(att)">删除</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.att-section { margin-top: 4px; }
.att-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.att-head h4 {
  margin: 0; font-size: var(--fs-14, 14px); background: var(--blue, #2f5597); color: #fff;
  padding: 8px 12px; border-radius: var(--r-md, 8px);
}
.att-empty { color: var(--n7, #889); font-size: var(--fs-13, 13px); margin: 0; padding: 6px 0; }
.att-list { display: flex; flex-direction: column; }
.att-row {
  display: flex; align-items: center; gap: 12px; padding: 8px 4px;
  border-bottom: 1px solid var(--n3, #dde3ec);
}
.att-row:last-child { border-bottom: none; }
.att-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-14, 14px); font-weight: 600; color: var(--n9, #222); }
.att-date { flex: 0 0 auto; font-size: var(--fs-12, 12px); color: var(--n7, #889); }
.att-size { flex: 0 0 auto; font-size: var(--fs-12, 12px); color: var(--n6, #a0a9b6); }
.att-ops { flex: 0 0 auto; display: flex; gap: 6px; }
</style>
