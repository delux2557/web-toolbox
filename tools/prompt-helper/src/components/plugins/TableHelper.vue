<script setup lang="ts">
// ============================================================
// 表格助手（TableHelper）—— 组件型插件
// ------------------------------------------------------------
// 从独立单页 小工具-原版/table助手-v2.html 迁移改造：
//   - 纯逻辑（解析/导出/合并）→ src/utils/tableExtract.ts（可单测）
//   - 本组件只做"界面壳"：状态、交互、渲染
//   - 平台适配：主题（全局 tokens 自动适配）、Toast（useToast）、
//     Modal（复用通用 Modal.vue）、复制（clipboard + execCommand 兜底）
// 核心交互保留：智能识别表头、跳过隐藏/功能列、追加模式按列名合并、
// 多表格来源切换、Ctrl+Enter 快速解析、3 个场景示例。
// ============================================================
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useToast } from '@/composables/useToast'
import Modal from '@/components/Modal.vue'
import {
  EXAMPLES,
  HtmlTableAdapter,
  PREVIEW_LIMIT,
  detectSourceType,
  extractTableData,
  mergeData,
  tableMeta,
  toCSV,
  toJSON,
  type ExampleDef,
  type TableData,
} from '@/utils/tableExtract'

const { show } = useToast()

// ---------- 状态 ----------
const inputText = ref('')
const masterData = ref<TableData | null>(null) // 当前展示/导出的数据
const rawTables = ref<Element[]>([]) // 最近一次解析出的原始 table（detached，安全）
const tableIndex = ref(0) // 多表格时的来源下标
const appendMode = ref(false) // 追加模式
const isExample = ref(false) // 是否处于示例演示状态
const showTips = ref(false)
const showExamples = ref(false)

const adapter = new HtmlTableAdapter()

// ---------- 派生状态 ----------
const previewRows = computed(() => masterData.value?.rows.slice(0, PREVIEW_LIMIT) ?? [])
const overLimit = computed(() => (masterData.value?.rows.length ?? 0) > PREVIEW_LIMIT)

/** 数字列判定（原版 alignNumericColumns 的 Vue 化：computed 而非渲染后改 DOM） */
const numCols = computed<Set<number>>(() => {
  const data = masterData.value
  const set = new Set<number>()
  if (!data || previewRows.value.length < 2) return set
  for (let c = 0; c < data.columns.length; c++) {
    let allNum = true
    let hasVal = false
    for (const r of previewRows.value) {
      const v = (r[c] ?? '').trim()
      if (v === '') continue
      hasVal = true
      if (!/^-?\d[\d,.\s]*%?$/.test(v)) {
        allNum = false
        break
      }
    }
    if (allNum && hasVal) set.add(c)
  }
  return set
})

// ---------- 解析流程 ----------
function doParse() {
  const input = inputText.value
  if (!input.trim()) {
    show('请先粘贴表格代码 / 内容', true)
    return
  }
  const type = detectSourceType(input)
  if (type === 'json') {
    show('JSON 数据源解析将于二期支持（架构已预留）', true)
    return
  }
  const tables = adapter.load(input)
  if (!tables.length) {
    show('未识别到表格，请检查粘贴内容', true)
    return
  }
  rawTables.value = tables
  tableIndex.value = 0
  applyExtract(0, appendMode.value && masterData.value !== null)
}

function applyExtract(idx: number, append: boolean) {
  const table = rawTables.value[idx]
  if (!table) return
  const data = extractTableData(table)
  if (!data.columns.length) {
    show('所选表格没有可用列', true)
    return
  }
  if (append && masterData.value) {
    const merged = mergeData(masterData.value, data)
    if (!merged) {
      show('列结构不一致，无法追加（已保留原数据）', true)
      return
    }
    masterData.value = merged.data
    show(merged.note)
  } else {
    masterData.value = data
  }
}

function onQuickParse() {
  isExample.value = false
  doParse()
}

function reset() {
  inputText.value = ''
  masterData.value = null
  rawTables.value = []
  appendMode.value = false
  isExample.value = false
  show('已重置')
}

// ---------- 示例 ----------
function loadExample(id: string) {
  const ex: ExampleDef | undefined = EXAMPLES.find((e) => e.id === id)
  if (!ex) return
  inputText.value = ex.data
  isExample.value = true
  showExamples.value = false
  doParse()
}

// ---------- 导出 ----------
function downloadCSV() {
  const data = masterData.value
  if (!data) return
  const blob = new Blob(['\ufeff' + toCSV(data)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '表格数据_' + new Date().toISOString().slice(0, 10) + '.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 500)
  show('CSV 已下载（含 BOM）')
}

async function copyText(text: string, msg: string) {
  try {
    await navigator.clipboard.writeText(text)
    show(msg)
  } catch {
    // 兜底：file:// 等非安全上下文下 Clipboard API 不可用
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    show(ok ? msg : '复制失败，请手动复制', !ok)
  }
}

function copyCsv() {
  if (masterData.value) copyText(toCSV(masterData.value), 'CSV 已复制到剪贴板')
}
function copyJson() {
  if (masterData.value)
    copyText(JSON.stringify(toJSON(masterData.value), null, 2), 'JSON 已复制到剪贴板')
}

// ---------- Escape 关闭弹窗（注意：必须在卸载时移除监听，防止插件切换后残留） ----------
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    showTips.value = false
    showExamples.value = false
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div>
    <!-- 输入区 -->
    <section class="panel">
      <div class="panel-head">
        <label class="panel-title" for="th-input">粘贴表格代码 / 内容</label>
        <span class="head-spacer"></span>
        <button type="button" class="link-btn" @click="showExamples = true">加载示例</button>
        <span class="head-hint">Ctrl + Enter 快速解析</span>
      </div>
      <div class="panel-body">
        <div class="input-row">
          <textarea
            id="th-input"
            v-model="inputText"
            class="th-textarea"
            placeholder="在此粘贴表格代码 / 内容（如网页 <table> HTML），或点上方「示例」快速体验…"
            @keydown.ctrl.enter.prevent="onQuickParse"
          ></textarea>
          <div class="btn-col">
            <button type="button" class="btn btn-primary" @click="onQuickParse">🔍 解析</button>
            <button type="button" class="btn btn-ghost" @click="reset">↺ 重置</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 空状态 -->
    <section v-if="!masterData" class="panel empty-panel">
      <div class="empty">
        <div class="empty-badge">本地运行 · 数据不离开浏览器</div>
        <h2 class="empty-title">粘贴表格，<span class="accent">一键导出</span></h2>
        <p class="empty-lead">粘贴表格代码 / 内容，点击「解析」查看数据，支持 CSV / JSON 导出。</p>
        <div class="empty-features">
          <span class="feature"><b>智能识别表头</b> data-field / th / 列索引</span>
          <span class="feature"><b>自动跳过</b> 隐藏列与功能列</span>
          <span class="feature"><b>追加模式</b> 分页粘贴按列合并</span>
        </div>
      </div>
    </section>

    <!-- 结果区 -->
    <section v-else class="panel">
      <div class="panel-head">
        <span class="panel-title">数据预览</span>
        <div class="chips">
          <span class="chip"><span class="k">数据行数</span><b class="v">{{ masterData.rows.length }}</b></span>
          <span class="chip"><span class="k">列数</span><b class="v">{{ masterData.columns.length }}</b></span>
        </div>
        <span class="head-spacer"></span>
        <div v-if="rawTables.length > 1" class="select-wrap">
          <span>表格来源</span>
          <select v-model.number="tableIndex" @change="applyExtract(tableIndex, false)">
            <option v-for="(t, i) in rawTables" :key="i" :value="i">{{ tableMeta(t, i) }}</option>
          </select>
        </div>
        <label class="switch" title="开启后再次解析将按列名合并数据，适合分页粘贴">
          <input v-model="appendMode" type="checkbox" />
          <span class="track"></span>
          <span>追加模式</span>
        </label>
      </div>

      <div class="panel-body">
        <div v-if="isExample" class="example-banner">
          <span class="ex-badge">示例数据</span>
          <span class="ex-hint">这是示例演示，帮你快速了解解析效果。</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="reset">清空输入</button>
        </div>
        <div class="table-wrap">
          <table class="th-table">
            <thead>
              <tr>
                <th>#</th>
                <th v-for="(c, i) in masterData.columns" :key="i" :class="{ num: numCols.has(i) }">
                  {{ c }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in previewRows" :key="ri">
                <td>{{ ri + 1 }}</td>
                <td
                  v-for="(cell, ci) in row"
                  :key="ci"
                  :class="{ num: numCols.has(ci) }"
                >
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="overLimit" class="preview-note">
          仅预览前 {{ PREVIEW_LIMIT }} 行，导出包含全部 {{ masterData.rows.length }} 行。
        </div>
      </div>

      <div class="export-bar">
        <span class="label">📤 导出：</span>
        <button type="button" class="btn btn-success" @click="downloadCSV">⬇️ 下载 CSV</button>
        <button type="button" class="btn btn-ghost" @click="copyCsv">📋 复制 CSV</button>
        <button type="button" class="btn btn-ghost" @click="copyJson">📄 复制 JSON</button>
        <span class="export-note">CSV：UTF-8 编码（下载含 BOM），字段自动转义，Excel 可直接打开。</span>
      </div>
    </section>

    <!-- 使用提示弹窗（复用平台通用 Modal） -->
    <Modal :open="showTips" title="使用提示" @close="showTips = false">
      <ul class="tip-list">
        <li>⚠️ 请确认当前内容包含全部目标数据；若表格为分页 / 虚拟滚动，请先切换「每页更多条」或滚动加载完成后再复制。</li>
        <li>自动识别 <kbd>data-field</kbd> / <kbd>&lt;th&gt;</kbd> / 列索引 作为列名，兼容字段变化。</li>
        <li>自动跳过隐藏列（display:none）与 复选 / 操作 类功能列。</li>
        <li>页面存在多个表格时默认解析第一个，可在「表格来源」中切换。</li>
        <li>开启「追加模式」后，再次解析将按列名对齐合并数据，适合分页粘贴场景。</li>
        <li>快捷键：<kbd>Ctrl</kbd> + <kbd>Enter</kbd> 快速解析。</li>
      </ul>
      <template #footer>
        <button type="button" class="btn btn-primary btn-sm" @click="showTips = false">知道了</button>
      </template>
    </Modal>

    <!-- 示例选择弹窗 -->
    <Modal :open="showExamples" title="加载示例数据" @close="showExamples = false">
      <div class="example-list">
        <button
          v-for="ex in EXAMPLES"
          :key="ex.id"
          type="button"
          class="example-card"
          @click="loadExample(ex.id)"
        >
          <span class="ex-head">
            <span class="ex-title">{{ ex.title }}</span>
            <span class="ex-tag">{{ ex.tag }}</span>
          </span>
          <span class="ex-desc">{{ ex.desc }}</span>
        </button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
/* ============ 业务特有样式（平台已有 .panel/.btn/.switch 等全局类，不再重复定义） ============ */
.head-spacer {
  flex: 1;
}
.head-hint {
  color: var(--text-3);
  font-size: 12px;
  font-family: var(--font-mono);
}
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  padding: 4px 8px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-2);
  cursor: pointer;
  border-radius: var(--radius-s);
  transition: color 140ms var(--ease-out), background 140ms var(--ease-out);
}
.link-btn:hover {
  color: var(--accent-strong);
  background: var(--accent-soft);
  text-decoration: underline;
}

/* 输入区 */
.input-row {
  display: flex;
  align-items: stretch;
  gap: 14px;
}
.th-textarea {
  flex: 1;
  min-height: 200px;
  resize: vertical;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  padding: 12px 14px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text);
  background: var(--code-bg);
  outline: none;
  transition: border-color 140ms var(--ease-out), box-shadow 140ms var(--ease-out);
}
.th-textarea::placeholder {
  color: var(--text-3);
}
.th-textarea:focus {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.btn-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 统计 chips */
.chips {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 7px 14px;
  border-radius: var(--radius-m);
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 13px;
}
.chip .k {
  color: var(--text-3);
  font-size: 12px;
}
.chip .v {
  font-weight: 600;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: var(--accent-strong);
}
.select-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-3);
}

/* 表格预览 */
.table-wrap {
  max-height: 60vh;
  overflow: auto;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.th-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.th-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--accent-strong);
  color: var(--accent-ink);
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid oklch(0 0 0 / 0.08);
  font-weight: 600;
  white-space: nowrap;
}
.th-table thead th:last-child {
  border-right: none;
}
.th-table tbody td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  word-break: break-all;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.th-table thead th:first-child,
.th-table tbody td:first-child {
  width: 54px;
  min-width: 54px;
  text-align: center;
  white-space: nowrap;
  word-break: normal !important;
  color: var(--text-3);
}
.th-table th.num,
.th-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.th-table tbody tr:nth-child(even) {
  background: var(--surface-2);
}
.th-table tbody tr:hover {
  background: var(--accent-soft);
}
.preview-note {
  font-size: 12px;
  color: var(--text-3);
  padding: 10px 18px 0;
}

/* 导出栏 */
.export-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px 18px;
}
.export-bar .label {
  font-size: 14px;
  font-weight: 600;
}
.export-note {
  font-size: 12px;
  color: var(--text-3);
  width: 100%;
}

/* 空状态 */
.empty-panel {
  padding: 0;
}
.empty {
  padding: 60px 32px;
  text-align: center;
}
.empty-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 12.5px;
  font-weight: 500;
  margin-bottom: 18px;
}
.empty-title {
  font-size: 26px;
  margin: 0 0 10px;
  letter-spacing: -0.02em;
  font-weight: 600;
}
.empty-title .accent {
  color: var(--accent-strong);
}
.empty-lead {
  color: var(--text-2);
  margin: 0 0 26px;
  font-size: 15px;
}
.empty-features {
  display: flex;
  justify-content: center;
  gap: 24px;
  flex-wrap: wrap;
}
.feature {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
  font-size: 13px;
}
.feature b {
  color: var(--text-2);
  font-weight: 600;
}

/* 示例 banner 与列表 */
.example-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: var(--accent-soft);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-m);
  font-size: 13px;
  color: var(--text-2);
}
.example-banner .ex-badge {
  flex-shrink: 0;
  background: var(--accent);
  color: var(--accent-ink);
  padding: 1px 8px;
  border-radius: var(--radius-s);
  font-size: 11px;
  font-weight: 600;
}
.example-banner .ex-hint {
  flex: 1;
  min-width: 180px;
}
.example-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.example-card {
  width: 100%;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  cursor: pointer;
  transition: background 140ms var(--ease-out), border-color 140ms var(--ease-out);
}
.example-card:hover {
  background: var(--accent-soft);
  border-color: var(--accent-strong);
}
.ex-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ex-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
}
.ex-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-strong);
  background: var(--accent-soft);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
}
.ex-desc {
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.5;
}

/* 使用提示列表 */
.tip-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  line-height: 1.75;
  color: var(--text-2);
}
.tip-list li {
  display: flex;
  gap: 8px;
}
.tip-list li::before {
  content: "•";
  color: var(--accent-strong);
  font-weight: 700;
  flex-shrink: 0;
}

/* 响应式 */
@media (max-width: 720px) {
  .input-row {
    flex-direction: column;
  }
  .btn-col {
    flex-direction: row;
  }
  .btn-col .btn {
    flex: 1;
  }
}
</style>
