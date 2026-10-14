'use strict';
/* =====================================================================
 * headers.js - 表头识别 / 清洗 / 校验 / 修复（命名空间 E2sHeaders）
 * 与 Python 版 src/excel2sql/headers.py 一一对应（含 0.4.2 的列名清洗）。
 *
 * 这里是全工具最容易"静默出错"的地方（历史上两个 P0 都出在这）：
 *   - 表头行选错 -> 静默丢一行数据；
 *   - 列名带换行 -> 产物头注释被劈成两行、后半行被当语句执行 -> 产物 syntax error；
 *   - 列名是零宽字符 -> 产物里出现"看不见的列名"，且 col_N 补名不触发。
 * 所以下面的阈值保护与清洗规则务必保留。
 *
 * 两个阈值保护：
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

  /* 「不可见但不属于空白」的字符：`trim()` 去不掉、肉眼也看不见。
     留着有两个后果（对齐 Python 版 0.4.2 的实测结论）：
       1. 列名变成"看不见的名字"，产物里是 `[]`，谁也不知道那列叫什么；
       2. isBlank() 认不出它（下面这几个码位不是空白），于是 `col_N` 补名不触发
          —— 一个"看着没名字"的列表头其实被当成了正常列名。
     这类字符在任何语言里都不是列名该有的内容，直接删除。
     ★ 与 Python 版 headers._INVISIBLE 逐字符对应。 */
  const INVISIBLE_RE = /[\u00ad\u200b\u200c\u200d\u2060\u200e\u200f\u202a-\u202e\u3164\ufeff]/g;
  /* C0/C1 里**不是空白**的那些（NUL、BEL、DEL…）同样删掉；
     是空白的（\t\n\v\f\r、0x1c-0x1f、NEL）留给下面的空白折叠 —— 它们表示"这里原本有分隔"。
     ★ 变体选择符 U+FE0E/U+FE0F 与 emoji 序列不在此列：它们修饰前一个字符的呈现方式，
       属于**有意的内容**，删掉会把 🗃️ 变成单色字形。 */
  const CONTROL_RE = /[\u0000-\u0008\u000e-\u001b\u007f-\u0084\u0086-\u009f]/g;
  /* Python `str.isspace()` 认的全部空白字符。
     ★ 不能直接用 JS 的 `\s`：两者**不一致** ——
       · JS `\s` 多含 U+FEFF（BOM），Python 的 isspace() 不含；
       · JS `\s` **少**含 U+001C-U+001F 与 U+0085（NEL），Python 认它们。
     这里显式列全，保证与 Python 版逐字符一致。 */
  const PY_WS_RE = /[\t\n\v\f\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

  /* 把列名里的不可见噪声归一：删掉零宽/控制字符，再把任意空白折叠成单个空格。
     与 Python 版 headers.clean_name() 一一对应。

     ★ 顺序很重要：**先删字符，再折叠空白**。
       JS 的 `\s` 把 BOM 也算空白，若反过来做，`'x\ufeffy'` 会变成 `'x y'`，
       而 Python 版（BOM 不是空白 → 被删除）给的是 `'xy'`。实测这条差异真实存在。

     只用于**表头/列名**。数据格里的换行是合法的多行文本，必须原样保留
     （由 `CHAR(10)` 拼接机制支持），绝不能走到这里来。 */
  function cleanName(v) {
    if (v == null) return '';
    const s = String(v).replace(INVISIBLE_RE, '').replace(CONTROL_RE, '');
    /* 等价于 Python 的 `' '.join(s.split())`：任意空白 -> 单空格，顺带去掉首尾 */
    return s.split(PY_WS_RE).filter(Boolean).join(' ');
  }

  /* ★★ 提示里要"转义显示"的字符 = **用户看不见的那些**：
     控制字符 + 所有非 ASCII 的空白/格式字符（NBSP、全角空格、零宽、方向标记、BOM、谚文填充符…）。

     为什么必须转义 NBSP / 全角空格（2026-10-14 **真机实测**发现，DOM 桩测不出来）：
     它们渲染出来与普通空格**完全一样**，不转义的话提示会显示成
         `[第5列] '数量 (件)' → '数量 (件)'`
     —— 看着像"根本没改"，清洗提示也就失去了意义（用户会以为工具在说废话）。
     命令行版用的是 Python 的 `repr()`，它按 `isprintable()` 判定、同样会转义这些
     （`repr('\xa0')` → `'\xa0'`），所以两边行为一致。

     ★ 普通空格（ASCII 0x20）**不转义**：它是可打印的，转义反而让提示变吵。
     ★ 比命令行版**多转义一个 U+3164**（谚文填充符）：Python 的 `isprintable()` 认它可打印，
       于是命令行版把它原样打出来（肉眼看不见）。这里转义，属**有意的改进**，已记入文档。 */
  const QUOTE_ESCAPE_RE =
    /[\u0000-\u001f\u007f-\u009f\u00a0\u00ad\u1680\u2000-\u200f\u2028-\u202e\u202f\u205f\u2060\u3000\u3164\ufeff]/g;
  /* 与 Python repr 的短转义对齐：\n\t\r 用短写，<0x100 用 \xNN，否则 \uNNNN */
  const QUOTE_SHORT = { '\n': '\\n', '\t': '\\t', '\r': '\\r' };

  /* 把一个值渲染成"看得见"的形式，用于给用户提示（等价于 Python 的 repr/_ 的 {!r}）。
     ★ 引号选择也照 Python 的规则：默认单引号；内容含单引号且不含双引号时改用双引号；
       两者都有则用单引号并把内部单引号转义 —— 否则 `O'Brien` 会渲染成 `'O'Brien'`，
       引号不配对、读起来有歧义。 */
  function quoteName(v) {
    if (v == null) return String(v);
    var s = String(v).replace(/\\/g, '\\\\').replace(QUOTE_ESCAPE_RE, function (c) {
      if (QUOTE_SHORT[c]) return QUOTE_SHORT[c];
      var code = c.charCodeAt(0);
      var hex = code.toString(16);
      return code < 0x100 ? '\\x' + ('0' + hex).slice(-2)
                          : '\\u' + ('000' + hex).slice(-4);
    });
    var hasSingle = s.indexOf("'") >= 0;
    var hasDouble = s.indexOf('"') >= 0;
    if (hasSingle && !hasDouble) return '"' + s + '"';
    if (hasSingle) s = s.replace(/'/g, "\\'");
    return "'" + s + "'";
  }

  /* 逐列比出「原始文本 vs 清洗结果」的差异（结构化，供界面取条数 / 格式化）。
     ★ 比较的是原始文本与清洗结果，不能两边都洗一遍再比（那样恒相等）。 */
  function nameDiffs(raw, cleaned) {
    const out = [];
    const n = Math.min(raw.length, cleaned.length);
    for (let i = 0; i < n; i++) {
      const original = raw[i] == null ? '' : String(raw[i]);
      if (original === String(cleaned[i])) continue;
      out.push({ index: i, from: raw[i], to: cleaned[i] });
    }
    return out;
  }

  /* 把差异渲染成给用户看的一行行文案，形如 `[第2列] '订\n单' → '订 单'`。
     ★ 清洗必须"看得见"：静默修正和静默走偏只差一步 —— 用户有权知道自己的表头被改过。 */
  function formatNameDiffs(diffs, limit) {
    const cap = limit == null ? 5 : limit;
    const items = diffs.slice(0, cap).map(function (d) {
      return '[第' + (d.index + 1) + '列] ' + quoteName(d.from) + ' → ' + quoteName(d.to);
    });
    if (diffs.length > cap) items.push('…（另有 ' + (diffs.length - cap) + ' 处）');
    return items;
  }

  /* 便捷组合：直接给出可展示的差异清单（对齐 Python 版 headers.changed_names） */
  function changedNames(raw, cleaned, limit) {
    return formatNameDiffs(nameDiffs(raw, cleaned), limit);
  }

  function isBlank(cell) {
    /* ★ 用 cleanName() 判空而不是 trim()：零宽字符、BOM 这类"看不见"的内容
       在 trim() 眼里是非空的，于是它们会被当成**有名字的列**，
       既得不到 col_N 补名，也不会被当成空列报出来（对齐 Python 版 0.4.2）。 */
    return cell == null || (cell.t === 'str' && cleanName(cell.v) === '');
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
      let base = cleanName(raw);
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
      if (h == null || cleanName(h) === '') holes.push(i);
    });
    if (holes.length) {
      issues.push('表头第 ' + holes.slice(0, 8).map(function (i) { return i + 1; }).join(',') +
                  ' 列为空（共 ' + holes.length + ' 处，已自动命名 col_N）');
    }

    const seen = {}, dup = [];
    names.forEach(function (h, i) {
      const k = cleanName(h).toLowerCase();
      /* 空列名已由上面的"列为空"报出，别在这里复述 ——
         否则会输出 `列名重复：`（后面空着）或把 null 当列名列出来（对齐 Python 版 0.4.2） */
      if (!k) return;
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
    cleanName: cleanName,
    /* 导出只为让自检能直测"提示里怎么显示" —— 它等价于 Python 的 repr()，
       是跨语言比对里**最容易漏掉的一半**（只比 cleanName 会漏掉这个，2026-10-14 踩过） */
    quoteName: quoteName,
    nameDiffs: nameDiffs,
    formatNameDiffs: formatNameDiffs,
    changedNames: changedNames,
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
