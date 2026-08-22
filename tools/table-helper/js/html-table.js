'use strict';
/* =====================================================================
 * html-table.js - HTML 表格提取与展示元信息（命名空间 HtmlTable）
 * 对外暴露 SKIP_KEYWORDS、isHiddenEl、isSkipCell、cellText、rowCells、
 * extractTableData、tableMeta，均为公共 API。
 * extractTableData 已拆分为若干单一职责的子函数，逻辑与原先完全等价。
 * ================================================================== */
const HtmlTable = (function () {
  const SKIP_KEYWORDS = ['checkbox', 'selection', 'operation', 'action'];

  function isHiddenEl(el) {
    if (!el || !el.getAttribute) return false;
    if (el.hasAttribute('hidden')) return true;
    const s = (el.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
    return s.includes('display:none') || s.includes('visibility:hidden');
  }

  function isSkipCell(el) {
    if (!el) return false;
    if (isHiddenEl(el)) return true;
    const cls = (el.getAttribute('class') || '').toLowerCase();
    return SKIP_KEYWORDS.some(k => cls.includes(k));
  }

  function cellText(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

  function rowCells(tr) { return Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH'); }

  /* 定位表头行与数据行：优先取 <thead>；否则按 <th>、data-field、是否纯数字启发式判断 */
  function locateHeaderRows(table, thead, allRows) {
    let headerRow = null;
    let bodyRows = [];
    let useDataFieldAsColumns = false;

    if (thead && thead.querySelector('tr')) {
      headerRow = thead.querySelector('tr');
      bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      if (!bodyRows.length) bodyRows = allRows.filter(tr => !thead.contains(tr));
    } else {
      const first = allRows[0];
      if (first && first.querySelector('th')) {
        headerRow = first;
        bodyRows = allRows.slice(1);
      } else if (first) {
        const cells = rowCells(first);
        const hasFields = cells.some(c => (c.getAttribute('data-field') || '').trim() !== '');
        const hasNumeric = cells.some(c => /^\d+$/.test(cellText(c).trim()));
        if (hasFields) {
          useDataFieldAsColumns = true;
          headerRow = null;
          bodyRows = allRows;
        } else if (!hasNumeric) {
          headerRow = first;
          bodyRows = allRows.slice(1);
        } else {
          headerRow = null;
          bodyRows = allRows;
        }
      } else {
        bodyRows = [];
      }
    }
    return { headerRow, bodyRows, useDataFieldAsColumns };
  }

  /* 过滤隐藏行与全空行——仅保留有实际内容的可见数据行 */
  function filterVisibleRows(bodyRows) {
    return bodyRows.filter(tr => {
      if (isHiddenEl(tr)) return false;
      const cells = rowCells(tr);
      return cells.length && cells.some(c => cellText(c) !== '');
    });
  }

  /* 以 data-field 驱动列构建：以首行为样本，跳过功能列，列名取自 data-field */
  function buildColumnsFromDataField(bodyRows) {
    const sampleRow = bodyRows[0];
    const cells = rowCells(sampleRow);
    const skip = new Set();
    cells.forEach((cell, i) => { if (isSkipCell(cell)) skip.add(i); });
    const keepIdx = Array.from({ length: cells.length }, (_, i) => i).filter(i => !skip.has(i));
    const columns = keepIdx.map(i => {
      const field = cells[i].getAttribute('data-field') || '';
      return field.trim() || ('列' + (i + 1));
    });
    const rows = bodyRows.map(tr => {
      const tds = rowCells(tr);
      return keepIdx.map(i => (tds[i] ? cellText(tds[i]) : ''));
    });
    return { columns, rows };
  }

  /* 计算保留的列下标：表头或首行数据中任意标记为「功能/隐藏」列均被跳过 */
  function computeKeepIndices(headerCells, firstBodyCells, count) {
    const skip = new Set();
    for (let i = 0; i < count; i++) {
      if (isSkipCell(headerCells[i]) || isSkipCell(firstBodyCells[i])) skip.add(i);
    }
    return Array.from({ length: count }, (_, i) => i).filter(i => !skip.has(i));
  }

  function extractTableData(table) {
    const allRows = Array.from(table.querySelectorAll('tr'));
    const thead = table.querySelector('thead');

    const { headerRow, bodyRows: rawBody, useDataFieldAsColumns } = locateHeaderRows(table, thead, allRows);
    const bodyRows = filterVisibleRows(rawBody);

    // 有 data-field 时仅凭数据行即可推导列，无需依赖表头
    if (useDataFieldAsColumns && bodyRows.length > 0) {
      const { columns, rows } = buildColumnsFromDataField(bodyRows);
      return { source: 'html', columns, rows };
    }

    const headerCells = headerRow ? rowCells(headerRow) : [];
    const rawColCount = headerRow ? headerCells.length
      : (bodyRows.length ? rowCells(bodyRows[0]).length : 0);

    const firstBodyCells = bodyRows.length ? rowCells(bodyRows[0]) : [];
    const keepIdx = computeKeepIndices(headerCells, firstBodyCells, rawColCount);

    const columns = headerRow
      ? keepIdx.map((i, n) => {
          const c = headerCells[i];
          const field = c ? (c.getAttribute('data-field') || '').trim() : '';
          return field || cellText(c) || ('列' + (n + 1));
        })
      : keepIdx.map((_, n) => '列' + (n + 1));

    const rows = bodyRows.map(tr => {
      const cells = rowCells(tr);
      return keepIdx.map(i => (cells[i] ? cellText(cells[i]) : ''));
    });

    return { source: 'html', columns, rows };
  }

  /* 表格元信息标签：行×列统计，超长 class 截断展示 */
  function tableMeta(t, i) {
    const trs = Array.from(t.querySelectorAll('tr'));
    const cols = Math.max(...trs.slice(0, 3).map(tr => tr.children.length));
    const cls = (t.getAttribute('class') || '').trim();
    let label = '表格' + (i + 1) + ' · ' + trs.length + '行×' + cols + '列';
    if (cls) label += ' · class="' + (cls.length > 24 ? cls.slice(0, 24) + '…' : cls) + '"';
    return label;
  }

  return {
    SKIP_KEYWORDS,
    isHiddenEl,
    isSkipCell,
    cellText,
    rowCells,
    extractTableData,
    tableMeta
  };
})();