import { computed, reactive, ref } from "vue";
import { backend } from "../api";
import {
  AIRCRAFT_TYPES,
  deepCopy,
  defaultApp,
  normalizeApp,
  normalizeState,
  projectFromDocument,
  projectPayload,
  sectionsFromState,
  stateFromSections,
  unwrapDocument,
} from "../domain/toolbox";
import { parseDay } from "../utils/format";

const STORAGE_KEY = "categoryItemManager.v2";

function loadCache() {
  try { return normalizeApp(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { return defaultApp(); }
}

function listDocuments(payload) {
  const value = payload?.data ?? payload?.documents ?? payload?.items ?? [];
  return Array.isArray(value) ? value : value?.data || [];
}

export function useToolbox() {
  const app = ref(loadCache());
  const screen = ref("list");
  const listTab = ref("tools");
  const detailTab = ref("display");
  const currentProjectId = ref(null);
  const editingLibrary = ref(null);
  const searchDay = ref("");
  const teamFilter = ref("");
  const cloud = reactive({ text: "连接中…", state: "warn", available: false });
  const toast = reactive({ message: "", visible: false });
  const shared = ref(false);
  let toastTimer;
  let saveTimer;
  let remoteSaving = false;
  let remotePending = false;
  let nextId = 1;

  const currentProject = computed(() => app.value.projects.find((item) => item.id === currentProjectId.value) || null);
  const active = computed(() => editingLibrary.value ? app.value.libraries[editingLibrary.value] : currentProject.value?.data || null);
  const detailTitle = computed(() => editingLibrary.value ? `${editingLibrary.value} 标准库` : currentProject.value?.name || "");
  const filteredProjects = computed(() => {
    const query = parseDay(searchDay.value);
    return app.value.projects.filter((project) => {
      if (teamFilter.value && project.team !== teamFilter.value) return false;
      if (!query) return true;
      const delta = Math.abs(new Date(project.createdAt).setHours(0, 0, 0, 0) - query.setHours(0, 0, 0, 0));
      return delta <= 5 * 86400000;
    });
  });

  function computeNextId() {
    let maximum = 0;
    for (const state of [...Object.values(app.value.libraries), ...app.value.projects.map((project) => project.data)]) {
      for (const item of state.items) maximum = Math.max(maximum, Number(item.id) || 0);
    }
    nextId = maximum + 1;
  }

  function notify(message) {
    toast.message = message;
    toast.visible = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.visible = false; }, 2200);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
    clearTimeout(saveTimer);
    if (cloud.available) saveTimer = setTimeout(saveRemote, 450);
  }

  async function saveRemote() {
    if (remoteSaving) {
      remotePending = true;
      return;
    }
    remoteSaving = true;
    try {
      cloud.text = "正在保存…";
      cloud.state = "warn";
      if (editingLibrary.value) {
        await backend.saveTemplate(editingLibrary.value, sectionsFromState(active.value));
      } else if (currentProject.value) {
        await backend.updateProject(currentProject.value.id, projectPayload(currentProject.value));
      } else if (screen.value === "cart") {
        await backend.saveToolCart(app.value.toolCart.map((item) => ({ name: item.name, quantity: item.qty })));
      } else {
        await Promise.all(app.value.projects.filter((project) => project.id).map((project) => backend.updateProject(project.id, projectPayload(project))));
      }
      cloud.text = "已连接 Django · 数据已保存";
      cloud.state = "ok";
    } catch (error) {
      cloud.text = "保存失败 · 已保留本地缓存";
      cloud.state = "err";
      notify(error.message || "保存失败");
    } finally {
      remoteSaving = false;
      if (remotePending) {
        remotePending = false;
        saveRemote();
      }
    }
  }

  function replaceApp(value) {
    app.value = normalizeApp(value);
    computeNextId();
    persist();
  }

  function openProject(id) {
    currentProjectId.value = id;
    editingLibrary.value = null;
    detailTab.value = "display";
    screen.value = "detail";
  }

  function openLibrary(type) {
    editingLibrary.value = type;
    currentProjectId.value = null;
    detailTab.value = "display";
    screen.value = "detail";
  }

  function openCart() {
    editingLibrary.value = null;
    currentProjectId.value = null;
    screen.value = "cart";
  }

  function backToList() {
    screen.value = "list";
    editingLibrary.value = null;
    currentProjectId.value = null;
  }

  async function createProject(name, aircraftType = "A320") {
    const project = {
      id: globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      createdAt: Date.now(),
      aircraftType,
      team: "",
      data: deepCopy(app.value.libraries[aircraftType]),
    };
    if (cloud.available) {
      try {
        const result = await backend.createProject(projectPayload(project));
        project.id = result.data?._id || project.id;
        project.createdAt = result.data?.created_at ? new Date(result.data.created_at).getTime() : project.createdAt;
      } catch (error) { notify(error.message || "云端创建失败，已保存到本地"); }
    }
    app.value.projects.unshift(project);
    persist();
    openProject(project.id);
  }

  async function deleteProject(project) {
    if (cloud.available) {
      try { await backend.deleteProject(project.id); } catch (error) { notify(error.message || "云端删除失败"); return; }
    }
    app.value.projects = app.value.projects.filter((item) => item.id !== project.id);
    persist();
  }

  function updateProject(project, changes) {
    Object.assign(project, changes);
    persist();
  }

  function setAircraftType(type) {
    if (!currentProject.value || !AIRCRAFT_TYPES.includes(type)) return;
    currentProject.value.aircraftType = type;
    currentProject.value.data = deepCopy(app.value.libraries[type]);
    currentProject.value.data.aircraftType = type;
    persist();
  }

  function itemsOf(cat, sub) { return active.value?.items.filter((item) => item.cat === cat && item.sub === sub) || []; }
  function subsOf(cat) { return [...new Set((active.value?.items || []).filter((item) => item.cat === cat).map((item) => item.sub))]; }
  function subTotal(cat, sub) { return itemsOf(cat, sub).reduce((total, item) => total + (+item.qty || 0), 0); }
  function catTotal(cat) { return (active.value?.items || []).filter((item) => item.cat === cat).reduce((total, item) => total + (+item.qty || 0), 0); }
  function allTotal() { return (active.value?.items || []).reduce((total, item) => total + (+item.qty || 0), 0); }
  function isCartDuplicate(name) { return Boolean(active.value?.useCart && app.value.toolCart.some((item) => item.name.trim() === name.trim())); }

  function addCategory(name) {
    if (!active.value || !name || active.value.categories.includes(name)) return;
    active.value.categories.push(name);
    active.value.items.push({ id: nextId++, cat: name, sub: "新工作1", name: "新物品", qty: 1 });
    persist();
  }

  function renameCategory(oldName, name) {
    if (!name || name === oldName || active.value.categories.includes(name)) return;
    active.value.categories[active.value.categories.indexOf(oldName)] = name;
    active.value.items.forEach((item) => { if (item.cat === oldName) item.cat = name; });
    if (active.value.notes[oldName]) active.value.notes[name] = active.value.notes[oldName];
    delete active.value.notes[oldName];
    persist();
  }

  function deleteCategory(cat) {
    active.value.categories = active.value.categories.filter((item) => item !== cat);
    active.value.items = active.value.items.filter((item) => item.cat !== cat);
    delete active.value.notes[cat];
    persist();
  }

  function addSub(cat) {
    const sub = `新工作${subsOf(cat).length + 1}`;
    active.value.items.push({ id: nextId++, cat, sub, name: "新物品", qty: 1 });
    persist();
  }

  function renameSub(cat, oldName, name) {
    if (!name || name === oldName) return;
    active.value.items.forEach((item) => { if (item.cat === cat && item.sub === oldName) item.sub = name; });
    persist();
  }

  function deleteSub(cat, sub) {
    active.value.items = active.value.items.filter((item) => !(item.cat === cat && item.sub === sub));
    persist();
  }

  function importStandardSub(cat, currentSub, key) {
    if (!key) return;
    const [sourceCat, sourceSub] = key.split("||");
    const sourceItems = app.value.libraries[currentProject.value?.aircraftType || "A320"].items.filter((item) => item.cat === sourceCat && item.sub === sourceSub);
    active.value.items = active.value.items.filter((item) => !(item.cat === cat && item.sub === currentSub));
    active.value.items.push(...sourceItems.map((item) => ({ ...deepCopy(item), id: nextId++, cat, sub: sourceSub })));
    persist();
  }

  function addItem(cat, sub) {
    active.value.items.push({ id: nextId++, cat, sub, name: "新物品", qty: 1 });
    persist();
  }

  function deleteItem(id) {
    active.value.items = active.value.items.filter((item) => item.id !== id);
    persist();
  }

  function replaceActive(state) {
    if (editingLibrary.value) app.value.libraries[editingLibrary.value] = normalizeState(state);
    else if (currentProject.value) currentProject.value.data = normalizeState(state);
    computeNextId();
    persist();
  }

  function clearActive() {
    Object.assign(active.value, normalizeState());
    persist();
  }

  function setToolCart(items) {
    app.value.toolCart = items;
    persist();
  }

  async function loadRemote() {
    cloud.text = "正在连接 Django 后端…";
    try {
      const status = await backend.status();
      if (!status.configured) {
        cloud.text = "后端已连接 · CloudBase 尚未配置";
        cloud.state = "warn";
        return;
      }
      const [projects, a320, b787, cart] = await Promise.all([
        backend.listProjects(),
        backend.getTemplate("A320").catch(() => null),
        backend.getTemplate("B787").catch(() => null),
        backend.getToolCart().catch(() => null),
      ]);
      const libraries = {
        A320: unwrapDocument(a320?.data) ? stateFromSections(unwrapDocument(a320.data).sections) : app.value.libraries.A320,
        B787: unwrapDocument(b787?.data) ? stateFromSections(unwrapDocument(b787.data).sections) : app.value.libraries.B787,
      };
      const cartDocument = unwrapDocument(cart?.data);
      const toolCart = (cartDocument?.items || []).map((item) => ({ name: String(item.name || ""), qty: Math.max(0, Number.parseInt(item.quantity ?? item.qty, 10) || 0) }));
      app.value = normalizeApp({ libraries, projects: listDocuments(projects).map(projectFromDocument), toolCart });
      computeNextId();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(app.value));
      cloud.available = true;
      cloud.text = "已连接 Django · 数据已同步";
      cloud.state = "ok";
    } catch (error) {
      cloud.text = "后端连接失败 · 正在使用本地缓存";
      cloud.state = "err";
      notify(error.message || "无法连接后端");
    }
  }

  computeNextId();
  return {
    app, screen, listTab, detailTab, currentProject, editingLibrary, active, detailTitle,
    searchDay, teamFilter, filteredProjects, cloud, toast, shared,
    notify, persist, replaceApp, openProject, openLibrary, openCart, backToList,
    createProject, deleteProject, updateProject, setAircraftType,
    itemsOf, subsOf, subTotal, catTotal, allTotal, isCartDuplicate,
    addCategory, renameCategory, deleteCategory, addSub, renameSub, deleteSub,
    importStandardSub, addItem, deleteItem, replaceActive, clearActive, setToolCart, loadRemote,
  };
}
