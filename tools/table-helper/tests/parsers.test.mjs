/* ============================================================
 * parsers.test.mjs — table-helper 的零依赖解析器测试
 * ------------------------------------------------------------
 * 跑法：node tools/table-helper/tests/parsers.test.mjs   （退出码 0 / 1）
 *
 * 设计取向与 tools/json-format/tests/format.test.mjs 一致：**测交付物本身**。
 * 这里把 js/ 下的解析器脚本按浏览器加载顺序拼成一个脚本、在 vm 沙箱里真跑一遍，
 * 再对暴露出的纯函数下断言。好处是「测试版 / 生产版」不存在两份代码可以漂移。
 *
 * 只覆盖可在 Node 里跑的纯逻辑（CSV / JSON / Worker 源码 / HTML 的纯工具函数）。
 * 依赖真实 DOM 的 HTML 表格提取（DOMParser + querySelectorAll）不在此处跑，
 * 由工具页顶部注释与 PR 说明中的浏览器手测覆盖。
 * ============================================================ */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const JS = join(ROOT, "js");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};
const section = t => console.log("\n" + t);

/* 去掉 JS 注释后再做「反模式」静态检查：
 * 文档里会正经地写出 new Worker('js/worker.js') 这个反例来解释「为什么不用它」，
 * 不剥注释就会把说明文字误判成真代码（这里踩过一次）。 */
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
/* 匹配「new Worker(字面量 .js 路径)」——这正是会破坏单文件产物的写法 */
const hasLiteralWorkerFile = s => /new\s+Worker\s*\(\s*['"][^'"]*\.js['"]/.test(s);

/* ============================================================
 * [0] 形态契约：Worker 必须是「运行时序列化」，不能是外链文件
 * ------------------------------------------------------------
 * 本工具的交付物是单个自包含 HTML（build-single.mjs 会把所有 <script src>
 * 内联进 dist/index.html）。若 app.js 里写死 new Worker('js/worker.js')，
 * dist 单文件里那个文件并不存在 → Worker 静默 404、大数据量回退到主线程。
 * 所以这里用静态断言把「Worker 走 Blob」这条契约钉死。
 * ============================================================ */
section("[0] 形态契约：Worker 必须由运行时序列化生成");
const appSrc = readFileSync(join(JS, "app.js"), "utf8");
const workerSrcJs = readFileSync(join(JS, "worker-source.js"), "utf8");
ok("app.js 不使用外链 Worker 脚本（new Worker('js/…')）",
   !hasLiteralWorkerFile(stripComments(appSrc)),
   "应改为 new Worker(blobUrl)");
ok("app.js 通过 URL.createObjectURL 构造 Worker",
   /URL\.createObjectURL/.test(appSrc) && /new\s+Worker\s*\(\s*(url|blobUrl)/.test(appSrc));
ok("worker-source.js 不含任何 DOM 依赖（Worker 里没有 document/DOMParser）",
   !/DOMParser|document\./.test(workerSrcJs));
ok("app.js 无残留的旧 Worker 句柄引用（parseWorker / terminate 已随重构清理）",
   !/\bparseWorker\b(?!Url)/.test(stripComments(appSrc)),
   "疑似残留旧变量 parseWorker —— 重构后应只用 parseWorkerUrl");

/* ============================================================
 * [1] 在 vm 沙箱里加载解析器（顺序与 index.html 一致）
 * ============================================================ */
section("[1] 从 js/ 加载解析器");
const LOAD = ["utils.js", "csv-parser.js", "json-parser.js", "html-table.js", "worker-source.js"];
const bundle = LOAD.map(f => `/* == ${f} == */\n` + readFileSync(join(JS, f), "utf8")).join("\n")
  + "\n;globalThis.__T = { CsvParser, JsonParser, HtmlTable, WorkerSource };\n";

const ctx = vm.createContext({ console });
vm.runInContext(bundle, ctx);
const { CsvParser, JsonParser, HtmlTable, WorkerSource } = ctx.__T;
ok("CsvParser / JsonParser / HtmlTable / WorkerSource 均已加载",
   !!(CsvParser && JsonParser && HtmlTable && WorkerSource));

/* ============================================================
 * [2] CSV 解析
 * ============================================================ */
section("[2] CSV 解析");
{
  const { parseCSV, buildColumns, detectUnevenRows, parseToTableData } = CsvParser;

  const r1 = parseCSV("a,b,c\n1,2,3\n4,5,6");
  ok("标准 CSV：3 行 × 3 列", r1.length === 3 && r1[0].length === 3,
     JSON.stringify(r1));

  ok("BOM 剥离：首列不含 \\uFEFF",
     parseCSV("\uFEFFx,y\n1,2")[0][0] === "x");

  const r3 = parseCSV('a,b\n"he,llo","wor""ld"\n"l1\nl2",end');
  ok("引号内逗号不分列", r3[1][0] === "he,llo", JSON.stringify(r3[1]));
  ok("双引号 \"\" 还原为字面引号", r3[1][1] === 'wor"ld');
  ok("引号内换行属同一字段", r3[2][0] === "l1\nl2");

  const crlf = parseCSV("a,b\r\n1,2\r\n3,4\r\n");
  ok("CRLF 行尾：3 行且无残留 \\r", crlf.length === 3 && crlf[0][0] === "a",
     JSON.stringify(crlf));
  ok("无尾随换行时不漏最后一行", parseCSV("a\n1").length === 2);
  ok("空输入 → 0 行", parseCSV("").length === 0);

  // 列名规范化
  const dup = buildColumns([["a", "a", "b"], ["1", "2", "3"]], true);
  ok("重复列名去重 → a, a_2, b", dup[0] === "a" && dup[1] === "a_2" && dup[2] === "b",
     JSON.stringify(dup));
  const empty = buildColumns([["", "", null], [1, 2, 3]], true);
  ok("空表头自动命名 → 列1, 列2, 列3",
     empty[0] === "列1" && empty[1] === "列2" && empty[2] === "列3", JSON.stringify(empty));

  // 列数不一致：补空、不能丢数据、要能检测出来
  const data = parseToTableData("a,b,c\n1,2,3\n4,5");
  ok("列数不一致：补齐到 3 列（不丢行）", data.rows.length === 2 && data.rows[1].length === 3,
     JSON.stringify(data.rows));
  ok("列数不一致：缺失位置补空串", data.rows[1][2] === "");
  ok("列数不一致：前两列数据保留（未串列）",
     data.rows[1][0] === "4" && data.rows[1][1] === "5", JSON.stringify(data.rows[1]));
  ok("_uneven.hasUneven 真检测到差异", data._uneven.hasUneven === true,
     JSON.stringify(data._uneven));

  // 表头智能判定
  const numericFirst = parseToTableData("2021,88\n2022,96");
  ok("首行全数字 → 判为非表头，列名 列1/列2",
     numericFirst.columns[0] === "列1" && numericFirst._headerUsed === false,
     JSON.stringify(numericFirst.columns) + " headerUsed=" + numericFirst._headerUsed);
  const textFirst = parseToTableData("月份,销售额\n1月,100");
  ok("首行文字 → 判为表头", textFirst.columns[0] === "月份" && textFirst._headerUsed === true);
  const forced = parseToTableData("2021,88\n2022,96", { header: true });
  ok("opts.header=true 强制当表头（覆盖智能判定）",
     forced._headerUsed === true && forced.columns[0] === "2021");
  const forcedOff = parseToTableData("月份,销售额\n1月,100", { header: false });
  ok("opts.header=false 强制首行当数据", forcedOff._headerUsed === false);

  // 空行过滤
  const blank = parseToTableData("a,b\n1,2\n\n\n3,4");
  ok("中间空行被过滤，仅 2 条数据行", blank.rows.length === 2, JSON.stringify(blank.rows));

  ok("detectUnevenRows 无差异时 hasUneven=false",
     detectUnevenRows([["a", "b"], ["1", "2"]]).hasUneven === false);

  // TSV 误判提示：以「≥2 个制表符」为判据，只提示不改解析行为
  ok("looksLikeTsv 认出制表符分隔",
     CsvParser.looksLikeTsv("a\tb\tc\n1\t2\t3") === true);
  ok("looksLikeTsv 对普通 CSV 不误报",
     CsvParser.looksLikeTsv("a,b,c\n1,2,3") === false);
  ok("parseToTableData 带出 _tsvSuspect 标志",
     parseToTableData("a\tb\tc\n1\t2\t3")._tsvSuspect === true &&
     parseToTableData("a,b,c\n1,2,3")._tsvSuspect === false);
}

/* ============================================================
 * [3] JSON 解析（四态识别 + 补齐 + 报错）
 * ============================================================ */
section("[3] JSON 解析");
{
  const { parseToTableData, serializeCell, isPlainObject } = JsonParser;
  const err = fn => { try { fn(); return null; } catch (e) { return e.message; } };

  const objs = parseToTableData('[{"name":"a","v":1},{"name":"b","v":2}]');
  ok("对象数组：2 列 × 2 行", objs.columns.length === 2 && objs.rows.length === 2);

  const union = parseToTableData('[{"a":1},{"b":2},{"a":3,"b":4}]');
  ok("字段并集为列，缺失补空（不丢行）",
     union.columns.length === 2 && union.rows[0][1] === "" && union.rows[1][0] === "",
     JSON.stringify(union.rows));

  const matrix = parseToTableData('[["h1","h2"],["a",1],["b",2]]');
  ok("二维数组：首行当表头", matrix.columns[0] === "h1" && matrix.rows[0][1] === "1");

  const ragged = parseToTableData('[["A","B","C"],[1,2],[3]]');
  ok("二维数组参差：补齐到 3 列且不丢行",
     ragged.rows.length === 2 && ragged.rows[0].length === 3 && ragged.rows[0][2] === "",
     JSON.stringify(ragged.rows));

  const single = parseToTableData('{"name":"t","v":42}');
  ok("单个对象 → 1 行 2 列", single.rows.length === 1 && single.columns.length === 2);

  ok("空数组 → 报错", (err(() => parseToTableData("[]")) || "").includes("空"));
  ok("标量 → 报错", (err(() => parseToTableData('"hi"')) || "").includes("单个值"));
  ok("混合数组 → 报错", (err(() => parseToTableData('[{"a":1},[1,2]]')) || "").includes("不一致"));
  ok("非法 JSON → 报错", (err(() => parseToTableData("{bad")) || "").includes("JSON"));

  const nested = parseToTableData('[{"o":"x","items":["a","b"],"addr":{"c":"HZ"}}]');
  ok("嵌套数组序列化", nested.rows[0][1] === '["a","b"]');
  ok("嵌套对象序列化", nested.rows[0][2] === '{"c":"HZ"}');

  ok("serializeCell(null/undefined) → 空串",
     serializeCell(null) === "" && serializeCell(undefined) === "");
  ok("serializeCell(false) → \"false\"（不当空值丢掉）", serializeCell(false) === "false");
  ok("serializeCell(0) → \"0\"", serializeCell(0) === "0");
  ok("isPlainObject([]) === false", isPlainObject([]) === false);
}

/* ============================================================
 * [4] Worker 一致性（关键：证明 Worker 与主线程是同一份逻辑）
 * ------------------------------------------------------------
 * 在 vm 沙箱里造一个假 self，跑 WorkerSource.build() 的产物，
 * 再把同一输入喂给主线程 parser，逐字段比对。
 * 任何一处「序列化漏了自由变量 / 两份实现漂移」都会在这里红。
 * ============================================================ */
section("[4] Worker 源码与主线程解析结果一致（防漂移）");
{
  const src = WorkerSource.build();
  ok("Worker 源码可独立求值（语法有效）", (() => {
    try { new vm.Script(src); return true; } catch (e) { return false; }
  })());
  ok("Worker 源码不含未序列化的 undefined 绑定",
     !/=\s*undefined\s*;/.test(src) && !/\bconst\s+\w+\s*=\s*;\s*$/.test(src));

  const runInWorker = (mode, input, opts) => {
    const out = [];
    const sandbox = { self: { postMessage: m => out.push(m) }, console };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    sandbox.self.onmessage({ data: { type: "parse", mode, input, opts: opts || {} } });
    return out[0];
  };

  const csvIn = "a,b,c\n1,2,3\n4,5";
  const wCsv = runInWorker("csv", csvIn);
  const mCsv = CsvParser.parseToTableData(csvIn, {});
  ok("CSV：Worker 返回 result 且与主线程逐字段一致",
     wCsv && wCsv.type === "result" && JSON.stringify(wCsv.data) === JSON.stringify(mCsv),
     wCsv && wCsv.type === "error" ? wCsv.message : "");

  const jsonIn = '[{"a":1,"b":{"c":2}},{"a":3}]';
  const wJson = runInWorker("json", jsonIn);
  const mJson = JsonParser.parseToTableData(jsonIn);
  ok("JSON：Worker 与主线程一致（含嵌套序列化）",
     wJson && wJson.type === "result" && JSON.stringify(wJson.data) === JSON.stringify(mJson));

  const wErr = runInWorker("json", "{bad");
  ok("JSON 报错经 Worker 透传中文提示",
     wErr && wErr.type === "error" && /JSON/.test(wErr.message), JSON.stringify(wErr));

  const wCsvOpt = runInWorker("csv", "2021,88\n2022,96", { header: true });
  ok("CSV：opts.header 经结构化克隆后在 Worker 内生效",
     wCsvOpt && wCsvOpt.type === "result" && wCsvOpt.data._headerUsed === true);
}

/* ============================================================
 * [5] HTML 解析的工具函数（用轻量假 DOM，不依赖浏览器）
 * ============================================================ */
section("[5] HTML 解析工具函数（假 DOM）");
{
  const { rowCells, expandColspan, isHiddenEl, isSkipCell, cellText, hasMergedCells } = HtmlTable;

  const el = (tag, attrs, text) => {
    const a = attrs || {};
    return {
      tagName: tag, textContent: text == null ? "" : text, children: [],
      hasAttribute: n => Object.prototype.hasOwnProperty.call(a, n),
      getAttribute: n => (Object.prototype.hasOwnProperty.call(a, n) ? String(a[n]) : null)
    };
  };

  ok("cellText 折叠多余空白",
     cellText(el("TD", {}, "  a   b  ")) === "a b");

  ok("isHiddenEl 识别 style=display:none",
     isHiddenEl(el("TD", { style: "display:none" })) === true);
  ok("isHiddenEl 识别 [hidden]",
     isHiddenEl(el("TD", { hidden: "" })) === true);
  ok("isHiddenEl 对普通单元格为 false",
     isHiddenEl(el("TD", { style: "color:red" })) === false);

  ok("isSkipCell 命中 checkbox/operation 关键字",
     isSkipCell(el("TD", { class: "c7n-checkbox" })) === true &&
     isSkipCell(el("TD", { class: "row-operation" })) === true);
  ok("isSkipCell 普通列为 false",
     isSkipCell(el("TD", { class: "amount" })) === false);

  ok("rowCells 只取 TD/TH",
     rowCells({ children: [el("TD", {}, "1"), el("SPAN", {}, "x"), el("TH", {}, "2")] }).length === 2);

  const spanCells = [el("TD", { colspan: "2" }, "合并"), el("TD", {}, "单独")];
  const expanded = expandColspan(spanCells);
  ok("expandColspan 把 colspan=2 展开为 2 项",
     expanded.length === 3 && expanded[0] === spanCells[0] && expanded[2] === spanCells[1]);
  ok("rowCells 对含 colspan 的行自动展开",
     rowCells({ children: spanCells }).length === 3);
  ok("colspan 非法/超大值被兜底（不会撑爆）",
     expandColspan([el("TD", { colspan: "99999" }, "x")]).length === 1000);

  // hasMergedCells：给一个能匹配 [colspan]/[rowspan] 的最小假表
  const fakeTable = allCells => ({
    querySelector: sel => {
      const want = sel.replace(/[\[\]]/g, "").split(",").map(s => s.trim());
      return allCells.find(c => want.some(attr => c.hasAttribute(attr))) || null;
    }
  });
  ok("hasMergedCells 检出 colspan",
     hasMergedCells(fakeTable([el("TD", { colspan: "2" }, "x")])) === true);
  ok("hasMergedCells 检出 rowspan",
     hasMergedCells(fakeTable([el("TD", { rowspan: "3" }, "x")])) === true);
  ok("hasMergedCells 无合并时为 false",
     hasMergedCells(fakeTable([el("TD", {}, "x")])) === false);

  /* 智能选表：多表选行数最多者；单表/空必须回到 0
   * （曾经的 bug：多表解析后下拉 value="1"，再来一次单表输入时读回陈旧 value
   *   → 下标越界 → 整页解析抛异常、统计恒为空。这里把选表规则钉成纯函数断言。） */
  const { pickLargestIndex } = HtmlTable;
  ok("pickLargestIndex([1,4]) === 1", pickLargestIndex([1, 4]) === 1);
  ok("pickLargestIndex([4,1]) === 0", pickLargestIndex([4, 1]) === 0);
  ok("pickLargestIndex([1]) === 0（单表恒选 0）", pickLargestIndex([1]) === 0);
  ok("pickLargestIndex([]) === 0（无表不越界）", pickLargestIndex([]) === 0);
  ok("pickLargestIndex 并列取靠前者", pickLargestIndex([3, 3]) === 0);
  ok("pickLargestIndex 容忍非法值（null/字符串）",
     pickLargestIndex([null, "5", undefined]) === 1);
}

/* ============================================================
 * [6] 构建产物契约（若 dist 存在则顺带核对「单文件」属性）
 * ============================================================ */
section("[6] 构建产物（dist/index.html）契约");
{
  const dist = join(ROOT, "dist", "index.html");
  if (!existsSync(dist)) {
    console.log("  · dist/index.html 不存在（未构建），跳过 —— CI 中由 build-single 步骤先生成");
  } else {
    const html = readFileSync(dist, "utf8");
    const htmlCode = stripComments(html);
    ok("产物无 <script src>（全部内联）", !/<script[^>]+src=/i.test(html));
    ok("产物无 <link rel=stylesheet>（CSS 已内联）", !/<link[^>]+rel=["']stylesheet["']/i.test(html));
    ok("产物内 Worker 不接受字面量文件路径（必须是 Blob URL）",
       !hasLiteralWorkerFile(htmlCode),
       "找到了 new Worker('<路径>.js') —— 单文件产物里该文件不存在");
    ok("产物内含 Worker 源码工厂", /WorkerSource/.test(html));
  }
}

/* ============================================================ */
console.log("\n" + "─".repeat(52));
console.log(`结果：通过 ${pass} / ${pass + fail}` + (fail ? `，失败 ${fail}` : "，全绿 ✅"));
process.exit(fail ? 1 : 0);
