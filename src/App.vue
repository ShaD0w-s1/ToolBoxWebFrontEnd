<script setup>
import { onMounted } from "vue";
import html2canvas from "html2canvas";
import AppHeader from "./components/AppHeader.vue";
import ProjectList from "./components/ProjectList.vue";
import ProjectDetail from "./components/ProjectDetail.vue";
import ToolCart from "./components/ToolCart.vue";
import { normalizeApp } from "./domain/toolbox";
import { useToolbox } from "./composables/useToolbox";
import { exportJson, exportState, importCart, importJson, importState } from "./services/spreadsheet";
import { copyText, createShareUrl, readSharePayload } from "./services/sharing";
import { download } from "./utils/format";

const store = useToolbox();

async function exportImage(element) {
  if (!element) return;
  try {
    store.notify("正在生成图片…");
    const canvas = await html2canvas(element, { backgroundColor: "#f4f6fb", scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true });
    canvas.toBlob((blob) => {
      if (blob) download(blob, `${store.detailTitle.value}_集中显示.jpg`);
    }, "image/jpeg", 0.92);
  } catch (error) { store.notify(error.message || "生成图片失败"); }
}

async function importAll(file) {
  try {
    const value = await importJson(file);
    if (!value.projects) throw new Error("文件中缺少 projects 数据");
    store.replaceApp(value);
    store.notify("全部数据导入完成");
  } catch (error) { store.notify(`导入失败：${error.message}`); }
}

async function importActive(file) {
  try {
    store.replaceActive(await importState(file));
    store.notify("标准库导入完成");
  } catch (error) { store.notify(`导入失败：${error.message}`); }
}

async function importToolCart(file) {
  try {
    const items = await importCart(file);
    if (window.confirm(`确认用导入的 ${items.length} 项覆盖工具车数据库？`)) {
      store.setToolCart(items);
      store.notify("工具车导入完成");
    }
  } catch (error) { store.notify(`导入失败：${error.message}`); }
}

async function share(scope) {
  let payload;
  if (scope === "app") payload = { v: 1, scope, data: store.app.value };
  if (scope === "cart") payload = { v: 1, scope, data: store.app.value.toolCart };
  if (scope === "detail") payload = {
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

function applySharedPayload() {
  const payload = readSharePayload();
  if (!payload?.scope) return;
  try {
    if (payload.scope === "app") store.app.value = normalizeApp(payload.data);
    else if (payload.scope === "cart") { store.app.value.toolCart = payload.data || []; store.openCart(); }
    else if (payload.scope === "detail" && payload.project) {
      if (payload.library) {
        store.app.value.libraries[payload.library] = payload.project.data;
        store.openLibrary(payload.library);
      } else {
        const project = payload.project;
        const index = store.app.value.projects.findIndex((item) => item.id === project.id);
        if (index >= 0) store.app.value.projects[index] = project;
        else store.app.value.projects.push(project);
        store.openProject(project.id);
      }
    }
    store.shared.value = true;
  } catch (error) { store.notify(`分享内容加载失败：${error.message}`); }
}

function saveShared() {
  store.persist();
  store.shared.value = false;
  history.replaceState(null, "", location.pathname + location.search);
  store.notify("分享内容已保存");
}

function cancelShared() {
  location.href = location.href.split("#")[0];
}

onMounted(async () => {
  applySharedPayload();
  if (!store.shared.value) await store.loadRemote();
});
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
      @export-sheet="exportState(store.active.value, store.detailTitle.value)"
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
