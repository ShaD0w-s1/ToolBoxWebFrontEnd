<script setup lang="ts">
import { computed, ref } from "vue";
import {
  STANDARD_LIB_KEYS,
  STANDARD_LIB_META,
  type StandardLibKey,
  type StandardLibRow,
} from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { exportTable, importTable } from "../services/spreadsheet";

const props = defineProps<{ store: ToolboxStore }>();

const key = computed<StandardLibKey | null>(() => props.store.editingStdLib.value);
const meta = computed(() => (key.value ? STANDARD_LIB_META[key.value] : null));
const rows = computed<StandardLibRow[]>(() => props.store.stdLibActive.value?.rows || []);
const importInput = ref<HTMLInputElement | null>(null);

function emptyRow(): StandardLibRow {
  const row: StandardLibRow = {};
  for (const col of meta.value?.rowKeys || []) row[col] = "";
  return row;
}

function addRow(): void {
  if (!key.value) return;
  props.store.stdLibActive.value?.rows.push(emptyRow());
  props.store.persist();
}

function deleteRow(index: number): void {
  if (!key.value) return;
  props.store.stdLibActive.value?.rows.splice(index, 1);
  props.store.persist();
}

function exportXlsx(): void {
  if (!key.value || !meta.value) return;
  exportTable(rows.value, meta.value.rowKeys, meta.value.label);
}

async function triggerImport(): Promise<void> {
  importInput.value?.click();
}

async function onImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !key.value) return;
  try {
    const imported = await importTable(file);
    const cols = STANDARD_LIB_META[key.value].rowKeys;
    // 用标准列顺序规整导入行，缺失列补空，多余列丢弃，保证与导出格式一致。
    const normalized = imported.map((raw) => {
      const row: StandardLibRow = {};
      for (const col of cols) row[col] = String(raw[col] ?? "");
      return row;
    });
    if (window.confirm(`确认用导入的 ${normalized.length} 行覆盖当前标准库？`)) {
      props.store.saveStdLib(key.value, normalized);
      props.store.notify("标准库导入完成");
    }
  } catch (error) {
    props.store.notify(error instanceof Error ? error.message : "导入失败");
  }
}

void STANDARD_LIB_KEYS;

/** 数据库页内"完成"：保存到云端并提示后返回列表（替代原一级卡片上的完成按钮）。 */
async function finishStdLib(): Promise<void> {
  if (!key.value) return;
  try {
    await props.store.saveStdLibNow(key.value);
    props.store.notify(`${meta.value?.label} 已完成保存`);
  } catch {
    props.store.notify("保存失败，但已留存本地");
  }
  props.store.backToList();
}
</script>

<template>
  <section v-if="key && meta">
    <div class="detail-sticky">
      <header class="detail-head">
        <button @click="store.backToList">← 返回</button>
        <div><strong>{{ meta.label }}</strong><span>共 {{ rows.length }} 行</span></div>
      </header>
      <div class="toolbar">
        <button class="primary" @click="addRow">+ 新增</button>
        <button @click="triggerImport">导入.xlsx</button>
        <input ref="importInput" hidden type="file" accept=".xlsx,.xls" @change="onImport" />
        <button @click="exportXlsx">导出.xlsx</button>
        <button title="强制同步数据" @click="store.refresh()">刷新</button>
        <span class="spacer" />
        <button class="ghost" @click="finishStdLib">完成</button>
      </div>
    </div>

    <div class="table-wrap stdlib-table">
      <table>
        <thead>
          <tr>
            <th class="idx">#</th>
            <th v-for="col in meta.rowKeys" :key="col">{{ col }}</th>
            <th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="index">
            <td class="idx">{{ index + 1 }}</td>
            <td v-for="col in meta.rowKeys" :key="col">
              <input v-model="row[col]" @input="store.persist" />
            </td>
            <td class="ops"><button class="danger" @click="deleteRow(index)">删除</button></td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="meta.rowKeys.length + 2" class="empty-state">暂无数据，点击“导入.xlsx”或“+ 新增”开始。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.stdlib-table { overflow-x: auto; }
.stdlib-table table { min-width: 720px; }
.idx { width: 44px; text-align: center; color: var(--n6); }
.ops { width: 64px; text-align: center; }
td input { width: 100%; box-sizing: border-box; }
</style>
