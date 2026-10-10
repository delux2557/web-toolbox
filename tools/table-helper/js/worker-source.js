'use strict';
/* =====================================================================
 * worker-source.js - Worker 源码工厂（命名空间 WorkerSource）
 *
 * 为什么不是独立的 worker.js 文件？
 *   本仓库的交付物是「单个自包含 HTML」（tools/_build/build-single.mjs
 *   会把所有 <script src> 内联进 dist/index.html）。独立 worker.js 文件
 *   在 dist 里不会存在，`new Worker('js/worker.js')` 会 404。
 *   因此这里在**运行时**把主线程已有的解析函数用 Function.prototype.toString()
 *   序列化成字符串，包成 Blob 再交给 Worker —— 既保住「单文件」形态，
 *   又保证 Worker 与主线程**用的是同一份解析代码**（不存在两处实现漂移）。
 *
 * 对外暴露 build()：返回可直接喂给 new Blob([...]) 的 Worker 脚本源码。
 * 依赖（加载顺序）：csv-parser.js → json-parser.js → 本文件
 * ================================================================== */
const WorkerSource = (function () {

  /* 把函数对象转成可独立求值的源码文本 */
  function fnSource(fn) { return fn.toString(); }

  /**
   * 生成 Worker 脚本源码。
   * 顺序即作用域依赖序：被引用的自由变量必须先声明。
   * 注意 JsonParser.parseToTableData 内部依赖 buildColumns / tryParse / detect /
   * serializeCell，CsvParser.parseToTableData 依赖 parseCSV / decideKeepHeader /
   * buildColumns / detectUnevenRows —— 都在下方按序补齐。
   */
  function build() {
    return [
      '"use strict";',
      '/* 运行时由 worker-source.js 从主线程解析器序列化生成（无独立文件）。 */',
      '/* ---- CsvParser 纯函数 ---- */',
      'const parseCSV = ' + fnSource(CsvParser.parseCSV) + ';',
      'const buildColumns = ' + fnSource(CsvParser.buildColumns) + ';',
      'const detectUnevenRows = ' + fnSource(CsvParser.detectUnevenRows) + ';',
      'const looksLikeTsv = ' + fnSource(CsvParser.looksLikeTsv) + ';',
      'const decideKeepHeader = ' + fnSource(CsvParser.decideKeepHeader) + ';',
      'const buildCsvTableData = ' + fnSource(CsvParser.parseToTableData) + ';',
      '/* ---- JsonParser 纯函数 ---- */',
      'const isPlainObject = ' + fnSource(JsonParser.isPlainObject) + ';',
      'const serializeCell = ' + fnSource(JsonParser.serializeCell) + ';',
      'const tryParse = ' + fnSource(JsonParser.tryParse) + ';',
      'const detect = ' + fnSource(JsonParser.detect) + ';',
      'const buildJsonTableData = ' + fnSource(JsonParser.parseToTableData) + ';',
      '/* ---- 消息处理 ---- */',
      'self.onmessage = function (e) {',
      '  const msg = e.data;',
      '  if (!msg || msg.type !== "parse") return;',
      '  try {',
      '    const data = msg.mode === "csv"',
      '      ? buildCsvTableData(msg.input, msg.opts || {})',
      '      : buildJsonTableData(msg.input);',
      '    self.postMessage({ type: "result", data: data });',
      '  } catch (err) {',
      '    self.postMessage({ type: "error", message: (err && err.message) || "解析失败" });',
      '  }',
      '};',
      ''
    ].join('\n');
  }

  return { build };
})();
