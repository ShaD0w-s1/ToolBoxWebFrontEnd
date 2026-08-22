<script setup lang="ts">
import { reactive, watch } from "vue";
import type { ToolboxStore } from "../composables/useToolbox";

const props = defineProps<{ store: ToolboxStore }>();

const fieldKeys = ["机号", "FSN", "MSN", "发动机", "机型", "ETOPS", "ELT-DT"] as const;
type FieldKey = (typeof fieldKeys)[number];

const form = reactive<Record<FieldKey, string>>({ 机号: "", FSN: "", MSN: "", 发动机: "", 机型: "", ETOPS: "", "ELT-DT": "" });
const errors = reactive<Record<FieldKey, boolean>>({ 机号: false, FSN: false, MSN: false, 发动机: false, 机型: false, ETOPS: false, "ELT-DT": false });

function resetErrors(): void {
  for (const k of fieldKeys) errors[k] = false;
}

// 弹窗打开时代入已输入/回传数据，并重置错误标记
watch(
  () => props.store.aircraftUpdate.value,
  (data) => {
    if (data) {
      form.机号 = data.机号;
      form.FSN = data.FSN;
      form.MSN = data.MSN;
      form.发动机 = data.发动机;
      form.机型 = data.机型;
      form.ETOPS = data.ETOPS;
      form["ELT-DT"] = data["ELT-DT"];
      resetErrors();
    }
  },
  { immediate: true },
);

/** 本地校验：未填报字段标红底，返回是否全部非空。 */
function validate(): boolean {
  let ok = true;
  for (const k of fieldKeys) {
    const empty = !String(form[k] ?? "").trim();
    errors[k] = empty;
    if (empty) ok = false;
  }
  return ok;
}

async function save(): Promise<void> {
  if (!validate()) return;
  await props.store.saveAircraftToLib({ ...form });
}
</script>

<template>
  <div v-if="store.aircraftUpdate.value" class="aum-modal">
    <div class="aum-card">
      <h3>更新机型标准库</h3>
      <p class="aum-tip">机号数据将写入飞机信息标准库，请确保所有字段均已填写（红底为未填报）。</p>
      <div class="aum-grid">
        <label class="aum-field" :class="{ 'aum-error': errors['机号'] }"><span>机号</span><input v-model="form.机号" placeholder="B-XXXX" @input="errors['机号'] = false" /></label>
        <label class="aum-field" :class="{ 'aum-error': errors['FSN'] }"><span>FSN</span><input v-model="form.FSN" @input="errors['FSN'] = false" /></label>
        <label class="aum-field" :class="{ 'aum-error': errors['MSN'] }"><span>MSN</span><input v-model="form.MSN" @input="errors['MSN'] = false" /></label>
        <label class="aum-field" :class="{ 'aum-error': errors['发动机'] }"><span>发动机</span><input v-model="form.发动机" @input="errors['发动机'] = false" /></label>
        <label class="aum-field" :class="{ 'aum-error': errors['机型'] }"><span>机型</span><input v-model="form.机型" @input="errors['机型'] = false" /></label>
        <label class="aum-field" :class="{ 'aum-error': errors['ETOPS'] }"><span>ETOPS</span><input v-model="form.ETOPS" @input="errors['ETOPS'] = false" /></label>
        <label class="aum-field" :class="{ 'aum-error': errors['ELT-DT'] }"><span>ELT-DT</span><input v-model="form['ELT-DT']" @input="errors['ELT-DT'] = false" /></label>
      </div>
      <div class="aum-actions">
        <button class="ghost" @click="store.closeAircraftUpdate()">返回</button>
        <button class="primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aum-modal {
  position: fixed; inset: 0; z-index: 9200;
  display: flex; align-items: center; justify-content: center;
  background: rgba(17, 24, 39, 0.45); backdrop-filter: blur(2px);
}
.aum-card {
  display: flex; flex-direction: column; gap: 12px;
  width: min(420px, calc(100% - 48px));
  padding: 22px 26px; background: #fff; border-radius: var(--r-lg);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.aum-card h3 { margin: 0; font-size: 17px; color: var(--n8); }
.aum-tip { margin: 0; font-size: 12px; color: #98a2b3; }
.aum-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.aum-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #5f6b7a; }
.aum-field input {
  min-height: 36px; padding: 7px 11px; border: 1px solid var(--focus); border-radius: var(--r-md);
  font-size: 14px; color: #2f5597; background: #fff; box-sizing: border-box; width: 100%;
}
/* 未填报字段：红底红边提示 */
.aum-field.aum-error input { background: var(--danger-bg); border-color: #e74c3c; }
.aum-field.aum-error span { color: #e74c3c; }
.aum-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
</style>
