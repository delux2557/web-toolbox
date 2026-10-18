/* ============================================================
 * analyze.test.mjs — param-analysis 的零依赖回归测试
 * ------------------------------------------------------------
 * 跑法：node tools/param-analysis/tests/analyze.test.mjs   （退出码 0 / 1）
 *
 * 与 url-helper / json-format 同一套路：把 index.html 里的解析核心
 * （normalizeInput / safeDecodeOnce / decodeAll / splitUrl / detectType / analyzeUrl）
 * 原样抠出来，在 vm 沙箱里跑交付物本身。
 *
 * 重点守住两件事：
 *   1) 「先按 & 切原始串、再逐值解码」这个顺序 —— 它是本工具没有 url-helper
 *      那个「%20 变空格后被截断」bug 的根本原因，顺序一旦被改成"先整串解码"，
 *      这里立刻红。
 *   2) 两个已知历史坑：&amp; 实体、整条 URL 被编码（无真 ?）。
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
 * [0] 切片 + 加载
 * ============================================================ */
console.log("\n[0] 从交付物里切出解析核心");
const START = "const MAX_DECODE = 10;";
const END = "/* ---------- 导入示例：示例数据常量 ---------- */";
const s = HTML.indexOf(START), e = HTML.indexOf(END);
ok("找到核心起点（const MAX_DECODE）", s >= 0);
ok("找到核心终点（导入示例注释）", e > s);
const CORE = HTML.slice(s, e);
ok("核心片段含全部解析函数",
   ["normalizeInput", "safeDecodeOnce", "decodeAll", "splitUrl", "detectType", "analyzeUrl"]
     .every(fn => new RegExp("function " + fn + "\\b").test(CORE)));

const sandbox = { console };
vm.createContext(sandbox);
let loadError = null;
try { vm.runInContext(CORE + "\n;globalThis.__api = { normalizeInput, decodeAll, splitUrl, detectType, analyzeUrl };", sandbox); }
catch (err) { loadError = err; }
ok("核心片段可执行", !loadError, loadError && loadError.message);
const { normalizeInput, analyzeUrl } = sandbox.__api || {};
ok("拿到核心函数", !!(normalizeInput && analyzeUrl));

const one = (u) => analyzeUrl(u);
const val = (u, key) => {
  const p = one(u).params.find(q => q.key === key);
  return p ? p.final : undefined;
};
/* 取值一律走这两个兜底 helper：断言失败时要报"值不对"，
   而不是因为 undefined 崩掉、把后面整段测试的结果都吞掉。 */
const P = (r, key) => r.params.find(p => p.key === key) || {};
const AT = (r, i) => r.params[i] || {};

/* ============================================================
 * [1] 真实事故 URL：值里的 %20 不能被截断
 * ------------------------------------------------------------
 * 这就是 url-helper 曾经翻车的那类链接（已换成等形脱敏数据，保留多空格特征）。
 * ============================================================ */
console.log("\n[1] 真实事故 URL");
const REAL = "https://example.com:4434/webroot/decision/view/form?viewlet=demo/retail/2026Q1%20sales%20summary%20draft.cpt&user=10000001&appid=20240101000000&site=&skin=skin1&fine_digital_signature=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig";
const EXPECT = "demo/retail/2026Q1 sales summary draft.cpt";
const r1 = one(REAL);
ok("viewlet 值完整（含 3 个空格）", val(REAL, "viewlet") === EXPECT, JSON.stringify(val(REAL, "viewlet")));
ok("参数个数 6（空值的 site 也算一个）", r1.params.length === 6, r1.params.length);
ok("协议 / 主机 / 端口 / 路径拆解正确",
   r1.parts.protocol === "https" && r1.parts.host === "example.com" &&
   r1.parts.port === "4434" && r1.parts.path === "/webroot/decision/view/form",
   JSON.stringify(r1.parts));
ok("viewlet 打了帆软标记", AT(r1, 0).fanruan === true);
ok("viewlet 层数为 1（确实解了一层）", AT(r1, 0).layers === 1, AT(r1, 0).layers);
ok("空值 site 被识别为 empty", P(r1, "site").type === "empty");
ok("签名参数原样保留（不误判成 Base64）",
   val(REAL, "fine_digital_signature") === "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig");

/* ============================================================
 * [2] 参数值边界：分隔符只认原始串里的 & 和 #
 * ============================================================ */
console.log("\n[2] 参数值边界");
ok("值里的 %26 不被当分隔符", val("https://x/y?viewlet=a%26b.cpt&user=1", "viewlet") === "a&b.cpt",
   JSON.stringify(val("https://x/y?viewlet=a%26b.cpt&user=1", "viewlet")));
ok("值里的 %26 不额外切出参数", one("https://x/y?viewlet=a%26b.cpt&user=1").params.length === 2);
ok("base64 的 == 填充不被截断", val("https://x/y?token=YWJjZGU=fg==&z=1", "token") === "YWJjZGU=fg==",
   JSON.stringify(val("https://x/y?token=YWJjZGU=fg==&z=1", "token")));
ok("值里的 %23 保留，hash 仍按真 # 切分",
   val("https://x/y?viewlet=A%23B.cpt#frag", "viewlet") === "A#B.cpt" && one("https://x/y?viewlet=A%23B.cpt#frag").parts.hash === "frag");
ok("值里的 %3F 保留，不影响 query 切分", val("https://x/y?viewlet=a%3Fb.cpt&z=1", "viewlet") === "a?b.cpt");
ok("值里的裸空格（没编码）也完整保留",
   val("https://x/y?viewlet=Q1 retail sales.cpt&x=1", "viewlet") === "Q1 retail sales.cpt");
ok("中文参数值不乱码",
   val("https://x/y?viewlet=%25E9%2594%2580%25E5%2594%25AE.cpt", "viewlet") === "销售.cpt");
ok("同名参数保留多行且都标 dup",
   one("https://x/y?a=1&a=2").params.length === 2 && one("https://x/y?a=1&a=2").params.every(p => p.dup));

/* ============================================================
 * [3] + 号口径（与 url-helper 统一为表单约定）
 * ============================================================ */
console.log("\n[3] + 号口径");
ok("裸 + → 空格", val("https://x/y?viewlet=Q1+retail+sales.cpt", "viewlet") === "Q1 retail sales.cpt");
ok("%2B → 字面 +", val("https://x/y?viewlet=Q1%2Bretail.cpt", "viewlet") === "Q1+retail.cpt");
ok("+ 号不影响层数统计（不算编码层）", AT(one("https://x/y?a=A+B"), 0).layers === 0);

/* ============================================================
 * [4] HTML 实体：&amp; 不能让参数名变成 amp;viewlet
 * ============================================================ */
console.log("\n[4] HTML 实体");
const g1 = one("https://x/y?a=1&amp;viewlet=A%20B.cpt");
ok("&amp; 形态：参数名是 viewlet，不是 amp;viewlet",
   g1.params.some(p => p.key === "viewlet") && !g1.params.some(p => p.key === "amp;viewlet"),
   JSON.stringify(g1.params.map(p => p.key)));
ok("&amp; 形态：参数个数正确（2 个）", g1.params.length === 2);
ok("&amp; 形态：帆软标记仍生效", P(g1, "viewlet").fanruan === true);
ok("&#38; 数字实体同样还原", one("https://x/y?a=1&#38;viewlet=A.cpt").params.length === 2);
ok("normalizeInput 不动其他实体",
   normalizeInput("https://x/y?a=%26lt%3B&amp;b=1") === "https://x/y?a=%26lt%3B&b=1");
ok("无需规范化的输入原样返回",
   normalizeInput("https://x/y?viewlet=A%20B.cpt") === "https://x/y?viewlet=A%20B.cpt");

/* ============================================================
 * [5] 整条 URL 被编码：必须兜底解一层，不能静默 0 参数
 * ============================================================ */
console.log("\n[5] 整条 URL 被编码");
const ENC = "https%3A%2F%2Fx%2Fy%3Fviewlet%3DA%20B.cpt%26user%3D1";
const f1 = one(ENC);
ok("标记了 autoDecoded（UI 靠它显示提示条）", f1.autoDecoded === true);
ok("解析出 2 个参数（不再是静默 0）", f1.params.length === 2, f1.params.length);
ok("值解码正确", P(f1, "viewlet").final === "A B.cpt");
ok("主机不再是一坨编码串", f1.parts.host === "x", f1.parts.host);
ok("原始串仍保留在 raw 里（导出/回显用）", f1.raw === ENC);
ok("普通 URL 不误报 autoDecoded", one("https://x/y?viewlet=A.cpt").autoDecoded === false);
ok("本来就没有查询串的 URL 不会被硬解", one("https://x/y/path").params.length === 0);

/* ============================================================
 * [6] 结构与统计
 * ============================================================ */
console.log("\n[6] 结构与统计");
const b = one("https://x/y/a/b?viewlet=%252Fdemo%252Fa.frm&ts=1700000000&data=%7B%22id%22%3A1%7D");
ok("多层编码层数 = 2", AT(b, 0).layers === 2, AT(b, 0).layers);
ok("多层编码值解到底", AT(b, 0).final === "/demo/a.frm", JSON.stringify(AT(b, 0).final));
ok("10 位时间戳识别为 ts", AT(b, 1).type === "ts");
ok("JSON 值识别为 json", AT(b, 2).type === "json");
ok("stats.total 与参数数一致", b.stats.total === b.params.length);
ok("stats.nested 统计嵌套类型（JSON 计入）", b.stats.nested === 1, b.stats.nested);
ok("stats.encoded 统计解过码的参数", b.stats.encoded === 2, b.stats.encoded);
const rel = one("x/y?a=1");
ok("无协议相对路径也能拆（host=x, path=/y）", rel.parts.host === "x" && rel.parts.path === "/y",
   JSON.stringify(rel.parts));

/* ============================================================
 * [7] 不伪造
 * ============================================================ */
console.log("\n[7] 没有就是没有");
ok("空输入不抛错、0 参数", one("").params.length === 0);
ok("纯文本不抛错", one("这只是一句话").params.length === 0);
ok("? 后面为空 → 0 参数", one("https://x/y?").params.length === 0);

/* ============================================================
 * [8] UI 冒烟：整段脚本在 DOM 桩里真跑一遍
 * ------------------------------------------------------------
 * 除了"值对不对"，还有一类失效是"页面根本跑不起来"：脚本里若引用了
 * 没声明的 DOM 变量，浏览器会靠「id 自动成为全局变量」的遗留行为兜住，
 * 换个环境（vm / 将来改模块）就是加载即 ReferenceError。
 * 这类问题在真浏览器里表现为"点了没反应"，最难查，所以用桩把它钉住。
 * ============================================================ */
console.log("\n[8] UI 冒烟（DOM 桩）");
function makeNode(tag) {
  return {
    tagName: String(tag).toUpperCase(), textContent: '', value: '', hidden: false,
    className: '', title: '', dataset: {}, style: {}, colSpan: 0, type: '', children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, addEventListener() {}, setAttribute() {},
    getAttribute() { return null; }, select() {}, click() {}, focus() {},
    add(o) { this.children.push(o); },
  };
}
function makeSandbox() {
  const reg = new Map();
  const document = {
    documentElement: { setAttribute() {}, getAttribute() { return 'light'; } },
    body: makeNode('body'),
    getElementById(id) { if (!reg.has(id)) reg.set(id, makeNode('div')); return reg.get(id); },
    createElement(tag) { return makeNode(tag); },
    addEventListener() {},
  };
  const sb = {
    document, console,
    Option: function (text, value) { this.text = text; this.value = value; },
    navigator: {},
    window: { isSecureContext: false, matchMedia: () => ({ matches: false }), document },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout, clearTimeout,
    URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
    Blob: function () {},
  };
  vm.createContext(sb);
  return { sb, reg };
}
const blocks = [...HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
ok("页面有 2 个内联脚本块（主题前置 + 应用）", blocks.length === 2, blocks.length);
const ui = makeSandbox();
let uiErr = null;
try { vm.runInContext(blocks[1], ui.sb, { filename: "param-analysis#app" }); } catch (e) { uiErr = e; }
ok("整段应用脚本能加载（不依赖『id 自动成为全局变量』）", !uiErr, uiErr && uiErr.message);
ok("加载后 doAnalyze 可用（说明脚本跑到底、没中途抛错）", typeof ui.sb.doAnalyze === "function");
if (!uiErr) {
  ui.reg.get("inputBox").value = REAL;
  ui.sb.doAnalyze();
  ok("统计数字渲染正确（6 参数 / 1 个解过码）",
     ui.reg.get("statTotal").textContent === 6 && ui.reg.get("statEnc").textContent === 1,
     ui.reg.get("statTotal").textContent + "/" + ui.reg.get("statEnc").textContent);
  const rows = ui.reg.get("detailTable").children[1].children;
  ok("明细表渲染出 6 行", rows.length === 6, rows.length);
  ok("表里 viewlet 的解码后值是完整路径（空格没丢）", rows[0].children[3].textContent === EXPECT,
     JSON.stringify(rows[0].children[3].textContent));
  ok("普通链接不显示『已自动解码』提示条", ui.reg.get("autoNote").hidden === true);
}

/* ============================================================
 * [9] 图标与文案卫生（交付物层面的约束）
 * ------------------------------------------------------------
 * 守两件"看得见但逻辑测不到"的事：
 *   ① 彩色 emoji 混进 UI —— 与单色界面冲突，且各平台字形不同。
 *      ★ 只禁彩色 emoji 码位，不禁 ★ ⚠ ✓ ✗ 这些常驻注释与状态文案的单色符号。
 *   ② sprite 的 <use href="#x"> 指向不存在的 <symbol id="x"> ——
 *      这种错不报错、不抛异常，只是那个图标永远不显示。
 * ============================================================ */
console.log("\n[9] 图标与文案卫生");

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2B00}-\u{2BFF}\u{FE0F}\u{26AA}-\u{26AB}]/gu;
const emojiHits = [...HTML.matchAll(EMOJI)].map(m => m[0]);
ok("页面里没有彩色 emoji（会跟单色 UI 打架）", emojiHits.length === 0,
   emojiHits.length ? "残留: " + [...new Set(emojiHits)].join(" ") : "");

const symbols = new Set([...HTML.matchAll(/<symbol\s+id="(ic-[^"]+)"/g)].map(m => m[1]));
const uses = [...HTML.matchAll(/<use\s+href="#(ic-[^"]+)"/g)].map(m => m[1]);
ok("图标集里有 symbol 定义", symbols.size > 0, symbols.size);
ok("页面确实在用这些图标（use 引用）", uses.length > 0, uses.length);
const dangling = uses.filter(u => !symbols.has(u));
ok("每个 <use> 都指向存在的 <symbol>（否则图标静默消失）", dangling.length === 0,
   dangling.join(", "));

/* 表格「类型」列现在是纯文字：说明本身已经讲清类型，不再叠图标。 */
ok("类型识别不再返回 icon 字段（表格用文字说明）",
   !/icon:\s*['"]/.test(HTML), "detectType 里仍有 icon");

const btnTags = [...HTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
const namelessBtns = btnTags.filter(([, attrs, inner]) => {
  const text = inner.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/\s+/g, "");
  const named = /\b(aria-label|title)\s*=\s*"[^"]+"/.test(attrs);
  return text === "" && !named;
});
ok("没有「既无文字又无无障碍名称」的按钮", namelessBtns.length === 0,
   "无名称按钮 " + namelessBtns.length + " 个");

/* ============================================================ */
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
