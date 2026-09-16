/* ============================================================
 * wiring.mjs — 接线冒烟：main.js 真的跑完了吗？事件真挂上了吗？
 * ------------------------------------------------------------
 * 用一个「会记账」的 DOM 桩加载 main.js：
 *   - 每个 id 始终返回同一个对象（模拟真实 DOM）
 *   - 记录每个元素上挂过哪些事件
 *   - 捕获任何未处理异常 / console.error
 * 然后模拟点击 dropzone，检查 openRoot 是否真的被触发、
 * 以及在 showDirectoryPicker 抛 SecurityError 时用户能收到什么。
 * ============================================================ */

import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const listeners = new Map();     // id → Set(eventType)
const errors = [];
const logs = [];
const clickable = new Map();     // id → click handler

function makeEl(id) {
  const el = {
    id,
    style: {}, dataset: {}, hidden: false, value: "",
    checked: false, disabled: false, title: "", innerHTML: "", placeholder: "",
    _text: "",              // textContent 的真实存储
    childNodes: [],         // 真的会累积 —— 否则「节点里有没有东西」就测不出来
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(type, fn) {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(type);
      if (type === "click") clickable.set(id, fn);
    },
    removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    /* 语义等价于 DOM：设置 textContent 会清空子节点 */
    appendChild(n) {
      this.childNodes.push(n);
      if (n && typeof n.textContent === "string") this._text += n.textContent;
      return n;
    },
    prepend(n) { this.childNodes.unshift(n); if (n && typeof n.textContent === "string") this._text = n.textContent + this._text; return n; },
    remove() {},
    children: [],
    querySelector() { return null; }, querySelectorAll() { return []; },
    contains() { return false; }, focus() {}, select() {}, scrollIntoView() {},
    getBoundingClientRect() { return { width: 100, height: 100, top: 0, left: 0 }; }
  };
  Object.defineProperty(el, "textContent", {
    get() { return this._text; },
    set(v) { this._text = v == null ? "" : String(v); this.childNodes.length = 0; }
  });
  return el;
}

const registry = new Map();
function byId(id) {
  if (!registry.has(id)) registry.set(id, makeEl(id));
  return registry.get(id);
}

globalThis.document = {
  getElementById: byId,
  createElement: () => makeEl("(created)"),
  createElementNS: () => makeEl("(created)"),
  createTextNode: (s) => { const t = makeEl("(text)"); t.textContent = s == null ? "" : String(s); return t; },
  createDocumentFragment: () => makeEl("(frag)"),
  addEventListener() {}, removeEventListener() {},
  documentElement: { style: {}, getAttribute: () => "light", setAttribute() {}, dataset: {} },
  body: makeEl("body"), head: makeEl("head"),
  activeElement: null, documentMode: undefined
};

let pickerCalls = 0;
let pickerBehavior = "ok";       // 'ok' | 'security' | 'abort'
const toasts = [];

globalThis.window = {
  isSecureContext: true,
  addEventListener() {}, removeEventListener() {},
  /* 默认：顶层页面（self === top）。测试 iframe 场景时再改写 top */
  self: null, top: null,
  matchMedia: () => ({ matches: false }),
  CSS: { escape: (s) => s },
  showDirectoryPicker: async (opts) => {
    pickerCalls++;
    if (pickerBehavior === "abort") { const e = new Error("user aborted"); e.name = "AbortError"; throw e; }
    if (pickerBehavior === "security") {
      const e = new Error("Failed to execute 'showDirectoryPicker' on 'Window': Cross origin sub frames aren't allowed to show a file picker.");
      e.name = "SecurityError";
      throw e;
    }
    return { name: "demo-project", values: async function* () {} };
  }
};
globalThis.window.self = globalThis.window;
/* 默认顶层；--embedded 时模拟「被跨域 iframe 嵌着」，用于验证 boot 阶段的主动告警 */
const EMBEDDED = process.argv.includes("--embedded");
globalThis.window.top = EMBEDDED ? { name: "top" } : globalThis.window;

/* 真实页面一定有 location；用占位地址即可，测试只关心 href 可读 */
globalThis.location = {
  href: "http://127.0.0.1:8777/tools/code-workspace/V1/index.html",
  origin: "http://127.0.0.1:8777", protocol: "http:", host: "127.0.0.1:8777"
};

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.KeyboardEvent = class {};

/* Node 自身的运行时警告会经由 console.error 混进 errors，而它们**不是代码缺陷**：
   本项目的 V1/src/*.js 是给浏览器 <script type="module"> 用的 ESM，Node 在祖先目录
   缺少 package.json "type":"module" 时会对每个 .js 发一次 MODULE_TYPELESS_PACKAGE_JSON
   警告 —— 换句话说，同一份代码换个目录跑就可能多出/少掉这条警告。
   本测试要守的契约是「点击路径有没有抛未捕获异常」，所以这类噪音必须滤掉，
   否则测试结果会取决于「跑在哪个目录下」，那就成了假信号。
   另：给 process 挂上任意 warning 监听器后，Node 就不再打印默认警告。 */
const NODE_NOISE = /MODULE_TYPELESS_PACKAGE_JSON|^\(node:\d+\)|Warning:|ExperimentalWarning|DeprecationWarning/;
const realErrors = () => errors.filter((e) => !NODE_NOISE.test(e));
process.on("warning", () => {});

const realError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(" ")); };
console.warn = (...a) => { logs.push("warn: " + a.map(String).join(" ")); };
console.info = () => {};

process.on("unhandledRejection", (r) => errors.push("unhandledRejection: " + (r && r.stack ? r.stack : r)));

const HERE = dirname(fileURLToPath(import.meta.url));
/* 第一个**不以 -- 开头**的参数才是项目根；这样 `wiring.mjs --embedded`
   和 `wiring.mjs <根> --embedded` 两种写法都对。 */
const ROOT_ARG = process.argv.slice(2).find((a) => !a.startsWith("--"));
const BASE = pathToFileURL(resolve(ROOT_ARG || join(HERE, ".."))).href;

let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (extra ? "  → " + extra : ""))); };

console.log("\n[1] 加载 main.js（捕获加载期异常）");
let loadError = null;
try {
  await import(`${BASE}/V1/src/main.js`);
} catch (e) {
  loadError = e;
}
realError("");  // 占位，把 console.error 换回来前先清空
ok("main.js 模块加载无异常", !loadError, loadError && loadError.stack);
ok("加载期没有 console.error", realErrors().length === 0, realErrors().join(" | "));

console.log("\n[2] 关键事件是否真的挂上了");
const expectClick = ["dropzone", "openBtn", "btnReload", "btnNewFile", "btnNewFolder", "btnTrash", "btnSave", "btnRename", "btnMove", "btnNewFileHere", "btnSoftDelete", "themeToggle", "btnToggleInfo"];
const missing = expectClick.filter((id) => !(listeners.get(id) || new Set()).has("click"));
ok(`${expectClick.length} 个关键元素都挂了 click`, missing.length === 0, "未挂：" + missing.join(", "));

ok("treeSearch 挂了 input", (listeners.get("treeSearch") || new Set()).has("input"));
ok("noiseToggle 挂了 change", (listeners.get("noiseToggle") || new Set()).has("change"));

console.log("\n[3] 启动流程真的走完了（不是中途炸掉）");
const compat = byId("compatNote").textContent || "";
ok("compatNote 被写入（说明 boot 代码执行到了）", compat.length > 0, "实际：" + JSON.stringify(compat));
ok("dropzone 未被标记 disabled（本环境支持 FSA）", !byId("dropzone").classList.contains("disabled"));
ok("trashDirName 被写入 .cw-trash", byId("trashDirName").textContent === ".cw-trash");

if (EMBEDDED) {
  console.log("\n[3b] 嵌入 iframe 场景：用户还没点，boot 阶段就该先告警");
  ok("envWarn 在 boot 阶段已点亮（不用等用户点空按钮）", byId("envWarn").hidden === false,
     "如果这里是 false，用户点半天只会觉得「按钮坏了」");
  ok("compatNote 明确提示需要独立标签页", (byId("compatNote").textContent || "").includes("独立标签页"),
     "实际：" + JSON.stringify(byId("compatNote").textContent));
  ok("dropzone 保持可点（不假装 disabled —— 让用户点了能看到原因）",
     !byId("dropzone").classList.contains("disabled"));
}

console.log("\n[4] 模拟点击 dropzone —— 正常路径");
pickerBehavior = "ok";
const click = clickable.get("dropzone");
ok("取到了 dropzone 的 click handler", typeof click === "function");
if (typeof click === "function") {
  try { await click(); } catch (e) { errors.push("click threw: " + e.message); }
}
await new Promise((r) => setTimeout(r, 50));
ok("真的调用了 showDirectoryPicker", pickerCalls === 1, "调用次数 " + pickerCalls);
ok("点击路径无未捕获异常", realErrors().length === 0, realErrors().join(" | "));

console.log("\n[5] 模拟点击 dropzone —— SecurityError 路径（预览 iframe 的典型失败）");
pickerCalls = 0;
pickerBehavior = "security";
errors.length = 0;
/* 这个场景的前提就是「页面被跨域 iframe 嵌着」，所以要让 isEmbedded() 返回 true */
globalThis.window.top = { name: "top" };
if (typeof click === "function") {
  try { await click(); } catch (e) { errors.push("click threw: " + e.message); }
}
await new Promise((r) => setTimeout(r, 50));
ok("SecurityError 被 catch（没有冒泡成未捕获异常）", realErrors().length === 0, realErrors().join(" | "));
ok("调用了 showDirectoryPicker", pickerCalls === 1);

console.log("\n[6] SecurityError 时用户能看到什么（关键：是不是只靠 toast）");
/* 断言必须查「行为」，不能匹配中文文案 —— 文案一改测试就假阴（或假阳），
   而真正要保证的是：有一个**持久可见**的元素承载了失败信息。 */
const warnEl = byId("envWarn");
const warnVisible = warnEl.hidden === false;
const warnText = (warnEl.textContent || "").trim();
const warnChildren = warnEl.childNodes.length;
console.log("  · envWarn.hidden = " + warnEl.hidden);
console.log("  · envWarn 子节点数 = " + warnChildren + "，文本长度 = " + warnText.length);
console.log("  · dropzone 当前 class：" + ([...byId("dropzone").classList._s].join(" ") || "（空）"));
ok("持久告警卡 envWarn 被点亮", warnVisible);
ok("告警卡里有内容（不是空壳）", warnChildren > 0);
ok("解释里带上了真实异常名 SecurityError（可复制给运维看）", warnText.includes("SecurityError"));
const hasNewTabBtn = warnEl.childNodes.some((n) =>
  n && Array.isArray(n.childNodes) && n.childNodes.some((c) => c && typeof c.textContent === "string" && c.textContent.includes("在新标签页打开")));
ok("提供了「在新标签页打开」的动作按钮（因为处于 iframe 中）", hasNewTabBtn,
   "缺少动作按钮 → 用户知道失败了却不知道怎么救");

/* 收尾：还原成非嵌入，避免影响后续 */
globalThis.window.top = globalThis.window;

console.log("\n================================");
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail) process.exitCode = 1;
