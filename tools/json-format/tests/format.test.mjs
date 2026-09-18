/* ============================================================
 * format.test.mjs — json-format 的零依赖测试
 * ------------------------------------------------------------
 * 跑法：node tools/json-format/tests/format.test.mjs   （退出码 0 / 1）
 *
 * 设计上的一个刻意选择：**测的就是交付物本身**。
 * 这个工具是「单个自包含 HTML」，所以测试不是 import 某个模块，
 * 而是把 index.html 里的 <script> 抠出来、在 vm 沙箱里真跑一遍，
 * 再对暴露出的核心函数下断言。
 * 好处：不存在"测试版 / 生产版"两份代码可以各自漂移 ——
 * 谁把核心改坏、或者改完忘了同步，这里立刻红。
 * ============================================================ */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};

/* ============================================================
 * [0] 「能双击打开」这条产品属性，先用静态断言守住
 * ------------------------------------------------------------
 * 选「单个自包含 HTML」这个形态，图的就是 file:// 双击即用、
 * 能把一个文件发给同事。以下四样任意一样出现，这个属性就**静默失效**：
 * 页面在 HTTP 下照样正常，只有在别人双击打开时才白屏。
 * 所以这里必须由测试守着，不能靠记性。
 * ============================================================ */
console.log("\n[0] 形态契约：必须能 file:// 双击打开");
ok("没有任何 <script src>（外部脚本）", !/<script[^>]+src=/i.test(HTML));
ok("没有 type=\"module\"（file:// 下会被 CORS 直接拦掉）", !/type\s*=\s*["']module["']/i.test(HTML));
ok("没有 fetch( —— 依赖 fetch 就必须起 HTTP 服务", !/\bfetch\s*\(/.test(HTML));
ok("没有外部 http(s) 资源（CDN 字体 / 样式一律不要）",
   !/(?:src|href)\s*=\s*["']https?:/i.test(HTML),
   "找到了外链：" + (HTML.match(/(?:src|href)\s*=\s*["']https?:[^"']*/i) || [""])[0]);
ok("CSS 与 JS 全部内联（没有 <link rel=stylesheet> 指向文件）",
   !/<link[^>]+rel=["']stylesheet["']/i.test(HTML));

const scripts = [...HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
ok("恰好 1 个内联 <script> 块", scripts.length === 1, "实际 " + scripts.length);

/* ============================================================
 * [1] 在 vm 沙箱里跑核心
 * ------------------------------------------------------------
 * 沙箱里**只给 module 与 TextEncoder**：
 *   - 不给 document / window → 核心跑完就 return，UI 代码不执行；
 *   - TextEncoder 是宿主 API（不是 ECMAScript 内置），注入它是安全的。
 *     绝不要注入 Object / Array / RegExp 这类内置 —— vm 有独立 realm，
 *     注入宿主 realm 的内置会让产物里的 instanceof 判断恒为 false。
 * ============================================================ */
console.log("\n[1] 从交付物里加载核心");
const sandbox = { module: { exports: {} }, TextEncoder, console };
vm.createContext(sandbox);
let loadError = null;
try { vm.runInContext(scripts[0], sandbox, { filename: "json-format/index.html#script1" }); }
catch (e) { loadError = e; }
ok("核心脚本可执行（UI 因缺 document 被跳过）", !loadError, loadError && loadError.message);

const J = sandbox.module.exports;
ok("核心暴露了 API 对象", J && typeof J === "object");
ok("API 含 formatJson / minifyJson / validateJson / parseJson",
   !!(J && J.formatJson && J.minifyJson && J.validateJson && J.parseJson));

/* ============================================================
 * [2] BOM 与「空输入」
 * ============================================================ */
console.log("\n[2] 边界：BOM 与空输入");
ok("带 BOM 的 JSON 能解析成功（记事本粘过来就是这种）",
   J.parseJson("\ufeff{\"a\":1}").ok);
ok("不带 BOM 的正常解析", J.parseJson("{\"a\":1}").ok);
ok("stripBOM 只削掉开头那一个 BOM", J.stripBOM("\ufeff\ufeffx") === "\ufeffx");

const empty = J.parseJson("");
ok("空串 → ok:false 且标了 empty", !empty.ok && empty.error.empty === true);
ok("空串不编造行列号（line 为 null）", empty.error.line === null);
ok("纯空白也算空", !J.parseJson("   \n\t ").ok);
ok("空输入的提示是中文且告诉用户怎么做", /粘贴/.test(J.parseJson("").error.hint));

/* ============================================================
 * [3] 报错定位：三种引擎格式 + 拿不到位置时不许编
 * ------------------------------------------------------------
 * 下面的消息文本是**实测**来的（V8 与 Node 同引擎），不是照文档猜的。
 * ============================================================ */
console.log("\n[3] 报错定位");
const p1 = J.errorPosition("Expected double-quoted property name in JSON at position 12 (line 3 column 1)", "x".repeat(30));
ok("V8 格式：直接取 (line L column C)", p1 && p1.line === 3 && p1.column === 1,
   JSON.stringify(p1));
const p2 = J.errorPosition("JSON.parse: unexpected character at line 2 column 5 of the JSON data", "x".repeat(30));
ok("Firefox 格式：同样认得 line / column", p2 && p2.line === 2 && p2.column === 5, JSON.stringify(p2));
const p3 = J.errorPosition("Unexpected non-whitespace character after JSON at position 3 (line 1 column 4)", "{} {}");
ok("两种信息同时存在时，以 line/column 为准", p3 && p3.line === 1 && p3.column === 4, JSON.stringify(p3));

const text = "{\n\"a\": 1\n}";
const p4 = J.errorPosition("Unexpected token at position 5", text);
/* 手算：line 2 的起点是 index 2（index 1 是那个换行），
   position 5（0-based）落在 line 2 的第 5-2+1 = 4 列。
   交叉验证：上面 "{} {}" 的 position 3 对应 column 4，同样满足 column = 行内偏移 + 1。 */
ok("只有 position 时能反推出行列（position 5 → 第 2 行第 4 列）",
   p4 && p4.line === 2 && p4.column === 4, JSON.stringify(p4));
ok("position 超出文本长度时被夹住，不产生越界行号",
   J.errorPosition("Unexpected token at position 99999", "ab").line === 1);

const noPos = J.errorPosition("Unexpected end of JSON input", "");
ok("完全没有位置信息 → 返回 null（宁可不给，也不编一个错的）", noPos === null);

/* ============================================================
 * [4] 真实报错 → 中文解释
 * ============================================================ */
console.log("\n[4] 错误解释映射");
const CASES = [
  ["{\n  \"a\": 1,\n}", "属性名"],
  ["{\n  \"a\": 1,\n  b: 2\n}", "属性名"],
  ["{'a': 1}", "属性名"],
  ["{\"a\": [1, 2", "数组元素"],
  ["{} {}", "多余内容"],
  ["undefined", "合法的 JSON 值"],
  ["{\"a\" 2}", "冒号"]
];
for (const [bad, expectWord] of CASES) {
  const r = J.parseJson(bad);
  const got = r.ok ? "(竟然通过了)" : (r.error.hint || "");
  ok(`真实报错「${bad.replace(/\n/g, "\\n").slice(0, 22)}」→ 中文解释含「${expectWord}」`,
     !r.ok && got.indexOf(expectWord) >= 0, "实际：" + JSON.stringify(got));
}
ok("遇到没见过的报错 → 解释为空串（不硬套一句可能错的中文）",
   J.explain("Some brand new engine message") === "");
const realMsg = J.parseJson("not json at all");
ok("引擎原文一定保留在 error.message 里（不被中文提示顶掉）",
   !realMsg.ok && /is not valid JSON|Unexpected token/.test(realMsg.error.message),
   JSON.stringify(realMsg.error && realMsg.error.message));
ok("中文提示与引擎原文分属两个字段，互不覆盖",
   !realMsg.ok && !!realMsg.error.hint && realMsg.error.hint !== realMsg.error.message);

/* ============================================================
 * [4b] 「输入被截断」判定
 * ------------------------------------------------------------
 * 预期值全部来自**实测**（见下面的 position 与长度对照），不是估的：
 *   {"a": [1, 2    len 11  pos 11  → 落末尾，判截断
 *   {"a": [1, 2]   len 12  pos 12  → 落末尾，判截断（对象没闭合）
 *   {"a": 1,}      len  9  pos  8  → 不在末尾，**不是**截断（是多余的尾逗号）
 *   {"a" 2}        len  7  pos  5  → 不在末尾，不是截断
 * ============================================================ */
console.log("\n[4b] 输入被截断的判定（重点在「不误报」）");
const TRUNC = [
  ['{"a": [1, 2', true, "数组没闭合"],
  ['{"a": 1', true, "对象没闭合"],
  ['{"a": [1, 2]', true, "对象没闭合（数组反而是完整的）"],
  ['[1, 2', true, "顶层数组没闭合"],
  ['{"a"', true, "属性值缺失"],
  ['{"a": [1, 2\n   ', true, "末尾有空白也要能识别"]
];
for (const [bad, want, why] of TRUNC) {
  const r = J.parseJson(bad);
  ok(`截断「${bad.replace(/\n/g, "\\n")}」→ 标记 truncated（${why}）`,
     !r.ok && r.error.truncated === true, "实际 truncated=" + (r.ok ? "n/a" : r.error.truncated));
}
const NOT_TRUNC = [
  ['{"a": 1,}', "多余的尾逗号"],
  ['{"a" 2}', "属性名后少了冒号"],
  ['{}  {}', "JSON 后面有多余内容"],
  ['[1,2,]', "数组尾逗号"]
];
for (const [bad, why] of NOT_TRUNC) {
  const r = J.parseJson(bad);
  ok(`语法错「${bad}」→ **不**误报成截断（${why}）`,
     !r.ok && r.error.truncated === false, "实际 truncated=" + (r.ok ? "n/a" : r.error.truncated));
}
/* 拿不到 position 的报错不走这条判定：原文本身已经说了「不完整」，再叠一句就重复 */
const noPos2 = J.parseJson("tru");
ok("没有 position 的截断（Unexpected end of JSON input）不重复叠提示",
   !noPos2.ok && noPos2.error.truncated === false && /不完整|截断/.test(noPos2.error.hint));
ok("合法的 JSON 不会带 truncated 字段（ok 分支不带 error）",
   J.parseJson('{"a":1}').ok === true && J.parseJson('{"a":1}').error === undefined);

/* ============================================================
 * [5] 格式化 / 压缩
 * ============================================================ */
console.log("\n[5] 格式化与压缩");
const SRC = '{"name":"张三","tags":[1,2],"meta":{"ok":true},"n":null}';

const f2 = J.formatJson(SRC, "2");
ok("缩进 2 空格：用 2 空格换行", f2.ok && /\n {2}"name"/.test(f2.value));
const f4 = J.formatJson(SRC, "4");
ok("缩进 4 空格：用 4 空格换行", f4.ok && /\n {4}"name"/.test(f4.value));
const ft = J.formatJson(SRC, "tab");
ok("缩进 Tab：用制表符换行", ft.ok && /\n\t"name"/.test(ft.value));
ok("非法缩进值回落成 2 空格", J.formatJson(SRC, "99x").ok);

ok("中文值不被转义成 \\uXXXX（发给同事看到的还是中文）",
   f2.ok && f2.value.indexOf("张三") > 0);

const m = J.minifyJson(SRC);
ok("压缩：没有换行", m.ok && m.value.indexOf("\n") < 0);
ok("压缩：没有多余空格", m.ok && m.value.indexOf(": ") < 0 && m.value.indexOf(", ") < 0);
ok("压缩后再格式化，结果与直接格式化一致（语义等价）",
   J.formatJson(m.value, "2").value === f2.value);

/* 幂等：格式化过的结果再格式化一次不应变化 —— 这条能挡住"输出不可再解析"这类问题 */
ok("格式化是幂等的（再格式化一次不变）",
   J.formatJson(f2.value, "2").value === f2.value);

/* 嵌套深度不丢结构 */
const deep = J.formatJson('{"a":{"b":{"c":[{"d":1}]}}}', "2");
ok("深层嵌套结构完整保留", deep.ok && /"d": 1/.test(deep.value));

/* 顶层不一定是对象 */
ok("顶层是数组 → 合法", J.parseJson("[1,2,3]").ok);
ok("顶层是字符串 → 合法", J.parseJson('"hello"').ok);
ok("顶层是 null → 合法", J.parseJson("null").ok);
ok("顶层是 true → 合法", J.parseJson("true").ok);
ok("顶层是数字 → 合法", J.parseJson("42").ok);

/* 非法输入三个出口行为一致 */
ok("格式化遇到非法输入 → ok:false 且带 error",
   !J.formatJson("{oops}").ok && !!J.formatJson("{oops}").error);
ok("压缩遇到非法输入 → 同上", !J.minifyJson("{oops}").ok);
ok("校验与格式化对「合法」的判定一致（不会一个说合法一个报错）",
   J.validateJson("{oops}").ok === J.formatJson("{oops}").ok);

/* ============================================================
 * [6] 大整数精度告警
 * ============================================================ */
console.log("\n[6] 大整数精度告警（跳过字符串内部是重点）");
ok("19 位裸数字 → 告警", J.findLongIntegers('{"id":1234567890123456789}').length === 1);
ok("16 位 → 告警", J.findLongIntegers('{"id":1234567890123456}').length === 1);
ok("15 位 → 不告警（还能精确表示）", J.findLongIntegers('{"id":123456789012345}').length === 0);
ok("**【反例】字符串里的长数字不告警** —— " +
   '"orderId":"1234567890123456789" 本来就不会丢精度',
   J.findLongIntegers('{"orderId":"1234567890123456789"}').length === 0);
ok("**【反例】字符串里含转义引号时状态机不跑偏**",
   J.findLongIntegers('{"a":"x\\"1234567890123456789"}').length === 0);
ok("小数 1.5 → 不告警", J.findLongIntegers('{"a":1.5}').length === 0);
ok("大指数 1e30 → 不告警（整数部分只有 1 位，可精确表示）",
   J.findLongIntegers('{"a":1e30}').length === 0);
ok("小数形式的长有效数字 → 不误判成整数",
   J.findLongIntegers('{"a":1.2345678901234567}').length === 0);
ok("数组里的长数字也告警", J.findLongIntegers('[1,1234567890123456789]').length === 1);

const multi = J.findLongIntegers('{\n  "a": 1234567890123456789,\n  "b": 9876543210987654321\n}');
ok("多个命中都数出来", multi.length === 2, "实际 " + multi.length);
ok("命中项带正确行号（第 2 行 / 第 3 行）",
   multi.length === 2 && multi[0].line === 2 && multi[1].line === 3,
   JSON.stringify(multi.map((h) => h.line)));

/* 真丢精度这件事本身，留个记录：库确实会改写末尾几位 */
const precision = String(JSON.parse("1234567890123456789"));
ok("（事实核对）JSON.parse 确实会改写 19 位整数的末尾几位 —— 所以这条告警是必要的",
   precision !== "1234567890123456789", "实际解析成 " + precision);

/* ============================================================
 * [7] 其它工具函数与页面契约
 * ============================================================ */
console.log("\n[7] 工具函数与页面契约");
ok("byteSize 对中文按 3 字节算（不是 length 的一半）", J.byteSize("中文") === 6);
ok("countLines 对空串返回 0", J.countLines("") === 0);
ok("countLines 对上文算对", J.countLines("a\nb\nc") === 3);
ok("超大文件上限是 2MB", J.MAX_BYTES === 2 * 1024 * 1024);

ok("页面有 input / output / status 三个必需元素",
   /id="input"/.test(HTML) && /id="output"/.test(HTML) && /id="status"/.test(HTML));
/* 输出区从 <textarea readonly> 换成了 <pre>（B2：高亮要能往里装元素）。
   「结果不能被直接改」这个性质还在，但断言得换个写法 ——
   <pre> 本身不是编辑控件，可**加个 contenteditable 就能编辑**，那才是真正要防的。 */
ok("输出区是 <pre>（语法高亮要能往里装元素，textarea 装不了）", /<pre[^>]*id="output"/.test(HTML));
ok("输出区不可编辑（不是 textarea、也没有 contenteditable）",
   !/<textarea[^>]*id="output"/.test(HTML) && !/id="output"[^>]*contenteditable/.test(HTML));
/* <pre> 不像 textarea 那样自带可聚焦性，而「Ctrl+A 只选输出区」得先能聚焦 */
ok("输出区可聚焦（tabindex=0，配合 JS 里的 Ctrl+A 选区限定）",
   /id="output"[^>]*tabindex="0"/.test(HTML));
ok("输出区用 data-placeholder 承担了原来 textarea 的 placeholder",
   /id="output"[^>]*data-placeholder/.test(HTML));
ok("页面自报「零依赖 · 数据不出浏览器」", /零依赖/.test(HTML));

/* 主题 key 必须带自己的前缀：web-toolbox 各工具同域部署，
   共用 localStorage，不带前缀会互相覆盖（code-workspace 用 cw-）。 */
ok("主题偏好使用 jf- 前缀，且没有误用 code-workspace 的 cw- 前缀",
   /jf-theme/.test(HTML) && !/["']cw-/.test(HTML));

/* ============================================================
 * [8] UI 冒烟：真的「双击打开能用吗」
 * ------------------------------------------------------------
 * 前面 [1] 段是**故意不注入 document** 才让 UI 代码被跳过、只测核心。
 * 代价是 UI 初始化整条路径没人守 —— 而它恰好是双击白屏的唯一可能来源
 * （核心全对、UI 一抛异常，页面照样白）。
 * 所以这里反过来：用最小 DOM 桩**注入** document/window，让 UI 真跑起来。
 *
 * 一个关键设计：桩里的 id 注册表**从 HTML 里抠出来预填**，而不是"要哪个给哪个"。
 * 否则 JS 里写错 id（$("btnFormt")）会拿到一个凭空冒出来的元素、静默通过 ——
 * 这正是「桩的空实现让断言恒真」那类坑。预填之后，id 对不上就会
 * els.btnX.addEventListener 抛错 → 直接红。
 * ============================================================ */
console.log("\n[8] UI 冒烟（真跑一遍初始化与按钮）");

const htmlIds = new Set();
for (const m of HTML.matchAll(/\bid="([^"]+)"/g)) htmlIds.add(m[1]);

const created = [];
function makeEl(id, tag) {
  const self = {
    id, tagName: String(tag || "div").toUpperCase(),
    value: "", title: "", disabled: false,
    files: null, href: "", download: "", style: {},
    _nodes: [], _handlers: {}, _attrs: {}, _cls: new Set(),
    _parent: null, _clicks: 0, _selected: false,
    addEventListener(type, fn) { (self._handlers[type] || (self._handlers[type] = [])).push(fn); },
    dispatch(type, ev) { (self._handlers[type] || []).forEach((fn) => fn(ev || {})); },
    appendChild(c) { c._parent = self; self._nodes.push(c); return c; },
    removeChild(c) {
      const i = self._nodes.indexOf(c);
      if (i >= 0) self._nodes.splice(i, 1);
      c._parent = null;
      return c;
    },
    remove() { if (self._parent) self._parent.removeChild(self); },
    click() { self._clicks++; self.dispatch("click"); },
    select() { self._selected = true; },
    focus() { self._focused = true; },
    setAttribute(k, v) { self._attrs[k] = String(v); },
    getAttribute(k) { return k in self._attrs ? self._attrs[k] : null; },
    selectionStart: 0, selectionEnd: 0
  };
  Object.defineProperty(self, "parentNode", { get() { return self._parent; } });
  /* textContent 必须按真实 DOM 语义建模：它是「所有后代文本节点」的拼接，
     而 appendChild 追加的新子节点**不会**顶掉已有文本。
     这就是产品里 setStatus 的写法 —— `b.textContent = body` 之后再
     `b.appendChild(r)`（把引擎原文挂进同一格）—— 靠的正是这个语义。
     早先版本的桩把「文本」和「子节点」分成两个字段，getter 见到子节点就丢掉文本，
     于是状态条看起来只剩引擎原文 → 三条断言误报红。
     **桩不忠实，红的是桩。** 所以这里把文本也当成节点放进同一个序列。 */
  Object.defineProperty(self, "textContent", {
    get() {
      return self._nodes.map((n) => (typeof n === "string" ? n : n.textContent)).join("");
    },
    set(v) { self._nodes = [String(v)]; }
  });
  Object.defineProperty(self, "className", {
    get() { return [...self._cls].join(" "); },
    set(v) { self._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  self.classList = {
    add: (c) => self._cls.add(c),
    remove: (c) => self._cls.delete(c),
    contains: (c) => self._cls.has(c)
  };
  return self;
}

const registry = new Map();
for (const id of htmlIds) registry.set(id, makeEl(id));
/* fileInput 在 HTML 里是 hidden 的，但仍要有 files / value 才能被驱动 */
registry.get("fileInput").files = null;
const missIds = [];

/* 记录型桩：不是空实现。空实现会让「复制走了哪条路 / 下载有没有回收 URL」
   这类断言恒真，等于没测。 */
const store = new Map();
const copyLog = [];          // navigator.clipboard 收到的文本
const execLog = [];          // execCommand 收到的命令
const blobLog = [];          // 造出来的 Blob（只记参数，够断言了）
const urlLog = [];           // createObjectURL / revokeObjectURL 的往返
const docEvents = {};        // document 上挂的监听器（dragover / drop 靠它驱动）
const rangeLog = [];         // createRange 造出来的 Range（记下它被圈到了哪个节点）
const selLog = { ranges: [] };   // Selection 的当前 Range 列表

const FAKE_DOC = {
  documentElement: makeEl("html", "html"),
  body: makeEl("body", "body"),
  getElementById(id) {
    if (!registry.has(id)) missIds.push(id);
    return registry.get(id) || null;
  },
  createElement(tag) { const e = makeEl("(created)", tag); created.push(e); return e; },
  /* 输出区高亮是用**真文本节点**拼的（不是 innerHTML），所以桩必须能造文本节点。
     注意**不能返回裸字符串**：appendChild 里要写 c._parent，而本文件是 .mjs（严格模式），
     给原始值设属性会直接 TypeError。返回一个只有 textContent 的对象即可 ——
     textContent 的 getter 对「非字符串」取的就是 n.textContent。 */
  createTextNode(t) { return { nodeType: 3, textContent: String(t) }; },
  addEventListener(type, fn) { (docEvents[type] || (docEvents[type] = [])).push(fn); },
  dispatch(type, ev) { (docEvents[type] || []).forEach((fn) => fn(ev || {})); },
  execCommand(cmd) { execLog.push(cmd); return FAKE_DOC.execOk; },
  /* Ctrl+A 要把选区限定在输出区里 —— 没有 Range / Selection 就只能测到
     「不抛异常」，测不到「圈的是输出区」。所以这两个也按记录型桩建出来。 */
  createRange() {
    const r = { node: null, selectNodeContents(n) { r.node = n; } };
    rangeLog.push(r);
    return r;
  },
  /* execCommand 的桩**不能恒返回 true** —— 那会让「两条路都不通」这条分支
     永远走不到，等于那段降级提示从来没被测过。留一个开关来制造真实失败。 */
  execOk: true
};
const FAKE_WIN = {
  matchMedia: () => ({ matches: false }),
  isSecureContext: true,
  getSelection: () => ({
    removeAllRanges() { selLog.ranges = []; },
    addRange(r) { selLog.ranges.push(r); }
  })
};
/* navigator 做成可变的：测试要在「现代 API 可用 / 不可用」两种情况下各跑一遍 */
const FAKE_NAV = {
  clipboard: {
    writeText(t) {
      if (FAKE_NAV.clipboard.fail) return Promise.reject(new Error("denied"));
      copyLog.push(t);
      return Promise.resolve();
    },
    fail: false
  }
};
/* Blob 只用参数、不调方法（产品里也只把它交给 createObjectURL），
   所以用假实现完全够，而且能直接断言内容，不必异步读回来。
   URL 则要真记录 create/revoke 的配对 —— 「用完有没有回收」是条真实断言。 */
function FakeBlob(parts, opts) {
  this.parts = parts;
  this.type = (opts && opts.type) || "";
  blobLog.push(this);
}
const FAKE_URL = {
  createObjectURL(blob) {
    const u = "blob:fake/" + urlLog.length;
    urlLog.push({ url: u, blob, revoked: false });
    return u;
  },
  revokeObjectURL(u) {
    const e = urlLog.find((x) => x.url === u);
    if (e) e.revoked = true;
  }
};
/* FileReader 兜底路径的桩：立刻触发 onload */
function FakeFileReader() {
  this.readAsText = (file) => {
    this.result = file && file._raw != null ? file._raw : "";
    if (this.onload) this.onload();
  };
}

/* 定时器做成**受控**的：toast 的存活期靠它，真等 2.6 秒会让测试变慢，
   而且没法断言「连续两次操作只挂一个定时器」。这里只登记不执行，
   由 runSandboxTimers() 手动推进时间。 */
let sandboxTimerSeq = 0;
const sandboxTimers = new Map();
const fakeSetTimeout = (fn, ms) => { const id = ++sandboxTimerSeq; sandboxTimers.set(id, { fn, ms }); return id; };
const fakeClearTimeout = (id) => { sandboxTimers.delete(id); };
const runSandboxTimers = () => {
  const fns = [...sandboxTimers.values()].map((t) => t.fn);
  sandboxTimers.clear();
  fns.forEach((f) => f());
};

/* 核心脚本抠出来，在**带 document/window** 的沙箱里跑 */
const UI_SRC = (() => {
  const blocks = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  return blocks[0][1];
})();
const uiCtx = {
  module: { exports: {} },
  TextEncoder,
  document: FAKE_DOC,
  window: FAKE_WIN,
  navigator: FAKE_NAV,
  Blob: FakeBlob,
  URL: FAKE_URL,
  FileReader: FakeFileReader,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  },
  console
};
uiCtx.globalThis = uiCtx;
let uiErr = null;
try {
  vm.createContext(uiCtx);
  vm.runInContext(UI_SRC, uiCtx);
} catch (e) {
  uiErr = e;
}
ok("注入 document 后 UI 能完整初始化（不抛异常）", uiErr === null,
   uiErr ? uiErr.stack.split("\n").slice(0, 2).join(" | ") : "");
ok("JS 里用到的 id 全部真实存在于 HTML 里（没有拼错）",
   missIds.length === 0, "查不到的 id：" + JSON.stringify(missIds));

const UI = uiCtx.window.JSONFMT || uiCtx.module.exports;
ok("UI 沙箱里也暴露了核心 API（window.JSONFMT）", !!UI && typeof UI.formatJson === "function");

const el = (id) => registry.get(id);
const statusText = () => el("status").textContent;
const statusCls = () => el("status").className;
const toastCls = () => el("toast").className;
const toastText = () => el("toast").textContent;
/* `show` 在不在 class 里 = 浮动提示当前是不是露着的 */
const toastShown = () => /\bshow\b/.test(el("toast").className);

/* --- 点「格式化」 --- */
el("indent").value = "2";
el("input").value = '{"b":2,"a":{"c":[1,2]}}';
el("btnFormat").dispatch("click");
ok("点格式化 → 输出区拿到格式化结果",
   /\n {2}"b"/.test(el("output").textContent), JSON.stringify(el("output").textContent));
/* 用户明确不要「操作后状态栏变色」→ 成功反馈改成会自己退场的浮动提示。
   这一对断言把两个方向都钉住：提示要出来，状态栏要**不动**。 */
ok("点格式化 → 浮出提示且说明结果规模",
   toastShown() && /已格式化/.test(toastText()), toastCls() + " | " + toastText());
ok("点格式化 → 状态栏**不**变色（成功态已从状态栏移除）",
   statusCls() === "status", statusCls());
ok("点格式化 → 状态栏回到「就绪」而不是报成功",
   /就绪/.test(statusText()), statusText());
ok("点格式化 → 输出区 meta 显示了行数与字节数", /字节/.test(el("outMeta").textContent),
   JSON.stringify(el("outMeta").textContent));
ok("点格式化 → 不残留「已过期」标记", !el("output").classList.contains("is-stale"));

/* --- 点「校验」：非法输入必须报错，且带行列号 --- */
el("input").value = '{\n  "a": 1,\n}';
el("btnValidate").dispatch("click");
ok("非法输入校验 → 状态条转为错误态（is-error）", /is-error/.test(statusCls()), statusCls());
ok("非法输入校验 → 提示里带「第 N 行第 M 列」", /第 \d+ 行第 \d+ 列/.test(statusText()),
   JSON.stringify(statusText()));
ok("非法输入校验 → 提示里带中文解释（属性名）", /属性名/.test(statusText()),
   JSON.stringify(statusText()));

/* --- 截断输入：要把「没粘完」这句话真送到用户眼前（这才是加它的目的） --- */
el("input").value = '{"a": [1, 2';
el("btnValidate").dispatch("click");
ok("截断输入 → 状态条真的出现「没粘完」提示（不是只在核心层标记）",
   /没粘完/.test(statusText()), JSON.stringify(statusText()));

/* --- 「只校验」不许动输出区 --- */
const before = el("output").textContent;
el("input").value = '{"ok":1}';
el("btnValidate").dispatch("click");
ok("「只校验」不动输出区（用户可能正拿它核对）", el("output").textContent === before);
ok("合法且无问题时校验 → 同样走浮动提示", toastShown() && /合法的 JSON/.test(toastText()),
   toastCls() + " | " + toastText());

/* --- 大整数告警要在状态栏里变成警告，而且**不许**被浮动提示替代 --- */
runSandboxTimers();                     // 先让上一条提示退场，才能确认这次没弹新的
el("input").value = '{"orderId": 1234567890123456789}';
el("btnFormat").dispatch("click");
ok("含超长整数 → 状态条是警告态（is-warn）而不是成功态", /is-warn/.test(statusCls()), statusCls());
ok("含超长整数 → **不**弹会消失的提示（警告必须留住让人看完）",
   toastShown() === false, toastCls());
ok("含超长整数 → 警告文案解释了「会被悄悄改写」", /悄悄改写/.test(statusText()),
   JSON.stringify(statusText()));

/* --- 主题切换 + 持久化 --- */
store.clear();
FAKE_DOC.documentElement.setAttribute("data-theme", "light");
el("btnTheme").dispatch("click");
ok("点主题按钮 → data-theme 切成 dark",
   FAKE_DOC.documentElement.getAttribute("data-theme") === "dark",
   String(FAKE_DOC.documentElement.getAttribute("data-theme")));
ok("点主题按钮 → 偏好写进 localStorage 的 jf-theme", store.get("jf-theme") === "dark",
   JSON.stringify([...store.entries()]));

/* --- 输入改动 → 旧结果标「已过期」而不是被清空 --- */
el("input").value = '{"x":1}';
el("btnFormat").dispatch("click");
const staleBefore = el("output").textContent;
el("input").value = '{"x":2}';
el("input").dispatch("input");
ok("改了输入 → 旧结果被标「已过期」而不是清空",
   el("output").textContent === staleBefore && el("output").classList.contains("is-stale"),
   "value 变了？" + (el("output").textContent !== staleBefore));
ok("改了输入 → 输出区 meta 显示「已过期」", el("outMeta").textContent === "已过期",
   JSON.stringify(el("outMeta").textContent));

/* --- Ctrl+Enter 快捷键 --- */
let prevented = false;
el("input").value = '{"k":1}';
el("input").dispatch("keydown", { ctrlKey: true, key: "Enter", preventDefault: () => { prevented = true; } });
ok("Ctrl + Enter → 触发格式化", /\n {2}"k"/.test(el("output").textContent), JSON.stringify(el("output").textContent));
ok("Ctrl + Enter → 拦掉了默认行为", prevented === true);

/* --- Tab 在输入框里插缩进、不跳焦点 --- */
let prevented2 = false;
el("input").value = "ab";
el("input").selectionStart = 1;
el("input").selectionEnd = 1;
el("input").dispatch("keydown", { key: "Tab", preventDefault: () => { prevented2 = true; } });
ok("Tab → 在光标处插入两空格缩进", el("input").value === "a  b", JSON.stringify(el("input").value));
ok("Tab → 拦掉了默认行为（不跳焦点）", prevented2 === true);
let prevented3 = false;
el("input").dispatch("keydown", { key: "Tab", ctrlKey: true, preventDefault: () => { prevented3 = true; } });
ok("Ctrl + Tab 不被拦截（留给浏览器切标签）", prevented3 === false);

/* --- 清空 --- */
el("btnClear").dispatch("click");
ok("点清空 → 输入输出都空、meta 归位到 —",
   el("input").value === "" && el("output").textContent === "" && el("outMeta").textContent === "—");

/* ============================================================
 * [9] 递归排序键名（纯核心）
 * ============================================================ */
console.log("\n[9] 递归排序键名");
const S = J.sortKeysDeep;
const cmp = J.compareKeys;
const sj = (v) => JSON.stringify(S(v, cmp));

ok("顶层对象按键名排序（输入 b 在前 → 输出 a 在前，值跟着键走）",
   sj({ b: 1, a: 2 }) === '{"a":2,"b":1}', sj({ b: 1, a: 2 }));
ok("嵌套对象递归排序",
   sj({ b: 1, a: { d: 1, c: 2 } }) === '{"a":{"c":2,"d":1},"b":1}', sj({ b: 1, a: { d: 1, c: 2 } }));

/* 数组顺序是语义 —— 排了就错。这是本功能最要紧的一条反例。 */
ok("**【反例】数组顺序原样保留**（数组不是按值排的）",
   sj({ b: [3, 1, 2], a: 1 }) === '{"a":1,"b":[3,1,2]}', sj({ b: [3, 1, 2], a: 1 }));
ok("数组里的对象要排序，但数组自身的顺序不动",
   sj({ z: [{ b: 1, a: 2 }, { d: 3, c: 4 }] }) === '{"z":[{"a":2,"b":1},{"c":4,"d":3}]}',
   sj({ z: [{ b: 1, a: 2 }, { d: 3, c: 4 }] }));

/* 实测出来的真坑：朴素的 out[k]=v 建新对象时，`__proto__` 那个键会**静默消失**。
   对一个「防止数据被悄悄改动」的工具来说，这条断言比其它都重要。 */
const protoSrc = '{"__proto__":{"a":1},"b":2}';
const protoOut = sj(JSON.parse(protoSrc));
ok("**【反例】`__proto__` 作键名时不被吃掉**（朴素赋值会静默丢掉它）",
   protoOut === '{"__proto__":{"a":1},"b":2}', protoOut);
ok("`__proto__` 键是真的自有属性（不是挂到原型上的）",
   Object.prototype.hasOwnProperty.call(S(JSON.parse(protoSrc), cmp), "__proto__"));
/* 注意：这里**不能**写 `getPrototypeOf(out) === Object.prototype`。
   `out` 是在 vm 沙箱里建的，它的原型是**沙箱那个 realm** 的 Object.prototype，
   与宿主的不是同一个对象 —— 跨 realm 的 `instanceof` / 恒等比较永远是 false。
   真正该验的是「原型没被污染」的表现：没多出 __proto__ 里的属性。 */
ok("排序没有污染原型（没有多出被吃进去的属性）",
   S(JSON.parse(protoSrc), cmp).a === undefined);

ok("标量原样返回（数字 / null / 字符串 / 布尔）",
   S(1, cmp) === 1 && S(null, cmp) === null && S("x", cmp) === "x" && S(true, cmp) === true);
ok("不修改入参（是纯函数）", (() => {
  const v = { b: 1, a: 2 };
  S(v, cmp);
  return Object.keys(v).join(",") === "b,a";
})());
ok("排序是幂等的（再排一次不变）", (() => {
  const o = JSON.parse('{"b":{"z":1,"y":2},"a":3}');
  return sj(S(o, cmp)) === sj(o);
})());

/* 比较器必须**真的被用上**，而不是无意间退化成默认的码点排序。
   用反序比较器一试就知道：如果参数没被透传，键序不会翻。 */
ok("比较器参数真的被透传（传反序 → 键序也确实反了）",
   JSON.stringify(Object.keys(S({ a: 1, b: 2, c: 3 }, (x, y) => y.localeCompare(x)))) === '["c","b","a"]');
ok("默认比较器用的是 localeCompare（有意取舍：中文更合直觉，代价是依赖 locale）",
   J.compareKeys("订单", "物料") === "订单".localeCompare("物料"));
ok("键序与「按默认比较器排序后的键列表」一致", (() => {
  const o = { 物料: 1, 订单: 2, 客户: 3 };
  return JSON.stringify(Object.keys(S(o, cmp))) === JSON.stringify(Object.keys(o).sort(cmp));
})());

/* 排序与格式化共用 indentOf —— 两处各写一遍迟早漂移 */
ok("indentOf：2 / 4 / tab 三档", J.indentOf("2") === 2 && J.indentOf("4") === 4 && J.indentOf("tab") === "\t");
ok("indentOf：非法值与缺省都回落 2 空格", J.indentOf("9x") === 2 && J.indentOf(undefined) === 2);
ok("排序输出与格式化用同一套缩进风格（不会一处 2 空格一处 4 空格）",
   /\n {4}"a"/.test(JSON.stringify(S(JSON.parse('{"b":1,"a":2}'), cmp), null, J.indentOf("4"))));

/* ============================================================
 * [10] 复制 / 下载 / 拖入 / 排序（走 UI 层，复用 [8] 的沙箱）
 * ============================================================ */
console.log("\n[10] 复制 / 下载 / 拖入 / 排序（UI 层）");

const tick = () => new Promise((r) => setTimeout(r, 0));
const realClipboard = FAKE_NAV.clipboard;
function fakeFile(name, content) {
  return { name, text: () => Promise.resolve(content) };
}
function dragEvent(files, types) {
  const ev = {
    _pd: false,
    preventDefault() { ev._pd = true; },
    dataTransfer: { files, types: types || ["Files"], dropEffect: "" },
    relatedTarget: null
  };
  return ev;
}

/* ---- 复制：现代 API 路径 ---- */
copyLog.length = 0; execLog.length = 0;
FAKE_NAV.clipboard = realClipboard; FAKE_NAV.clipboard.fail = false;
el("input").value = '{"b":1,"a":2}';
el("btnFormat").dispatch("click");
const outText = el("output").textContent;
el("btnCopy").dispatch("click");
await tick();
ok("点复制 → 结果内容进了剪贴板", copyLog.length === 1 && copyLog[0] === outText);
ok("点复制 → 浮出提示并说明字节数", toastShown() && /已复制/.test(toastText()),
   toastCls() + " | " + toastText());
ok("有现代 API 时不走 execCommand 老路", execLog.length === 0);

/* ---- 复制：现代 API 被拒 → 降级 ---- */
copyLog.length = 0; execLog.length = 0; created.length = 0;
FAKE_NAV.clipboard.fail = true;
el("btnCopy").dispatch("click");
await tick();
ok("现代 API 被拒 → 自动落到 execCommand 老路", execLog.length === 1 && execLog[0] === "copy");
const tmpTa = created.find((e) => e.tagName === "TEXTAREA");
ok("降级路径**自己造**离屏 textarea，并塞进了要复制的文本",
   !!tmpTa && tmpTa.value === outText, tmpTa ? JSON.stringify(tmpTa.value) : "(没造 textarea)");
ok("降级路径没有去动结果区的选区（不复用结果区）", el("output")._selected === false);
ok("临时 textarea 用完就从 body 撤掉（不留垃圾）", FAKE_DOC.body._nodes.length === 0);
ok("降级成功时同样报成功（用户不需要知道走的哪条路）",
   toastShown() && /已复制/.test(toastText()), toastCls() + " | " + toastText());

/* ---- 复制：两条路都不可用 ---- */
runSandboxTimers();                        // 让上一条提示退场，才能确认这次没弹新的
FAKE_NAV.clipboard = null;
FAKE_DOC.execOk = false;                   // 老路也失败（例如剪贴板被策略禁掉）
execLog.length = 0;
el("btnCopy").dispatch("click");
await tick();
ok("两条路都不通时状态栏报错，并给**可执行的替代办法**（而不是静默失败）",
   /is-error/.test(statusCls()) && /Ctrl \+ A/.test(statusText()), statusText());
ok("失败**不**弹会消失的提示（错误要留在状态栏让人照着做）",
   toastShown() === false, toastCls());
ok("失败时也确实尝试过老路（不是直接放弃）", execLog.length === 1);
FAKE_NAV.clipboard = realClipboard; FAKE_NAV.clipboard.fail = false;
FAKE_DOC.execOk = true;

/* ---- 下载 ---- */
el("btnClear").dispatch("click");          // 顺带把 sourceName 清掉，测默认文件名
ok("结果区空时复制按钮置灰", el("btnCopy").disabled === true);
ok("结果区空时下载按钮置灰", el("btnDownload").disabled === true);

el("input").value = '{"b":1,"a":2}';
el("btnFormat").dispatch("click");
ok("出结果后复制 / 下载按钮恢复可用",
   el("btnCopy").disabled === false && el("btnDownload").disabled === false);

blobLog.length = 0; urlLog.length = 0; created.length = 0;
el("btnDownload").dispatch("click");
const anchor = created.find((e) => e.tagName === "A");
ok("点下载 → 造了一个 JSON 类型的 Blob", blobLog.length === 1 && /json/.test(blobLog[0].type));
ok("Blob 内容就是结果区的内容", blobLog.length === 1 && blobLog[0].parts[0] === el("output").textContent);
ok("用临时 <a download> 触发，没粘贴来源时文件名是 formatted.json",
   !!anchor && anchor.download === "formatted.json" && /^blob:/.test(anchor.href),
   anchor ? anchor.download : "(没造出 <a>)");
ok("下载后 object URL 被回收（不漏内存）", urlLog.length === 1 && urlLog[0].revoked === true);
ok("临时 <a> 用完从 body 移除", FAKE_DOC.body._nodes.length === 0);

/* ---- 拖入文件 ---- */
/* 先测「拖的是文字」这一路：它应当在**任何状态**下都不介入。
   放在文件拖入之前，是因为文件拖入会把提示层置起来，
   而拖文字这条路径本来就不负责收提示层（收提示层是 dragleave 的事）。 */
const evText = dragEvent([], ["text/plain"]);
FAKE_DOC.dispatch("dragover", evText);
ok("拖的是选中的文字时不介入（不拦、也不显示「松开鼠标」提示）",
   evText._pd === false && !FAKE_DOC.body.classList.contains("dropping"));

const evOver = dragEvent([fakeFile("a.json", "{}")]);
FAKE_DOC.dispatch("dragover", evOver);
ok("**【最关键的一条】dragover 被拦住了**（不拦浏览器会直接把文件当页面打开、输入区内容全丢）",
   evOver._pd === true);
ok("dragover → 显示拖入提示层", FAKE_DOC.body.classList.contains("dropping"));
ok("dragover 时把 dropEffect 设成 copy（光标会显示成「复制」而不是「移动」）",
   evOver.dataTransfer.dropEffect === "copy");

FAKE_DOC.dispatch("dragleave", { relatedTarget: {} });
ok("拖过页面内子元素时提示不闪（relatedTarget 非空就不收）",
   FAKE_DOC.body.classList.contains("dropping"));
FAKE_DOC.dispatch("dragleave", { relatedTarget: null });
ok("真的离开窗口时才收起提示", !FAKE_DOC.body.classList.contains("dropping"));

const evDrop = dragEvent([fakeFile("sample.txt", '{"b":1,"a":2}')]);
FAKE_DOC.dispatch("drop", evDrop);
await tick();
ok("drop 也被拦住了（否则页面会被导航走）", evDrop._pd === true);
ok("drop 后收起提示层", !FAKE_DOC.body.classList.contains("dropping"));
ok("文件内容真读进输入区了", el("input").value === '{"b":1,"a":2}', JSON.stringify(el("input").value));
ok("读入后输入区 meta 更新了", /行/.test(el("inMeta").textContent), el("inMeta").textContent);
ok("读入成功 → 浮出提示报文件名与规模",
   toastShown() && /已读入/.test(toastText()) && /sample\.txt/.test(toastText()),
   toastCls() + " | " + toastText());
created.length = 0;
el("btnDownload").dispatch("click");
const anchor2 = created.find((e) => e.tagName === "A");
ok("读入过文件后，下载名沿用它的主干名（sample.txt → sample.json）",
   !!anchor2 && anchor2.download === "sample.json", anchor2 ? anchor2.download : "(无)");

FAKE_DOC.dispatch("drop", dragEvent([fakeFile("one.json", '{"x":1}'), fakeFile("two.json", '{"y":2}')]));
await tick();
ok("一次拖多个文件只取第一个，不报错", el("input").value === '{"x":1}', JSON.stringify(el("input").value));

/* 文件路径上的 BOM 同样要削 */
FAKE_DOC.dispatch("drop", dragEvent([fakeFile("bom.json", "\uFEFF" + '{"a":1}')]));
await tick();
ok("从文件读入也削掉 BOM（记事本另存的就是带 BOM 的）",
   el("input").value === '{"a":1}', JSON.stringify(el("input").value));

/* 没有 File.text() 的老浏览器走 FileReader 兜底 */
FAKE_DOC.dispatch("drop", dragEvent([{ name: "old.json", _raw: '{"z":1}' }]));
await tick();
ok("没有 File.text() 时走 FileReader 兜底", el("input").value === '{"z":1}', JSON.stringify(el("input").value));

/* 读不了的文件要优雅失败，并点出真正的原因 */
FAKE_DOC.dispatch("drop", dragEvent([
  { name: "报表.xlsx", text: () => Promise.reject(new Error("NotReadableError")) }
]));
await tick();
ok("读不了的文件给明确提示，并点出「压缩包」这层原因",
   /is-error/.test(statusCls()) && /压缩包/.test(statusText()), statusText());

/* ---- 「打开文件」按钮 ---- */
const clicksBefore = el("fileInput")._clicks;
el("btnOpenFile").dispatch("click");
ok("点「打开文件」会去触发隐藏的 file input", el("fileInput")._clicks === clicksBefore + 1);

el("fileInput").files = [fakeFile("picked.json", '{"q":1}')];
el("fileInput").dispatch("change");
await tick();
ok("选文件后内容读入输入区", el("input").value === '{"q":1}', JSON.stringify(el("input").value));
ok("读完清空 fileInput.value（否则再选同一个文件不触发 change）", el("fileInput").value === "");

/* ---- 排序按钮 ---- */
el("input").value = '{"b":1,"a":{"d":3,"c":[2,1]}}';
el("indent").value = "2";
el("btnSort").dispatch("click");
ok("点「排序键名」→ 结果区是按键名排序后的文本",
   el("output").textContent === JSON.stringify({ a: { c: [2, 1], d: 3 }, b: 1 }, null, 2),
   JSON.stringify(el("output").textContent));
ok("排序结果里数组顺序没被动（[2,1] 还是 2 在前）",
   /\[\n\s+2,\n\s+1\n\s+\]/.test(el("output").textContent), JSON.stringify(el("output").textContent));
ok("排序**不动输入区**（用户随时能改回去）",
   el("input").value === '{"b":1,"a":{"d":3,"c":[2,1]}}');
ok("排序后浮出提示且说明了做了什么",
   toastShown() && /已排序/.test(toastText()), toastCls() + " | " + toastText());
ok("排序后状态栏**不**变色（与格式化一致）", statusCls() === "status", statusCls());

/* 排序对非法输入要报错，不能静默产出空结果 */
el("input").value = '{"a": 1,}';
el("btnSort").dispatch("click");
ok("非法输入点排序 → 报错态，且提示里有中文解释",
   /is-error/.test(statusCls()) && /属性名/.test(statusText()), statusText());

/* ============================================================
 * [11] 浮动提示的分工与生命周期
 * ------------------------------------------------------------
 * 这一段的立场：**会自己消失的只放"做成了"**。
 * 报错和警告必须留在状态栏 —— 用户要照着行号列号改、要复制引擎原文排查，
 * 三秒后消失等于把工具最要紧的能力毁掉。所以这段既验"提示会出现会退场"，
 * 也验"该留的东西没被塞进提示里"。
 * ============================================================ */
console.log("\n[11] 浮动提示（toast）");

/* --- 生命周期：会自己退场 --- */
runSandboxTimers();                        // 清场
el("input").value = '{"b":1,"a":2}';
el("btnFormat").dispatch("click");
ok("出提示时挂了一个待触发的定时器", sandboxTimers.size === 1, String(sandboxTimers.size));
runSandboxTimers();
ok("时间到了 → 提示自己退场（class 里的 show 被摘掉）", toastShown() === false, toastCls());
ok("退场后定时器也清干净了（不留悬挂引用）", sandboxTimers.size === 0, String(sandboxTimers.size));

/* --- 连续操作：只留一个定时器，不叠成一摞 --- */
el("input").value = '{"b":1,"a":2}';
el("btnFormat").dispatch("click");
const firstTimerId = [...sandboxTimers.keys()][0];
el("btnMinify").dispatch("click");
ok("连续两次操作只挂一个定时器（新的顶掉旧的，不叠成摞）",
   sandboxTimers.size === 1, String(sandboxTimers.size));
ok("上一次的定时器真的被取消了（否则它会提前把新提示收走）",
   !sandboxTimers.has(firstTimerId), "旧 id=" + firstTimerId);
ok("提示内容是最后一次操作的", /已压缩/.test(toastText()), toastText());
runSandboxTimers();

/* --- 样式契约：浮层，不挡点击，尊重减少动效 --- */
const toastBlock = (HTML.match(/\.toast\s*\{([\s\S]*?)\}/) || ["", ""])[1];
ok("提示是固定定位的浮层（不占文档流）", /position:\s*fixed/.test(toastBlock), JSON.stringify(toastBlock.slice(0, 40)));
ok("提示**不吃点击**（pointer-events: none，否则会挡住底下的按钮）",
   /pointer-events:\s*none/.test(toastBlock));
ok("提示默认是隐藏的（opacity 0 + visibility hidden）",
   /opacity:\s*0/.test(toastBlock) && /visibility:\s*hidden/.test(toastBlock));
const toastShowBlock = (HTML.match(/\.toast\.show\s*\{([\s\S]*?)\}/) || ["", ""])[1];
ok("露出来时 opacity 回到 1", /opacity:\s*1/.test(toastShowBlock), JSON.stringify(toastShowBlock));
ok("初始状态就是隐藏的（HTML 里的 class 只有 toast，没有 show）",
   /class="toast"\s+id="toast"/.test(HTML));

/* aria-live 容器必须**常驻 DOM** —— display:none 会让它停止播报，
   所以显隐走 visibility 而不是 display。 */
ok("提示是无障碍播报容器（role=status + aria-live），且常驻 DOM",
   /id="toast"[^>]*role="status"/.test(HTML) && /id="toast"[^>]*aria-live="polite"/.test(HTML));
ok("显隐用 visibility 而不是 display（否则 aria-live 停止播报）",
   /visibility:\s*hidden/.test(toastBlock) && !/display:\s*none/.test(toastBlock));

const rmBlock = (HTML.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/) || ["", ""])[1];
ok("尊重「减少动态效果」偏好：有专门的降级分支", /\.toast/.test(rmBlock), JSON.stringify(rmBlock.slice(0, 50)));
ok("降级分支里不做位移动画（只留淡出）",
   /translate\(-50%,\s*0\)/.test(rmBlock) && !/10px/.test(rmBlock));

/* --- 「状态栏不再为成功变色」这条从样式层也成立 --- */
ok("状态栏样式里已经没有 is-ok（成功态彻底不占状态栏）", !/\.status\.is-ok/.test(HTML));
ok("状态栏仍保留警告与错误两档语义色（该留的没被一起砍掉）",
   /\.status\.is-warn/.test(HTML) && /\.status\.is-error/.test(HTML));

/* ============================================================
 * [12] tokenize 词法器
 * ------------------------------------------------------------
 * 它必须是**词法器**而不是解析器：不判合法性、不抛异常。
 * 这是它能和 parseJson 长期共存的前提 —— 一旦它开始"判断什么算合法"，
 * 工具里就出现了两个判定源，早晚各说各话（所以它也**不参与报错定位**）。
 * ============================================================ */
console.log("\n[12] tokenize 词法器（不判合法性、不抛异常）");

const tokTypes = (src) => J.tokenize(src).filter((t) => t.type !== "ws").map((t) => t.type).join(",");
ok("{}[]:, 都是 punct", tokTypes('{"a":1}') === "punct,string,punct,number,punct", tokTypes('{"a":1}'));
ok("true / false / null 是 literal",
   J.tokenize("[true,false,null]").filter((t) => t.type === "literal").map((t) => t.raw).join(",") === "true,false,null");
ok("负数带小数带指数算一个 number 整体",
   J.tokenize("[-2.5e3]").filter((t) => t.type === "number")[0].raw === "-2.5e3");
ok("raw 是原文切片（含引号、未解义）", J.tokenize('"a\\nb"')[0].raw === '"a\\nb"');
ok("空输入 → 空数组（不是 undefined、也不抛）", Array.isArray(J.tokenize("")) && J.tokenize("").length === 0);
ok("纯空白 → 只有一个 ws token", J.tokenize("  \n\t ").length === 1 && J.tokenize("  \n\t ")[0].type === "ws");
ok("每个 token 的 start/end 能原样切回 raw", (() => {
  const s = '{"a": 1}';
  return J.tokenize(s).every((t) => s.slice(t.start, t.end) === t.raw);
})());

/* 最要紧的一条：**多烂的输入都不许抛**。
   词法器一旦抛异常，将来高亮就会把整个输出区变成白屏 —— 而它本来只是个装饰。 */
const nastyInputs = ['{"a":"unclosed', "}{][:", "'single'", "NaN", "//comment", "\u0000",
                     '{"a":1,,,}', "[[[[", "1e", "-", "\uD800"];
let firstThrow = null;
try { nastyInputs.forEach((s) => J.tokenize(s)); } catch (e) { firstThrow = e.message; }
ok("★ 各种畸形输入都不抛异常（词法器不是校验器）", firstThrow === null, String(firstThrow));
ok("未闭合字符串也照给 string token，不中断扫描",
   J.tokenize('{"a":"unclosed').filter((t) => t.type !== "ws")[3].type === "string",
   J.tokenize('{"a":"unclosed').map((t) => t.type).join(","));

/* ============================================================
 * [13] 重复键检测（核心）
 * ------------------------------------------------------------
 * JSON 规范**允许**重复键，而 JSON.parse 会**静默只保留最后一个**。
 * 所以这是警告、不是错误：不改 parseJson 的判定，也不拦任何操作。
 * ============================================================ */
console.log("\n[13] 重复键检测（核心）");
const dupKeyNames = (s) => J.findDuplicateKeys(s).map((d) => d.key);
ok("同一对象里同名键 → 命中", dupKeyNames('{"a":1,"a":2}').join(",") === "a");
ok("不同名 → 不命中", J.findDuplicateKeys('{"a":1,"b":2}').length === 0);
ok("大小写敏感（a 与 A 是不同键）", J.findDuplicateKeys('{"a":1,"A":2}').length === 0);
ok("★ 数组里的重复**值**不算重复键", J.findDuplicateKeys("[1,1,1]").length === 0);
ok("★ 数组里的重复字符串也不算（那不是键）", J.findDuplicateKeys('["a","a"]').length === 0);
ok("值里的同名不算（{\"a\":\"a\"}）", J.findDuplicateKeys('{"a":"a"}').length === 0);
ok("嵌套内重复能抓到", dupKeyNames('{"a":{"x":1,"x":2}}').join(",") === "x");
ok("层级不同、键名相同 → 不算重复", J.findDuplicateKeys('{"a":{"x":1},"b":{"x":2}}').length === 0);
ok("三层嵌套也能抓到", dupKeyNames('{"a":{"b":{"c":1,"c":2}}}').join(",") === "c");

/* ★ 键必须先**解义**再比：JSON 里 "a" 与 "\u0061" 是同一个键，
   parseJson 会把它们并成一个，检测器跟不上就是漏报。 */
ok('★ 转义键等价：{"a":1,"\\u0061":2} → 命中', dupKeyNames('{"a":1,"\\u0061":2}').join(",") === "a");

/* ★ 差点重蹈 sortKeysDeep 的覆辙：用普通 {} 当"已见键"表时，key 为 "__proto__"
   会命中原型 setter → **静默漏报**。必须用 Object.create(null) 才挡得住。 */
ok('★ 键名 "__proto__" 不会被静默漏报', dupKeyNames('{"__proto__":1,"__proto__":2}').join(",") === "__proto__");

ok("给出 1 基的行列位置", (() => {
  const d = J.findDuplicateKeys('{"a":1,"a":2}')[0];
  return d.line === 1 && d.column === 8;
})(), JSON.stringify(J.findDuplicateKeys('{"a":1,"a":2}')[0]));
ok("多行输入的行号列号算对", (() => {
  const d = J.findDuplicateKeys('{\n  "a": 1,\n  "a": 2\n}')[0];
  return d.line === 3 && d.column === 3;
})(), JSON.stringify(J.findDuplicateKeys('{\n  "a": 1,\n  "a": 2\n}')[0]));
ok("键与冒号之间有空白也认", J.findDuplicateKeys('{"a" : 1, "a" : 2}').length === 1);
ok("未闭合的输入不抛异常（词法器不判合法性）", (() => {
  try { J.findDuplicateKeys('{"a":1,"a'); return true; } catch (e) { return false; }
})());
ok("decodeJsonString 解常见转义", J.decodeJsonString('"\\n\\t"') === "\n\t");
ok("decodeJsonString 解 \\uXXXX", J.decodeJsonString('"\\u0061"') === "a");
ok("decodeJsonString 对非法转义原样保留（不抛）", J.decodeJsonString('"\\q"') === "\\q");

/* ============================================================
 * [14] 重复键在界面上是「警告」不是「错误」
 * ------------------------------------------------------------
 * 判定不能只停在核心函数上 —— 真正决定体验的是它挂在哪儿。
 * 按工具既定分工：会自己消失的浮层只放"做成了"，
 * 警告/错误一律留状态栏（重复键属于"做成了，但请你注意"）。
 * ============================================================ */
console.log("\n[14] 重复键检测的界面表现");

runSandboxTimers();                      // 先让上一条提示退场，才能确认这次没弹新的
el("input").value = '{"a":1,"a":2}';
el("btnFormat").dispatch("click");
ok("含重复键 → 状态栏是警告态（is-warn）而不是成功态", /is-warn/.test(statusCls()), statusCls());
ok("含重复键 → **不**弹会消失的提示（警告必须留住让人看完）", toastShown() === false, toastCls());
ok("警告文案说明了「只保留最后一个」", /只保留最后一个/.test(statusText()), JSON.stringify(statusText()));
ok("警告文案点出了第一个重复键的行列", /第 1 行第 8 列/.test(statusText()), JSON.stringify(statusText()));
ok("结果区照样正常产出（重复键只警告、不拦操作）",
   /\n {2}"a": 2/.test(el("output").textContent), JSON.stringify(el("output").textContent));

/* 无重复键时要回到「成功走浮层」的老样子，别把警告挂成常驻 */
runSandboxTimers();
el("input").value = '{"a":1,"b":2}';
el("btnFormat").dispatch("click");
ok("无重复键 → 照旧弹成功提示", toastShown() === true, toastCls());
ok("无重复键 → 状态栏不留警告", !/is-warn/.test(statusCls()), statusCls());

/* 两种告警同时命中时都要说到 —— 否则修完一个才发现还有一个 */
runSandboxTimers();
el("input").value = '{"id":1234567890123456789,"id":2}';
el("btnFormat").dispatch("click");
ok("大整数 + 重复键同时命中 → 两条告警都在状态栏里",
   /悄悄改写/.test(statusText()) && /只保留最后一个/.test(statusText()), JSON.stringify(statusText()));

/* 「只校验」也要报重复键 —— 用户按这个按钮就是来查数据问题的 */
runSandboxTimers();
el("input").value = '{"a":1,"a":2}';
el("btnValidate").dispatch("click");
ok("「只校验」也能发现重复键", /is-warn/.test(statusCls()) && /只保留最后一个/.test(statusText()),
   statusCls() + " | " + statusText());

/* ============================================================
 * [15] 输出区高亮与缩进参考线（B2）
 * ------------------------------------------------------------
 * 输出区从 <textarea> 换成了 <pre>：要高亮就得能往里装元素。
 * 这一换带来两类风险，本段就是守它们的：
 *   ① **文本会不会被渲染改坏** —— 复制与下载都读 textContent，
 *      渲染层一旦吞掉/多加一个字符，用户拿到的就是错的结果；
 *   ② **数据会不会变成结构** —— 高亮要往 DOM 里塞东西，
 *      而字符串里可能带 `</span><img onerror=…>`。
 *
 * 断言一律走**节点树**（桩的 _nodes 就是为这个留的），不靠整串 HTML 搜关键词。
 * ============================================================ */
console.log("\n[15] 输出区高亮与缩进参考线");

/* 桩把子节点放在 _nodes 上，这里封装两个遍历器；
   文本节点是「只有 textContent 的对象」，用 typeof 过滤掉。 */
function walkNodes(node, fn) {
  fn(node);
  (node._nodes || []).forEach((n) => { if (n && typeof n === "object") walkNodes(n, fn); });
}
function nodesWithClass(cls) {
  const hits = [];
  walkNodes(el("output"), (n) => { if (n._cls && n._cls.has(cls)) hits.push(n); });
  return hits;
}
const classText = (cls) => nodesWithClass(cls).map((n) => n.textContent);
const renderInto = (src, indent) => {
  runSandboxTimers();
  el("indent").value = indent || "2";
  el("input").value = src;
  el("btnFormat").dispatch("click");
};

/* ---------- ① 文本无损：渲染后拿回来的必须与源文本逐字节相同 ---------- */
const srcNested = '{"b":2,"a":{"c":[1,2],"d":true,"e":null}}';
const expectedNested = J.formatJson(srcNested, "2").value;
renderInto(srcNested, "2");
ok("★ 高亮渲染之后 textContent 与格式化结果**逐字节相同**（缩进不能丢）",
   el("output").textContent === expectedNested,
   JSON.stringify(el("output").textContent));

/* 上面那条是「整体相等」，容易被"两边一起错"骗过；这里正面钉一句缩进确实在 */
ok("★ 缩进空格没有在渲染时被吞掉（复制/下载读的就是它）",
   /\n {2}"b": 2/.test(el("output").textContent), JSON.stringify(el("output").textContent));

/* 4 空格与 Tab 各来一遍 —— 缩进单位不同，切段逻辑走的是不同分支 */
const expected4 = J.formatJson(srcNested, "4").value;
renderInto(srcNested, "4");
ok("缩进 4 空格：渲染后仍逐字节相同", el("output").textContent === expected4);

const expectedTab = J.formatJson(srcNested, "tab").value;
renderInto(srcNested, "tab");
ok("缩进 Tab：渲染后仍逐字节相同（\\t 也要原样保留）",
   el("output").textContent === expectedTab && /\n\t"b": 2/.test(el("output").textContent));

/* 压缩成一行时没有行首空白，参考线必须是 0 条（不能凭空画线） */
runSandboxTimers();
el("input").value = srcNested;
el("btnMinify").dispatch("click");
ok("压缩成一行 → 一条缩进参考线都不画", nodesWithClass("ind").length === 0);
ok("压缩成一行 → 文本仍逐字节相同", el("output").textContent === J.minifyJson(srcNested).value);

/* ---------- ② 高亮结构：类型对了才算高亮对了 ---------- */
renderInto('{"n":123,"s":"hi","t":true,"f":false,"z":null}', "2");
ok("数字套 tok-number", classText("tok-number").join(",") === "123", classText("tok-number").join(","));
ok("字符串值套 tok-string", classText("tok-string").join(",") === '"hi"', classText("tok-string").join(","));
ok("true / false / null 都套 tok-literal",
   classText("tok-literal").join(",") === "true,false,null", classText("tok-literal").join(","));
ok("括号与冒号套 tok-punct", classText("tok-punct").includes("{") && classText("tok-punct").includes(":"),
   classText("tok-punct").join(""));

/* ★ 键名与字符串值要分开着色 —— 判据只能是「后面紧跟冒号」。
   这条同时排掉两类不是键的字符串：数组元素、以及对象里的值。 */
renderInto('{"k":"v"}', "2");
ok('★ 键 "k" 归 tok-key、值 "v" 归 tok-string（不是同一个色）',
   classText("tok-key").join(",") === '"k"' && classText("tok-string").join(",") === '"v"',
   "key=" + classText("tok-key").join(",") + " string=" + classText("tok-string").join(","));

renderInto('{"a":["x","y"]}', "2");
ok('★ 数组里的字符串是 tok-string 而不是 tok-key（数组元素不是键）',
   classText("tok-key").join(",") === '"a"' && classText("tok-string").join(",") === '"x","y"',
   "key=" + classText("tok-key").join(",") + " string=" + classText("tok-string").join(","));

renderInto('{"a":1,"b":{"c":2}}', "2");
ok("键名个数与嵌套层数一致（每层各算各的键）", classText("tok-key").join(",") === '"a","b","c"',
   classText("tok-key").join(","));

/* ---------- ③ 缩进参考线：条数由**层数**决定，与缩进单位无关 ---------- */
const countInd = () => nodesWithClass("ind").length;
renderInto('{"a":{"b":1}}', "2");
const ind2 = countInd();
renderInto('{"a":{"b":1}}', "4");
const ind4 = countInd();
/* 该输入格式化后每层的行首缩进分别是 0 / 1 / 2 / 1 / 0 层 → 合计 4 条 */
ok("★ 缩进参考线条数 = 各行缩进层数之和（2 空格时 4 条）", ind2 === 4, String(ind2));
ok("★ 换成 4 空格缩进，参考线条数不变（层数没变，只是每层更宽）", ind4 === ind2,
   `2 空格 ${ind2} 条 vs 4 空格 ${ind4} 条`);

renderInto('{"a":{"b":1}}', "tab");
ok("Tab 缩进：一个 \\t 算一层，条数与 2 空格一致", countInd() === ind2, String(countInd()));

/* 参考线要**包着原始空白**，不是空壳 —— 否则 textContent 又会丢缩进 */
ok("★ 每条参考线的内容就是那段空白原文（不是空 span）",
   nodesWithClass("ind").every((n) => n.textContent === "  " || n.textContent === "\t"),
   JSON.stringify(nodesWithClass("ind").map((n) => n.textContent)));

/* 顶层不缩进的行不该被画线：`{` 与 `}` 各自 0 条 */
renderInto("{}", "2");
ok("空对象只有顶层、不画参考线", countInd() === 0, String(countInd()));

/* ---------- ④ XSS：数据不许变成结构 ---------- */
const XSS = '{"k":"</span><img src=x onerror=alert(1)>"}';
created.length = 0;      // 只看这一次渲染造了什么，别把前面几百个节点也算进来
renderInto(XSS, "2");
const madeTags = created.map((c) => c.tagName);
ok("★ 字符串里的标签没有变成真元素（只造 span / 不造 img）",
   !madeTags.includes("IMG"), madeTags.join(","));
ok("★ 造出来的元素上没有 on* 属性（属性级断言，不靠搜关键词）",
   created.every((c) => Object.keys(c._attrs || {}).every((k) => !/^on/i.test(k))),
   JSON.stringify(created.map((c) => Object.keys(c._attrs || {}))));
ok("★ 危险内容原样留在文本里（既没被吞、也没被解成标签）",
   el("output").textContent.includes("<img src=x onerror=alert(1)>"),
   JSON.stringify(el("output").textContent));

/* ---------- ⑤ 超大输出退回纯文本 ---------- */
/* 注意走 UI.* 而不是 J.*：高亮阈值是在 UI 层（`if (typeof document === "undefined") return;`
   之后）才挂到 API 上的，只注入 DOM 的那个沙箱有它。J 是「不注入 document」的纯核心沙箱。 */
ok("高亮阈值是 128 KB（暴露给测试，避免两边各写一份数字）", UI.HL_MAX_BYTES === 128 * 1024,
   String(UI.HL_MAX_BYTES));
runSandboxTimers();
el("input").value = '{"big":"' + "x".repeat(UI.HL_MAX_BYTES + 200) + '"}';
el("btnFormat").dispatch("click");
ok("超过阈值 → 不建任何 token / 参考线节点（节点太多会卡）",
   nodesWithClass("ind").length === 0 && nodesWithClass("tok-string").length === 0);
ok("★ 超过阈值 → **文本照样完整**（退的只是着色，不是结果）",
   el("output").textContent === J.formatJson(el("input").value, "2").value);

/* ---------- ⑥ Ctrl+A 限定在输出区 ---------- */
/* <pre> 的 Ctrl+A 默认全选整页（会把按钮文字也复制进去）。
   原来 textarea 只选自己 —— 这条断言守的就是「别把这个行为弄丢」。 */
rangeLog.length = 0; selLog.ranges = [];
/* 变量名统一加 ca 前缀：本文件前面（Ctrl+Enter / Tab 那两段）已经用过 prevented 了 */
const pressOnOutput = (ev) => {
  let caPd = false;
  el("output").dispatch("keydown", Object.assign({ preventDefault() { caPd = true; } }, ev));
  return caPd;
};
let caPd = pressOnOutput({ key: "a", ctrlKey: true, altKey: false, shiftKey: false });
ok("Ctrl+A → 选区被限定为输出区的内容", rangeLog.length === 1 && rangeLog[0].node === el("output"),
   `rangeLog=${rangeLog.length}`);
ok("Ctrl+A → 选区被真正换成了这一个 Range", selLog.ranges.length === 1 && selLog.ranges[0] === rangeLog[0]);
ok("Ctrl+A → 拦下了浏览器默认的「全选整页」", caPd === true);

rangeLog.length = 0;
caPd = pressOnOutput({ key: "a", ctrlKey: false, altKey: false, shiftKey: false });
ok("光按 a（没有 Ctrl）→ 不拦、不动选区", rangeLog.length === 0 && caPd === false);

rangeLog.length = 0;
caPd = pressOnOutput({ key: "a", ctrlKey: true, altKey: true, shiftKey: false });
ok("Ctrl+Alt+A（macOS 上是特殊字符输入）→ 让路，不拦", rangeLog.length === 0 && caPd === false,
   `rangeLog=${rangeLog.length} preventDefault=${caPd} handler数=${(el("output")._handlers.keydown || []).length}`);

rangeLog.length = 0;
caPd = pressOnOutput({ key: "c", ctrlKey: true, altKey: false, shiftKey: false });
ok("Ctrl+C → 不拦（复制走的还是浏览器原生那条）", rangeLog.length === 0 && caPd === false);

console.log("\n================================");
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail) process.exitCode = 1;
