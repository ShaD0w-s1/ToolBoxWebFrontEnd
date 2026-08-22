<script setup lang="ts">
import { computed, ref } from "vue";
import { AIRCRAFT_TYPES, type AircraftType } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";

const props = defineProps<{ store: ToolboxStore; type: AircraftType }>();
const emit = defineEmits<{ close: [] }>();

const type = ref<AircraftType>(props.type);
const matLib = computed(() => props.store.app.value.materialLibraries[type.value]);
const toolLib = computed(() => props.store.app.value.libraries[type.value]);

/** 归一化：忽略大小写与全角/半角符号（与筛选逻辑 normalizeMatch 一致）。 */
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^一-鿿a-z0-9]/g, "");
}

interface CompareRow { 航材: string; 工具: string; same: boolean; }
interface CompareGroup { cat: string; matCat: string; toolCat: string; rows: CompareRow[]; }

/** 合并航材/工具部位，同名部位对齐；组内归一化同名类型/工作对齐（淡绿），不同名放末端。 */
const groups = computed<CompareGroup[]>(() => {
  const mat = matLib.value;
  const tool = toolLib.value;
  const matCats = [...new Set(mat.items.map((it) => it.cat))];
  const toolCats = [...new Set(tool.items.map((it) => it.cat))];
  const allCats = [...new Set([...matCats, ...toolCats])];
  return allCats.map((cat) => {
    const matSubs = [...new Set(mat.items.filter((it) => it.cat === cat).map((it) => it.sub))];
    const toolSubs = [...new Set(tool.items.filter((it) => it.cat === cat).map((it) => it.sub))];
    const matNormMap = new Map(matSubs.map((s) => [norm(s), s]));
    const toolNormMap = new Map(toolSubs.map((s) => [norm(s), s]));
    const commonNorms = [...matNormMap.keys()].filter((k) => toolNormMap.has(k));
    const matOnly = matSubs.filter((s) => !toolNormMap.has(norm(s)));
    const toolOnly = toolSubs.filter((s) => !matNormMap.has(norm(s)));
    const rows: CompareRow[] = [];
    for (const k of commonNorms) rows.push({ 航材: matNormMap.get(k)!, 工具: toolNormMap.get(k)!, same: true });
    const maxLen = Math.max(matOnly.length, toolOnly.length);
    for (let i = 0; i < maxLen; i++) rows.push({ 航材: matOnly[i] || "", 工具: toolOnly[i] || "", same: false });
    return { cat, matCat: matCats.includes(cat) ? cat : "", toolCat: toolCats.includes(cat) ? cat : "", rows };
  });
});

function saveSide(side: "mat" | "tool"): void {
  if (side === "mat") void props.store.saveMaterialLibraryNow(type.value);
  else void props.store.saveLibraryNow(type.value);
}

/** 改部位名（左=航材库，右=工具库）。 */
function renameCat(side: "mat" | "tool", oldCat: string, newCat: string): void {
  const lib = side === "mat" ? matLib.value : toolLib.value;
  const target = (newCat || "").trim();
  if (!target || target === oldCat) return;
  const idx = lib.categories.indexOf(oldCat);
  if (idx >= 0) lib.categories[idx] = target;
  for (const it of lib.items) if (it.cat === oldCat) it.cat = target;
  saveSide(side);
}

/** 改类型/工作名。 */
function renameSub(side: "mat" | "tool", cat: string, oldSub: string, newSub: string): void {
  const lib = side === "mat" ? matLib.value : toolLib.value;
  const target = (newSub || "").trim();
  if (!target || target === oldSub) return;
  for (const it of lib.items) if (it.cat === cat && it.sub === oldSub) it.sub = target;
  saveSide(side);
}

/** 新增类型（航材）或工作（工具）：在对应标准库同步新增空白卡片 + 名称。 */
function addSub(side: "mat" | "tool", cat: string): void {
  const lib = side === "mat" ? matLib.value : toolLib.value;
  const label = side === "mat" ? "类型" : "工作";
  const name = window.prompt(`请输入新${label}名称：`);
  if (!name || !name.trim()) return;
  const sub = name.trim();
  if (lib.items.some((it) => it.cat === cat && it.sub === sub)) {
    props.store.notify("该名称已存在");
    return;
  }
  const maxId = lib.items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0);
  if (side === "mat") lib.items.push({ id: maxId + 1, cat, sub, name: "", qty: 1, partNo: "" });
  else lib.items.push({ id: maxId + 1, cat, sub, name: "", qty: 1 });
  saveSide(side);
}
</script>

<template>
  <div class="name-compare">
    <div class="nc-head">
      <button class="ghost" @click="emit('close')">← 返回数据库</button>
      <h3>类型工作名称对照</h3>
      <div class="nc-tabs">
        <button v-for="t in AIRCRAFT_TYPES" :key="t" class="tab" :class="{ active: type === t }" @click="type = t">{{ t }}</button>
      </div>
    </div>

    <p class="nc-hint">左侧为航材标准库（类型），右侧为工具标准库（工作）；同名部位/类型对齐（淡绿），不同名放末端。对比忽略大小写与符号。可编辑/新增名称并同步到对应库。</p>

    <div class="nc-legend">
      <span class="nc-col nc-col-head">航材标准库（类型）</span>
      <span class="nc-col nc-col-head">工具标准库（工作）</span>
    </div>

    <section v-for="grp in groups" :key="grp.cat" class="nc-cat">
      <div class="nc-cat-head">
        <input class="nc-cat-input" :value="grp.matCat" :placeholder="grp.matCat ? '' : '（航材无此部位）'" @change="renameCat('mat', grp.cat, ($event.target as HTMLInputElement).value)" />
        <input class="nc-cat-input" :value="grp.toolCat" :placeholder="grp.toolCat ? '' : '（工具无此部位）'" @change="renameCat('tool', grp.cat, ($event.target as HTMLInputElement).value)" />
      </div>
      <div v-for="(row, i) in grp.rows" :key="i" class="nc-row" :class="{ 'nc-row-same': row.same }">
        <div class="nc-col">
          <input v-if="row.航材" class="nc-sub-input" :value="row.航材" @change="renameSub('mat', grp.cat, row.航材, ($event.target as HTMLInputElement).value)" />
          <span v-else class="nc-empty"></span>
        </div>
        <div class="nc-col">
          <input v-if="row.工具" class="nc-sub-input" :value="row.工具" @change="renameSub('tool', grp.cat, row.工具, ($event.target as HTMLInputElement).value)" />
          <span v-else class="nc-empty"></span>
        </div>
      </div>
      <div class="nc-add-row">
        <button class="ghost" @click="addSub('mat', grp.cat)">＋ 新增类型</button>
        <button class="ghost" @click="addSub('tool', grp.cat)">＋ 新增工作</button>
      </div>
    </section>

    <div v-if="!groups.length" class="empty-state">该机型标准库暂无数据。</div>
  </div>
</template>

<style scoped>
.name-compare { padding: 4px 0 24px; }
.nc-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.nc-head h3 { margin: 0; font-size: var(--fs-16); }
.nc-tabs { display: flex; gap: 6px; }
.nc-hint { margin: 0 0 12px; font-size: var(--fs-12); color: var(--n7); }
.nc-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--n3); border: 1px solid var(--n3); border-radius: var(--r-md); overflow: hidden; margin-bottom: 12px; }
.nc-col { background: #fff; padding: 8px 10px; min-height: 36px; display: flex; align-items: center; }
.nc-col-head { background: var(--n1); font-weight: 700; font-size: var(--fs-13); color: var(--n8); }
.nc-cat { margin-bottom: 12px; border: 1px solid var(--n3); border-radius: var(--r-md); overflow: hidden; }
.nc-cat-head { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #eef2f9; }
.nc-cat-input { border: none; background: #fff; padding: 8px 10px; font-size: var(--fs-13); font-weight: 700; color: #185fa5; }
.nc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--n3); }
.nc-row-same .nc-col { background: #eaf3de; }
.nc-sub-input { width: 100%; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 6px 8px; font-size: var(--fs-13); }
.nc-empty { display: block; width: 100%; min-height: 30px; background: #fafafa; }
.nc-add-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #eef2f9; border-top: 1px solid var(--n3); }
.nc-add-row button { border: none; background: #fff; padding: 6px 8px; font-size: var(--fs-12); color: #185fa5; }
.nc-add-row button:hover { background: #e6f1fb; }
</style>
