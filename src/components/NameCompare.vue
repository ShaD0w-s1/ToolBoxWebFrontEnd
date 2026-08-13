<script setup lang="ts">
import { computed, ref } from "vue";
import { AIRCRAFT_TYPES, type AircraftType } from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";

const props = defineProps<{ store: ToolboxStore; type: AircraftType }>();
const emit = defineEmits<{ close: [] }>();

const type = ref<AircraftType>(props.type);
const matLib = computed(() => props.store.app.value.materialLibraries[type.value]);
const toolLib = computed(() => props.store.app.value.libraries[type.value]);

interface CompareRow { 航材: string; 工具: string; }
interface CompareGroup { cat: string; matCat: string; toolCat: string; rows: CompareRow[]; }

/** 合并航材/工具部位，同名部位对齐；组内同名类型/工作对齐，不同名放末端。 */
const groups = computed<CompareGroup[]>(() => {
  const mat = matLib.value;
  const tool = toolLib.value;
  const matCats = [...new Set(mat.items.map((it) => it.cat))];
  const toolCats = [...new Set(tool.items.map((it) => it.cat))];
  const allCats = [...new Set([...matCats, ...toolCats])];
  return allCats.map((cat) => {
    const matSubs = [...new Set(mat.items.filter((it) => it.cat === cat).map((it) => it.sub))];
    const toolSubs = [...new Set(tool.items.filter((it) => it.cat === cat).map((it) => it.sub))];
    const common = matSubs.filter((s) => toolSubs.includes(s));
    const matOnly = matSubs.filter((s) => !toolSubs.includes(s));
    const toolOnly = toolSubs.filter((s) => !matSubs.includes(s));
    const rows: CompareRow[] = [];
    for (const s of common) rows.push({ 航材: s, 工具: s });
    const maxLen = Math.max(matOnly.length, toolOnly.length);
    for (let i = 0; i < maxLen; i++) rows.push({ 航材: matOnly[i] || "", 工具: toolOnly[i] || "" });
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

    <p class="nc-hint">左侧为航材标准库（类型），右侧为工具标准库（工作）；同名部位/类型对齐，不同名放末端。可编辑名称并同步到对应库。</p>

    <div class="nc-legend">
      <span class="nc-col nc-col-head">航材标准库（类型）</span>
      <span class="nc-col nc-col-head">工具标准库（工作）</span>
    </div>

    <section v-for="grp in groups" :key="grp.cat" class="nc-cat">
      <div class="nc-cat-head">
        <input class="nc-cat-input" :value="grp.matCat" :placeholder="grp.matCat ? '' : '（航材无此部位）'" @change="renameCat('mat', grp.cat, ($event.target as HTMLInputElement).value)" />
        <input class="nc-cat-input" :value="grp.toolCat" :placeholder="grp.toolCat ? '' : '（工具无此部位）'" @change="renameCat('tool', grp.cat, ($event.target as HTMLInputElement).value)" />
      </div>
      <div v-for="(row, i) in grp.rows" :key="i" class="nc-row">
        <div class="nc-col">
          <input v-if="row.航材" class="nc-sub-input" :value="row.航材" @change="renameSub('mat', grp.cat, row.航材, ($event.target as HTMLInputElement).value)" />
          <span v-else class="nc-empty"></span>
        </div>
        <div class="nc-col">
          <input v-if="row.工具" class="nc-sub-input" :value="row.工具" @change="renameSub('tool', grp.cat, row.工具, ($event.target as HTMLInputElement).value)" />
          <span v-else class="nc-empty"></span>
        </div>
      </div>
    </section>

    <div v-if="!groups.length" class="empty-state">该机型标准库暂无数据。</div>
  </div>
</template>

<style scoped>
.name-compare { padding: 4px 0 24px; }
.nc-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.nc-head h3 { margin: 0; font-size: 15px; }
.nc-tabs { display: flex; gap: 6px; }
.nc-hint { margin: 0 0 12px; font-size: 12px; color: #6b7280; }
.nc-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #e6e9f0; border: 1px solid #e6e9f0; border-radius: 8px; overflow: hidden; margin-bottom: 12px; }
.nc-col { background: #fff; padding: 8px 10px; min-height: 36px; display: flex; align-items: center; }
.nc-col-head { background: #f5f7fb; font-weight: 700; font-size: 13px; color: #2f3b52; }
.nc-cat { margin-bottom: 12px; border: 1px solid #e6e9f0; border-radius: 8px; overflow: hidden; }
.nc-cat-head { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #eef2f9; }
.nc-cat-input { border: none; background: #fff; padding: 8px 10px; font-size: 13px; font-weight: 700; color: #185fa5; }
.nc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #e6e9f0; }
.nc-sub-input { width: 100%; border: 1px solid #d7dbe4; border-radius: 6px; padding: 6px 8px; font-size: 13px; }
.nc-empty { display: block; width: 100%; min-height: 30px; background: #fafafa; }
</style>
