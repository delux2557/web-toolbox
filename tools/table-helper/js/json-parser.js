'use strict';
/* =====================================================================
 * json-parser.js - JSON 表格解析（命名空间 JsonParser）
 * 支持四种输入形态（自动识别）：
 *   1. 对象数组 [{...}]   → 每行一条，列名取全部 key 并集（按首次出现顺序）
 *   2. 二维数组 [[...]]   → 复用 CsvParser.buildColumns（含去重、空表头自动命名）
 *   3. 单个对象 {...}     → 自动包成一行（键名即列名）
 *   4. 其他 JSON 值       → 给出清晰报错判别（非法 JSON / 合法但非表格）
 * 嵌套对象 / 数组单元格统一序列化为紧凑字符串，保证行列对齐。
 * 错误通过抛出 Error（message 为中文用户提示）向上传递，由调用方 toast。
 * 对外暴露 parseToTableData / detect / serializeCell，为公共 API。
 * ================================================================== */
const JsonParser = (function () {
  const { buildColumns } = CsvParser;

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /* 单元格规整：字符串原样；布尔/数字转字符串；对象/数组 JSON 序列化；null/undefined 置空 */
  function serializeCell(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  /* ---- 解析与形态识别 ---- */
  function tryParse(input) {
    const text = String(input ?? '').trim();
    if (!text) return { ok: false, error: '请输入 JSON 内容' };
    let value;
    try {
      value = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'JSON 格式不正确：' + e.message };
    }
    return { ok: true, value };
  }

  function detect(value) {
    if (isPlainObject(value)) return { kind: 'object', value };                    // 单个对象
    if (Array.isArray(value)) {
      if (!value.length) return { kind: 'empty', value };                          // 空数组
      const allObj = value.every(isPlainObject);
      const allArr = value.every(Array.isArray);
      if (allObj) return { kind: 'objects', value };                               // 对象数组
      if (allArr) return { kind: 'matrix', value };                                // 二维数组
      return { kind: 'mixed', value };                                             // 混合类型
    }
    return { kind: 'scalar', value };                                               // 单个基础值
  }

  /* ---- 主入口：返回 TableData = { source, columns, rows } ---- */
  function parseToTableData(input) {
    const parsed = tryParse(input);
    if (!parsed.ok) throw new Error(parsed.error);
    const shape = detect(parsed.value);

    if (shape.kind === 'empty') throw new Error('JSON 数组为空，没有可解析的数据');
    if (shape.kind === 'scalar') throw new Error('JSON 是单个值，不是表格数据');
    if (shape.kind === 'mixed') throw new Error('JSON 数组元素类型不一致，请使用统一的对象数组或二维数组');

    // 单个对象 → 包成一行
    if (shape.kind === 'object') {
      const columns = Object.keys(shape.value);
      const rows = [columns.map(c => serializeCell(shape.value[c]))];
      return { source: 'json', columns, rows };
    }

    // 二维数组 → 首行为表头
    if (shape.kind === 'matrix') {
      const grid = shape.value.map(r => r.map(serializeCell));
      const columns = buildColumns(grid, true);
      const rows = grid.slice(1)
        .filter(r => r.some(c => String(c).trim() !== ''))
        .map(r => columns.map((_, i) => r[i] ?? ''));
      return { source: 'json', columns, rows };
    }

    // 对象数组 → key 并集作为列名，按首次出现顺序，缺失补空
    const columns = [];
    const seen = new Set();
    shape.value.forEach(obj => {
      Object.keys(obj).forEach(k => {
        if (!seen.has(k)) { seen.add(k); columns.push(k); }
      });
    });
    if (!columns.length) throw new Error('JSON 对象缺少字段，无法确定列名');
    const rows = shape.value.map(obj => columns.map(c => serializeCell(obj[c])));
    return { source: 'json', columns, rows };
  }

  return { parseToTableData, detect, serializeCell };
})();