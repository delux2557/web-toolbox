'use strict';
/* =====================================================================
 * sqlgen.js - 字面量渲染与 SQL 生成（命名空间 E2sSqlGen）
 * 与 Python 版 src/excel2sql/sqlgen.py 一一对应。
 *
 * 渲染层注册表与 dialects 同构：加一种「写法」= 加一个函数 + 注册一行。
 * 注意 --format 只管「同一种 SQL 文本的不同写法」；换输出载体（json/csv）
 * 或产品形态（ddl/orm）不并入本表。
 *
 * ★ legacyDateMode（默认 true）—— 对齐 Python 版行为：
 *     Python 侧 openpyxl 在 read_only 下会把**纯日期**单元格也返回 datetime，
 *     于是 literal() 走 datetime 分支，产物是 'YYYY-MM-DD 00:00:00'。
 *     本开关打开时前端复刻该行为，便于与命令行版产物逐字节对比；
 *     关闭时按 numFmt 精确判定，纯日期输出 'YYYY-MM-DD'（Oracle 下格式串也不同）。
 * ================================================================== */
const E2sSqlGen = (function () {
  const D = E2sDialects;
  const H = E2sHeaders;

  const FORMATS = ['union', 'insert'];
  const WRAPS = ['cte', 'plain'];
  /* 超过该行数仍用 UNION ALL 会明显拖慢解析，建议改 insert */
  const UNION_ROW_WARN = 2000;
  /* 超过 2 万行建议改用数据库原生通道 */
  const NATIVE_CHANNEL_WARN = 20000;
  /* 超过该行数直接拒绝，避免生成一个谁也打不开的 SQL 文件 */
  const MAX_ROWS = 200000;

  /* CTE 体内每行缩进的宽度（对齐 Python 版 CTE_INDENT） */
  const CTE_INDENT = '    ';

  /* 有效数字上限。取 15 是因为 Excel 本身只保证 15 位有效数字：
     越过这条线的"数字"几乎一定是编号/账号而不是数量，而且 19 位以上还会超出
     SQL Server / MySQL / PostgreSQL 的 bigint 范围 —— 硬转成数字字面量会直接报错。
     ★ 这条比 Number.isSafeInteger（2^53 ≈ 16 位）**更严**：一个 16 位但小于 2^53 的
       编号，isSafeInteger 会放行、JS 也能精确表示，但它是"编号"的概率远大于"数量"，
       所以按 15 位拦下、留作文本。 */
  const MAX_SIG_DIGITS = 15;

  const REASON_ALL_STRING = '用户选择全部按字符串输出';
  const REASON_MIXED = '同列混有数字/日期与文本，整列统一为字符串';
  const REASON_TEXT_CSV = '源数据是文本（CSV 无类型信息）';
  const REASON_TEXT_XLSX = '该列取值本身是文本';
  const REASON_BIGNUM = '超长数字按文本输出，避免浏览器端精度丢失';

  const INT_RE = /^[+-]?\d+$/;
  const FLOAT_RE = /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/;

  /* ------------------------------------------------------------------
   * 默认参数
   * ------------------------------------------------------------------ */
  function defaultOptions(o) {
    return Object.assign({
      dialect: D.DIALECTS.sqlserver,
      table: 'HARDCODE',
      fmt: 'union',
      wrap: 'cte',
      emptyAsNull: false,
      allString: false,
      inferTypes: false,
      batchSize: 500,
      legacyDateMode: true,
      source: 'xlsx'
    }, o || {});
  }

  /* ------------------------------------------------------------------
   * 列级类型统一
   * ------------------------------------------------------------------ */

  /* 逐列判断是否需要强制按字符串输出。
     只要该列出现过「非空字符串」就整列字符串化 —— 避免同列混 int/varchar
     导致 UNION ALL 隐式转换报错或算术溢出。 */
  function inferColumnTypes(header, rows, opt) {
    const n = header.length;
    if (opt.allString) {
      const all = [];
      for (let i = 0; i < n; i++) all.push(true);
      return all;
    }
    const force = [];
    for (let i = 0; i < n; i++) force.push(false);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const lim = Math.min(n, row.length);
      for (let i = 0; i < lim; i++) {
        const c = row[i];
        if (c && (c.t === 'str' || c.t === 'bignum')) {
          if (opt.emptyAsNull && c.t === 'str' && String(c.v).trim() === '') continue;
          force[i] = true;
        }
      }
    }
    return force;
  }

  /* 把「整列都是数字文本」的列换成真正的数字（--infer-types）
     保守起见只做「整列可解析」才转换：只要有一格不是数字（含前导零、
     超 2^53、NaN/inf）就整列保持文本，绝不逐格猜。 */
  /* 数字文本的有效位数（对齐 Python 版 _sig_digits 的 Decimal 口径）。
     去符号、去小数点、去**前导**零，剩下的都算有效数字 —— 尾随零算
     （Decimal('1.50') → 3 位），指数记号只取尾数部分。
     解析不了就返回一个大于任何阈值的大数，让调用方按「不安全」处理。 */
  function sigDigits(text) {
    const m = /^[+-]?(\d*\.?\d*)(?:[eE][+-]?\d+)?$/.exec(String(text).trim());
    if (!m || !m[1]) return MAX_SIG_DIGITS + 1;
    const mant = m[1].replace(/\./g, '').replace(/^0+/, '');
    return mant.length;
  }

  function asNumber(text) {
    const t = String(text).trim();
    if (!t) return null;
    if (INT_RE.test(t)) {
      const digits = t.replace(/^[+-]/, '');
      if (digits.length > 1 && digits.charAt(0) === '0') return null;   // '007' 保持文本
      if (sigDigits(digits) > MAX_SIG_DIGITS) return null;              // 多半是编号
      const n = Number(t);
      return Number.isSafeInteger(n) ? n : null;                        // 超 2^53 不转
    }
    if (FLOAT_RE.test(t)) {
      if (sigDigits(t) > MAX_SIG_DIGITS) return null;                   // 超出可无损表达的范围
      const n = Number(t);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function coerceNumericColumns(rows) {
    const out = rows.map(function (r) { return r.slice(); });
    let ncols = 0;
    out.forEach(function (r) { if (r.length > ncols) ncols = r.length; });

    for (let i = 0; i < ncols; i++) {
      const col = out.map(function (r) { return i < r.length ? r[i] : null; });
      const idx = [];
      col.forEach(function (c, j) { if (!H.isBlank(c)) idx.push(j); });
      if (!idx.length) continue;
      /* 只处理纯文本列；bignum 不参与（转了必然丢精度） */
      let allStr = true;
      idx.forEach(function (j) { if (col[j].t !== 'str') allStr = false; });
      if (!allStr) continue;

      const nums = idx.map(function (j) { return asNumber(col[j].v); });
      let ok = true;
      nums.forEach(function (n) { if (n === null) ok = false; });
      if (!ok) continue;

      idx.forEach(function (j, k) { out[j][i] = { t: 'num', v: nums[k] }; });
      /* 空白格一并转成 NULL —— 数字列本来就容不下空字符串 */
      col.forEach(function (c, j) { if (H.isBlank(c)) out[j][i] = null; });
    }
    return out;
  }

  /* ------------------------------------------------------------------
   * 字面量
   * ------------------------------------------------------------------ */
  function literal(cell, forceStr, opt) {
    const dia = opt.dialect;

    if (cell == null) return 'NULL';
    if (cell.t === 'bool') return cell.v ? "'1'" : "'0'";
    if (cell.t === 'err') return 'NULL';

    if (cell.t === 'date') {
      if (opt.legacyDateMode) {
        /* 对齐 Python：openpyxl 把纯日期也当 datetime，产物带 00:00:00 */
        return dia.datetimePrefix + D.quoteString(dia, cell.v + ' 00:00:00') + dia.datetimeSuffix;
      }
      return dia.datePrefix + D.quoteString(dia, cell.v) + dia.dateSuffix;
    }
    if (cell.t === 'datetime') {
      return dia.datetimePrefix + D.quoteString(dia, String(cell.v).replace('T', ' ')) + dia.datetimeSuffix;
    }
    if (cell.t === 'bignum') return D.quoteString(dia, cell.v);
    if (cell.t === 'num') {
      if (!forceStr) return String(cell.v);
      /* 整列按字符串输出时，数字也要加引号 —— 漏了这一步会退化成 NULL */
      return D.quoteString(dia, String(cell.v));
    }

    if (cell.t === 'str') {
      if (opt.emptyAsNull && String(cell.v).trim() === '') return 'NULL';
      /* ★ 与 Python literal() 一致：xlsx 里多行文本真存 \r\n，先归一化 */
      const text = String(cell.v).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const segs = text.split('\n').map(function (p) { return D.quoteString(dia, p); });
      return segs.length === 1 ? segs[0] : D.concatStrings(dia, segs, dia.newlineExpr);
    }
    return 'NULL';
  }

  /* 一行数据的字面量列表。withAlias=false 用于 INSERT（列名已在列清单里） */
  function renderRow(header, row, force, opt, withAlias) {
    const alias = withAlias !== false;
    const cells = [];
    for (let i = 0; i < header.length; i++) {
      const cell = i < row.length ? row[i] : null;
      let s = literal(cell, force[i], opt);
      if (alias) s += ' AS ' + D.quoteIdent(opt.dialect, header[i]);
      cells.push(s);
    }
    return cells.join(', ');
  }

  /* ------------------------------------------------------------------
   * 渲染器注册表
   * ------------------------------------------------------------------ */
  function renderUnion(header, data, force, opt) {
    const dia = opt.dialect;
    const lines = data.map(function (r) {
      return 'SELECT ' + renderRow(header, r, force, opt) + dia.dual;
    });
    if (opt.wrap === 'plain') return lines.join('\nUNION ALL\n') + '\n';
    const t = D.quoteIdent(dia, opt.table);
    /* CTE 体内缩进一级、闭合括号回到行首（对齐 Python 0.4.0 / sqlfluff 的默认风格）。
       plain **不缩进** —— 那是给「嵌进已有 SQL」用的，缩进交给调用方按所在层级对齐。 */
    const sep = '\n' + CTE_INDENT + 'UNION ALL\n' + CTE_INDENT;
    return 'WITH ' + t + ' AS (\n' + CTE_INDENT + lines.join(sep) +
           '\n)\nSELECT * FROM ' + t + ';\n';
  }

  function renderInsert(header, data, force, opt) {
    const dia = opt.dialect;
    const cols = header.map(function (h) { return D.quoteIdent(dia, h); }).join(', ');
    const head = 'INSERT INTO ' + D.quoteIdent(dia, opt.table) + ' (' + cols + ') VALUES\n';
    const parts = [];
    const size = Math.max(1, opt.batchSize | 0);
    for (let start = 0; start < data.length; start += size) {
      const chunk = data.slice(start, start + size);
      const body = chunk.map(function (r) {
        return '(' + renderRow(header, r, force, opt, false) + ')';
      }).join(',\n');
      parts.push(body + ';\n');
    }
    return head + parts.join('\n' + head);
  }

  const RENDERERS = { union: renderUnion, insert: renderInsert };

  /* ------------------------------------------------------------------
   * 产物头注释（所有渲染器共用）
   * ------------------------------------------------------------------ */

  /* 给「按字符串输出」的列分档，让"用户要求的"和"工具被迫的"可区分 */
  function forcedGroups(header, rows, force, opt) {
    const names = [];
    header.forEach(function (h, i) { if (force[i]) names.push(h); });
    if (!names.length) return [];
    if (opt.allString) return [[REASON_ALL_STRING, names]];

    const textReason = opt.source === 'csv' ? REASON_TEXT_CSV : REASON_TEXT_XLSX;
    const bignum = [], textLike = [], mixed = [];
    header.forEach(function (name, i) {
      if (!force[i]) return;
      const vals = [];
      rows.forEach(function (r) {
        const c = r[i];
        if (!H.isBlank(c)) vals.push(c);
      });
      /* 含超长数字的列优先归到「超长数字」档：原因更具体，用户才知道为什么 */
      if (vals.length && vals.some(function (c) { return c.t === 'bignum'; })) bignum.push(name);
      else if (vals.length && vals.every(function (c) { return c.t === 'str'; })) textLike.push(name);
      else mixed.push(name);
    });

    const out = [];
    if (mixed.length) out.push([REASON_MIXED, mixed]);
    if (bignum.length) out.push([REASON_BIGNUM, bignum]);
    if (textLike.length) out.push([textReason, textLike]);
    return out;
  }

  function headerComments(header, data, force, opt) {
    const lines = [
      '-- 由 excel2sql 生成：' + data.length + ' 行 x ' + header.length + ' 列',
      '-- 方言：' + opt.dialect.name + '   输出格式：' + opt.fmt
    ];
    forcedGroups(header, data, force, opt).forEach(function (g) {
      lines.push('-- 按字符串输出的列（' + g[0] + '）：' + g[1].join(', '));
    });
    lines.push('-- 提示：内联数据仅供测试/修数，请勿直接用于生产批量导入');
    return lines.map(function (l) { return l + '\n'; }).join('');
  }

  function render(header, data, force, opt) {
    return headerComments(header, data, force, opt) + RENDERERS[opt.fmt](header, data, force, opt);
  }

  /* ------------------------------------------------------------------
   * 预处理：表头识别 -> 裁列 -> 取数据 -> 类型统一
   * ------------------------------------------------------------------ */
  function prepare(rawRows, opt, headerRowOverride) {
    if (!rawRows || !rawRows.length) throw new Error('工作表是空的，没有可转换的内容');

    let headerRow, detectWhy;
    if (headerRowOverride && headerRowOverride > 0) {
      headerRow = Math.min(headerRowOverride, rawRows.length);
      detectWhy = '手动指定第 ' + headerRow + ' 行为表头';
    } else {
      const det = H.detect(rawRows);
      headerRow = det.row;
      detectWhy = det.why;
    }

    /* 列数：取所有行里最宽的 */
    let ncols = 0;
    rawRows.forEach(function (r) { if (r.length > ncols) ncols = r.length; });
    const headerCells = rawRows[headerRow - 1] || [];

    /* 裁掉尾部「表头为空 且 整列确实没数据」的列。
       注意必须检查该列有没有数据 —— 早期 Python 版没检查，导致
       "表头为空但有数据的尾列"被整列裁掉（真实 P0） */
    while (ncols > 1) {
      const i = ncols - 1;
      if (!H.isBlank(headerCells[i] != null ? headerCells[i] : null)) break;
      let hasData = false;
      for (let r = headerRow; r < rawRows.length; r++) {
        const c = rawRows[r][i] != null ? rawRows[r][i] : null;
        if (!H.isBlank(c)) { hasData = true; break; }
      }
      if (hasData) break;
      ncols--;
    }

    /* 表头名（空 -> null，交给 repair 补 col_N） */
    const rawNames = [];
    for (let i = 0; i < ncols; i++) {
      const c = headerCells[i] != null ? headerCells[i] : null;
      rawNames.push(H.isBlank(c) ? null : String(c.v).trim());
    }
    const header = H.repair(rawNames);

    /* 数据行：跳过全空行，列数补齐到 ncols */
    const data = [];
    for (let r = headerRow; r < rawRows.length; r++) {
      const row = rawRows[r] || [];
      let blank = true;
      for (let i = 0; i < ncols; i++) {
        if (!H.isBlank(row[i] != null ? row[i] : null)) { blank = false; break; }
      }
      if (blank) continue;
      const out = [];
      for (let i = 0; i < ncols; i++) out.push(row[i] != null ? row[i] : null);
      data.push(out);
    }

    if (!data.length) throw new Error('表头下方没有任何数据行，无法生成 SQL');

    /* ★ allString 时不再做数字转换（对齐 Python 版 0.4.0）：
       先转数字、再全部字符串化，顺带会把数字列里的空格子改成 NULL ——
       与"全部按字符串输出"自相矛盾。 */
    const finalData = (opt.inferTypes && !opt.allString) ? coerceNumericColumns(data) : data;
    const force = inferColumnTypes(header, finalData, opt);
    /* 体检基于「修复前」的表头 —— 空列名/重名会被自动修好，但必须如实告知用户 */
    const check = H.check(rawNames, finalData);

    /* 被跳过的行里只要有内容，就值得提示用户核对（可能把真表头跳过了）。
       注：Python 版这里的两个条件（首列非空 / 行内任一格非空）是重复的 ——
       首列非空必然蕴含行内非空，合并后行为完全一致。 */
    const skipped = [];
    for (let i = 1; i < headerRow; i++) {
      const row = rawRows[i - 1] || [];
      if (row.some(function (c) { return !H.isBlank(c); })) skipped.push(i);
    }

    return {
      header: header,
      data: finalData,
      force: force,
      headerRow: headerRow,
      detectWhy: detectWhy,
      check: check,
      skippedRows: skipped,
      ncols: ncols
    };
  }

  /* ------------------------------------------------------------------
   * 主入口
   * ------------------------------------------------------------------ */
  function buildSql(rawRows, options) {
    const opt = defaultOptions(options);
    if (FORMATS.indexOf(opt.fmt) < 0) throw new Error('未知输出格式：' + opt.fmt);
    if (WRAPS.indexOf(opt.wrap) < 0) throw new Error('未知包裹方式：' + opt.wrap);

    const t0 = Date.now();
    const pre = prepare(rawRows, opt, options && options.headerRow);
    const tPrep = Date.now() - t0;

    if (pre.data.length > MAX_ROWS) {
      throw new Error('数据有 ' + pre.data.length + ' 行，超过 ' + MAX_ROWS +
                      ' 行上限 —— 工具会拒绝生成一个谁也打不开的 SQL 文件。' +
                      '请改用数据库原生导入通道（SQL Server BULK INSERT / MySQL LOAD DATA / PostgreSQL COPY）。');
    }

    const t1 = Date.now();
    const body = render(pre.header, pre.data, pre.force, opt);
    const tRender = Date.now() - t1;

    /* 性能护栏（与原工具一致） */
    const warnings = [];
    if (opt.fmt === 'union' && pre.data.length > UNION_ROW_WARN) {
      warnings.push({
        level: 'warn',
        text: '数据 ' + pre.data.length + ' 行，UNION ALL 超过 ' + UNION_ROW_WARN +
              ' 行后解析会明显变慢，建议改用「INSERT 分批」输出。'
      });
    }
    if (pre.data.length > NATIVE_CHANNEL_WARN) {
      warnings.push({
        level: 'warn',
        text: '数据超过 2 万行，内联 SQL 已不是最佳通道 —— 正式导入建议用数据库原生工具' +
              '（SQL Server BULK INSERT / MySQL LOAD DATA / PostgreSQL COPY）。'
      });
    }
    if (!pre.check.ok) {
      pre.check.issues.forEach(function (t) { warnings.push({ level: 'warn', text: t }); });
    }

    return {
      sql: body,
      header: pre.header,
      rowCount: pre.data.length,
      colCount: pre.header.length,
      headerRow: pre.headerRow,
      detectWhy: pre.detectWhy,
      check: pre.check,
      skippedRows: pre.skippedRows,
      forcedGroups: forcedGroups(pre.header, pre.data, pre.force, opt),
      warnings: warnings,
      tPrep: tPrep,
      tRender: tRender,
      bytes: byteLengthUtf8(body)
    };
  }

  /* 产物字节数（Blob 是最准的度量，也顺带反映真实下载体积） */
  function byteLengthUtf8(s) {
    try { return new Blob([s]).size; } catch (e) { return s.length; }
  }

  /* 给界面用的规模预估（不生成 SQL） */
  function estimatePlan(rowCount, fmt) {
    const plan = { notes: [] };
    if (fmt === 'union' && rowCount > UNION_ROW_WARN) {
      plan.notes.push('约 ' + rowCount + ' 行用 UNION ALL 会较慢，建议改 INSERT 分批');
    }
    if (rowCount > NATIVE_CHANNEL_WARN) {
      plan.notes.push('超过 2 万行，正式导入建议走数据库原生通道');
    }
    if (rowCount > MAX_ROWS) {
      plan.notes.push('超过 ' + MAX_ROWS + ' 行会被拒绝');
    }
    return plan;
  }

  return {
    FORMATS: FORMATS,
    WRAPS: WRAPS,
    UNION_ROW_WARN: UNION_ROW_WARN,
    NATIVE_CHANNEL_WARN: NATIVE_CHANNEL_WARN,
    MAX_ROWS: MAX_ROWS,
    defaultOptions: defaultOptions,
    inferColumnTypes: inferColumnTypes,
    coerceNumericColumns: coerceNumericColumns,
    literal: literal,
    forcedGroups: forcedGroups,
    prepare: prepare,
    buildSql: buildSql,
    estimatePlan: estimatePlan,
    byteLengthUtf8: byteLengthUtf8
  };
})();
