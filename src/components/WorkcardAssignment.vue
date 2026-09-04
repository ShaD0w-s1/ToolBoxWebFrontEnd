<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, nextTick, reactive, ref, watch } from "vue";
import {
  WORKCARD_SECTIONS,
  WORKCARD_COLUMNS,
  AREA_BY_SECTION,
  isStdWorkcardSection,
  type WorkCardRow,
  type WorkcardArrange,
  type WorkcardSectionData,
} from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { exportWorkcardAssignment } from "../services/spreadsheet";
import { sectionHex, sectionRgba } from "../utils/sectionColor";
import { exportFileName } from "../utils/format";
import { growTextarea, growAllTextareas } from "../utils/dom";
import { createEditLockDirective } from "../utils/editLock";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-image": [element: HTMLElement | null] }>();

// —— 单输入框级编辑软锁（共享指令）：A检工卡分配数据在 workcardAssignment 顶层字段 ——
const lockKey = (kind: string, id: string, field: string): string => `workcardAssignment|${kind}|${id}|${field}`;
const vLock = createEditLockDirective(props.store);
/** 工卡行稳定 key：行级合并主键 = section + 工卡号（空号回退行序，避免同 section 空号互锁）。 */
function rowKeyOf(section: string, card: WorkCardRow, index: number): string {
  return `${section}:${(card.工卡号 || "").trim() || `r${index}`}`;
}

const rootEl = ref<HTMLElement | null>(null);
const project = computed(() => props.store.currentProject.value);
const assignment = computed(() => project.value?.workcardAssignment || null);

/** 分组渲染顺序：内置标准部位（FC/LG/AV CB/ENG）在前 + 用户自建临时分组（按创建序）。 */
const sectionList = computed<string[]>(() => {
  const s = assignment.value?.sections || {};
  const keys = Object.keys(s);
  const std = WORKCARD_SECTIONS.filter((k) => k in s);
  const temp = keys.filter((k) => !isStdWorkcardSection(k));
  return [...std, ...temp];
});
/** 标准部位分组（自建分组名不在此列即为「临时分组」，其内改动不写标准库）。 */
const isStd = (section: string): boolean => isStdWorkcardSection(section);
const isTemp = (section: string): boolean => !isStdWorkcardSection(section);
/** Segmented 分段视图：全部 / 人员安排 / 各分组（含临时分组，自适应）。 */
const segOptions = computed<string[]>(() => ["全部", "人员安排", ...sectionList.value]);

/** 工卡分级取值（需求 1）。 */
const WORKCARD_LEVELS = ["一类", "二类", "三类"] as const;

/** 需求 2：每个分组是否显示“部位”修改列（默认隐藏，点“工卡修改部位”才出现）。 */
const showMove = reactive<Record<string, boolean>>({ FC: false, LG: false, "AV CB": false, ENG: false });

/** Segmented 分段视图：全部 / 人员安排 / 各分组（含临时分组，仅本地 UI 状态，不写入数据、不同步云端）。 */
const waSegment = ref<string>("全部");
/** 各分组工卡安排「缩进/放出」（默认放出；仅本地运行状态，不参与 persist/合并）。 */
const waCardExpanded = reactive<Record<string, boolean>>({ FC: true, LG: true, "AV CB": true, ENG: true });
// 新出现的分组（临时分组）默认放出
watch(sectionList, (list) => {
  for (const k of list) if (waCardExpanded[k] === undefined) waCardExpanded[k] = true;
});
// 选「人员安排」时工卡安排统一缩进；切回「全部/部位」统一放出
watch(waSegment, (v) => {
  const keys = sectionList.value;
  for (const k of keys) waCardExpanded[k] = v !== "人员安排";
});

/** grid 列宽：显示部位列 9 列 / 隐藏部位列 8 列。工卡分级列用 CSS 变量，移动端加倍。 */
const GRID_WITH_MOVE = "0.5fr 2fr 2fr var(--wa-level,0.5fr) 2fr 1fr 1fr 1.2fr 56px";
const GRID_NO_MOVE = "0.5fr 2fr 2fr var(--wa-level,0.5fr) 2fr 1fr 1fr 56px";

/** 各部位“人员安排”的字段（按空白模板 A检工卡分配.xlsx 顺序）。 */
const PERSONNEL_FIELDS: Record<string, string[]> = {
  FC: ["人员", "部位工具负责", "工具清点", "构型设置确认", "梯架设备准备", "货舱清洁", "完工现场清理", "完工驾驶舱检查", "耳机监控", "高空车保障"],
  LG: ["人员", "部位工具负责", "工具清点", "构型设置确认", "梯架设备准备", "舱门保持架（前）", "舱门保持架（后）", "镜面勤务（前）", "镜面勤务（后）", "耳机监控", "完工现场清理"],
  "AV CB": ["人员", "部位工具负责", "工具清点", "构型设置确认", "梯架设备准备", "航后人员", "座椅标牌检查", "客舱检查（TA）", "驾驶舱清理", "完工现场清理", "客舱负责人"],
  ENG: ["人员（右发）", "人员（左发）", "部位工具负责", "工具清点", "构型设置确认", "梯架设备准备", "试车构型设置", "试车前环境检查", "试车两侧监护", "渗漏检查", "试车耳机监控", "完工现场清理"],
};

/** 第二行固定 4 个字段。 */
const SECOND_ROW_FIELDS = ["部位工具负责", "工具清点", "构型设置确认", "梯架设备准备"];
/** 临时分组默认人员安排：仅「人员」整行（可增删岗位通过 新增安排 补充）。 */
const TEMP_PERSONNEL_FIELDS = ["人员"];

/** 需求 4：把人员安排字段拆成 置顶人员 / 第二行 4 格 / 其余。临时分组走默认人员字段。 */
function personnelLayout(section: string) {
  const fields = PERSONNEL_FIELDS[section] || TEMP_PERSONNEL_FIELDS;
  const startIdx = fields.findIndex((f) => SECOND_ROW_FIELDS.includes(f));
  const top = startIdx > 0 ? fields.slice(0, startIdx) : [];
  const second = startIdx >= 0 ? fields.slice(startIdx, startIdx + 4) : [];
  const extra = startIdx >= 0 ? fields.slice(startIdx + 4) : fields;
  return { top, second, extra };
}

function blankCard(): WorkCardRow {
  const row = {} as WorkCardRow;
  for (const col of WORKCARD_COLUMNS) row[col] = "";
  return row;
}

/** 确保分组存在（被删除的标准分组在移入工卡时重建）。 */
function ensureSection(section: string): WorkcardSectionData {
  const a = assignment.value;
  if (!a) return { personnel: {}, cards: [], extra: [] };
  if (!a.sections[section]) a.sections[section] = { personnel: {}, cards: [], extra: [] };
  return a.sections[section];
}

function addCard(section: string): void {
  ensureSection(section).cards.push(blankCard());
  props.store.persist();
  nextTick(growAll);
}

function deleteCard(section: string, index: number): void {
  assignment.value?.sections[section].cards.splice(index, 1);
  props.store.persist();
}

/** 需求 5：新增一个“安排 + 人员”条目（长度不超过 1.7 列）。 */
function addArrange(section: string): void {
  const list = ensureSection(section).extra;
  list.push({ arrange: "", personnel: "" } as WorkcardArrange);
  props.store.persist();
}

function deleteArrange(section: string, index: number): void {
  assignment.value?.sections[section].extra.splice(index, 1);
  props.store.persist();
}

/** 新增临时分组：默认名「临时组N」，可随时在组名处修改。 */
function addTempGroup(): void {
  const a = assignment.value;
  if (!a) return;
  const exists = new Set(Object.keys(a.sections));
  let n = 1;
  let name = `临时组${n}`;
  while (exists.has(name)) { n += 1; name = `临时组${n}`; }
  a.sections[name] = { personnel: {}, cards: [], extra: [] };
  props.store.persist();
  props.store.notify(`已新增分组“${name}”，点击组名可重命名`, "ok");
  waCardExpanded[name] = true;
}

/** 重命名分组（标准部位名只读，仅临时分组可改）。 */
function renameSection(oldName: string, event: Event): void {
  const a = assignment.value;
  if (!a) return;
  const input = event.target as HTMLInputElement;
  const name = input.value.trim();
  if (!name || name === oldName) { input.value = oldName; return; }
  if (a.sections[name]) {
    props.store.notify(`分组“${name}”已存在`, "err");
    input.value = oldName;
    return;
  }
  a.sections[name] = a.sections[oldName];
  delete a.sections[oldName];
  // 组内工卡「部位」标记同步为新组名；其它组中部位=旧名的工卡一并改（跨组引用只可能来自误置，一并修正）。
  for (const k of Object.keys(a.sections)) {
    for (const c of a.sections[k].cards) if (c.部位 === oldName) c.部位 = name;
  }
  const exp = waCardExpanded[oldName];
  if (exp !== undefined) { delete waCardExpanded[oldName]; waCardExpanded[name] = exp; }
  if (waSegment.value === oldName) waSegment.value = name;
  props.store.persist();
  props.store.notify(`分组已重命名为“${name}”`, "ok");
}

/** 删除分组：标准部位仅空分组可删；临时分组含卡时确认后移回「未分配部位」。 */
function removeSection(section: string): void {
  const a = assignment.value;
  if (!a) return;
  const cards = a.sections[section]?.cards || [];
  if (isTemp(section) && cards.length) {
    if (!window.confirm(`删除临时分组“${section}”？其中 ${cards.length} 张工卡将移回“未分配部位”。`)) return;
    a.unassigned.push(...cards.map((c) => ({ ...c })));
  } else if (isStd(section) && cards.length) {
    props.store.notify(`标准部位“${section}”仍有 ${cards.length} 张工卡，清空后才能删除`, "info");
    return;
  } else if (!window.confirm(`确认删除分组“${section}”？`)) {
    return;
  }
  delete a.sections[section];
  if (waSegment.value === section) waSegment.value = "全部";
  props.store.persist();
}

/** 部位选择后，把卡片移到所选分组（store 负责移动到目标；临时分组不写标准库）。 */
function onSectionChange(section: string, index: number, event: Event): void {
  const to = (event.target as HTMLSelectElement).value as string;
  if (!to || to === section) return; // 未变更：不视为修改操作
  props.store.moveCard(section, index, to);
  // 有实际部位变更：刷新该组计时（勾选态保持；超过 120s 无变更自动关闭）
  showMoveAt[section] = Date.now();
}

/** 未分配部位的工卡选择分组后插入对应分组（标准部位写入工卡分配标准库；临时分组不写库）。 */
function onUnassignedSectionChange(index: number, event: Event): void {
  const to = (event.target as HTMLSelectElement).value as string;
  if (!to) return;
  props.store.moveUnassignedToSection(index, to);
  // 归入“AV CB”标准分组时按 AV/CB 子部位排序，保证顺序正确。
  if (isStd(to)) props.store.sortAvCbCards();
}

/** 需求 1/3：工卡分级变更：标准部位同步保存到工卡分配标准库；临时分组仅存项目（不写库）。
 *  非“三类”行必检默认 N/A。 */
function onLevelChange(section: string, card: WorkCardRow): void {
  // 非“三类” → 必检强制 N/A；“三类” → 清空让用户填写。
  if (card.工卡分级 !== "三类") {
    card.必检 = "N/A";
  } else if (card.必检 === "N/A") {
    card.必检 = "";
  }
  props.store.persist();
  if (isStd(section)) {
    // upsert 时保留卡片原始子部位（AV CB 分组的 AV/CB 区分），没有则用 section 默认值。
    props.store.upsertWorkcardStdLib(card.工卡号, card.工卡名称, card.部位 || AREA_BY_SECTION[section as (typeof WORKCARD_SECTIONS)[number]], card.工卡分级);
  }
}

/** 需求 3：宽列（工卡号/工卡名称/参与人员）用 textarea，自动撑高以完整显示并换行。 */
function onCardInput(event: Event): void {
  growTextarea(event.target as HTMLTextAreaElement);
  props.store.persist();
}

function growAll(): void {
  growAllTextareas(rootEl.value);
}

/** 需求 4：导出图片，委托 App.vue 处理（与工具清单同名按钮一致）。 */
function exportImage(): void {
  emit("export-image", rootEl.value);
}

/** 需求：把工卡分配清单（未分配 + 四部位工卡安排 + 人员安排）导出为单 Sheet xlsx。 */
function exportTable(): void {
  if (!assignment.value) return;
  exportWorkcardAssignment(assignment.value, exportFileName(project.value?.name || "", "工卡分配清单"));
}

/** 加载时补全：非“三类”且必检为空的行，必检默认 N/A（仅本地修正，不主动写云）。 */
function normalizeInspection(): void {
  if (!assignment.value) return;
  for (const section of sectionList.value) {
    for (const card of assignment.value.sections[section].cards) {
      if (card.工卡分级 && card.工卡分级 !== "三类" && !card.必检) {
        card.必检 = "N/A";
      }
    }
  }
}

/** 「工卡修改部位」为勾选启用：勾选显示部位列；取消勾选，或勾选后 120s 内无实际部位变更 → 自动关闭。 */
const MOVE_SECTION_TIMEOUT = 120000;
const showMoveAt = reactive<Record<string, number>>({});
function setShowMove(section: string, on: boolean): void {
  showMove[section] = on;
  if (on) showMoveAt[section] = Date.now();
}
let moveAutoCloseTimer: ReturnType<typeof setInterval> | undefined;
function startMoveAutoClose(): void {
  if (moveAutoCloseTimer) return;
  moveAutoCloseTimer = setInterval(() => {
    const now = Date.now();
    for (const k of sectionList.value) {
      if (showMove[k] && now - (showMoveAt[k] || 0) > MOVE_SECTION_TIMEOUT) showMove[k] = false;
    }
  }, 2000);
}

onMounted(() => {
  growAll();
  normalizeInspection();
  startMoveAutoClose();
  // 需求 4：已存在数据也按 AV/CB 子部位排序（导入时已排，此处理非导入来源的旧数据）。
  props.store.sortAvCbCards();
});
onBeforeUnmount(() => {
  if (moveAutoCloseTimer) clearInterval(moveAutoCloseTimer);
});
</script>

<template>
  <div v-if="assignment" ref="rootEl" class="workcard-assignment">
    <div class="subpage-head">
      <h3>工卡分配清单</h3>
      <div class="subpage-actions">
        <button class="ghost" @click="addTempGroup" title="新增一个可命名分组，用于把工卡临时归组（不写入工卡分配标准库）">+ 临时分组</button>
        <button class="ghost" :class="{ 'is-loading': store.imageExportBusy.value }" :disabled="store.imageExportBusy.value" @click="exportImage">导出图片</button>
        <button class="ghost" @click="exportTable">导出表格</button>
      </div>
    </div>

    <!-- 需求 1：未分配部位（仅「全部」视图显示） -->
    <section v-if="waSegment === '全部'" class="wa-section wa-unassigned">
      <h4>未分配部位</h4>
      <div class="table-wrap">
        <div class="wa-grid wa-grid-unassigned">
          <div class="wa-cell wa-head">序号</div>
          <div class="wa-cell wa-head">工卡号</div>
          <div class="wa-cell wa-head">工卡名称</div>
          <div class="wa-cell wa-head">部位</div>
          <div class="wa-cell wa-head wa-ops">操作</div>

          <template v-for="(card, index) in assignment.unassigned" :key="`u-${card.工卡号}-${index}`">
            <div class="wa-cell"><input v-model="card.序号" @input="store.persist" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工卡号" rows="1" @input="onCardInput" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工卡名称" rows="1" @input="onCardInput" /></div>
            <div class="wa-cell">
              <!-- :value="" 受控：选择即移动，行被 splice 后 DOM 复用不会残留上一行的选中态（index key 复用场景必加） -->
              <select :value="''" aria-label="选择部位" @change="onUnassignedSectionChange(index, $event)">
                <option value="">选择部位</option>
                <option v-for="s in sectionList" :key="s" :value="s">{{ s }}<template v-if="isTemp(s)">（临时）</template></option>
              </select>
            </div>
            <div class="wa-cell wa-ops"><button class="danger wa-x" @click="store.deleteUnassigned(index)" title="删除">×</button></div>
          </template>

          <div v-if="!assignment.unassigned.length" class="wa-empty">暂无未分配工卡。导入后无法在标准库匹配到部位的工卡会显示在此，请在“部位”列指定部位。</div>
        </div>
      </div>
    </section>

    <!-- Segmented 分段视图：全部 / 人员安排 / 各分组（含临时分组，自适应；仅本地状态，不同步） -->
    <div class="wa-segment">
      <button v-for="opt in segOptions" :key="opt" class="wa-seg-btn" :class="{ on: waSegment === opt }" @click="waSegment = opt">{{ opt }}</button>
    </div>

    <section
      v-for="section in sectionList"
      :key="section"
      v-show="waSegment === '全部' || waSegment === '人员安排' || waSegment === section"
      class="wa-section"
      :class="{ 'wa-temp-section': isTemp(section) }"
      :style="{ '--sec-color': sectionHex(section), '--sec-bg': sectionRgba(section, 0.5) }"
    >
      <h4>{{ section }} 人员安排 <span v-if="isTemp(section)" class="wa-temp-tag">临时</span></h4>

      <!-- 人员安排布局 -->
      <div class="wa-personnel">
        <div class="wa-person-top">
          <label v-for="field in personnelLayout(section).top" :key="field" class="wa-person wa-full">
            <span>{{ field }}</span>
            <input v-model="assignment.sections[section].personnel[field]" @input="store.persist" v-lock="lockKey('personnel', section, field)" />
          </label>
        </div>
        <div class="wa-person-second">
          <label v-for="field in personnelLayout(section).second" :key="field" class="wa-person">
            <span>{{ field }}</span>
            <input v-model="assignment.sections[section].personnel[field]" @input="store.persist" v-lock="lockKey('personnel', section, field)" />
          </label>
        </div>
        <div v-if="personnelLayout(section).extra.length" class="wa-person-extra">
          <label v-for="field in personnelLayout(section).extra" :key="field" class="wa-person">
            <span>{{ field }}</span>
            <input v-model="assignment.sections[section].personnel[field]" @input="store.persist" v-lock="lockKey('personnel', section, field)" />
          </label>
        </div>
      </div>

      <!-- 新增安排 -->
      <button class="ghost add-arrange" @click="addArrange(section)">+ 新增安排</button>
      <div class="wa-arrange-list">
        <div v-for="(item, i) in assignment.sections[section].extra" :key="`arr-${i}`" class="wa-arrange-row">
          <input class="wa-arrange-name" v-model="item.arrange" @input="store.persist" placeholder="安排" />
          <input class="wa-arrange-person" v-model="item.personnel" @input="store.persist" placeholder="人员" />
          <button class="danger wa-arrange-del" @click="deleteArrange(section, i)" title="删除">×</button>
        </div>
      </div>

      <div class="wa-card-head">
        <h4>
          <button
            class="wa-indent-arrow"
            :class="{ off: !waCardExpanded[section] }"
            :title="waCardExpanded[section] ? '缩进工卡安排' : '放出工卡安排'"
            @click="waCardExpanded[section] = !waCardExpanded[section]"
          >{{ waCardExpanded[section] ? '▾' : '▸' }}</button>
          <input
            v-if="isTemp(section)"
            class="wa-sec-name"
            :value="section"
            title="临时分组：点击修改组名"
            @change="renameSection(section, $event)"
          />
          <template v-else>{{ section }}</template>
          <span class="wa-sec-suffix">工卡安排</span>
        </h4>
        <div class="wa-card-actions">
          <button
            v-if="isTemp(section) || !assignment.sections[section].cards.length"
            class="ghost wa-del-group"
            :title="isTemp(section) && assignment.sections[section].cards.length ? '删除分组，组内工卡将移回未分配部位' : '删除该分组（标准部位删除后再次导入工卡会重新生成）'"
            @click="removeSection(section)"
          >删除分组</button>
          <!-- 工卡修改部位：勾选启用显示“部位”列；取消勾选或 120s 无变更自动关闭 -->
          <label
            class="ghost wa-move-toggle"
            :class="{ on: !!showMove[section] }"
            :title="showMove[section] ? '取消勾选关闭“部位”列（120 秒无变更也会自动关闭）' : '勾选后显示“部位”列以修改工卡所在分组'"
          >
            <input type="checkbox" class="wa-move-check" :checked="!!showMove[section]" @change="setShowMove(section, ($event.target as HTMLInputElement).checked)" />
            工卡修改部位
          </label>
        </div>
      </div>
      <div v-if="waCardExpanded[section]" class="table-wrap">
        <div class="wa-grid" :style="{ gridTemplateColumns: showMove[section] ? GRID_WITH_MOVE : GRID_NO_MOVE }">
          <!-- 表头 -->
          <div class="wa-cell wa-head">序号</div>
          <div class="wa-cell wa-head">工卡号</div>
          <div class="wa-cell wa-head">工卡名称</div>
          <div class="wa-cell wa-head">工卡分级</div>
          <div class="wa-cell wa-head">参与人员</div>
          <div class="wa-cell wa-head">工作签卡者</div>
          <div class="wa-cell wa-head">必检</div>
          <template v-if="showMove[section]">
            <div class="wa-cell wa-head">部位</div>
          </template>
          <div class="wa-cell wa-head wa-ops">操作</div>

          <!-- 数据行 -->
          <template v-for="(card, index) in assignment.sections[section].cards" :key="index">
            <div class="wa-cell"><input v-model="card.序号" @input="store.persist" v-lock="lockKey('card', rowKeyOf(section, card, index), '序号')" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工卡号" rows="1" @input="onCardInput" v-lock="lockKey('card', rowKeyOf(section, card, index), '工卡号')" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工卡名称" rows="1" @input="onCardInput" v-lock="lockKey('card', rowKeyOf(section, card, index), '工卡名称')" /></div>
            <!-- 需求 1：工卡分级改为下拉（一类/二类/三类）；空值显示「无」并红色高亮 -->
            <div class="wa-cell">
              <div class="wa-level-wrap">
                <select
                  class="wa-level-select"
                  :class="{ 'wa-level-empty': !card.工卡分级 }"
                  v-model="card.工卡分级"
                  @change="onLevelChange(section, card)"
                  v-lock="lockKey('card', rowKeyOf(section, card, index), '工卡分级')"
                >
                  <option value="">无</option>
                  <option v-for="lv in WORKCARD_LEVELS" :key="lv" :value="lv">{{ lv }}</option>
                </select>
              </div>
            </div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.参与人员" rows="1" @input="onCardInput" v-lock="lockKey('card', rowKeyOf(section, card, index), '参与人员')" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工作签卡者" rows="1" @input="onCardInput" v-lock="lockKey('card', rowKeyOf(section, card, index), '工作签卡者')" /></div>
            <!-- 需求 3：非“三类”行必检默认 N/A 且不可编辑 -->
            <div class="wa-cell">
              <input v-model="card.必检" :disabled="card.工卡分级 !== '三类'" :placeholder="card.工卡分级 !== '三类' ? 'N/A' : ''" @input="store.persist" v-lock="lockKey('card', rowKeyOf(section, card, index), '必检')" />
            </div>
            <template v-if="showMove[section]">
              <div class="wa-cell">
                <select :value="section" aria-label="选择部位" @change="onSectionChange(section, index, $event)">
                  <option v-for="s in sectionList" :key="s" :value="s">{{ s }}<template v-if="isTemp(s)">（临时）</template></option>
                </select>
              </div>
            </template>
            <div class="wa-cell wa-ops"><button class="danger wa-x" @click="deleteCard(section, index)" title="删除">×</button></div>
          </template>

          <!-- 空状态 -->
          <div v-if="!assignment.sections[section].cards.length" class="wa-empty">暂无工卡，可在二级页首行“依据工卡清单”导入，或点“+ 添加工卡”。</div>
        </div>
      </div>
      <button v-if="waCardExpanded[section]" class="ghost add-card" @click="addCard(section)">+ 添加工卡</button>
    </section>
  </div>
</template>

<style scoped>
.workcard-assignment { --wa-col: 220px; padding: 4px 2px 40px; }
.wa-section { margin-bottom: 22px; background: var(--n0); border: 1px solid var(--n3); border-radius: var(--r-lg); padding: 12px 14px; }
.wa-unassigned { border-color: #f0c8a0; background: #fffaf3; }
/* 工卡分配清单部位配色：参考工具清单（用同一套部位色，底色 50% 透明 + 左实色边条） */
.wa-section:not(.wa-unassigned) { border-left: 6px solid var(--sec-color, var(--n3)); }
.wa-section h4 { margin: 4px 0 10px; font-size: var(--fs-14); background: var(--sec-bg, var(--n1)); color: var(--n8); padding: 5px 10px; border-radius: var(--r-sm); display: inline-block; }

/* 工卡安排标题行（含“工卡修改部位”按钮） */
.wa-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0 10px; flex-wrap: wrap; }
.wa-card-head h4 { margin: 0; background: var(--sec-bg, var(--n1)); color: var(--n8); padding: 5px 10px; border-radius: var(--r-sm); display: inline-flex; align-items: center; }
.wa-card-actions { display: flex; gap: 8px; flex-shrink: 0; }
/* 工卡安排标题前的缩进/放出箭头 */
.wa-indent-arrow { width: 22px; height: 22px; padding: 0; margin-right: 6px; border: 1px solid var(--line, var(--n4)); border-radius: var(--r-sm); background: var(--n0); color: var(--n7); font-size: var(--fs-12); line-height: 1; cursor: pointer; flex-shrink: 0; }
.wa-indent-arrow:hover { border-color: var(--blue); color: var(--blue-dark); }
.wa-indent-arrow.off { color: #a8b2c4; }

/* Segmented 分段视图选择器（全部/人员安排/FC/LG/AV CB/ENG） */
.wa-segment { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: #eef1f6; border-radius: var(--r-pill); margin: 0 0 16px; }
.wa-seg-btn { border: none; background: transparent; border-radius: var(--r-pill); padding: 6px 16px; font-size: var(--fs-13); color: var(--n7); cursor: pointer; font-family: inherit; }
.wa-seg-btn:hover { color: var(--blue-dark); }
.wa-seg-btn.on { background: var(--n0); color: var(--blue-dark); font-weight: 600; box-shadow: 0 1px 4px rgba(0, 0, 0, .12); }

/* 人员安排布局 */
.wa-personnel { margin-bottom: 10px; }
.wa-person { display: flex; flex-direction: column; gap: 3px; font-size: var(--fs-13); color: #000; }
.wa-person span { font-size: var(--fs-12); color: var(--n7); }
.wa-person input { padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.wa-person-top { margin-bottom: 8px; }
.wa-person-top .wa-full { margin-bottom: 6px; }
.wa-person-second { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 12px; margin-bottom: 8px; }
.wa-person-extra { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }

/* 新增安排（安排 0.7 列 + 人员 1.0 列，整体 ≤1.7 列） */
.add-arrange { margin: 2px 0 8px; }
.wa-arrange-list { margin-bottom: 8px; }
.wa-arrange-row { display: flex; gap: 6px; align-items: center; max-width: calc(var(--wa-col) * 1.7); margin-bottom: 6px; }
.wa-arrange-name { flex: 0.7 1 0; min-width: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.wa-arrange-person { flex: 1 1 0; min-width: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-14); }
.wa-arrange-del { flex: 0 0 auto; width: 26px; height: 26px; line-height: 1; border: 1px solid #f2cdcd; background: #fdecec; color: #b53a3a; border-radius: var(--r-sm); font-size: var(--fs-16); cursor: pointer; }

/* 工卡安排表格（比例列宽 + 宽列换行显示） */
.table-wrap { overflow-x: auto; }
.wa-grid {
  display: grid;
  gap: 1px;
  background: var(--n3);
  border: 1px solid var(--n3);
  border-radius: var(--r-md);
  overflow: hidden;
  min-width: 760px;
}
.wa-grid-unassigned {
  grid-template-columns: 0.5fr 2fr 2fr 1.6fr 56px;
  min-width: 520px;
}
.wa-cell { background: var(--n0); padding: 4px 6px; display: flex; align-items: stretch; }
.wa-head { background: var(--n1); font-weight: 600; font-size: var(--fs-13); color: #000; align-items: center; }
.wa-ops { justify-content: center; }
.wa-cell input,
.wa-cell select {
  width: 100%; box-sizing: border-box; padding: 5px 6px;
  border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13); min-width: 0;
}
/* 工卡分级列：网页版字号与工卡名称一致（13px），移动端在 media query 内缩小 */
.wa-cell select {
  padding: 4px 1px; font-size: var(--fs-13);
}
/* 需求 2/3：工卡分级下拉——箭头区域底色透明。
   注意：早期用 svg data-uri 背景画箭头，但 iOS Safari 把 svg 绘入 canvas 会污染画布，
   导致「导出图片」toBlob 抛 SecurityError("the operation is insecure")。改为纯 CSS 三角箭头（无图片），彻底避免污染。 */
.wa-level-wrap { position: relative; width: 100%; }
.wa-level-wrap::after {
  content: ""; position: absolute; right: 6px; top: 50%;
  width: 0; height: 0; pointer-events: none;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid var(--n7); transform: translateY(-50%);
}
.wa-level-select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-color: transparent;
  padding-right: 16px;
}
.wa-level-select.wa-level-empty {
  background-color: #fdecec;
  color: #b53a3a;
  border-color: #f2cdcd;
}
.wa-level-select option {
  color: #000;
  background: var(--n0);
}
/* 未分配部位表格的"部位"select 字体放大到与工卡名称一致（13px） */
.wa-grid-unassigned .wa-cell select {
  padding: 5px 6px; font-size: var(--fs-13);
}
.wa-cell input:disabled { background: #f2f4f7; color: #98a2b3; }
.wa-cell.wa-wrap textarea {
  width: 100%; box-sizing: border-box; padding: 5px 6px;
  border: 1px solid var(--line); border-radius: var(--r-sm); font-size: var(--fs-13);
  resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word;
  line-height: 1.7; min-width: 0; font-family: inherit;
}
/* 需求 1：操作列 × 按钮缩小到可见即可 */
.wa-x { width: 18px; height: 18px; line-height: 1; padding: 0; font-size: var(--fs-11); }
.wa-empty { grid-column: 1 / -1; background: var(--n0); padding: 12px; color: #98a2b3; font-size: var(--fs-13); text-align: center; }
.add-card { margin-top: 8px; }

/* 移动端：第二行 4 格 → 2 列；新增安排行满宽；工卡安排字体减小、工卡分级可见 */
@media (max-width: 768px) {
  .wa-person-second { grid-template-columns: repeat(2, 1fr) !important; }
  .wa-arrange-row { max-width: 100%; }
  /* 需求 2：手机端所有文字字体减小约 4 号，工卡分级列宽加倍确保可见 */
  .wa-grid { min-width: 520px; --wa-level: 1fr; }
  .wa-head { font-size: var(--fs-10); }
  .wa-cell input,
  .wa-cell select { font-size: var(--fs-10); padding: 3px 2px; }
  .wa-cell select { font-size: var(--fs-10); padding: 2px 1px; }
  .wa-cell select.wa-level-select { padding: 2px 1px; padding-right: 12px; }
  .wa-level-wrap::after { right: 3px; border-left-width: 3px; border-right-width: 3px; border-top-width: 4px; }
  .wa-cell.wa-wrap textarea { font-size: var(--fs-10); padding: 3px 2px; line-height: 1.5; }
  .wa-x { width: 20px; height: 20px; font-size: var(--fs-12); }
  .wa-grid-unassigned { min-width: 360px; }
}

/* —— 临时分组（自建分组）视觉与组名编辑 —— */
.wa-temp-section { border-color: #d8c48f !important; }
.wa-temp-tag {
  display: inline-block; margin-left: 6px; vertical-align: 1px;
  font-size: var(--fs-11, 11px); font-weight: 600; color: #8a6d1a;
  background: #f7efd8; border: 1px solid #e3cf96; border-radius: 999px; padding: 0 8px; line-height: 1.7;
}
.wa-sec-name {
  border: 1px dashed transparent; background: transparent; border-radius: var(--r-sm, 6px);
  font: inherit; font-weight: 700; font-size: var(--fs-14, 14px); color: #8a6d1a;
  min-width: 4em; max-width: 12em; padding: 1px 4px; margin: 0 2px; font-family: inherit;
}
.wa-sec-name:hover { border-color: #e3cf96; background: #fffdf4; }
.wa-sec-name:focus { outline: none; border-color: var(--focus); background: var(--n0); color: var(--n8); }
.wa-sec-suffix { margin-left: 2px; }
.wa-del-group { color: var(--danger, #b53a3a); border-color: #f2cdcd; background: #fdecec; }
.wa-del-group:hover { background: #f9dcdc; }
.wa-segment { max-width: 100%; overflow-x: auto; flex-wrap: nowrap; }
@media (max-width: 768px) { .wa-seg-btn { padding: 6px 12px; } }

/* 「工卡修改部位」勾选式开关 */
.wa-move-toggle { display: inline-flex; align-items: center; gap: 6px; user-select: none; }
.wa-move-toggle .wa-move-check { width: 14px; height: 14px; margin: 0; accent-color: var(--blue); }
.wa-move-toggle.on { background: var(--blue-light, #eaf1fa); border-color: var(--blue); }
</style>
