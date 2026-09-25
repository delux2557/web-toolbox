'use strict';
/* =====================================================================
 * headers.js - 表头识别 / 校验 / 修复（命名空间 E2sHeaders）
 * 与 Python 版 src/excel2sql/headers.py 一一对应。
 *
 * 这里是全工具最容易"静默出错"的地方（历史上两个 P0 都出在这），
 * 两个阈值保护务必保留：
 *   1. 候选行与第 1 行分差 < AMBIGUOUS_MARGIN 时，保守选第 1 行；
 *   2. 被跳过的行只要"不止一个非空格"就不跳（标题行总是稀疏的）。
 * 两条都是"宁可保守，也不静默丢一行数据"。
 *
 * 入参 cell 统一为 { t, v }（见 reader.js），null 表示空单元格。
 * ================================================================== */
const E2sHeaders = (function () {
  /* 表头行里"看起来像数据"的判断上限 */
  const LIKE_DATA_RATIO = 1.0;
  /* 自动识别表头时，低于这个分数就认为没有明显表头 */
  const MIN_SCORE = 1.5;
  /* 分差小于此值时保守选第 1 行 */
  const AMBIGUOUS_MARGIN = 0.3;
  /* 允许被跳过的行"有多空"：非空单元格个数超过它就不跳 */
  const SKIPPED_MAX_CELLS = 1;

  function isBlank(cell) {
    return cell == null || (cell.t === 'str' && String(cell.v).trim() === '');
  }

  function cellText(cell) {
    return cell == null ? '' : String(cell.v);
  }

  const NUMBER_RE = /^-?\d+(\.\d+)?$/;
  const DATE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/;

  /* 单元格内容是否像"数据"而不是"字段名" */
  function looksLikeValue(cell) {
    if (cell == null) return false;
    if (cell.t === 'bool') return false;        // 布尔列（Y/N）不该被判成数据行
    if (cell.t === 'num' || cell.t === 'bignum' ||
        cell.t === 'date' || cell.t === 'datetime') return true;
    const s = cellText(cell).trim();
    return NUMBER_RE.test(s) || DATE_RE.test(s);
  }

  function nonblankCount(row) {
    return row.filter(function (c) { return !isBlank(c); }).length;
  }

  /* 给"这一行像不像表头"打分：越高越像 */
  function scoreHeaderRow(row, nextRow) {
    const cells = row.filter(function (c) { return !isBlank(c); });
    if (!cells.length) return -10;

    const filled = cells.length / Math.max(1, row.length);
    const valueLike = cells.filter(looksLikeValue).length / cells.length;
    const textLike = 1 - valueLike;
    const uniq = new Set(cells.map(function (c) {
      return cellText(c).trim().toLowerCase();
    })).size / cells.length;
    const short = cells.filter(function (c) {
      return c.t === 'str' && c.v.length > 0 && c.v.length <= 40;
    }).length / cells.length;

    const below = nextRow ? nextRow.filter(function (c) { return !isBlank(c); }) : [];
    const nextIsData = below.length
      ? below.filter(looksLikeValue).length / below.length
      : 0;

    return 2 * textLike + 1 * uniq + 0.5 * short + 1.5 * nextIsData + 0.5 * filled - 2 * valueLike;
  }

  /* 自动识别表头行，返回 { row: 1 基行号, why: 说明 } */
  function detect(rows, maxScan) {
    const scan = maxScan || 15;
    if (!rows.length) return { row: 1, why: '工作表为空' };

    const limit = Math.min(rows.length, Math.max(1, scan));
    const scores = [];
    let best = 1, bestScore = null;
    for (let i = 0; i < limit; i++) {
      const s = scoreHeaderRow(rows[i], i + 1 < rows.length ? rows[i + 1] : []) - 0.05 * i;
      scores.push(s);
      if (bestScore === null || s > bestScore) { best = i + 1; bestScore = s; }
    }

    if (bestScore === null || bestScore < MIN_SCORE) {
      return { row: 1, why: '前 ' + limit + ' 行都更像数据，默认第 1 行' };
    }

    if (best > 1) {
      const margin = bestScore - scores[0];
      const dense = [];
      for (let i = 1; i < best; i++) {
        if (nonblankCount(rows[i - 1]) > SKIPPED_MAX_CELLS) dense.push(i);
      }
      if (margin < AMBIGUOUS_MARGIN || dense.length) {
        const why = margin < AMBIGUOUS_MARGIN
          ? '第 ' + best + ' 行只高 ' + margin.toFixed(2) + ' 分，证据不足'
          : '第 ' + dense.slice(0, 5).join('、') + ' 行填得较满，不像标题/说明行';
        return {
          row: 1,
          why: '第 1 行最像表头（' + why + '，保守取第 1 行；' +
               '若表头确实在第 ' + best + ' 行，点那一行即可更正）'
        };
      }
      return { row: best, why: '跳过前 ' + (best - 1) + ' 行，第 ' + best + ' 行最像表头' };
    }

    return { row: 1, why: '第 1 行最像表头（文本列名 + 下方是数据）' };
  }

  /* 生成全局唯一、非空的列名：空列 -> col_N；重名 -> 名字_2、名字_3… */
  function repair(names) {
    const out = [], seen = {};
    names.forEach(function (raw, i) {
      let base = raw == null ? '' : String(raw).trim();
      if (!base) base = 'col_' + (i + 1);
      let name = base, n = 1;
      while (seen[name.toLowerCase()]) { n += 1; name = base + '_' + n; }
      seen[name.toLowerCase()] = true;
      out.push(name);
    });
    return out;
  }

  /* 校验表头，返回问题清单（不修改入参） */
  function check(names, dataRows) {
    const issues = [];
    if (!names.length) return { ok: false, issues: ['表头行为空或整行无内容'] };
    if (!dataRows || !dataRows.length) issues.push('表头下方没有任何数据行');

    const holes = [];
    names.forEach(function (h, i) {
      if (h == null || String(h).trim() === '') holes.push(i);
    });
    if (holes.length) {
      issues.push('表头第 ' + holes.slice(0, 8).map(function (i) { return i + 1; }).join(',') +
                  ' 列为空（共 ' + holes.length + ' 处，已自动命名 col_N）');
    }

    const seen = {}, dup = [];
    names.forEach(function (h, i) {
      const k = String(h).trim().toLowerCase();
      if (seen[k]) dup.push(i);
      seen[k] = true;
    });
    if (dup.length) {
      issues.push('列名重复：' + dup.slice(0, 8).map(function (i) { return names[i]; }).join(', ') +
                  '（已自动加 _2、_3 后缀）');
    }

    const likeValues = names.filter(function (n) {
      const s = String(n).trim();
      return NUMBER_RE.test(s) || DATE_RE.test(s);
    }).length;
    if (names.length && likeValues / names.length >= LIKE_DATA_RATIO) {
      issues.push('表头行全是数字/日期，不像字段名（表头可能不在这一行）');
    }

    return { ok: !issues.length, issues: issues };
  }

  return {
    isBlank: isBlank,
    cellText: cellText,
    looksLikeValue: looksLikeValue,
    scoreHeaderRow: scoreHeaderRow,
    detect: detect,
    repair: repair,
    check: check,
    MIN_SCORE: MIN_SCORE,
    AMBIGUOUS_MARGIN: AMBIGUOUS_MARGIN,
    SKIPPED_MAX_CELLS: SKIPPED_MAX_CELLS
  };
})();
