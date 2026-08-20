<script setup lang="ts">
import { onMounted, onUnmounted, nextTick, ref } from "vue";
import html2canvas from "html2canvas";
import AppHeader from "./components/AppHeader.vue";
import ProjectList from "./components/ProjectList.vue";
import ProjectDetail from "./components/ProjectDetail.vue";
import ToolCart from "./components/ToolCart.vue";
import StandardLibraryTable from "./components/StandardLibraryTable.vue";
import AircraftUpdateModal from "./components/AircraftUpdateModal.vue";
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
import { setForceDesktop } from "./composables/useResponsiveGrid";
import { exportJson, exportState, importCart, importState } from "./services/spreadsheet";
import { copyText, createShareUrl, readSharePayload, projectShareUrl, type SharePayload } from "./services/sharing";
import { download, exportFileName, formatDay } from "./utils/format";

const store = useToolbox();

// —— 无密码身份标识弹窗 ——
const showIdentityModal = ref(false);
const identityDraft = ref("");

async function submitIdentity(): Promise<void> {
  if (await store.setIdentity(identityDraft.value)) {
    identityDraft.value = "";
    showIdentityModal.value = false;
  }
}
function switchIdentity(): void {
  identityDraft.value = "";
  showIdentityModal.value = true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

const previewImage = ref<string | null>(null);
let previewUrl: string | null = null;
let lastImageName = "导出图片.jpg";

function closePreview(): void {
  previewImage.value = null;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
}

function downloadPreview(): void {
  if (!previewUrl) return;
  const anchor = document.createElement("a");
  anchor.href = previewUrl;
  anchor.download = lastImageName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function exportImage(element: HTMLElement | null, subPageName = ""): Promise<void> {
  if (!element) return;
  lastImageName = `${exportFileName(store.currentProject.value?.name || store.detailTitle.value, subPageName)}.jpg`;
  // 移动端按网页宽屏（1100px、3 列）重排后再截，得到“网页宽屏长截图”
  const isMobile = window.innerWidth < 768;
  const prevOverflow = document.body.style.overflow;
  const cleanup = (): void => {
    element.classList.remove("exporting");
    store.forceExpandAll.value = false;
    if (isMobile) {
      setForceDesktop(false);
      element.style.width = "";
      document.body.style.overflow = prevOverflow;
    }
  };
  try {
    store.notify("正在生成图片…");
    // 导出前强制展开所有部位卡片，保证长图完整
    store.forceExpandAll.value = true;
    if (isMobile) {
      setForceDesktop(true);
      element.style.width = "1100px";
      // 防止临时加宽导致页面出现横向滚动条
      document.body.style.overflow = "hidden";
    }
    await nextTick();
    // 等 ResizeObserver 把各工作卡片内的 item-grid 按新宽度重排列数
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150))));
    // 导出时让返回栏 + 功能按钮行脱离 sticky，稳定停在长图最上方（不被吸顶/重叠干扰）
    element.classList.add("exporting");

    // 渲染循环：iOS 对超限 canvas（任一边长 > ~4096）调 toBlob/drawImage 会抛
    // SecurityError("the operation is insecure")，且超限 canvas 在 iOS 上连 drawImage 读取都抛错，
    // 无法事后缩放。故必须保证 html2canvas 生成的 canvas 不超限：
    // 先按内容高度估 scale，渲染后若实际 canvas 仍超限（或渲染本身抛错）则按真实尺寸缩小 scale 重试。
    const SAFE = 4096;
    let scale: number;
    if (isMobile) {
      const w = element.scrollWidth || element.offsetWidth || 1100;
      const h = element.scrollHeight || element.offsetHeight || 0;
      scale = Math.max(w, h) > SAFE ? SAFE / Math.max(w, h) : 1;
    } else {
      scale = Math.min(2, window.devicePixelRatio || 1);
    }
    const baseOpts = { backgroundColor: "#f4f6fb", useCORS: true, windowWidth: isMobile ? 1100 : window.innerWidth };
    let canvas: HTMLCanvasElement | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4 && !canvas; attempt++) {
      try {
        const c = await html2canvas(element, { ...baseOpts, scale });
        if (c.width > SAFE || c.height > SAFE) {
          // 实际画布仍超限：按真实尺寸反算更小 scale 后重试
          scale = (scale * SAFE) / Math.max(c.width, c.height);
          lastErr = null;
          continue;
        }
        canvas = c;
      } catch (renderErr) {
        // 渲染本身抛错（多为 iOS 无法创建超限 canvas）：缩小 scale 后重试
        lastErr = renderErr;
        scale *= 0.5;
      }
    }
    if (!canvas) {
      cleanup();
      const m = lastErr instanceof Error ? `${lastErr.name} ${lastErr.message}` : (lastErr ? String(lastErr) : "画布尺寸超限，无法生成");
      store.notify(`导出失败(渲染): ${m}`);
      return;
    }
    cleanup();
    // 导出：iOS 对受污染/超限 canvas 调 toBlob 会同步抛 SecurityError，单独捕获并附带画布尺寸便于定位
    try {
      canvas.toBlob((blob) => {
        if (!blob) { store.notify(`生成图片失败：blob 为空 | canvas=${canvas!.width}x${canvas!.height}`); return; }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        previewImage.value = previewUrl;
        // 电脑端（非 iOS）直接触发下载；iOS 不支持 blob 下载，靠预览层长按保存
        const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent);
        if (!isIOS) download(blob, lastImageName);
      }, "image/jpeg", 0.92);
    } catch (blobErr) {
      const m = blobErr instanceof Error ? `${blobErr.name} ${blobErr.message}` : String(blobErr);
      store.notify(`导出失败(toBlob): ${m} | canvas=${canvas.width}x${canvas.height}`);
    }
  } catch (error) {
    cleanup();
    store.notify(errorMessage(error) || "生成图片失败");
  }
}

async function importActive(file: File): Promise<void> {
  try {
    store.replaceActive(await importState(file));
    store.notify("标准库导入完成");
  } catch (error) { store.notify(`导入失败：${errorMessage(error)}`); }
}

/** “导入新部位.xlsx”：解析后合并进当前标准库（只补不覆盖），由 store 实现合并逻辑。 */
async function importNewSections(file: File): Promise<void> {
  try {
    const imported = await importState(file);
    const { addedCats, addedItems } = store.mergeImportedSections(imported);
    store.notify(`导入新部位完成：新增部位 ${addedCats} 个，补充物品 ${addedItems} 项`);
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
  // 无密码身份标识：首次（或本设备无身份）时弹窗输入姓名
  if (!store.identityReady.value) showIdentityModal.value = true;
  // 启动每 2 秒自动同步（推送本地变更到云端，不覆盖本地编辑）
  store.startAutoSync(2000);
  // 根据远端配置启动 watch 实时推送或轮询（loadRemote 成功后内部已按配置启动，
  // 此处兜底：若 loadRemote 因故未成功，确保至少轮询在跑）。幂等，可安全重复调用。
  store.syncRealtimeMode();
});

onUnmounted(() => {
  store.stopPolling();
  store.stopWatch();
});

function exportCurrentState(displayCats?: string[]): void {
  if (!store.active.value) return;
  const active = store.active.value;
  // 仅导出集中显示页面上(displayCats)的工具，删除非显示部位数据
  const cats = displayCats && displayCats.length ? displayCats : active.categories;
  const filtered: ToolState = {
    ...active,
    categories: cats.filter((c) => active.categories.includes(c)),
    items: active.items.filter((it) => cats.includes(it.cat)),
  };
  exportState(filtered, exportFileName(store.currentProject.value?.name || store.detailTitle.value, "工具清单"));
}
</script>

<template>
  <AppHeader :cloud="store.cloud" :watch-active="store.watchActive.value" :identity-name="store.identityName.value" @switch-identity="switchIdentity" />
  <main :class="{ 'gantt-full': store.screen.value === 'detail' && store.currentProject.value?.type === '换发/APU' }">
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
      @import-new-sections="importNewSections"
      @share="share('detail')"
    />
    <StandardLibraryTable v-else-if="store.screen.value === 'stdlib'" :store="store" />
    <ToolCart v-else :store="store" @import-sheet="importToolCart" @share="share('cart')" />
  </main>

  <div v-if="store.syncing.value" class="sync-overlay">
    <div class="sync-overlay-card">
      <div class="sync-spinner" aria-hidden="true"></div>
      <p>加载中，正在同步数据…</p>
      <button class="ghost" @click="store.backToList()">返回</button>
    </div>
  </div>

  <div v-if="showIdentityModal" class="identity-modal">
    <div class="identity-modal-card">
      <h3>请输入您的姓名</h3>
      <p class="identity-hint">用于标识操作身份（2-5 个字符），同设备下次自动登录。</p>
      <input v-model="identityDraft" maxlength="5" placeholder="姓名（2-5 个字符）" autofocus @keydown.enter="submitIdentity" />
      <div class="identity-actions">
        <button class="ghost" @click="showIdentityModal = false">跳过</button>
        <button class="primary" :disabled="identityDraft.trim().length < 2 || identityDraft.trim().length > 5" @click="submitIdentity">进入系统</button>
      </div>
    </div>
  </div>

  <aside v-if="store.shared.value" class="share-banner">
    <span>你正在查看通过链接分享的内容（尚未保存到本地）。</span>
    <div class="spacer" />
    <button class="primary" @click="saveShared">保存到本地</button>
    <button @click="cancelShared">取消</button>
  </aside>
  <div class="toast" :class="{ show: store.toast.visible }">{{ store.toast.message }}</div>

  <AircraftUpdateModal :store="store" />

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

<style scoped>
/* 全屏「加载中」冻结遮罩：仅允许操作其中的「返回」按钮 */
.sync-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(2px);
}
.sync-overlay-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 28px 36px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.sync-overlay-card p {
  margin: 0;
  color: #333;
  font-size: 15px;
}
.sync-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #e5e7eb;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: sync-spin 0.8s linear infinite;
}
@keyframes sync-spin {
  to { transform: rotate(360deg); }
}
.identity-modal {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(2px);
}
.identity-modal-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 28px 32px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  width: min(360px, calc(100% - 48px));
}
.identity-modal-card h3 { margin: 0; color: #333; font-size: 17px; }
.identity-hint { margin: 0; color: #888; font-size: 13px; line-height: 1.5; }
.identity-modal-card input { padding: 8px 12px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 15px; }
.identity-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
