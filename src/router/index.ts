import { createRouter, createWebHashHistory } from "vue-router";

/**
 * 路由表（hash 模式，兼容 CloudBase 静态托管 + vite base:"./"）。
 * 说明：视图仍由 App.vue 顶层 v-if 按 store.screen 渲染（保留 emit 链），
 * 本 router 仅承担 URL 结构 + 深链恢复 + 前进/后退历史；component 字段为未来迁移 router-view 预留。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "list", component: () => import("../components/ProjectList.vue") },
    { path: "/project/:id", name: "project", component: () => import("../components/ProjectDetail.vue") },
    { path: "/library/:type", name: "library", component: () => import("../components/ProjectDetail.vue") },
    { path: "/material/:type", name: "material", component: () => import("../components/ProjectDetail.vue") },
    { path: "/stdlib/:key", name: "stdlib", component: () => import("../components/StandardLibraryTable.vue") },
    { path: "/cart", name: "cart", component: () => import("../components/ToolCart.vue") },
    { path: "/:pathMatch(.*)*", name: "not-found", redirect: "/" },
  ],
});
