<script setup lang="ts">
import { computed, onMounted, nextTick, reactive, ref } from "vue";
import {
  WORKCARD_SECTIONS,
  WORKCARD_COLUMNS,
  AREA_BY_SECTION,
  type WorkcardSection,
  type WorkCardRow,
  type WorkcardArrange,
} from "../domain/toolbox";
import type { ToolboxStore } from "../composables/useToolbox";
import { exportWorkcardAssignment } from "../services/spreadsheet";
import { sectionHex, sectionRgba } from "../utils/sectionColor";

const props = defineProps<{ store: ToolboxStore }>();
const emit = defineEmits<{ "export-image": [element: HTMLElement | null] }>();

const rootEl = ref<HTMLElement | null>(null);
const project = computed(() => props.store.currentProject.value);
const assignment = computed(() => project.value?.workcardAssignment || null);

/** 工卡分级取值（需求 1）。 */
const WORKCARD_LEVELS = ["一类", "二类", "三类"] as const;

/** 需求 2：每个部位是否显示“部位”修改列（默认隐藏，点“工卡修改部位”才出现）。 */
const showMove = reactive<Record<WorkcardSection, boolean>>({
  FC: false,
  LG: false,
  "AV CB": false,
  ENG: false,
});

/** grid 列宽：显示部位列 9 列 / 隐藏部位列 8 列。工卡分级列用 CSS 变量，移动端加倍。 */
const GRID_WITH_MOVE = "0.5fr 2fr 2fr var(--wa-level,0.5fr) 2fr 1fr 1fr 1.2fr 56px";
const GRID_NO_MOVE = "0.5fr 2fr 2fr var(--wa-level,0.5fr) 2fr 1fr 1fr 56px";

/** 各部位“人员安排”的字段（按空白模板 A检工卡分配.xlsx 顺序）。 */
const PERSONNEL_FIELDS: Record<WorkcardSection, string[]> = {
  FC: ["人员", "部位工具负责", "工具清点", "构型设置确认", "梯架设备准备", "货舱清洁", "完工现场清理", "完工驾驶舱检查", "耳机监控", "高空车保障"],
  LG: ["人员", "部位工具负责", "工具清点", "构型设置确认", "梯架设备准备", "舱门保持架（前）", "舱门保持架（后）", "镜面勤务（前）", "镜面勤务（后）", "耳机监控", "完工现场清理"],
  "AV CB": ["人员", "部位工具负责", "工具清点", "构型设置确认", "梯架设备准备", "航后人员", "座椅标牌检查", "客舱检查（TA）", "驾驶舱清理", "完工现场清理", "客舱负责人"],
  ENG: ["人员（右发）", "人员（左发）", "部位工具负责", "工具清点", "构型设置确认", "梯架设备准备", "试车构型设置", "试车前环境检查", "试车两侧监护", "渗漏检查", "试车耳机监控", "完工现场清理"],
};

/** 第二行固定 4 个字段。 */
const SECOND_ROW_FIELDS = ["部位工具负责", "工具清点", "构型设置确认", "梯架设备准备"];

/** 需求 4：把人员安排字段拆成 置顶人员 / 第二行 4 格 / 其余。 */
function personnelLayout(section: WorkcardSection) {
  const fields = PERSONNEL_FIELDS[section];
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

function addCard(section: WorkcardSection): void {
  assignment.value?.sections[section].cards.push(blankCard());
  props.store.persist();
  nextTick(growAll);
}

function deleteCard(section: WorkcardSection, index: number): void {
  assignment.value?.sections[section].cards.splice(index, 1);
  props.store.persist();
}

/** 需求 5：新增一个“安排 + 人员”条目（长度不超过 1.7 列）。 */
function addArrange(section: WorkcardSection): void {
  const list = assignment.value?.sections[section].extra;
  if (!list) return;
  list.push({ arrange: "", personnel: "" } as WorkcardArrange);
  props.store.persist();
}

function deleteArrange(section: WorkcardSection, index: number): void {
  assignment.value?.sections[section].extra.splice(index, 1);
  props.store.persist();
}

/** 需求 3：部位选择后，把卡片移到所选部位分组（store 负责移动到目标并同步标准库）。 */
function onSectionChange(section: WorkcardSection, index: number, event: Event): void {
  const to = (event.target as HTMLSelectElement).value as WorkcardSection;
  // 移动完成后收起部位列，避免误操作。
  showMove[section] = false;
  props.store.moveCard(section, index, to);
}

/** 需求 1/4：未分配部位的工卡选择部位后，插入对应分组并写入工卡分配标准库。 */
function onUnassignedSectionChange(index: number, event: Event): void {
  const to = (event.target as HTMLSelectElement).value as WorkcardSection;
  if (!to) return;
  props.store.moveUnassignedToSection(index, to);
  // 归入“AV CB”分组时按 AV/CB 子部位排序，保证顺序正确。
  props.store.sortAvCbCards();
}

/** 需求 1/3：工卡分级变更时，同步保存到工卡分配标准库；非“三类”行必检默认 N/A。 */
function onLevelChange(section: WorkcardSection, card: WorkCardRow): void {
  // 需求 3：非“三类” → 必检强制 N/A；“三类” → 清空让用户填写。
  if (card.工卡分级 !== "三类") {
    card.必检 = "N/A";
  } else if (card.必检 === "N/A") {
    card.必检 = "";
  }
  props.store.persist();
  // upsert 时保留卡片原始子部位（AV CB 分组的 AV/CB 区分），没有则用 section 默认值。
  props.store.upsertWorkcardStdLib(card.工卡号, card.工卡名称, card.部位 || AREA_BY_SECTION[section], card.工卡分级);
}

/** 需求 3：宽列（工卡号/工卡名称/参与人员）用 textarea，自动撑高以完整显示并换行。 */
function onCardInput(event: Event): void {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  props.store.persist();
}

function growTextarea(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function growAll(): void {
  rootEl.value?.querySelectorAll("textarea").forEach((t) => growTextarea(t as HTMLTextAreaElement));
}

/** 需求 4：导出图片，委托 App.vue 处理（与工具清单同名按钮一致）。 */
function exportImage(): void {
  emit("export-image", rootEl.value);
}

/** 需求：把工卡分配清单（未分配 + 四部位工卡安排 + 人员安排）导出为单 Sheet xlsx。 */
function exportTable(): void {
  if (!assignment.value) return;
  exportWorkcardAssignment(assignment.value, project.value?.name || "");
}

/** 需求 3：加载时补全——非“三类”且必检为空的行，必检默认 N/A（仅本地修正，不主动写云）。 */
function normalizeInspection(): void {
  if (!assignment.value) return;
  for (const section of WORKCARD_SECTIONS) {
    for (const card of assignment.value.sections[section].cards) {
      if (card.工卡分级 && card.工卡分级 !== "三类" && !card.必检) {
        card.必检 = "N/A";
      }
    }
  }
}

onMounted(() => {
  growAll();
  normalizeInspection();
  // 需求 4：已存在数据也按 AV/CB 子部位排序（导入时已排，此处理非导入来源的旧数据）。
  props.store.sortAvCbCards();
});
</script>

<template>
  <div v-if="assignment" ref="rootEl" class="workcard-assignment">
    <div class="subpage-head">
      <h3>工卡分配清单</h3>
      <button class="ghost" @click="exportTable">导出表格</button>
      <button class="ghost" @click="exportImage">导出图片</button>
    </div>

    <!-- 需求 1：未分配部位 -->
    <section class="wa-section wa-unassigned">
      <h4>未分配部位</h4>
      <div class="table-wrap">
        <div class="wa-grid wa-grid-unassigned">
          <div class="wa-cell wa-head">序号</div>
          <div class="wa-cell wa-head">工卡号</div>
          <div class="wa-cell wa-head">工卡名称</div>
          <div class="wa-cell wa-head">部位</div>
          <div class="wa-cell wa-head wa-ops">操作</div>

          <template v-for="(card, index) in assignment.unassigned" :key="`u-${index}`">
            <div class="wa-cell"><input v-model="card.序号" @input="store.persist" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工卡号" rows="1" @input="onCardInput" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工卡名称" rows="1" @input="onCardInput" /></div>
            <div class="wa-cell">
              <select aria-label="选择部位" @change="onUnassignedSectionChange(index, $event)">
                <option value="">选择部位</option>
                <option v-for="s in WORKCARD_SECTIONS" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
            <div class="wa-cell wa-ops"><button class="danger wa-x" @click="store.deleteUnassigned(index)" title="删除">×</button></div>
          </template>

          <div v-if="!assignment.unassigned.length" class="wa-empty">暂无未分配工卡。导入后无法在标准库匹配到部位的工卡会显示在此，请在“部位”列指定部位。</div>
        </div>
      </div>
    </section>

    <section v-for="section in WORKCARD_SECTIONS" :key="section" class="wa-section" :style="{ '--sec-color': sectionHex(section), '--sec-bg': sectionRgba(section, 0.5) }">
      <h4>{{ section }} 人员安排</h4>

      <!-- 人员安排布局 -->
      <div class="wa-personnel">
        <div class="wa-person-top">
          <label v-for="field in personnelLayout(section).top" :key="field" class="wa-person wa-full">
            <span>{{ field }}</span>
            <input v-model="assignment.sections[section].personnel[field]" @input="store.persist" />
          </label>
        </div>
        <div class="wa-person-second">
          <label v-for="field in personnelLayout(section).second" :key="field" class="wa-person">
            <span>{{ field }}</span>
            <input v-model="assignment.sections[section].personnel[field]" @input="store.persist" />
          </label>
        </div>
        <div v-if="personnelLayout(section).extra.length" class="wa-person-extra">
          <label v-for="field in personnelLayout(section).extra" :key="field" class="wa-person">
            <span>{{ field }}</span>
            <input v-model="assignment.sections[section].personnel[field]" @input="store.persist" />
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
        <h4>{{ section }} 工卡安排</h4>
        <!-- 需求 2：工卡修改部位按钮，点击后显示“部位”选项列 -->
        <button class="ghost wa-move-toggle" @click="showMove[section] = !showMove[section]">
          {{ showMove[section] ? '完成修改部位' : '工卡修改部位' }}
        </button>
      </div>
      <div class="table-wrap">
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
            <div class="wa-cell"><input v-model="card.序号" @input="store.persist" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工卡号" rows="1" @input="onCardInput" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工卡名称" rows="1" @input="onCardInput" /></div>
            <!-- 需求 1：工卡分级改为下拉（一类/二类/三类）；空值显示「无」并红色高亮 -->
            <div class="wa-cell">
              <div class="wa-level-wrap">
                <select
                  class="wa-level-select"
                  :class="{ 'wa-level-empty': !card.工卡分级 }"
                  v-model="card.工卡分级"
                  @change="onLevelChange(section, card)"
                >
                  <option value="">无</option>
                  <option v-for="lv in WORKCARD_LEVELS" :key="lv" :value="lv">{{ lv }}</option>
                </select>
              </div>
            </div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.参与人员" rows="1" @input="onCardInput" /></div>
            <div class="wa-cell wa-wrap"><textarea v-model="card.工作签卡者" rows="1" @input="onCardInput" /></div>
            <!-- 需求 3：非“三类”行必检默认 N/A 且不可编辑 -->
            <div class="wa-cell">
              <input v-model="card.必检" :disabled="card.工卡分级 !== '三类'" :placeholder="card.工卡分级 !== '三类' ? 'N/A' : ''" @input="store.persist" />
            </div>
            <template v-if="showMove[section]">
              <div class="wa-cell">
                <select :value="section" aria-label="选择部位" @change="onSectionChange(section, index, $event)">
                  <option v-for="s in WORKCARD_SECTIONS" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>
            </template>
            <div class="wa-cell wa-ops"><button class="danger wa-x" @click="deleteCard(section, index)" title="删除">×</button></div>
          </template>

          <!-- 空状态 -->
          <div v-if="!assignment.sections[section].cards.length" class="wa-empty">暂无工卡，可在二级页首行“依据工卡清单”导入，或点“+ 添加工卡”。</div>
        </div>
      </div>
      <button class="ghost add-card" @click="addCard(section)">+ 添加工卡</button>
    </section>
  </div>
</template>

<style scoped>
.workcard-assignment { --wa-col: 220px; padding: 4px 2px 40px; }
.wa-section { margin-bottom: 22px; background: #fff; border: 1px solid #e6e9f0; border-radius: 10px; padding: 12px 14px; }
.wa-unassigned { border-color: #f0c8a0; background: #fffaf3; }
/* 工卡分配清单部位配色：参考工具清单（用同一套部位色，底色 50% 透明 + 左实色边条） */
.wa-section:not(.wa-unassigned) { border-left: 6px solid var(--sec-color, #e6e9f0); }
.wa-section h4 { margin: 4px 0 10px; font-size: 14px; background: var(--sec-bg, #f5f7fb); color: #2f3b52; padding: 5px 10px; border-radius: 6px; display: inline-block; }

/* 工卡安排标题行（含“工卡修改部位”按钮） */
.wa-card-head { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 10px; }
.wa-card-head h4 { margin: 0; background: var(--sec-bg, #f5f7fb); color: #2f3b52; padding: 5px 10px; border-radius: 6px; display: inline-block; }

/* 人员安排布局 */
.wa-personnel { margin-bottom: 10px; }
.wa-person { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: #000; }
.wa-person span { font-size: 12px; color: #6b7280; }
.wa-person input { padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.wa-person-top { margin-bottom: 8px; }
.wa-person-top .wa-full { margin-bottom: 6px; }
.wa-person-second { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 12px; margin-bottom: 8px; }
.wa-person-extra { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }

/* 新增安排（安排 0.7 列 + 人员 1.0 列，整体 ≤1.7 列） */
.add-arrange { margin: 2px 0 8px; }
.wa-arrange-list { margin-bottom: 8px; }
.wa-arrange-row { display: flex; gap: 6px; align-items: center; max-width: calc(var(--wa-col) * 1.7); margin-bottom: 6px; }
.wa-arrange-name { flex: 0.7 1 0; min-width: 0; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.wa-arrange-person { flex: 1 1 0; min-width: 0; padding: 6px 8px; border: 1px solid #d7dbe4; border-radius: 6px; font-size: 14px; }
.wa-arrange-del { flex: 0 0 auto; width: 26px; height: 26px; line-height: 1; border: 1px solid #f2cdcd; background: #fdecec; color: #b53a3a; border-radius: 6px; font-size: 16px; cursor: pointer; }

/* 工卡安排表格（比例列宽 + 宽列换行显示） */
.table-wrap { overflow-x: auto; }
.wa-grid {
  display: grid;
  gap: 1px;
  background: #e6e9f0;
  border: 1px solid #e6e9f0;
  border-radius: 8px;
  overflow: hidden;
  min-width: 760px;
}
.wa-grid-unassigned {
  grid-template-columns: 0.5fr 2fr 2fr 1.6fr 56px;
  min-width: 520px;
}
.wa-cell { background: #fff; padding: 4px 6px; display: flex; align-items: stretch; }
.wa-head { background: #f5f7fb; font-weight: 600; font-size: 13px; color: #000; align-items: center; }
.wa-ops { justify-content: center; }
.wa-cell input,
.wa-cell select {
  width: 100%; box-sizing: border-box; padding: 5px 6px;
  border: 1px solid #d7dbe4; border-radius: 5px; font-size: 13px; min-width: 0;
}
/* 工卡分级列：网页版字号与工卡名称一致（13px），移动端在 media query 内缩小 */
.wa-cell select {
  padding: 4px 1px; font-size: 13px;
}
/* 需求 2/3：工卡分级下拉——箭头区域底色透明。
   注意：早期用 svg data-uri 背景画箭头，但 iOS Safari 把 svg 绘入 canvas 会污染画布，
   导致「导出图片」toBlob 抛 SecurityError("the operation is insecure")。改为纯 CSS 三角箭头（无图片），彻底避免污染。 */
.wa-level-wrap { position: relative; width: 100%; }
.wa-level-wrap::after {
  content: ""; position: absolute; right: 6px; top: 50%;
  width: 0; height: 0; pointer-events: none;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid #6b7280; transform: translateY(-50%);
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
  background: #fff;
}
/* 未分配部位表格的"部位"select 字体放大到与工卡名称一致（13px） */
.wa-grid-unassigned .wa-cell select {
  padding: 5px 6px; font-size: 13px;
}
.wa-cell input:disabled { background: #f2f4f7; color: #98a2b3; }
.wa-cell.wa-wrap textarea {
  width: 100%; box-sizing: border-box; padding: 5px 6px;
  border: 1px solid #d7dbe4; border-radius: 5px; font-size: 13px;
  resize: none; overflow: hidden; white-space: pre-wrap; word-break: break-word;
  line-height: 1.7; min-width: 0; font-family: inherit;
}
/* 需求 1：操作列 × 按钮缩小到可见即可 */
.wa-x { width: 18px; height: 18px; line-height: 1; padding: 0; font-size: 11px; }
.wa-empty { grid-column: 1 / -1; background: #fff; padding: 12px; color: #98a2b3; font-size: 13px; text-align: center; }
.add-card { margin-top: 8px; }

/* 移动端：第二行 4 格 → 2 列；新增安排行满宽；工卡安排字体减小、工卡分级可见 */
@media (max-width: 768px) {
  .wa-person-second { grid-template-columns: repeat(2, 1fr) !important; }
  .wa-arrange-row { max-width: 100%; }
  /* 需求 2：手机端所有文字字体减小约 4 号，工卡分级列宽加倍确保可见 */
  .wa-grid { min-width: 520px; --wa-level: 1fr; }
  .wa-head { font-size: 9px; }
  .wa-cell input,
  .wa-cell select { font-size: 9px; padding: 3px 2px; }
  .wa-cell select { font-size: 8px; padding: 2px 1px; }
  .wa-cell select.wa-level-select { padding: 2px 1px; padding-right: 12px; }
  .wa-level-wrap::after { right: 3px; border-left-width: 3px; border-right-width: 3px; border-top-width: 4px; }
  .wa-cell.wa-wrap textarea { font-size: 9px; padding: 3px 2px; line-height: 1.5; }
  .wa-x { width: 20px; height: 20px; font-size: 12px; }
  .wa-grid-unassigned { min-width: 360px; }
}
</style>
