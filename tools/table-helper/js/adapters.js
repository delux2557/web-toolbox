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

  class CsvAdapter extends BaseAdapter {
    /* 逻辑全部下沉到 CsvParser.parseToTableData（纯函数，Worker 复用同一份），
     * 这里只做转发，避免「主线程一份、Worker 一份」两处实现各自漂移。 */
    parse(input, opts) {
      return CsvParser.parseToTableData(input, opts);
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