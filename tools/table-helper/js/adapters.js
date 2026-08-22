'use strict';
/* =====================================================================
 * adapters.js - 输入适配器（命名空间 Adapters）
 * 统一数据模型 TableData = { source, columns, rows }
 * 新增数据源只需实现一个 Adapter（parse 返回 TableData）并注册。
 * 对外暴露 BaseAdapter / CsvAdapter / JsonAdapter / HtmlTableAdapter /
 * adapters / PREVIEW_LIMIT，均为公共 API。
 * ================================================================== */
const Adapters = (function () {
  class BaseAdapter {
    parse() { throw new Error('Adapter.parse 未实现'); }
  }

  /* 判定本次是否把首行当表头：
   * - opts.header === false：用户强制关闭
   * - opts.header === true： 用户强制开启
   * - 其余（含 'auto'、undefined）：智能判定，首行数字占比 > 50% 视为数据行而非表头 */
  function decideKeepHeader(grid, opts) {
    const o = opts || {};
    let keepHeader = true;
    if (o.header === false) keepHeader = false;
    else if (o.header !== true) {
      const first = grid[0];
      if (first) {
        const cells = first.filter(c => String(c).trim() !== '');
        const numCount = cells.filter(c => /^-?\d[\d,.\s]*%?$/.test(String(c).trim())).length;
        if (cells.length && numCount / cells.length > 0.5) keepHeader = false;
      }
    }
    return keepHeader;
  }

  class CsvAdapter extends BaseAdapter {
    parse(input, opts) {
      const grid = CsvParser.parseCSV(input);
      if (!grid.length) return { source: 'csv', columns: [], rows: [] };

      const keepHeader = decideKeepHeader(grid, opts);
      const columns = CsvParser.buildColumns(grid, keepHeader);
      let rows = keepHeader ? grid.slice(1) : grid;
      // 过滤全空行；每行按列数补齐（不足补空串），保证行列对齐
      rows = rows
        .filter(r => r.some(c => String(c).trim() !== ''))
        .map(r => columns.map((_, i) => r[i] ?? ''));
      // _headerUsed：本次实际生效的表头判定值，供调用方同步开关/UI（所见即所得）
      return { source: 'csv', columns, rows, _headerUsed: keepHeader };
    }
  }

  class JsonAdapter extends BaseAdapter {
    /* 粘贴 JSON → 表格：四态自动识别（对象数组 / 二维数组 / 单个对象 / 兜底报错）。
     * 嵌套对象 / 数组单元格序列化为紧凑字符串（见 JsonParser.serializeCell）。 */
    parse(input, opts) {
      return JsonParser.parseToTableData(input, opts);
    }
  }

  /* ---------- HTML 表格提取（沿用 v2 逻辑） ---------- */
  /* 预览行数上限：超出则提示「仅预览前 N 行」，导出仍包含全部 */
  const PREVIEW_LIMIT = 200;

  class HtmlTableAdapter extends BaseAdapter {
    /** 安全解析：DOMParser 独立文档，脚本不执行、资源不加载 */
    load(input) {
      const doc = new DOMParser().parseFromString(input, 'text/html');
      return Array.from(doc.querySelectorAll('table')).filter(t => t.querySelector('tr'));
    }
    extract(tableEl) { return HtmlTable.extractTableData(tableEl); }
    parse(input) {
      const tables = this.load(input);
      if (!tables.length) return { source: 'html', columns: [], rows: [] };
      return HtmlTable.extractTableData(tables[0]);
    }
  }

  const adapters = {
    csv: new CsvAdapter(),
    json: new JsonAdapter()
  };
  adapters.html = new HtmlTableAdapter();

  return { BaseAdapter, CsvAdapter, JsonAdapter, HtmlTableAdapter, adapters, PREVIEW_LIMIT };
})();