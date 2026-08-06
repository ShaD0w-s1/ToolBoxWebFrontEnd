<script setup lang="ts">
import { onMounted } from "vue";
import html2canvas from "html2canvas";
import AppHeader from "./components/AppHeader.vue";
import ProjectList from "./components/ProjectList.vue";
import ProjectDetail from "./components/ProjectDetail.vue";
import ToolCart from "./components/ToolCart.vue";
import {
  AIRCRAFT_TYPES,
  normalizeApp,
  normalizeState,
  type AircraftType,
  type AppInput,
  type Project,
  type ToolCartItem,
  type ToolState,
} from "./domain/toolbox";
import { useToolbox } from "./composables/useToolbox";
import { exportJson, exportState, importCart, importJson, importState } from "./services/spreadsheet";
import { copyText, createShareUrl, readSharePayload, type SharePayload } from "./services/sharing";
import { download } from "./utils/format";

const store = useToolbox();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

async function exportImage(element: HTMLElement | null): Promise<void> {
  if (!element) return;
  try {
    store.notify("正在生成图片…");
    const canvas = await html2canvas(element, { backgroundColor: "#f4f6fb", scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true });
    canvas.toBlob((blob) => {
      if (blob) download(blob, `${store.detailTitle.value}_集中显示.jpg`);
    }, "image/jpeg", 0.92);
  } catch (error) { store.notify(errorMessage(error) || "生成图片失败"); }
}

async function importAll(file: File): Promise<void> {
  try {
    const value = await importJson(file);
    if (!value || typeof value !== "object" || !("projects" in value)) throw new Error("文件中缺少 projects 数据");
    store.replaceApp(normalizeApp(value as AppInput));
    store.notify("全部数据导入完成");
  } catch (error) { store.notify(`导入失败：${errorMessage(error)}`); }
}

async function importActive(file: File): Promise<void> {
  try {
    store.replaceActive(await importState(file));
    store.notify("标准库导入完成");
  } catch (error) { store.notify(`导入失败：${errorMessage(error)}`); }
}

async function importToolCart(file: File): Promise<void> {
  try {
    const items = await importCart(file);
    if (window.confirm(`确认用导入的 ${items.length} 项覆盖工具车数据库？`)) {
      store.setToolCart(items);
      store.notify("工具车导入完成");
    }
  } catch (error) { store.notify(`导入失败：${errorMessage(error)}`); }
}

async function share(scope: SharePayload["scope"]): Promise<void> {
  let payload: SharePayload;
  if (scope === "app") payload = { v: 1, scope, data: store.app.value };
  else if (scope === "cart") payload = { v: 1, scope, data: store.app.value.toolCart };
  else payload = {
    v: 1,
    scope,
    library: store.editingLibrary.value,
    project: store.editingLibrary.value
      ? { id: "__lib__", name: store.detailTitle.value, data: store.active.value }
      : store.currentProject.value,
  };
  try { await copyText(createShareUrl(payload)); store.notify("分享链接已复制"); }
  catch { store.notify("复制失败，请检查浏览器权限"); }
}

/** 将分享数据先载入内存，用户确认保存后才写入本地缓存。 */
function applySharedPayload(): void {
  const payload = readSharePayload();
  if (!payload?.scope) return;
  try {
    if (payload.scope === "app") store.app.value = normalizeApp((payload.data || {}) as AppInput);
    else if (payload.scope === "cart") {
      store.app.value.toolCart = Array.isArray(payload.data) ? payload.data as ToolCartItem[] : [];
      store.openCart();
    }
    else if (payload.scope === "detail" && payload.project) {
      const rawProject = payload.project as Partial<Project> & { data?: ToolState };
      const library = AIRCRAFT_TYPES.includes(payload.library as AircraftType) ? payload.library as AircraftType : null;
      if (library) {
        store.app.value.libraries[library] = normalizeState(rawProject.data);
        store.openLibrary(library);
      } else {
        const project = normalizeApp({ projects: [rawProject as Project] }).projects[0];
        const index = store.app.value.projects.findIndex((item) => item.id === project.id);
        if (index >= 0) store.app.value.projects[index] = project;
        else store.app.value.projects.push(project);
        store.openProject(project.id);
      }
    }
    store.shared.value = true;
  } catch (error) { store.notify(`分享内容加载失败：${errorMessage(error)}`); }
}

function saveShared(): void {
  store.persist();
  store.shared.value = false;
  history.replaceState(null, "", location.pathname + location.search);
  store.notify("分享内容已保存");
}

function cancelShared(): void {
  location.href = location.href.split("#")[0];
}

onMounted(async () => {
  applySharedPayload();
  if (!store.shared.value) await store.loadRemote();
});

function exportCurrentState(): void {
  if (store.active.value) exportState(store.active.value, store.detailTitle.value);
}
</script>

<template>
  <AppHeader :cloud="store.cloud" />
  <main>
    <ProjectList
      v-if="store.screen.value === 'list'"
      :store="store"
      @export-all="exportJson(store.app.value)"
      @import-all="importAll"
      @share="share('app')"
    />
    <ProjectDetail
      v-else-if="store.screen.value === 'detail'"
      :store="store"
      @export-sheet="exportCurrentState"
      @export-image="exportImage"
      @import-sheet="importActive"
      @share="share('detail')"
    />
    <ToolCart v-else :store="store" @import-sheet="importToolCart" @share="share('cart')" />
  </main>

  <aside v-if="store.shared.value" class="share-banner">
    <span>你正在查看通过链接分享的内容（尚未保存到本地）。</span>
    <div class="spacer" />
    <button class="primary" @click="saveShared">保存到本地</button>
    <button @click="cancelShared">取消</button>
  </aside>
  <div class="toast" :class="{ show: store.toast.visible }">{{ store.toast.message }}</div>
</template>
