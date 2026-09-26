'use strict';
/* =====================================================================
 * dialects.js - SQL 方言规则（命名空间 E2sDialects）
 * 与 Python 版 src/excel2sql/dialects.py 一一对应。
 *
 * 规则来源（不要"简化"，每条都是踩坑换来的）：
 *   - MySQL 的换行必须写 CHAR(10 USING utf8mb4)：裸 CHAR(10) 在 MySQL 是
 *     二进制串，CONCAT 一旦遇到二进制参数结果也是二进制，
 *     CREATE TABLE AS SELECT 会把列推成 varbinary。
 *   - Oracle 的 date / datetime 格式串不同，且 prefix/suffix 不能自带引号
 *     （引号由 quoteString 统一加）。
 *   - UNION ALL 必须独立成行，否则 Oracle 会出现 `... FROM dualUNION ALL`。
 * ================================================================== */
const E2sDialects = (function () {
  function make(o) {
    return Object.assign({
      key: '', name: '',
      identOpen: '', identClose: '',
      stringPrefix: '',
      concat: 'plus',              // plus: a + b | pipe: a || b | func: CONCAT(a, b)
      newlineExpr: 'CHAR(10)',
      datePrefix: '', dateSuffix: '',
      datetimePrefix: '', datetimeSuffix: '',
      dual: '',
      backslashEscape: false
    }, o);
  }

  const SQLSERVER = make({
    key: 'sqlserver', name: 'SQL Server',
    identOpen: '[', identClose: ']',
    stringPrefix: 'N',
    concat: 'plus', newlineExpr: 'CHAR(10)'
  });

  const MYSQL = make({
    key: 'mysql', name: 'MySQL',
    identOpen: '`', identClose: '`',
    stringPrefix: '',
    concat: 'func',
    newlineExpr: 'CHAR(10 USING utf8mb4)',
    backslashEscape: true
  });

  const ORACLE = make({
    key: 'oracle', name: 'Oracle',
    identOpen: '"', identClose: '"',
    stringPrefix: '',
    concat: 'pipe', newlineExpr: 'CHR(10)',
    datePrefix: 'TO_DATE(', dateSuffix: ",'YYYY-MM-DD')",
    datetimePrefix: 'TO_DATE(', datetimeSuffix: ",'YYYY-MM-DD HH24:MI:SS')",
    dual: ' FROM dual'
  });

  const POSTGRESQL = make({
    key: 'postgresql', name: 'PostgreSQL',
    identOpen: '"', identClose: '"',
    stringPrefix: '',
    concat: 'pipe', newlineExpr: 'CHR(10)'
  });

  /* SQLite（对齐 Python 版 0.4.0）。
     日期**不加包装**：SQLite 没有日期类型，ISO-8601 文本就是它的规范表示，
     '2024-11-11' / '2024-11-11 13:05:00' 这类字面量能被 date() / strftime() 直接识别。
     规律是「只有真正需要包装的方言才加前缀」—— 目前仍只有 Oracle 需要 TO_DATE。 */
  const SQLITE = make({
    key: 'sqlite', name: 'SQLite',
    identOpen: '"', identClose: '"',
    stringPrefix: '',
    concat: 'pipe', newlineExpr: 'CHAR(10)'
  });

  const DIALECTS = {
    sqlserver: SQLSERVER,
    mysql: MYSQL,
    oracle: ORACLE,
    postgresql: POSTGRESQL,
    sqlite: SQLITE
  };

  /* ★ 方言清单的**唯一来源**（对齐 Python 版 dialects.ORDER）。
     下拉选项、编号、报错里的可选值清单全部从它派生 —— 加方言时只改这一处。
     此前 index.html 里另手写了一份 <option>，加 SQLite 时就得记着改两处。 */
  const ORDER = ['sqlserver', 'mysql', 'oracle', 'postgresql', 'sqlite'];

  /* 编号 / 别名 -> 方言 key（对齐 Python 版 ALIASES） */
  const ALIASES = {
    '1': 'sqlserver', sqlserver: 'sqlserver', mssql: 'sqlserver',
    '2': 'mysql', mysql: 'mysql', mariadb: 'mysql',
    '3': 'oracle', oracle: 'oracle', ora: 'oracle',
    '4': 'postgresql', postgresql: 'postgresql', postgres: 'postgresql', pg: 'postgresql',
    '5': 'sqlite', sqlite: 'sqlite', sqlite3: 'sqlite'
  };

  /* 除「正式名」与「编号」之外的别名，报错时提示用（从 ALIASES 派生，避免两处各写一份） */
  const EXTRA_ALIASES = Object.keys(ALIASES)
    .filter(function (k) { return ORDER.indexOf(k) < 0 && !/^\d+$/.test(k); })
    .sort();

  /* 校验失败时抛这个 —— 与 Python 版同名同义。
     文案里必须带上全部可选值与别名：拼错方言时用户要能一眼看出该写什么
     （Python 侧专门有一条测试钉住这一点）。 */
  function UnknownDialect(value) {
    const err = new Error(
      '无法识别的方言：' + JSON.stringify(value) +
      '。可选 ' + choicesText() +
      '，也接受 ' + EXTRA_ALIASES.join(' / ') + ' 等别名');
    err.name = 'UnknownDialect';
    return err;
  }

  /* 可选值清单（正式名 + 编号），给报错与提示文案用 */
  function choicesText() {
    return ORDER.map(function (k, i) {
      return k + '(' + (i + 1) + ')';
    }).join(' / ');
  }

  /* 引用标识符，并转义内部引号（防语法破坏与注入） */
  function quoteIdent(dia, name) {
    const s = String(name);
    if (dia.identOpen === '[') return '[' + s.replace(/]/g, ']]') + ']';
    if (dia.identOpen === '`') return '`' + s.replace(/`/g, '``') + '`';
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /* 单行字符串字面量（不含换行） */
  function quoteString(dia, body) {
    let s = String(body);
    if (dia.backslashEscape) s = s.replace(/\\/g, '\\\\');
    s = s.replace(/'/g, "''");
    return dia.stringPrefix + "'" + s + "'";
  }

  /* 把多行文本拼成单个表达式 */
  function concatStrings(dia, segments, newlineExpr) {
    const parts = [];
    segments.forEach(function (seg, i) {
      if (i) parts.push(newlineExpr);
      parts.push(seg);
    });
    if (dia.concat === 'func') return 'CONCAT(' + parts.join(', ') + ')';
    return parts.join(dia.concat === 'pipe' ? ' || ' : ' + ');
  }

  /* 把 '1' / 'mysql' / 'PostgreSQL' 统一解析成 Dialect。
     ★ 无法识别时**抛 UnknownDialect**，不再静默回退成 SQL Server（对齐 Python 0.4.1）。
       静默回退是最坏的一类失败：产物语法完全正确、只是方言错了 ——
       往往要到灌库时才暴露，更糟的是被隐式转换掩盖过去，看起来像"跑通了"。
       调用方各自决定怎么办：读设置时是"显式提示 + 重置为默认"，渲染时不该再遇到非法值。 */
  function resolve(value) {
    const k = String(value == null ? '' : value).trim().toLowerCase();
    const key = ALIASES[k];
    if (!key) throw UnknownDialect(value);
    return DIALECTS[key];
  }

  /* 不抛的版本：给"只想问一句合不合法"的地方用 */
  function isValid(value) {
    const k = String(value == null ? '' : value).trim().toLowerCase();
    return !!ALIASES[k];
  }

  /* 下拉选项：从 ORDER 派生，别在别处再手写一份 */
  function options() {
    return ORDER.map(function (k) {
      return { key: k, name: DIALECTS[k].name };
    });
  }

  return {
    DIALECTS: DIALECTS,
    ALIASES: ALIASES,
    ORDER: ORDER,
    EXTRA_ALIASES: EXTRA_ALIASES,
    quoteIdent: quoteIdent,
    quoteString: quoteString,
    concatStrings: concatStrings,
    resolve: resolve,
    isValid: isValid,
    options: options,
    choicesText: choicesText
  };
})();
