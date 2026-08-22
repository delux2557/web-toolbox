'use strict';
/* =====================================================================
 * csv-parser.js - 标准 CSV 解析与列名规范化（命名空间 CsvParser）
 * 对外暴露 parseCSV / buildColumns，二者为公共 API；函数内部局部变量
 * 已重命名以增强可读性，行为保持不变。
 * ================================================================== */
const CsvParser = (function () {

  /* ---------- 标准 CSV 解析（RFC 4180 风格状态机） ---------- */
  function parseCSV(input) {
    const text = String(input ?? '').replace(/^\uFEFF/, ''); // 剥离 UTF-8 BOM，避免首列多出不可见字符
    const rows = [];
    let currentRow = [], cell = '', inQuotes = false, i = 0, len = text.length;
    while (i < len) {
      const ch = text[i];
      if (inQuotes) {
        // 引号模式：连续两个 " 转为字面引号；单个 " 表示本字段结束
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; }
          else { inQuotes = false; i++; }
        } else { cell += ch; i++; }
      } else {
        if (ch === '"' && cell === '') { inQuotes = true; i++; }              // 字段开头进入引号模式
        else if (ch === ',') { currentRow.push(cell); cell = ''; i++; }       // 字段分隔
        else if (ch === '\n') { currentRow.push(cell); rows.push(currentRow); currentRow = []; cell = ''; i++; }
        else if (ch === '\r') {                                                // CR / CRLF 均视为换行
          if (text[i + 1] === '\n') i++;
          currentRow.push(cell); rows.push(currentRow); currentRow = []; cell = ''; i++;
        }
        else { cell += ch; i++; }
      }
    }
    // 收尾：无尾随换行时补最后一行，保证不漏掉结尾数据
    if (cell !== '' || currentRow.length) { currentRow.push(cell); rows.push(currentRow); }
    return rows;
  }

  /* 列名规范化：去重（同名加 _2/_3…）、空表头自动命名 列N */
  function buildColumns(grid, keepHeader) {
    if (keepHeader && grid.length) {
      const used = new Set();
      return grid[0].map((header, i) => {
        let baseName = String(header ?? '').trim() || ('列' + (i + 1));
        let name = baseName, n = 1;
        while (used.has(name)) { n++; name = baseName + '_' + n; }
        used.add(name);
        return name;
      });
    }
    // 无表头：列名 列1..列N，N 取最长行的列数
    const n = grid.length ? Math.max(...grid.map(r => r.length)) : 0;
    return Array.from({ length: n }, (_, i) => '列' + (i + 1));
  }

  return { parseCSV, buildColumns };
})();