'use strict';
/* =====================================================================
 * app.js - 界面装配与交互（Excel / CSV 转 SQL）
 *
 * 本文件是全工具唯一直接操作 DOM 的地方；其余模块（dialects / headers /
 * reader / sqlgen / utils）都保持"纯函数 + 命名空间"的形态，好处有二：
 *   1. 自检脚本 tools/_build/check-excel2sql.mjs 能用 new Function 直接
 *      把它们拼起来在 Node 里跑，不需要 DOM 桩；
 *   2. 将来换壳（比如并进 workbench 插件）只需重写这一个文件。
 *
 * 依赖（按 index.html 的加载顺序）：
 *   E2sUtils / E2sDialects / E2sHeaders / E2sReaders / E2sSqlGen
 * ================================================================== */
(function () {
  const U = E2sUtils;
  const D = E2sDialects;
  const H = E2sHeaders;
  const R = E2sReaders;
  const G = E2sSqlGen;

  const $ = function (id) { return document.getElementById(id); };

  const SETTINGS_KEY = 'excel2sql-settings';
  const PICKER_MAX_ROWS = 12;     /* 表头选择表最多渲染多少行 */
  const PICKER_MAX_COLS = 20;     /* 表头选择表最多渲染多少列 */
  const PREVIEW_MAX_LINES = 60;   /* SQL 产物预览最多显示多少行 */
  const TOAST_MS = 2400;

  /* ------------------------------------------------------------------
   * DOM
   * ------------------------------------------------------------------ */
  const el = {
    drop: $('dropZone'), fileInput: $('fileInput'), btnSample: $('btnSample'),
    sheetWrap: $('sheetWrap'), sheetSelect: $('sheetSelect'),
    /* 注意：这几个已随界面改版搬进底部状态栏 —— 名称不动，
       因为自检脚本正是按它们读"文件到底有没有被解析出来" */
    fileRow: $('fileRow'), fileDot: $('fileDot'),
    fileName: $('fileName'), fileMeta: $('fileMeta'),
    envNotice: $('envNotice'),

    /* workState 是"工作态"整体容器（工具栏 + 左右分栏 + 状态栏）。
       载入数据源后空态退场、workState 登场，表头预览与产物都在它里面。 */
    workState: $('workState'), btnReselect: $('btnReselect'),

    headerCard: $('headerCard'), headerHint: $('headerHint'),
    headerNotice: $('headerNotice'), headerPicker: $('headerPicker'),

    dialectSegs: $('dialectSegs'),
    formatSegs: $('formatSegs'), wrapSegs: $('wrapSegs'),
    tableInput: $('tableInput'),
    batchWrap: $('batchWrap'), batchInput: $('batchInput'),
    optEmptyNull: $('optEmptyNull'),
    inferWrap: $('inferWrap'), optInferTypes: $('optInferTypes'),
    optLegacyDate: $('optLegacyDate'),
    btnGenerate: $('btnGenerate'),

    resultCard: $('resultCard'),
    statRows: $('statRows'), statCols: $('statCols'),
    statSize: $('statSize'), statTime: $('statTime'),
    resultNotice: $('resultNotice'), resultCode: $('resultCode'),
    codeHint: $('codeHint'), resultPlaceholder: $('resultPlaceholder'),
    btnCopy: $('btnCopy'), btnDownload: $('btnDownload'),

    emptyCard: $('emptyCard'), emptyFeatures: $('emptyFeatures'),

    btnTips: $('btnTips'), tipModal: $('tipModal'),
    btnCloseModal: $('btnCloseModal'), btnCloseModalX: $('btnCloseModalX'),

    btnDetails: $('btnDetails'), detailsDrawer: $('detailsDrawer'),
    detailsBody: $('detailsBody'),
    btnCloseDetails: $('btnCloseDetails'), btnCloseDetailsX: $('btnCloseDetailsX'),

    toast: $('toast')
  };

  /* ------------------------------------------------------------------
   * 状态
   * ------------------------------------------------------------------ */
  const state = {
    book: null,        /* { kind:'xlsx'|'csv', label, size, sample, meta, sheets:[{name,rows}] } */
    sheetIndex: 0,
    headerRow: null,   /* null = 用自动识别；>0 = 用户手动指定（1 基行号） */
    detected: null,    /* H.detect() 的结果，用于回显"为什么选这一行" */
    prepared: null,    /* G.prepare() 的结果，界面展示用 */
    prepareError: null,
    result: null,      /* G.buildSql() 的结果 */
    busy: false
  };

  let staleEl = null;  /* "设置已变更"提示条，避免重复堆叠 */

  /* 用户可调的转换设置（持久化到 localStorage） */
  const settings = {
    dialect: 'sqlserver',
    fmt: 'union',
    wrap: 'cte',
    table: 'HARDCODE',
    batchSize: 500,
    emptyAsNull: false,
    inferTypes: false,
    legacyDateMode: true
  };

  const DIALECT_OPTS = [
    { k: 'sqlserver', label: 'SQL Server' },
    { k: 'mysql', label: 'MySQL' },
    { k: 'oracle', label: 'Oracle' },
    { k: 'postgresql', label: 'PostgreSQL' }
  ];
  const FORMAT_OPTS = [
    { k: 'union', label: 'UNION ALL' },
    { k: 'insert', label: 'INSERT 分批' }
  ];
  const WRAP_OPTS = [
    { k: 'cte', label: 'WITH 包裹' },
    { k: 'plain', label: '裸 SELECT' }
  ];

  /* ------------------------------------------------------------------
   * 内置示例数据
   * 刻意覆盖了历史上真出过问题的几类值：
   *   · 第 1 行是标题 -> 演示表头识别会跳过它
   *   · 前导零条码   -> 必须保持文本（否则 0071234 变 71234）
   *   · 16 位订单号  -> 必须保持文本（JS 双精度会改写末尾几位）
   *   · 备注里有换行 -> 演示按方言拼 CHAR(10) / CHR(10)
   *   · 空格子       -> 演示 NULL
   * ------------------------------------------------------------------ */
  const SAMPLE = {
    name: '示例-门店销售明细.xlsx',
    sheet: '销售明细',
    title: '2026年3月 门店销售明细',
    cols: ['门店', '商品', '类别', '销量', '单价', '金额', '销售日期', '条码', '订单号', '备注'],
    types: ['str', 'str', 'str', 'num', 'num', 'num', 'date', 'str', 'bignum', 'str'],
    rows: [
      ['东城店', '纯牛奶 250ml', '乳制品', 120, 3.5, 420, '2026-03-01', '0071234', '9007199254740993', '常温堆头\n买二赠一'],
      ['东城店', '全麦吐司', '烘焙', 64, 8.9, 569.6, '2026-03-01', '0071235', '9007199254740994', ''],
      ['西城店', '抽取式纸巾', '日化', 210, 12, 2520, '2026-03-02', '0071299', '9007199254740995', '端架促销'],
      ['西城店', '纯牛奶 250ml', '乳制品', 96, 3.5, 336, '2026-03-02', '0071234', '9007199254740996', ''],
      ['南关店', '鲜鸡蛋 10枚', '生鲜', 58, 11.9, 690.2, '2026-03-03', '0072051', '9007199254740997', '冷链\n当日达'],
      ['南关店', '全麦吐司', '烘焙', 24, 8.9, 213.6, '2026-03-03', '0071235', '9007199254740998', '临期打折'],
      ['北苑店', '抽取式纸巾', '日化', 175, 12, 2100, '2026-03-04', '0071299', '9007199254740999', '']
    ]
  };

  const FEATURES = [
    { b: '零上传', t: '解析全在本地完成' },
    { b: '4 种方言', t: 'SQL Server / MySQL / Oracle / PG' },
    { b: '5 万行', t: '实测解析 2.3 秒' },
    { b: '列级统一', t: '躲开 UNION ALL 隐式转换' }
  ];

  /* ==================================================================
   * 一、通用小组件
   * ================================================================== */

  let toastTimer = null;
  function toast(msg, kind) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'toast'; }, TOAST_MS);
  }

  /* 往某个容器里追加一条提示条。actLabel 存在时右侧带一个动作按钮。 */
  function notice(box, level, text, actLabel, onAct) {
    const wrap = document.createElement('div');
    wrap.className = 'esq-notice is-' + level;

    const dot = document.createElement('span');
    dot.className = 'esq-notice-dot';

    const body = document.createElement('div');
    body.className = 'esq-notice-body';
    body.textContent = text;

    wrap.appendChild(dot);
    wrap.appendChild(body);

    if (actLabel) {
      const act = document.createElement('div');
      act.className = 'esq-notice-act';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = actLabel;
      btn.addEventListener('click', onAct);
      act.appendChild(btn);
      wrap.appendChild(act);
    }
    box.appendChild(wrap);
    return wrap;
  }

  /* 分段控件（方言 / 输出形式 / 包裹方式共用）。
     点选时**只切换高亮，不重建节点** —— 重建会把按钮换成新对象，
     正在按的那个按钮瞬间失去焦点，键盘用户点一下就被弹回页面开头。 */
  function renderSegs(box, opts, cur, onPick) {
    if (box.childNodes.length !== opts.length) {
      box.textContent = '';
      opts.forEach(function (o) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'esq-seg';
        btn.textContent = o.label;
        btn.dataset.k = o.k;
        if (o.title) btn.title = o.title;
        btn.addEventListener('click', function () { onPick(o.k); });
        box.appendChild(btn);
      });
    }
    markSegs(box, cur);
  }

  function markSegs(box, cur) {
    box.childNodes.forEach(function (btn) {
      if (btn.dataset && btn.dataset.k === cur) btn.classList.add('is-active');
      else btn.classList.remove('is-active');
    });
  }

  function setBusy(on, label) {
    state.busy = !!on;
    el.btnGenerate.disabled = state.busy || !state.prepared;
    el.btnGenerate.textContent = state.busy ? (label || '处理中…') : '生成 SQL';
  }

  /* ==================================================================
   * 二、设置持久化与回填
   * ================================================================== */

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 隐私模式等，忽略 */ }
  }

  function loadSettings() {
    let raw = null;
    try { raw = localStorage.getItem(SETTINGS_KEY); } catch (e) { return; }
    if (!raw) return;
    let o = null;
    try { o = JSON.parse(raw); } catch (e) { return; }
    if (!o || typeof o !== 'object') return;

    Object.keys(settings).forEach(function (k) {
      if (o[k] === undefined || o[k] === null) return;
      settings[k] = o[k];
    });
    /* 防御：持久化内容可能是旧版本或手改过的，非法值一律回落到默认 */
    if (!D.DIALECTS[settings.dialect]) settings.dialect = 'sqlserver';
    if (G.FORMATS.indexOf(settings.fmt) < 0) settings.fmt = 'union';
    if (G.WRAPS.indexOf(settings.wrap) < 0) settings.wrap = 'cte';
    settings.batchSize = Math.max(1, Math.min(10000, Number(settings.batchSize) || 500));
    settings.legacyDateMode = !!settings.legacyDateMode;
    settings.emptyAsNull = !!settings.emptyAsNull;
    settings.inferTypes = !!settings.inferTypes;
    settings.table = String(settings.table || 'HARDCODE');
  }

  function applySettingsToUI() {
    renderSegs(el.dialectSegs, DIALECT_OPTS, settings.dialect, function (k) {
      settings.dialect = k; saveSettings(); applySettingsToUI(); markStale();
    });
    renderSegs(el.formatSegs, FORMAT_OPTS, settings.fmt, function (k) {
      settings.fmt = k; saveSettings(); applySettingsToUI(); markStale();
    });
    renderSegs(el.wrapSegs, WRAP_OPTS, settings.wrap, function (k) {
      settings.wrap = k; saveSettings(); applySettingsToUI(); markStale();
    });

    /* 包裹方式只对 UNION ALL 有意义；分批行数只对 INSERT 有意义 */
    el.wrapSegs.hidden = settings.fmt !== 'union';
    el.batchWrap.hidden = settings.fmt !== 'insert';

    el.tableInput.value = settings.table;
    el.batchInput.value = settings.batchSize;
    el.optEmptyNull.checked = settings.emptyAsNull;
    el.optInferTypes.checked = settings.inferTypes;
    el.optLegacyDate.checked = settings.legacyDateMode;

    /* CSV 自动推断数字只对 CSV 有意义 —— xlsx 本来就有类型信息 */
    el.inferWrap.hidden = !(state.book && state.book.kind === 'csv');
  }

  /* 转换相关的选项（prepare 只关心这几个） */
  function prepareOpts() {
    return {
      source: state.book ? state.book.kind : 'xlsx',
      emptyAsNull: settings.emptyAsNull,
      inferTypes: settings.inferTypes
    };
  }

  /* 完整的 sqlgen 参数。注意 dialect 必须是**方言对象**而不是 key 字符串。 */
  function sqlOptions() {
    return {
      dialect: D.resolve(settings.dialect),
      table: settings.table || 'HARDCODE',
      fmt: settings.fmt,
      wrap: settings.wrap,
      emptyAsNull: settings.emptyAsNull,
      inferTypes: settings.inferTypes,
      batchSize: settings.batchSize,
      legacyDateMode: settings.legacyDateMode,
      source: state.book ? state.book.kind : 'xlsx',
      headerRow: state.headerRow || 0
    };
  }

  /* ==================================================================
   * 三、数据源
   * ================================================================== */

  function currentSheet() {
    if (!state.book) return null;
    return state.book.sheets[state.sheetIndex] || state.book.sheets[0] || null;
  }

  function maxCols(rows) {
    let n = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i].length > n) n = rows[i].length;
    return n;
  }

  function colLetter(i) {
    let n = i + 1, s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  const DELIM_NAME = { ',': '逗号', ';': '分号', '\t': '制表符', '|': '竖线' };

  function renderFileRow() {
    const b = state.book;
    if (!b) { el.fileRow.hidden = true; return; }
    const sheet = currentSheet();
    el.fileRow.hidden = false;

    el.fileName.textContent = b.label;
    el.fileName.title = b.label;
    el.fileDot.className = 'esq-file-dot' + (b.kind === 'csv' ? ' is-csv' : '');

    const bits = [];
    if (b.sample) bits.push('示例数据');
    bits.push(b.kind === 'csv' ? 'CSV' : 'XLSX');
    if (b.size) bits.push(U.fmtBytes(b.size));
    if (b.meta && b.meta.encoding) bits.push(b.meta.encoding);
    if (b.meta && b.meta.delimiter) bits.push('分隔符 ' + (DELIM_NAME[b.meta.delimiter] || b.meta.delimiter));
    if (sheet) bits.push(U.fmtInt(sheet.rows.length) + ' 行');
    el.fileMeta.textContent = bits.join(' · ');
  }

  function renderSheetSelect() {
    const sheets = state.book ? state.book.sheets : [];
    el.sheetSelect.textContent = '';
    sheets.forEach(function (s, i) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = s.name + '（' + U.fmtInt(s.rows.length) + ' 行）';
      el.sheetSelect.appendChild(opt);
    });
    el.sheetSelect.value = String(state.sheetIndex);
    el.sheetWrap.hidden = sheets.length < 2;
  }

  function renderEnvNotice() {
    el.envNotice.textContent = '';
    if (!R.canReadXlsx()) {
      notice(el.envNotice, 'warn',
        '当前浏览器缺少原生解压能力（DecompressionStream "deflate-raw"），无法解析 .xlsx。' +
        '请换用 Chrome / Edge 103+、Firefox 113+ 或 Safari 16.4+；' +
        '或先把表格另存为 .csv 再试。');
    }
  }

  /* 载入一份（新的）数据源 */
  function applyBook(book) {
    state.book = book;
    state.sheetIndex = 0;
    state.headerRow = null;      /* 换文件一律回到"自动识别"，避免把上一个文件的手动选择带过来 */
    el.emptyCard.hidden = true;
    el.workState.hidden = false;
    dropResult();
    applySettingsToUI();         /* CSV 才会显示"自动推断数字"开关 */
    renderFileRow();
    renderSheetSelect();
    refreshMeta();
  }

  function applyError(msg) {
    state.book = null;
    el.fileRow.hidden = true;
    el.sheetWrap.hidden = true;
    el.headerHint.textContent = '';
    el.workState.hidden = true;
    el.headerNotice.textContent = '';
    el.headerPicker.textContent = '';
    closeDetails();
    dropResult();
    el.emptyCard.hidden = false;
    el.envNotice.textContent = '';
    notice(el.envNotice, 'danger', msg);
    toast(msg, 'error');
  }

  /* 回到空态：清掉数据源与产物，让用户从头挑一个文件。
     与 applyError 的区别是不报错 —— 是用户主动按的「重新选择」。 */
  function resetToEmpty() {
    state.book = null;
    state.sheetIndex = 0;
    state.headerRow = null;
    state.detected = null;
    state.prepared = null;
    state.prepareError = null;
    el.fileInput.value = '';
    el.fileRow.hidden = true;
    el.sheetWrap.hidden = true;
    el.headerHint.textContent = '';
    el.headerNotice.textContent = '';
    el.headerPicker.textContent = '';
    el.envNotice.textContent = '';
    closeDetails();
    dropResult();
    renderStatusNote();
    renderDetails();         /* 清空抽屉内容，并把「详情」按钮一起收起 */
    el.emptyCard.hidden = false;
    el.workState.hidden = true;
    applySettingsToUI();     /* 回到 xlsx 语境：CSV 专属开关收起 */
    setBusy(false);
  }

  async function loadFile(file) {
    setBusy(true, '正在解析…');
    await U.nextFrame();
    try {
      const book = await R.readFile(file);
      applyBook({
        kind: book.kind === 'csv' ? 'csv' : 'xlsx',
        label: file.name || '未命名',
        size: book.size || 0,
        sample: false,
        meta: book,
        sheets: book.sheets
      });
      toast('已解析 ' + (file.name || '文件') + '（' + U.fmtInt(book.sheets[state.sheetIndex].rows.length) + ' 行）', 'ok');
    } catch (e) {
      applyError(e && e.message ? e.message : '解析失败');
    } finally {
      setBusy(false);
    }
  }

  function buildSampleRows() {
    const rows = [];
    /* 第 1 行：标题（右边补 null，模拟合并单元格） */
    const titleRow = [SAMPLE.title ? { t: 'str', v: SAMPLE.title } : null];
    while (titleRow.length < SAMPLE.cols.length) titleRow.push(null);
    rows.push(titleRow);
    /* 第 2 行：表头 */
    rows.push(SAMPLE.cols.map(function (c) { return { t: 'str', v: c }; }));
    /* 之后：数据 */
    SAMPLE.rows.forEach(function (r) {
      rows.push(r.map(function (v, i) {
        const t = SAMPLE.types[i];
        if (v === '') return null;
        if (t === 'num') return { t: 'num', v: v };
        if (t === 'date') return { t: 'date', v: v };
        if (t === 'bignum') return { t: 'bignum', v: v };
        return { t: 'str', v: v };
      }));
    });
    return rows;
  }

  function loadSample() {
    applyBook({
      kind: 'xlsx',
      label: SAMPLE.name,
      size: 0,
      sample: true,
      meta: null,
      sheets: [{ name: SAMPLE.sheet, rows: buildSampleRows() }]
    });
    toast('已加载示例数据', 'ok');
  }

  /* ==================================================================
   * 四、表头行确认
   * ================================================================== */

  function effectiveHeaderRow() {
    if (state.prepared) return state.prepared.headerRow;
    return state.headerRow || 1;
  }

  /* 跑一遍 prepare，拿到表头/体检/被跳过行等信息（不生成 SQL，代价很低） */
  function refreshMeta() {
    const sheet = currentSheet();
    if (!sheet) return;
    state.detected = H.detect(sheet.rows);
    try {
      state.prepared = G.prepare(sheet.rows, prepareOpts(), state.headerRow);
      state.prepareError = null;
    } catch (e) {
      state.prepared = null;
      state.prepareError = (e && e.message) || '无法解析这个工作表';
    }
    renderPicker();
    renderHeaderNotices();
    renderStatusNote();
    renderDetails();
    setBusy(state.busy);
  }

  function renderPicker() {
    const sheet = currentSheet();
    if (!sheet) return;
    const rows = sheet.rows;
    const totalCols = maxCols(rows);
    const hr = effectiveHeaderRow();

    const ncol = Math.min(totalCols, PICKER_MAX_COLS);
    const nrow = Math.min(rows.length, PICKER_MAX_ROWS);

    const table = document.createElement('table');

    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'esq-rownum';
    corner.textContent = '行';
    htr.appendChild(corner);
    for (let c = 0; c < ncol; c++) {
      const th = document.createElement('th');
      th.textContent = colLetter(c);
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < nrow; r++) {
      const tr = document.createElement('tr');
      if (r + 1 === hr) tr.className = 'is-head';
      else if (r + 1 < hr) tr.className = 'is-skipped';
      tr.title = '点这一行，把它设为表头';

      const numTd = document.createElement('td');
      numTd.className = 'esq-rownum';
      numTd.textContent = String(r + 1);
      tr.appendChild(numTd);

      for (let c = 0; c < ncol; c++) {
        const td = document.createElement('td');
        const raw = rows[r] ? rows[r][c] : null;
        const cell = raw == null ? null : raw;
        td.textContent = U.previewCell(cell);
        td.title = '第 ' + (r + 1) + ' 行 · ' + colLetter(c) + ' 列 —— ' + U.cellKind(cell);
        if (cell && cell.t === 'bignum') td.style.color = 'var(--warn)';
        tr.appendChild(td);
      }

      tr.addEventListener('click', function () { pickHeaderRow(r + 1); });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    el.headerPicker.textContent = '';
    el.headerPicker.appendChild(table);
  }

  function renderHeaderNotices() {
    el.headerNotice.textContent = '';

    if (state.prepareError) {
      notice(el.headerNotice, 'danger', state.prepareError);
      return;
    }
    const pre = state.prepared;
    if (!pre) return;

    if (state.headerRow) {
      notice(el.headerNotice, 'info',
        '已手动指定第 ' + state.headerRow + ' 行为表头。',
        '恢复自动识别',
        function () { state.headerRow = null; refreshMeta(); markStale(); });
    }

    if (pre.skippedRows.length) {
      const head = pre.skippedRows.slice(0, 5).join('、');
      const more = pre.skippedRows.length > 5 ? ' 等 ' + pre.skippedRows.length + ' 行' : '';
      notice(el.headerNotice, 'warn',
        '第 ' + head + more + ' 行会整行跳过（表头在第 ' + pre.headerRow + ' 行）。' +
        '如果表头其实在第 1 行，点预览里的第 1 行就能更正。',
        !state.headerRow ? '用第 1 行做表头' : null,
        function () { pickHeaderRow(1); });
    }

    if (!pre.check.ok) {
      pre.check.issues.forEach(function (t) { notice(el.headerNotice, 'warn', t); });
    }

    if (state.detected && state.headerRow && state.detected.row !== state.headerRow) {
      notice(el.headerNotice, 'info',
        '自动识别原本选的是第 ' + state.detected.row + ' 行（' + state.detected.why + '）。');
    }
  }

  /* 状态栏右侧那一行摘要：表头为什么落在这一行。
     只放一行 —— 放不下的（评分、被跳过的行、逐列类型）一律进「详情」抽屉。
     这里必须用 textContent 覆写，别拼成"含 N 行"这种宽判据的字符串：
     识别落到"保守取第 1 行"那一支时，说明文本里同样会出现"第 2 行"。 */
  function renderStatusNote() {
    if (!state.book) { el.headerHint.textContent = ''; return; }
    if (state.headerRow) {
      el.headerHint.textContent = '手动指定第 ' + state.headerRow + ' 行为表头';
      return;
    }
    el.headerHint.textContent = state.detected
      ? '表头取第 ' + state.detected.row + ' 行：' + state.detected.why
      : '';
  }

  /* 「详情」抽屉：装那些"必须有、但不该一直占屏"的说明。
     内容每次都重算 —— 打开时看到的就是当前状态，不是陈旧快照。 */
  function renderDetails() {
    const box = el.detailsBody;
    box.textContent = '';

    if (!state.book) { el.btnDetails.hidden = true; return; }

    const pre = state.prepared;
    const groups = [];

    /* ① 表头识别 */
    const head = [];
    if (state.headerRow) {
      head.push('表头是手动指定的第 ' + state.headerRow + ' 行。');
      if (state.detected) {
        head.push('自动识别原本选的是第 ' + state.detected.row + ' 行（' + state.detected.why + '）。');
      }
    } else if (state.detected) {
      head.push('自动识别选第 ' + state.detected.row + ' 行：' + state.detected.why + '。');
    }
    if (pre) {
      if (pre.skippedRows.length) {
        head.push('第 ' + pre.skippedRows.join('、') + ' 行整行跳过，不参与产物。');
      } else {
        head.push('表头之前没有被跳过的行。');
      }
      if (!pre.check.ok) pre.check.issues.forEach(function (t) { head.push(t); });
      head.push('表头 ' + pre.header.length + ' 列，数据 ' + pre.data.length + ' 行。');
    }
    if (state.prepareError) head.push(state.prepareError);
    groups.push(['表头识别', head]);

    /* ② 列级类型统一：为什么某些列整体变成了字符串 */
    const cols = [];
    if (state.result) {
      state.result.forcedGroups.forEach(function (g) {
        cols.push('整列按字符串输出（' + g[0] + '）：' + g[1].join('、'));
      });
      if (!cols.length) cols.push('没有列被强制成字符串，各列都按原始类型输出。');
    } else {
      cols.push('先生成一次 SQL，这里会列出哪些列被统一成了字符串以及原因。');
    }
    groups.push(['列级类型', cols]);

    /* ③ 处理耗时 */
    const time = [];
    if (state.result) {
      time.push('预处理 ' + U.fmtMs(state.result.tPrep) +
                '（解析表头、统一列类型），渲染 ' + U.fmtMs(state.result.tRender) + '（拼 SQL 文本）。');
      time.push('合计 ' + U.fmtMs(state.result.totalMs) + '，产物 ' +
                U.fmtInt(state.result.rowCount) + ' 行 × ' + U.fmtInt(state.result.colCount) + ' 列 / ' +
                U.fmtBytes(state.result.bytes) + '。');
    } else {
      time.push('尚未生成产物。');
    }
    groups.push(['处理耗时', time]);

    let count = 0;
    groups.forEach(function (g) {
      const wrap = document.createElement('div');
      wrap.className = 'esq-detail-group';

      const title = document.createElement('div');
      title.className = 'esq-detail-title';
      title.textContent = g[0];
      wrap.appendChild(title);

      const ul = document.createElement('ul');
      ul.className = 'esq-detail-list';
      g[1].forEach(function (t) {
        if (!t) return;
        const li = document.createElement('li');
        li.textContent = t;
        ul.appendChild(li);
        count++;
      });
      wrap.appendChild(ul);
      box.appendChild(wrap);
    });

    el.btnDetails.hidden = false;
    el.btnDetails.textContent = '详情 ' + count;
  }

  function pickHeaderRow(n) {
    if (state.headerRow === n) return;
    state.headerRow = n;
    refreshMeta();
    markStale();
  }

  /* ==================================================================
   * 五、生成 SQL
   * ================================================================== */

  function dropResult() {
    state.result = null;
    staleEl = null;
    el.resultNotice.textContent = '';
    el.resultCode.textContent = '';
    el.codeHint.textContent = '';
    el.resultPlaceholder.hidden = false;
    el.btnCopy.disabled = true;
    el.btnDownload.disabled = true;
  }

  function markStale() {
    if (!state.result || staleEl) return;
    staleEl = notice(el.resultNotice, 'warn',
      '设置已变更，下面的产物还是上一次生成的。',
      '重新生成',
      function () { generate(); });
    el.resultNotice.insertBefore(staleEl, el.resultNotice.firstChild);
  }

  function clearStale() {
    if (!staleEl) return;
    if (staleEl.parentNode) staleEl.parentNode.removeChild(staleEl);
    staleEl = null;
  }

  async function generate() {
    if (state.busy || !state.prepared) return;
    const sheet = currentSheet();
    if (!sheet) return;

    setBusy(true, '正在生成…');
    await U.nextFrame();

    const t0 = Date.now();
    try {
      const res = G.buildSql(sheet.rows, sqlOptions());
      res.totalMs = Date.now() - t0;
      state.result = res;
      renderResult();
      clearStale();
      toast('已生成：' + U.fmtInt(res.rowCount) + ' 行', 'ok');
    } catch (e) {
      dropResult();
      /* 报错时占位提示让位，别出现"上面一条红字、下面一句『点生成 SQL』" */
      el.resultPlaceholder.hidden = true;
      notice(el.resultNotice, 'danger', (e && e.message) || '生成失败');
      toast((e && e.message) || '生成失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  /* SQL 语法高亮。只做够用的近似着色（注释 / 字符串 / 引用标识符 / 关键字 / 数字），
     目的是让几千行的 UNION ALL 一眼看得出结构，不是要当编辑器用。
     产出的是**词元数组**而不是 HTML 字符串，由调用方用 DOM API 拼节点：
     ① 不必手工转义（拼 HTML 最容易在这里漏一个字符）；② 自检脚本能直接读到
     真实渲染出来的文本，不必再去反解析 innerHTML。 */
  const KW_STICKY = /(SELECT|UNION|ALL|WITH|AS|INSERT|INTO|VALUES|FROM|NULL|GO|TABLE|CREATE)\b/iy;
  const FN_STICKY = /(CONCAT|CHAR|CHR|TO_DATE|CONVERT|CAST|N)\b/iy;
  const NUM_STICKY = /\d+(?:\.\d+)?/y;

  function tokenizeSql(src) {
    const out = [];
    const n = src.length;
    let i = 0, plain = '';

    function flush() {
      if (plain) { out.push({ cls: '', text: plain }); plain = ''; }
    }

    while (i < n) {
      const ch = src[i];

      /* 行注释 */
      if (ch === '-' && src[i + 1] === '-') {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        flush();
        out.push({ cls: 'c', text: src.slice(i, j) });
        i = j;
        continue;
      }

      /* 单引号字符串（'' 是转义的单引号） */
      if (ch === "'") {
        let j = i + 1;
        while (j < n) {
          if (src[j] === "'") {
            if (src[j + 1] === "'") j += 2;
            else { j++; break; }
          } else j++;
        }
        flush();
        out.push({ cls: 's', text: src.slice(i, j) });
        i = j;
        continue;
      }

      /* 被引用的标识符：[] / `` / ""（内部双写是转义） */
      if (ch === '[' || ch === '`' || ch === '"') {
        const close = ch === '[' ? ']' : ch;
        let j = i + 1, end = -1;
        while (j < n) {
          if (src[j] === close) {
            if (src[j + 1] === close) { j += 2; continue; }
            end = j + 1;
            break;
          }
          j++;
        }
        if (end < 0) end = n;
        flush();
        out.push({ cls: 'k', text: src.slice(i, end) });
        i = end;
        continue;
      }

      /* 关键字 / 函数名 / 数字。只在字母或数字处试，别对每个字符都跑正则 */
      let m = null, cls = 'k';
      if (ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z') {
        KW_STICKY.lastIndex = i;
        m = KW_STICKY.exec(src);
        if (!m) { FN_STICKY.lastIndex = i; m = FN_STICKY.exec(src); }
      } else if (ch >= '0' && ch <= '9') {
        NUM_STICKY.lastIndex = i;
        m = NUM_STICKY.exec(src);
        cls = 'n';
      }
      if (m) {
        flush();
        out.push({ cls: cls, text: m[0] });
        i += m[0].length;
        continue;
      }

      plain += ch;
      i++;
    }
    flush();
    return out;
  }

  /* 把词元画进容器（纯 DOM，不用 innerHTML） */
  function renderTokens(box, tokens) {
    box.textContent = '';
    tokens.forEach(function (t) {
      if (!t.cls) { box.appendChild(document.createTextNode(t.text)); return; }
      const span = document.createElement('span');
      span.className = t.cls;
      span.textContent = t.text;
      box.appendChild(span);
    });
  }

  /* 多行小字提示（用 <br> 分行，同样是 DOM 而不是 innerHTML） */
  function renderHint(box, lines) {
    box.textContent = '';
    lines.forEach(function (h, i) {
      if (i) box.appendChild(document.createElement('br'));
      box.appendChild(document.createTextNode(h));
    });
  }

  function renderResult() {
    const res = state.result;
    el.resultPlaceholder.hidden = true;
    el.btnCopy.disabled = false;
    el.btnDownload.disabled = false;
    el.statRows.textContent = U.fmtInt(res.rowCount);
    el.statCols.textContent = U.fmtInt(res.colCount);
    el.statSize.textContent = U.fmtBytes(res.bytes);
    el.statTime.textContent = U.fmtMs(res.totalMs);

    el.resultNotice.textContent = '';
    staleEl = null;

    /* 表头理由与"整列按字符串输出"的逐列明细都收进了「详情」抽屉 ——
       它们挂在产物卡上会一直占屏，把真正要看的 SQL 挤下去。
       这里只留"需要你留意"的告警。 */
    res.warnings.forEach(function (w) {
      notice(el.resultNotice, w.level === 'danger' ? 'danger' : 'warn', w.text);
    });

    renderStatusNote();
    renderDetails();

    const lines = res.sql.split('\n');
    const tokens = tokenizeSql(lines.slice(0, PREVIEW_MAX_LINES).join('\n'));
    if (lines.length > PREVIEW_MAX_LINES) {
      tokens.push({
        cls: 'c',
        text: '\n-- … 还有 ' + U.fmtInt(lines.length - PREVIEW_MAX_LINES) +
              ' 行，完整内容请用「复制 SQL」或「下载 .sql」'
      });
    }
    renderTokens(el.resultCode, tokens);

    const dia = D.resolve(settings.dialect);
    const hints = [];
    hints.push('产物 ' + U.fmtInt(lines.length) + ' 行 / ' + U.fmtBytes(res.bytes) +
               '，UTF-8 无 BOM、LF 换行（与命令行版一致）');
    if (res.sql.indexOf(dia.newlineExpr) >= 0) {
      hints.push('源数据含多行文本，换行按 ' + dia.name + ' 的写法拼成 ' + dia.newlineExpr +
                 '，不是字面换行符');
    }
    if (settings.fmt === 'insert') {
      hints.push('INSERT 每批 ' + U.fmtInt(settings.batchSize) + ' 行一句');
    }
    if (dia.dual) hints.push(dia.name + ' 的每行 SELECT 会补上' + dia.dual);
    renderHint(el.codeHint, hints);
  }

  /* ==================================================================
   * 六、事件绑定
   * ================================================================== */

  /* 拖拽：dragenter/dragleave 会在子元素间反复触发，用计数器抵消 */
  let dragDepth = 0;

  el.drop.addEventListener('click', function () { el.fileInput.click(); });
  el.drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.fileInput.click();
    }
  });
  el.drop.addEventListener('dragenter', function (e) {
    e.preventDefault();
    dragDepth++;
    el.drop.classList.add('is-over');
  });
  el.drop.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  el.drop.addEventListener('dragleave', function (e) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.drop.classList.remove('is-over');
  });
  el.drop.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    el.drop.classList.remove('is-over');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) loadFile(files[0]);
  });

  el.fileInput.addEventListener('change', function () {
    const f = el.fileInput.files && el.fileInput.files[0];
    if (f) loadFile(f);
    el.fileInput.value = '';   /* 清空，同一个文件才能再次触发 change */
  });

  el.btnSample.addEventListener('click', function (e) {
    e.stopPropagation();       /* 否则会连带动到拖拽区，把文件选择框也弹出来 */
    loadSample();
  });

  el.sheetSelect.addEventListener('change', function () {
    state.sheetIndex = Number(el.sheetSelect.value) || 0;
    state.headerRow = null;
    renderFileRow();
    refreshMeta();
    markStale();
  });

  el.tableInput.addEventListener('input', function () {
    settings.table = el.tableInput.value;
    saveSettings();
    markStale();
  });
  el.tableInput.addEventListener('blur', function () {
    if (!el.tableInput.value.trim()) {
      settings.table = 'HARDCODE';
      el.tableInput.value = 'HARDCODE';
      saveSettings();
      markStale();
    }
  });

  el.batchInput.addEventListener('input', function () {
    const v = Math.max(1, Math.min(10000, Number(el.batchInput.value) || 1));
    settings.batchSize = v;
    saveSettings();
    markStale();
  });
  el.batchInput.addEventListener('blur', function () {
    el.batchInput.value = settings.batchSize;
  });

  el.optEmptyNull.addEventListener('change', function () {
    settings.emptyAsNull = el.optEmptyNull.checked;
    saveSettings();
    refreshMeta();     /* 空串是否算空，会影响列级类型判断 */
    markStale();
  });
  el.optInferTypes.addEventListener('change', function () {
    settings.inferTypes = el.optInferTypes.checked;
    saveSettings();
    refreshMeta();
    markStale();
  });
  el.optLegacyDate.addEventListener('change', function () {
    settings.legacyDateMode = el.optLegacyDate.checked;
    saveSettings();
    markStale();
  });

  el.btnGenerate.addEventListener('click', generate);

  el.btnCopy.addEventListener('click', async function () {
    if (!state.result) return;
    const ok = await U.copyText(state.result.sql);
    toast(ok ? '已复制到剪贴板' : '复制被浏览器拦下，请手动全选复制', ok ? 'ok' : 'error');
  });

  el.btnDownload.addEventListener('click', function () {
    if (!state.result) return;
    const sheet = currentSheet();
    /* 与命令行版 config.DEFAULT_FILENAME = '{name}_{sheet}_hardcode.sql' 同名 */
    const fname = U.stemOf(state.book.label) + '_' + U.safeFileStem(sheet ? sheet.name : 'sheet') + '_hardcode.sql';
    const size = U.downloadText(fname, state.result.sql, 'application/sql');
    toast('已开始下载 ' + fname + '（' + U.fmtBytes(size) + '）', 'ok');
  });

  el.btnReselect.addEventListener('click', resetToEmpty);

  /* 使用提示弹窗 */
  function openTips() { el.tipModal.hidden = false; }
  function closeTips() { el.tipModal.hidden = true; }
  el.btnTips.addEventListener('click', openTips);
  el.btnCloseModal.addEventListener('click', closeTips);
  el.btnCloseModalX.addEventListener('click', closeTips);
  el.tipModal.addEventListener('click', function (e) {
    if (e.target === el.tipModal) closeTips();   /* 点遮罩关闭 */
  });

  /* 识别详情抽屉 */
  function openDetails() { el.detailsDrawer.hidden = false; }
  function closeDetails() { el.detailsDrawer.hidden = true; }
  el.btnDetails.addEventListener('click', openDetails);
  el.btnCloseDetails.addEventListener('click', closeDetails);
  el.btnCloseDetailsX.addEventListener('click', closeDetails);
  el.detailsDrawer.addEventListener('click', function (e) {
    if (e.target === el.detailsDrawer) closeDetails();
  });

  /* 一个 keydown 处理所有浮层的 Escape（挂两个会互相覆盖：
     document 上的监听是「一种类型只有一个」） */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!el.detailsDrawer.hidden) { closeDetails(); return; }
    if (!el.tipModal.hidden) closeTips();
  });

  /* ==================================================================
   * 七、启动
   * ================================================================== */

  function renderEmptyFeatures() {
    el.emptyFeatures.textContent = '';
    FEATURES.forEach(function (f) {
      const span = document.createElement('span');
      span.className = 'feature';
      const b = document.createElement('b');
      b.textContent = f.b;
      span.appendChild(b);
      span.appendChild(document.createTextNode(' ' + f.t));
      el.emptyFeatures.appendChild(span);
    });
  }

  loadSettings();
  applySettingsToUI();
  renderEmptyFeatures();
  renderEnvNotice();
  renderStatusNote();
  renderDetails();
  dropResult();
  el.workState.hidden = true;   /* 启动必然是空态：还没有数据源，没什么可预览的 */
  setBusy(false);
})();
