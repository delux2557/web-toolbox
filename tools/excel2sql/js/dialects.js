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

  const DIALECTS = {
    sqlserver: SQLSERVER,
    mysql: MYSQL,
    oracle: ORACLE,
    postgresql: POSTGRESQL
  };

  /* 编号 / 别名 -> 方言 key（对齐 Python 版 ALIASES） */
  const ALIASES = {
    '1': 'sqlserver', sqlserver: 'sqlserver', mssql: 'sqlserver',
    '2': 'mysql', mysql: 'mysql', mariadb: 'mysql',
    '3': 'oracle', oracle: 'oracle', ora: 'oracle',
    '4': 'postgresql', postgresql: 'postgresql', postgres: 'postgresql', pg: 'postgresql'
  };

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

  function resolve(value) {
    const k = String(value == null ? '' : value).trim().toLowerCase();
    return DIALECTS[ALIASES[k] || 'sqlserver'];
  }

  return {
    DIALECTS: DIALECTS,
    ALIASES: ALIASES,
    quoteIdent: quoteIdent,
    quoteString: quoteString,
    concatStrings: concatStrings,
    resolve: resolve
  };
})();
