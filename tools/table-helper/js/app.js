'use strict';
/* =====================================================================
 * app.js - 应用主逻辑
 * 依赖（按加载顺序）：theme.js? 否 → utils → csv-parser →
 * html-table → exporters → adapters
 * 职责：MODES 模式注册、EXAMPLES 示例、全局状态、DOM 引用、
 *       解析/渲染/导出流程、事件绑定与初始化。
 * 引用其他模块的命名空间：Adapters / Exporters / HtmlTable /
 *                        CsvParser / TableUtils
 * ================================================================== */

/* =====================================================================
 * v3.0 多模式架构重构
 *  - 新增「模式」概念：html（HTML表格解析）/ csv（CSV转JSON），Tab 切换且各自保留状态
 *  - 架构抽象（面向未来扩展）：
 *      1. 统一数据模型 TableData = { source, columns, rows }
 *      2. 输入适配器 Adapter：parse(input, opts) => TableData（Html / Csv / Json(预留)）
 *      3. 导出器 Exporter 注册表：{ id, label, kind: 'download'|'copy', build(data, opts) }
 *         新增导出格式（如 SQL 插入语句）只需注册一个 exporter，并在模式的 exporters 列表引用
 *      4. 模式注册表 MODES：新增数据源（如粘贴 JSON）只需添加一个模式配置
 *  - 新增标准 CSV 解析（双引号转义 / 多行字段 / BOM 剥离）、表头去重、「首行为表头」开关、
 *    JSON 导出结构切换（对象数组 / 二维数组，纯数据不含表头）
 * ================================================================== */

const { adapters } = Adapters;
const { exporters } = Exporters;

/* ---------- 模式注册表（新增数据源：添加一个模式配置即可） ---------- */
const MODES = {
  html: {
    id: 'html', label: 'HTML表格', icon: '📊', available: true,
    title: '粘贴表格代码 / 内容',
    placeholder: '在此粘贴表格代码 / 内容（如网页 <table> HTML），或点上方「示例」快速体验…',
    emptyLead: '粘贴表格代码 / 内容，点击「解析」查看数据，支持 CSV / JSON 导出。',
    features: [
      { b: '智能识别表头', t: 'data-field / th / 列索引' },
      { b: '自动跳过', t: '隐藏列与功能列' },
      { b: '追加模式', t: '分页粘贴按列合并' }
    ],
    note: 'CSV：UTF-8 编码（下载含 BOM），字段自动转义，Excel 可直接打开。',
    showExample: true, showHeaderToggle: false,
    exporters: ['csvDownload', 'csvCopy', 'jsonCopy']
  },
  csv: {
    id: 'csv', label: 'CSV表格', icon: '🧾', available: true,
    title: '粘贴 CSV 文本',
    placeholder: '在此粘贴 CSV 文本（逗号分隔；字段内含逗号 / 换行 / 引号时请用双引号包裹）…',
    emptyLead: '粘贴 CSV 文本，一键转为 JSON，支持「对象数组 / 二维数组」两种结构。',
    features: [
      { b: '标准 CSV 解析', t: '引号转义 / 多行字段' },
      { b: '表头去重', t: '空表头自动命名' },
      { b: '双结构输出', t: '对象数组 / 二维数组' }
    ],
    note: 'JSON：UTF-8 编码、缩进 2 空格；「对象数组」以首行为字段名（自动去重），「二维数组」为纯数据（不含表头）。',
    showExample: true, showHeaderToggle: true,
    exporters: ['jsonDownload', 'jsonCopy']
  },
  json: {
    id: 'json', label: 'JSON表格', icon: '🔣', available: true,
    title: '粘贴 JSON 文本',
    placeholder: '在此粘贴 JSON 数组 / 对象（自动识别对象数组、二维数组、单个对象），或点上方「示例」快速体验…',
    emptyLead: '粘贴 JSON 文本，一键解析为表格，支持 CSV / JSON 导出。',
    features: [
      { b: '四态识别', t: '对象数组 / 二维数组 / 单个对象' },
      { b: '智能列名', t: '字段并集去重、按序排列' },
      { b: '嵌套处理', t: '对象 / 数组序列化展示' }
    ],
    note: 'JSON：UTF-8、缩进 2 空格；对象数组以字段名为列名，二维数组以首行为列名，嵌套值自动序列化。',
    showExample: true, showHeaderToggle: false,
    exporters: ['csvDownload', 'csvCopy']
  }
};
const MODE_ORDER = ['html', 'csv', 'json'];

/* ---------- DOM 引用 ---------- */
/* $ 是 getElementById 的简写，仅在此集中取一次元素，避免各处重复查询 */
const $ = id => document.getElementById(id);
const inputBox = $('inputBox'), btnParse = $('btnParse'), btnReset = $('btnReset'),
  resultCard = $('resultCard'), emptyCard = $('emptyCard'),
  statRows = $('statRows'), statCols = $('statCols'),
  selectWrap = $('selectWrap'), tableSelect = $('tableSelect'),
  appendToggle = $('appendToggle'), previewTable = $('previewTable'),
  previewNote = $('previewNote'), exportActions = $('exportActions'), exportNote = $('exportNote'),
  inputTitle = $('inputTitle'), btnExample = $('btnExample'), headerToggleWrap = $('headerToggleWrap'),
  headerToggle = $('headerToggle'), emptyLead = $('emptyLead'), emptyFeatures = $('emptyFeatures'),
  modeTabs = $('modeTabs'),
  tipModal = $('tipModal'), btnTips = $('btnTips'), btnCloseModal = $('btnCloseModal'),
  exampleModal = $('exampleModal'), exampleList = $('exampleList'),
  exampleBanner = $('exampleBanner'), toastEl = $('toast'),
  btnClearExample = $('btnClearExample'), btnCloseExampleX = $('btnCloseExampleX');

/* ---------- 模式状态：每个模式独立保存输入 / 结果 / 选项，Tab 切换互不干扰 ---------- */
const modeStateStore = {
  html: { input: '', data: null, extractedHtmlTables: [], tableValue: '0', append: false, example: false },
  csv: { input: '', data: null, headerOverrideActive: false, header: true, structure: 'object', append: false },
  json: { input: '', data: null, append: false, example: false }
};
let currentMode = 'html';
let currentTableData = null;   // 当前模式的展示/导出数据（TableData）
let extractedHtmlTables = [];  // html 模式：最近解析出的原始 table（detached，安全）
let isExampleData = false;     // html/json 模式：示例演示状态

/* ---------- Web Worker 解析（大数据量防卡顿） ----------
 * 解析器（CSV/JSON）是纯函数，可以整体搬到 Worker 里跑，主线程只等结果。
 * 源码由 WorkerSource.build() 在运行时序列化生成 → Blob URL，
 * 因此不依赖独立 worker.js 文件，dist 单文件产物在 file:// 下同样可用。
 * 任何一步失败（浏览器禁用 Worker / blob 被拦 / 超时）都**静默降级**为主线程解析，
 * 保证功能不受影响。 */
let parseWorkerUrl = null;          // Blob URL，创建一次复用
const PARSE_WORKER_THRESHOLD = 200000; // 输入超过约 200KB 才值得开线程（含结构化克隆开销）
const PARSE_WORKER_TIMEOUT = 30000;

/** 惰性创建 Worker 的 Blob URL；不可用时返回 null（调用方走主线程） */
function ensureWorkerUrl() {
  if (parseWorkerUrl) return parseWorkerUrl;
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !URL.createObjectURL) return null;
    const blob = new Blob([WorkerSource.build()], { type: 'text/javascript' });
    parseWorkerUrl = URL.createObjectURL(blob);
    return parseWorkerUrl;
  } catch (e) {
    return null;   // 降级为主线程
  }
}

/** 在 Worker 里解析；成功 resolve(TableData)，失败 reject(Error) */
function parseWithWorker(mode, input, opts) {
  return new Promise((resolve, reject) => {
    const url = ensureWorkerUrl();
    if (!url) { reject(new Error('Worker 不可用')); return; }

    let worker;
    try { worker = new Worker(url); }
    catch (e) { reject(new Error('Worker 创建失败')); return; }

    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch (e) { /* ignore */ }
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error('解析超时（30s）')), PARSE_WORKER_TIMEOUT);

    worker.onmessage = e => {
      const msg = e.data || {};
      if (msg.type === 'result') finish(resolve, msg.data);
      else if (msg.type === 'error') finish(reject, new Error(msg.message || '解析失败'));
    };
    worker.onerror = () => finish(reject, new Error('Worker 执行异常'));
    worker.postMessage({ type: 'parse', mode, input, opts: opts || {} });
  });
}

/**
 * 大数据量异步解析：Worker 优先，失败则静默降级到主线程（功能等价，只慢一点）。
 * @param parseMain 主线程解析闭包（同步，可能抛错）
 * @param onDone    解析成功后的落地回调
 */
function parseAsync(mode, input, opts, parseMain, onDone, label) {
  btnParse.disabled = true; btnParse.textContent = '⏳ 解析中…';
  parseWithWorker(mode, input, opts)
    .then(onDone)
    .catch(() => {
      try { onDone(parseMain()); }
      catch (e) { toast(e.message || (label + '解析失败'), 'error'); }
    })
    .finally(() => { btnParse.disabled = false; btnParse.textContent = '🔍 解析'; });
}

/* ---------- 解析流程 ---------- */
function parseInput() {
  const input = inputBox.value;
  if (!input.trim()) { toast('请先粘贴内容', 'warn'); return; }
  if (currentMode === 'html') parseHtml(input);
  else if (currentMode === 'json') parseJson(input);
  else parseCsv(input);
}

function parseHtml(input) {
  const tables = adapters.html.load(input);
  if (!tables.length) { toast('未识别到表格，请检查粘贴内容', 'error'); return; }
  extractedHtmlTables = tables;

  // 默认解析哪一张：多表时智能选行数最多的一张（跳过 colgroup 规格行那一类）
  let pick = 0;
  if (tables.length > 1) {
    const counts = tables.map(t => t.querySelectorAll('tr').length);
    pick = HtmlTable.pickLargestIndex(counts);
    tableSelect.textContent = '';
    tables.forEach((t, i) => tableSelect.add(new Option(HtmlTable.tableMeta(t, i), String(i))));
    tableSelect.value = String(pick);
    selectWrap.hidden = false;
    if (pick !== 0) toast('检测到多个表格，已自动选中最长（表格' + (pick + 1) + ' · ' + counts[pick] + '行），可在「表格来源」切换', 'warn');
  } else {
    // ★ 必须清空下拉：否则上一次多表解析留下的 value（如 "1"）会残留在 DOM 上，
    //   下一轮读回时越界索引到不存在的表格（曾真的因此整页解析失败）。
    tableSelect.textContent = '';
    tableSelect.value = '';
    selectWrap.hidden = true;
  }
  // 直接用本地 pick，不从 DOM 读回——杜绝「陈旧 value」这一整类问题
  applyExtract(pick, appendToggle.checked && !!currentTableData);
}

function parseJson(input) {
  const parseMain = () => adapters.json.parse(input);
  if (input.length < PARSE_WORKER_THRESHOLD) {
    try { finishParseJson(parseMain()); }
    catch (e) { toast(e.message || 'JSON 解析失败', 'error'); }
    return;
  }
  parseAsync('json', input, undefined, parseMain, finishParseJson, 'JSON');
}

function finishParseJson(newData) {
  if (!newData.columns.length) { toast('JSON 缺少可解析的列', 'error'); return; }
  if (appendToggle.checked && currentTableData) {
    const merged = mergeTableData(currentTableData, newData);
    if (!merged) return;
    currentTableData = merged;
  } else {
    currentTableData = newData;
  }
  emptyCard.hidden = true;
  render();
}

function parseCsv(input) {
  // 表头策略：用户手动拨过开关（headerOverrideActive）则以其强制值为准；
  // 否则传 'auto' 交由适配器智能判定（首行数字占比高 → 退化为 列1、列2）。
  const headerOpt = modeStateStore.csv.headerOverrideActive ? modeStateStore.csv.header : 'auto';
  const opts = { header: headerOpt };
  const parseMain = () => adapters.csv.parse(input, opts);
  if (input.length < PARSE_WORKER_THRESHOLD) {
    try { finishParseCsv(parseMain()); }
    catch (e) { toast(e.message || 'CSV 解析失败', 'error'); }
    return;
  }
  parseAsync('csv', input, opts, parseMain, finishParseCsv, 'CSV');
}

function finishParseCsv(newData) {
  if (!newData.columns.length) { toast('没有可解析的列', 'error'); return; }

  // 提示优先级：疑似 TSV（格式选错）> 列数不一致（可能串列）；两者不叠加刷屏
  const uneven = newData._uneven;
  if (newData._tsvSuspect) {
    toast('⚠️ 输入里检测到制表符（Tab），更像 TSV 而非逗号 CSV，解析结果可能不对', 'warn');
  } else if (uneven && uneven.hasUneven) {
    toast('⚠️ 解析完成：有行列数（最少 ' + uneven.minCols + ' 列）与列数（' + newData.columns.length
      + ' 列）不一致，已按空值补齐，请核对是否串列', 'warn');
  }

  // 智能判定生效时（用户未手动覆盖）：若认首行非表头，则同步开关与状态为未勾选，保证所见即所得
  if (!modeStateStore.csv.headerOverrideActive) {
    const headerActuallyUsed = newData._headerUsed !== false;
    if (modeStateStore.csv.header !== headerActuallyUsed) {
      modeStateStore.csv.header = headerActuallyUsed;
      headerToggle.checked = headerActuallyUsed;
    }
  }
  if (appendToggle.checked && currentTableData) {
    const merged = mergeTableData(currentTableData, newData);
    if (!merged) return;
    currentTableData = merged;
  } else {
    currentTableData = newData;
  }
  emptyCard.hidden = true;
  render();
}

function applyExtract(idx, append) {
  const tableEl = extractedHtmlTables[idx];
  // 防御：下标越界（如切换下拉与输入不同步）时给出提示而不是抛异常中断整个解析
  if (!tableEl) { toast('未找到所选表格，请重新解析', 'error'); return; }
  const newData = adapters.html.extract(tableEl);
  if (!newData.columns.length) { toast('所选表格没有可用列', 'error'); return; }
  // 合并单元格提示：colspan 已按展开单元格对齐；rowspan 暂不做跨行回填，可能致行错位
  const hasColspan = !!tableEl.querySelector('[colspan]');
  const hasRowspan = !!tableEl.querySelector('[rowspan]');
  if (hasColspan || hasRowspan) {
    const parts = [];
    if (hasColspan) parts.push('colspan 已展开对齐');
    if (hasRowspan) parts.push('rowspan 未做跨行回填，少数行可能错位');
    toast('⚠️ 表格含合并单元格：' + parts.join('；'), 'warn');
  }
  if (append && currentTableData) {
    const merged = mergeTableData(currentTableData, newData);
    if (!merged) return;
    currentTableData = merged;
  } else {
    currentTableData = newData;
  }
  emptyCard.hidden = true;
  render();
}

/* 追加合并：列名完全一致直接拼接；同名不同序按列名对齐；否则拒绝并不静默错列 */
function mergeTableData(a, b) {
  if (a.columns.length === b.columns.length && a.columns.every((c, i) => c === b.columns[i])) {
    toast('追加成功：+' + b.rows.length + ' 行', 'ok');
    return { source: a.source, columns: a.columns, rows: a.rows.concat(b.rows) };
  }
  if (a.columns.length === b.columns.length && b.columns.every(c => a.columns.includes(c))) {
    const rows = b.rows.map(r => a.columns.map(c => r[b.columns.indexOf(c)]));
    toast('列顺序不同，已按列名对齐追加', 'ok');
    return { source: a.source, columns: a.columns, rows: a.rows.concat(rows) };
  }
  toast('列结构不一致，无法追加（已保留原数据）', 'error');
  return null;
}

/* ---------- 预览渲染（仅 textContent，杜绝 XSS） ---------- */
function render() {
  const PREVIEW_LIMIT = Adapters.PREVIEW_LIMIT;
  resultCard.hidden = false;
  statRows.textContent = currentTableData.rows.length;
  statCols.textContent = currentTableData.columns.length;

  previewTable.textContent = '';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const thIdx = document.createElement('th');
  thIdx.textContent = '#';
  htr.appendChild(thIdx);
  currentTableData.columns.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  previewTable.appendChild(thead);

  const tbody = document.createElement('tbody');
  currentTableData.rows.slice(0, PREVIEW_LIMIT).forEach((r, idx) => {
    const tr = document.createElement('tr');
    const tdIdx = document.createElement('td');
    tdIdx.textContent = idx + 1;
    tr.appendChild(tdIdx);
    currentTableData.columns.forEach((_, i) => {
      const td = document.createElement('td');
      td.textContent = r[i] ?? '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  previewTable.appendChild(tbody);

  const isTruncated = currentTableData.rows.length > PREVIEW_LIMIT;
  previewNote.hidden = !isTruncated;
  if (isTruncated) previewNote.textContent = '仅预览前 ' + PREVIEW_LIMIT + ' 行，导出包含全部 ' + currentTableData.rows.length + ' 行。';

  alignNumericColumns();
  exampleBanner.hidden = !isExampleData;
}

/* ---------- 导出执行 ---------- */
function runExporter(ex) {
  if (!currentTableData) return;
  const out = ex.build(currentTableData, modeStateStore[currentMode]);
  if (ex.kind === 'download') downloadText(out.text, out.filename, out.mime, out.bom);
  else copyText(out.text, out.toast || '已复制');
}
function downloadText(text, filename, mime, withBom) {
  const blob = new Blob([(withBom ? '\ufeff' : '') + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function copyText(text, msg) {
  const done = () => toast(msg, 'ok');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('复制失败，请手动复制', 'error'); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(fallback);
  else fallback();
}

/* ---------- 模式切换与导出栏渲染 ---------- */
function saveCurrentMode() {
  const s = modeStateStore[currentMode];
  s.input = inputBox.value;
  s.data = currentTableData;
  s.append = appendToggle.checked;
  if (currentMode === 'html') {
    s.extractedHtmlTables = extractedHtmlTables;
    s.tableValue = tableSelect.value;
    s.example = isExampleData;
  } else if (currentMode === 'csv') {
    s.header = headerToggle.checked;
    s.structure = (document.getElementById('structureSelect') || {}).value || s.structure;
  } else if (currentMode === 'json') {
    s.example = isExampleData && currentMode === 'json';
  }
}

function applyModeUI() {
  const mode = MODES[currentMode];

  syncInputArea(mode);
  restoreModeMemory();
  restoreResultVisibility();
  syncEmptyState(mode);
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === currentMode));
  renderExportBar();
}

/* 输入区与开关：把当前模式的输入内容、提示文案及可选项回填到 DOM */
function syncInputArea(mode) {
  const s = modeStateStore[currentMode];
  inputBox.value = s.input;
  inputTitle.textContent = mode.title;
  inputBox.placeholder = mode.placeholder;
  btnExample.hidden = !mode.showExample;
  headerToggleWrap.hidden = !mode.showHeaderToggle;
  headerToggle.checked = s.header;
  appendToggle.checked = s.append;
  isExampleData = (currentMode === 'html' || currentMode === 'json') ? !!s.example : false;
}

/* 模式私有记忆：html 恢复原始表格与其切换器；其余模式清空选择器并收起 */
function restoreModeMemory() {
  if (currentMode === 'html') {
    extractedHtmlTables = modeStateStore[currentMode].extractedHtmlTables || [];
    if (extractedHtmlTables.length > 1) {
      tableSelect.textContent = '';
      extractedHtmlTables.forEach((t, i) => tableSelect.add(new Option(HtmlTable.tableMeta(t, i), String(i))));
      tableSelect.value = modeStateStore[currentMode].tableValue || '0';
      selectWrap.hidden = false;
    } else {
      // 同步清空，避免留下上一次多表解析的陈旧选项/value
      tableSelect.textContent = '';
      tableSelect.value = '';
      selectWrap.hidden = true;
    }
  } else {
    extractedHtmlTables = [];
    selectWrap.hidden = true;
  }
}

/* 结果区可见性：有数据则显示预览卡并重绘，否则回到空态卡 */
function restoreResultVisibility() {
  currentTableData = modeStateStore[currentMode].data;
  if (currentTableData) {
    emptyCard.hidden = true;
    resultCard.hidden = false;
    render();
  } else {
    emptyCard.hidden = false;
    resultCard.hidden = true;
  }
}

/* 空态文案与特性徽章（来自 MODES 配置） */
function syncEmptyState(mode) {
  emptyLead.textContent = mode.emptyLead;
  renderEmptyFeatures(mode);
}

/* 空态特性徽章：随模式渲染（文案来自 MODES 配置） */
function renderEmptyFeatures(mode) {
  emptyFeatures.textContent = '';
  (mode.features || []).forEach(f => {
    const span = document.createElement('span');
    span.className = 'feature';
    const b = document.createElement('b');
    b.textContent = f.b;
    span.appendChild(b);
    span.appendChild(document.createTextNode(' ' + f.t));
    emptyFeatures.appendChild(span);
  });
}

function switchMode(id) {
  if (id === currentMode || !MODES[id] || MODES[id].available === false) return;
  saveCurrentMode();
  currentMode = id;
  applyModeUI();
  // 若示例弹窗处于打开状态，切换后刷新按新模式过滤的示例列表
  if (!exampleModal.hidden) buildExampleList();
}

/* 导出栏：由当前模式 exporters 配置动态构建（含模式专属控件） */
function renderExportBar() {
  const mode = MODES[currentMode];
  exportActions.textContent = '';

  // csv 模式额外提供「对象数组 / 二维数组」结构选择控件
  if (mode.id === 'csv') exportActions.appendChild(buildStructureSelector());

  mode.exporters.forEach(id => {
    const ex = exporters[id];
    if (!ex) return;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (ex.kind === 'download' ? 'btn-success' : 'btn-ghost');
    btn.textContent = ex.label;
    btn.addEventListener('click', () => runExporter(ex));
    exportActions.appendChild(btn);
  });

  exportNote.textContent = mode.note;
}

/* 构建 csv 模式的结构下拉控件，并写入模式状态（保留 id=structureSelect 供 saveCurrentMode 读取） */
function buildStructureSelector() {
  const wrap = document.createElement('div');
  wrap.className = 'select-wrap';
  const lab = document.createElement('span');
  lab.textContent = '结构';
  const sel = document.createElement('select');
  sel.id = 'structureSelect';
  sel.add(new Option('对象数组', 'object'));
  sel.add(new Option('二维数组', 'array2d'));
  sel.value = modeStateStore.csv.structure;
  sel.addEventListener('change', () => { modeStateStore.csv.structure = sel.value; });
  wrap.appendChild(lab);
  wrap.appendChild(sel);
  return wrap;
}

function renderTabs() {
  modeTabs.textContent = '';
  MODE_ORDER.forEach(id => {
    const m = MODES[id];
    if (!m || m.available === false) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode-tab' + (id === currentMode ? ' active' : '');
    b.dataset.mode = id;
    b.setAttribute('role', 'tab');
    b.innerHTML = '<span class="mt-ico">' + m.icon + '</span>' + m.label;
    b.addEventListener('click', () => switchMode(id));
    modeTabs.appendChild(b);
  });
}

/* ---------- 提示弹窗 / toast ---------- */
let toastTimer;
function toast(msg, type) {
  toastEl.textContent = msg;
  toastEl.className = 'toast show ' + (type || 'ok');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2600);
}

/* ---------- 导入示例：示例数据常量 ---------- */
const EXAMPLES = [
  {
    id: 'order', mode: 'html',
    title: '订单明细表',
    tag: '智能识别',
    desc: '带 data-field 字段，自动识别表头并跳过「操作」列',
    data: `<table>
  <tr>
    <td data-field="订单号">SO-20240815-001</td>
    <td data-field="客户名称">杭州云启科技</td>
    <td data-field="订单金额">12800.00</td>
    <td data-field="状态">已发货</td>
    <td class="operation">查看</td>
  </tr>
  <tr>
    <td data-field="订单号">SO-20240815-002</td>
    <td data-field="客户名称">深圳蓝湾贸易</td>
    <td data-field="订单金额">4650.50</td>
    <td data-field="状态">待付款</td>
    <td class="operation">查看</td>
  </tr>
  <tr>
    <td data-field="订单号">SO-20240815-003</td>
    <td data-field="客户名称">广州南粤实业</td>
    <td data-field="订单金额">89600.00</td>
    <td data-field="状态">已完成</td>
    <td class="operation">查看</td>
  </tr>
</table>`
  },
  {
    id: 'report', mode: 'html',
    title: '月度销售报表',
    tag: '基础解析',
    desc: '普通表头 + 数字列，数字列自动右对齐',
    data: `<table>
  <thead>
    <tr><th>月份</th><th>销售额</th><th>订单量</th><th>环比</th></tr>
  </thead>
  <tbody>
    <tr><td>1月</td><td>328000</td><td>1260</td><td>—</td></tr>
    <tr><td>2月</td><td>412500</td><td>1480</td><td>+25.8%</td></tr>
    <tr><td>3月</td><td>396200</td><td>1395</td><td>-4.0%</td></tr>
    <tr><td>4月</td><td>485300</td><td>1732</td><td>+22.5%</td></tr>
  </tbody>
</table>`
  },
  {
    id: 'bi', mode: 'html',
    title: 'BI 项目看板',
    tag: '过滤列',
    desc: '含复选框列与隐藏列，自动跳过非数据列',
    data: `<table>
  <thead>
    <tr>
      <th class="checkbox">选择</th>
      <th>地区</th>
      <th>负责人</th>
      <th>项目数</th>
      <th style="display:none">内部ID</th>
      <th>完成率</th>
    </tr>
  </thead>
  <tbody>
    <tr><td class="checkbox"><input type="checkbox"/></td><td>华东</td><td>张伟</td><td>12</td><td>h01</td><td>85%</td></tr>
    <tr><td class="checkbox"><input type="checkbox"/></td><td>华南</td><td>李娜</td><td>9</td><td>h02</td><td>92%</td></tr>
    <tr><td class="checkbox"><input type="checkbox"/></td><td>华北</td><td>王强</td><td>15</td><td>h03</td><td>78%</td></tr>
    <tr><td class="checkbox"><input type="checkbox"/></td><td>西南</td><td>赵敏</td><td>7</td><td>h04</td><td>88%</td></tr>
  </tbody>
</table>`
  },
  {
    id: 'json-users', mode: 'json',
    title: '用户对象数组',
    tag: '对象数组',
    desc: '标准 JSON 对象数组，字段自动识别为列名',
    data: `[
  { "name": "张三", "dept": "技术部", "age": 28, "active": true },
  { "name": "李四", "dept": "产品部", "age": 32, "active": false },
  { "name": "王五", "dept": "设计部", "age": 26, "active": true }
]`
  },
  {
    id: 'json-nested', mode: 'json',
    title: '带嵌套字段',
    tag: '嵌套值',
    desc: '含对象 / 数组字段，嵌套值自动序列化为字符串',
    data: `[
  { "order": "SO-001", "customer": { "name": "杭州云启", "city": "杭州" }, "items": ["手机", "耳机"] },
  { "order": "SO-002", "customer": { "name": "深圳蓝湾", "city": "深圳" }, "items": ["显示器"] }
]`
  },
  {
    id: 'csv-sales', mode: 'csv',
    title: '月度销售数据',
    tag: '含表头',
    desc: '首行为文字表头，常规对象数组转 JSON',
    data: `月份,销售额,订单量,环比
1月,328000,1260,+25.8%
2月,412500,1480,-4.0%
3月,396200,1395,+22.5%`
  },
  {
    id: 'csv-pure', mode: 'csv',
    title: '纯数据矩阵',
    tag: '智能列名',
    desc: '首行全为数字，自动判定为数据行，列名退化为 列1、列2…',
    data: `2021,88,1024
2022,96,1150
2023,110,1280`
  }
];

function buildExampleList() {
  const modeExamples = EXAMPLES.filter(ex => !ex.mode || ex.mode === currentMode);
  exampleList.textContent = '';
  if (!modeExamples.length) {
    const empty = document.createElement('span');
    empty.className = 'ex-desc';
    empty.textContent = '当前模式暂无示例。';
    exampleList.appendChild(empty);
    return;
  }
  modeExamples.forEach(ex => {
    const card = document.createElement('button');
    card.className = 'example-card';
    card.type = 'button';

    const head = document.createElement('span');
    head.className = 'ex-head';
    const title = document.createElement('span');
    title.className = 'ex-title';
    title.textContent = ex.title;
    const tag = document.createElement('span');
    tag.className = 'ex-tag';
    tag.textContent = ex.tag;
    head.appendChild(title);
    head.appendChild(tag);

    const desc = document.createElement('span');
    desc.className = 'ex-desc';
    desc.textContent = ex.desc;

    card.appendChild(head);
    card.appendChild(desc);
    card.addEventListener('click', () => loadExample(ex.id));
    exampleList.appendChild(card);
  });
}

function loadExample(id) {
  const ex = EXAMPLES.find(e => e.id === id);
  if (!ex) return;
  // 若示例所属模式与当前不同，自动切换后再解析，避免跨模式误解析
  const target = ex.mode || 'html';
  if (target !== currentMode) switchMode(target);
  inputBox.value = ex.data;
  isExampleData = true;
  exampleModal.hidden = true;
  parseInput();
}

function resetForm() {
  const s = modeStateStore[currentMode];
  s.input = ''; s.data = null; s.extractedHtmlTables = []; s.append = false; s.example = false;
  currentTableData = null; extractedHtmlTables = [];
  appendToggle.checked = false; inputBox.value = '';
  resultCard.hidden = true; selectWrap.hidden = true; emptyCard.hidden = false;
  exampleBanner.hidden = true;
  toast('已重置');
}

/* ---------- 事件绑定 ---------- */
btnParse.addEventListener('click', () => { isExampleData = false; parseInput(); });
btnReset.addEventListener('click', resetForm);
btnClearExample.addEventListener('click', resetForm);
/* 打开示例弹窗前总是按当前模式重建示例列表，避免显示过期模式的示例 */
btnExample.addEventListener('click', () => {
  buildExampleList();
  exampleModal.hidden = false;
});
btnCloseExampleX.addEventListener('click', () => { exampleModal.hidden = true; });
exampleModal.addEventListener('click', e => { if (e.target === exampleModal) exampleModal.hidden = true; });

tableSelect.addEventListener('change', () => {
  if (!extractedHtmlTables.length) return;
  applyExtract(parseInt(tableSelect.value, 10) || 0, false);
  toast('已切换：' + tableSelect.selectedOptions[0].text);
});

/* 「首行为表头」开关：切换后若已有解析结果，自动按新设置重新解析（不追加）。
 * 用户手动拨动即视为显式声明表头策略，之后解析以其强制值为准，不再自动判定。 */
headerToggle.addEventListener('change', () => {
  modeStateStore.csv.header = headerToggle.checked;
  modeStateStore.csv.headerOverrideActive = true;
  if (currentTableData && currentMode === 'csv') {
    const keepAppend = appendToggle.checked;
    appendToggle.checked = false;
    parseInput();
    appendToggle.checked = keepAppend;
  }
});

btnTips.addEventListener('click', () => { tipModal.hidden = false; });
btnCloseModal.addEventListener('click', () => { tipModal.hidden = true; });
tipModal.addEventListener('click', e => { if (e.target === tipModal) tipModal.hidden = true; });

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); isExampleData = false; parseInput(); }
  if (e.key === 'Escape') {
    if (!exampleModal.hidden) exampleModal.hidden = true;
    if (!tipModal.hidden) tipModal.hidden = true;
  }
});

/* ===== 数字列右对齐（纯视觉增强，不改变数据） ===== */
function alignNumericColumns() {
  const rows = previewTable.querySelectorAll('tbody tr');
  if (rows.length < 2) return;
  const colCount = currentTableData.columns.length;
  for (let c = 0; c < colCount; c++) {
    let allNum = true, hasVal = false;
    rows.forEach(tr => {
      const td = tr.children[c + 1];
      if (!td) return;
      const v = td.textContent.trim();
      if (v === '') return;
      hasVal = true;
      if (!/^-?\d[\d,.\s]*%?$/.test(v)) allNum = false;
    });
    if (allNum && hasVal) {
      rows.forEach(tr => { const td = tr.children[c + 1]; if (td) td.classList.add('num'); });
      const th = previewTable.querySelectorAll('thead th')[c + 1];
      if (th) th.classList.add('num');
    }
  }
}

/* ===== 弹窗右上角关闭 ===== */
const btnCloseX = document.getElementById('btnCloseModalX');
if (btnCloseX) btnCloseX.addEventListener('click', () => { tipModal.hidden = true; });

/* ===== 初始化 ===== */
/* 空态入场动画：首屏播放一次，播放后移除动画类，避免 Tab 切换时空态重放导致抖动 */
(function () {
  const inner = emptyCard.querySelector('.empty');
  if (inner) {
    inner.classList.add('anim-in');
    inner.addEventListener('animationend', () => inner.classList.remove('anim-in'), { once: true });
  }
})();
buildExampleList();
renderTabs();
applyModeUI();

/* 页面卸载时释放 Worker 的 Blob URL（Worker 实例本身按次创建、用完即 terminate） */
window.addEventListener('beforeunload', function () {
  if (parseWorkerUrl) { try { URL.revokeObjectURL(parseWorkerUrl); } catch (e) {} parseWorkerUrl = null; }
});