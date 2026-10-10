'use strict';
/* =====================================================================
 * csv-parser.js - 标准 CSV 解析与列名规范化（命名空间 CsvParser）
 * 对外暴露 parseCSV / buildColumns / detectUnevenRows / looksLikeTsv /
 * decideKeepHeader / parseToTableData，均为公共 API。
 * 说明：CSV → TableData 的**完整纯逻辑**都收在这里（含表头判定与行补齐），
 * 适配器与 Worker 都只调用 parseToTableData，避免两处实现各自漂移。
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

  /**
   * 行数差异检测：返回 { hasUneven, minCols, maxCols }。
   * 注意必须在「原始行」上调用——补齐后的行长度恒等于列数，检测不出差异。
   */
  function detectUnevenRows(rows) {
    if (!rows.length) return { hasUneven: false, minCols: 0, maxCols: 0 };
    const maxCols = Math.max(...rows.map(r => r.length));
    const minCols = Math.min(...rows.map(r => r.length));
    return { hasUneven: minCols < maxCols, minCols, maxCols };
  }

  /* 列名规范化：去重（同名加 _2/_3…）、空表头自动命名 列N */
  function buildColumns(grid, keepHeader) {
    if (keepHeader && grid.length) {
      // 取最长行作为列数标准，避免列数不一致时表头行比数据行短导致丢列
      const maxLen = Math.max(...grid.map(r => r.length));
      const used = new Set();
      return Array.from({ length: maxLen }, (_, i) => {
        // 注意用 ?? 而非 !== undefined：null 表头也要退化为「列N」，不能变成 "null"
        const raw = grid[0] ? grid[0][i] : undefined;
        let baseName = String(raw ?? '').trim() || ('列' + (i + 1));
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

  /* 判定本次是否把首行当表头：
   * - opts.header === false：用户强制关闭
   * - opts.header === true： 用户强制开启
   * - 其余（含 'auto'、undefined）：智能判定，首行数字占比 > 50% 视为数据行而非表头 */
  function decideKeepHeader(grid, opts) {
    const o = opts || {};
    if (o.header === false) return false;
    if (o.header === true) return true;
    const first = grid[0];
    if (!first) return true;
    const cells = first.filter(c => String(c).trim() !== '');
    const numCount = cells.filter(c => /^-?\d[\d,.\s]*%?$/.test(String(c).trim())).length;
    return !(cells.length && numCount / cells.length > 0.5);
  }

  /**
   * 粗判输入是否更像 TSV（一行内有 ≥2 个制表符）而非逗号分隔 CSV。
   * 仅用于给用户一句提示，不改变解析行为。
   */
  function looksLikeTsv(text) {
    return /^(?:[^\r\n]*\t){2,}/m.test(String(text ?? ''));
  }

  /**
   * CSV → TableData 的唯一入口（纯函数，可在主线程或 Worker 中调用）。
   * 返回 { source, columns, rows, _headerUsed, _uneven, _tsvSuspect }：
   *   - _headerUsed：本次实际生效的表头判定值，供调用方同步开关（所见即所得）
   *   - _uneven：**在补齐前**的原始数据行上统计的列数差异，用于「静默丢列」告警
   *   - _tsvSuspect：输入疑似 TSV，调用方据此提示用户可能选错了格式
   */
  function parseToTableData(input, opts) {
    const tsvSuspect = looksLikeTsv(input);
    const grid = parseCSV(input);
    if (!grid.length) {
      return { source: 'csv', columns: [], rows: [], _headerUsed: true, _tsvSuspect: tsvSuspect,
               _uneven: { hasUneven: false, minCols: 0, maxCols: 0 } };
    }
    const keepHeader = decideKeepHeader(grid, opts);
    const columns = buildColumns(grid, keepHeader);
    const rawRows = keepHeader ? grid.slice(1) : grid;
    // 差异检测必须在补齐/过滤之前做，否则恒为「无差异」
    const uneven = detectUnevenRows(rawRows.filter(r => r.some(c => String(c).trim() !== '')));
    const rows = rawRows
      .filter(r => r.some(c => String(c).trim() !== ''))
      .map(r => columns.map((_, i) => r[i] ?? ''));
    return { source: 'csv', columns, rows, _headerUsed: keepHeader, _uneven: uneven, _tsvSuspect: tsvSuspect };
  }

  return { parseCSV, buildColumns, detectUnevenRows, looksLikeTsv, decideKeepHeader, parseToTableData };
})();