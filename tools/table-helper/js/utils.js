'use strict';
/* =====================================================================
 * utils.js - 通用工具（命名空间 TableUtils）
 * 存放与表格无关、可复用的轻量纯函数，供其他模块（exporters 等）调用。
 * 对外仅暴露 today / csvEscape，二者被视为公共 API，改名会影响依赖方。
 * ================================================================== */
const TableUtils = (function () {
  /* 返回本地当日日期字符串（用于导出文件名，格式 YYYY-MM-DD） */
  function today() { return new Date().toISOString().slice(0, 10); }

  /* CSV 字段转义：统一加引号，内部的 " 双写为 ""（遵循 RFC 4180） */
  function csvEscape(v) { return '"' + String(v ?? '').replace(/"/g, '""') + '"'; }

  return { today, csvEscape };
})();