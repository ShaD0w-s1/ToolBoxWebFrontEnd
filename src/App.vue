<script setup lang="ts">
import { onMounted, nextTick, ref } from "vue";
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
import { exportJson, exportState, importCart, importState } from "./services/spreadsheet";
import { copyText, createShareUrl, readSharePayload, type SharePayload } from "./services/sharing";
import { download, formatDay } from "./utils/format";

const store = useToolbox();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

const previewImage = ref<string | null>(null);
let previewUrl: string | null = null;

function closePreview(): void {
  previewImage.value = null;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
}

function downloadPreview(): void {
  if (!previewUrl) return;
  const anchor = document.createElement("a");
  anchor.href = previewUrl;
  anchor.download = `${store.detailTitle.value}_集中显示.jpg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function exportImage(element: HTMLElement | null): Promise<void> {
  if (!element) return;
  try {
    store.notify("正在生成图片…");
    // 导出前强制展开所有部位卡片，保证长图完整
    store.forceExpandAll.value = true;
    await nextTick();
    // 手机端用 scale=1 避免画布尺寸超限导致生成失败
    const scale = window.innerWidth < 768 ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const canvas = await html2canvas(element, { backgroundColor: "#f4f6fb", scale, useCORS: true });
    store.forceExpandAll.value = false;
    canvas.toBlob((blob) => {
      if (!blob) { store.notify("生成图片失败"); return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      previewImage.value = previewUrl;
      // 电脑端（非 iOS）直接触发下载；iOS 不支持 blob 下载，靠预览层长按保存
      const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent);
      if (!isIOS) download(blob, `${store.detailTitle.value}_集中显示.jpg`);
    }, "image/jpeg", 0.92);
  } catch (error) {
    store.forceExpandAll.value = false;
    store.notify(errorMessage(error) || "生成图片失败");
  }
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

/** 一级页面（列表）分享链接：直接用裸域名，列表数据来自后端共享，无需内联。 */
function baseUrl(): string {
  return location.origin + location.pathname.replace(/index\.html$/i, "");
}
/** 二级页面（某个工作项目）分享链接：base/?p=工作项目名称/日期（查询格式，零配置、不触发 404）。 */
function projectShareUrl(project: Project): string {
  return `${baseUrl()}?p=${encodeURIComponent(project.name)}/${formatDay(project.createdAt)}`;
}

async function share(scope: SharePayload["scope"]): Promise<void> {
  try {
    if (scope === "app") {
      // 一级页面：直接分享裸域名（列表数据由后端共享，接收方打开即见同一列表）
      await copyText(baseUrl());
      store.notify("一级页面链接已复制");
      return;
    }
    if (scope === "detail" && !store.editingLibrary.value && store.currentProject.value) {
      // 二级页面（工作项目）：用干净的查询格式链接，接收方按名称+日期在后端匹配打开
      await copyText(projectShareUrl(store.currentProject.value));
      store.notify("二级页面链接已复制");
      return;
    }
    // 标准库 / 工具车：仍用内联 #s= 方式（自带数据，跨设备稳健），保持旧行为
    let payload: SharePayload;
    if (scope === "cart") payload = { v: 1, scope, data: store.app.value.toolCart };
    else payload = {
      v: 1,
      scope,
      library: store.editingLibrary.value,
      project: store.editingLibrary.value
        ? { id: "__lib__", name: store.detailTitle.value, data: store.active.value }
        : store.currentProject.value,
    };
    const longUrl = await createShareUrl(payload);
    await copyText(longUrl);
    store.notify("分享链接已复制");
  }
  catch { store.notify("复制失败，请检查浏览器权限"); }
}

/** 打开带 ?p=名称/日期 的分享链接：从已加载（后端/本地缓存）的项目中按名称+日期匹配并打开。 */
function openFromQuery(): void {
  const p = new URLSearchParams(location.search).get("p");
  if (!p) return;
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return;
  const name = decodeURIComponent(p.slice(0, idx));
  const date = p.slice(idx + 1);
  const project = store.app.value.projects.find(
    (item) => item.name === name && formatDay(item.createdAt) === date,
  );
  if (project) {
    store.openProject(project.id);
    history.replaceState(null, "", baseUrl());
  } else {
    store.notify("未找到该项目，可能已被删除或尚未同步");
  }
}

/** 将分享数据先载入内存，用户确认保存后才写入本地缓存。 */
async function applySharedPayload(): Promise<void> {
  const payload = await readSharePayload();
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
  const payload = await readSharePayload();
  if (payload?.scope) {
    // 旧版内联 #s= 分享链接（标准库/工具车/历史项目链接）仍兼容
    await applySharedPayload();
  } else {
    await store.loadRemote();
    openFromQuery();
  }
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

  <div v-if="previewImage" class="img-preview" @click="closePreview">
    <div class="img-preview-inner" @click.stop>
      <img :src="previewImage" alt="导出图片预览" />
      <p class="img-hint">手机端可长按图片保存；电脑端已自动下载（也可点下方按钮）。</p>
      <div class="img-actions">
        <button class="primary" @click="downloadPreview">下载</button>
        <button @click="closePreview">关闭</button>
      </div>
    </div>
  </div>
</template>
