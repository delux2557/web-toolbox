/* ============================================================
 * extract.test.mjs — url-helper 的零依赖回归测试
 * ------------------------------------------------------------
 * 跑法：node tools/url-helper/tests/extract.test.mjs   （退出码 0 / 1）
 *
 * 和 json-format 一样，测的就是交付物本身：把 index.html 里的
 * 解码核心（safeDecodeOnce / decodeAll / extractViewlet）原样抠出来，
 * 在 vm 沙箱里跑一遍再断言。不存在"测试版 / 生产版"两份会漂移的代码。
 *
 * 之所以要抠而不是整段跑：这个 HTML 的脚本在核心之后紧接着 DOM 操作，
 * 换个能跑完整段的 DOM 桩只会把测试写成一场表演，不如精确切核心。
 * 切片的两个边界下面的 [0] 会显式断言，谁改了标记这里立刻红。
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
 * [0] 切片边界
 * ============================================================ */
console.log("\n[0] 从交付物里切出解码核心");
const START = "const MAX_DECODE = 10;";
const END = "/* ---------- 导入示例：示例数据常量 ---------- */";
const s = HTML.indexOf(START), e = HTML.indexOf(END);
ok("找到核心起点（const MAX_DECODE）", s >= 0);
ok("找到核心终点（导入示例注释）", e > s);
const CORE = HTML.slice(s, e);
ok("核心片段含 normalizeInput / safeDecodeOnce / decodeAll / extractViewlet / analyzeOne",
   ["normalizeInput", "safeDecodeOnce", "decodeAll", "extractViewlet", "analyzeOne"]
     .every(fn => new RegExp("function " + fn + "\\b").test(CORE)));

const sandbox = { console };
vm.createContext(sandbox);
let loadError = null;
try { vm.runInContext(CORE + "\n;globalThis.__api = { normalizeInput, safeDecodeOnce, decodeAll, extractViewlet, analyzeOne };", sandbox); }
catch (err) { loadError = err; }
ok("核心片段可执行", !loadError, loadError && loadError.message);
const { normalizeInput, analyzeOne, decodeAll } = sandbox.__api || {};
ok("拿到核心函数", !!(normalizeInput && analyzeOne && decodeAll));

/* 一律走 UI 用的同一条入口 analyzeOne()，不下探子函数 */
const path = (raw) => analyzeOne(raw).path;

/* ============================================================
 * [1] 真实事故：值里的 %20 曾被截断成半截路径
 * ------------------------------------------------------------
 * 现场是一条生产环境的帆软决策链接，viewlet 里带 3 个空格。
 * 为免把生产地址与报表路径写进仓库，这里用等形脱敏数据（demo/retail/2026Q1 sales summary draft）。
 * 旧实现从"最解码的一层"开始匹配 + 正则排除 \s → 只返回 .../retail/2026Q1。
 * ============================================================ */
console.log("\n[1] 真实事故：%20 变成空格后不能被截断");
const REAL = "https://example.com:4434/webroot/decision/view/form?viewlet=demo/retail/2026Q1%20sales%20summary%20draft.cpt&user=10000001&appid=20240101000000&site=&skin=skin1&fine_digital_signature=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig";
const REAL_EXPECT = "demo/retail/2026Q1 sales summary draft.cpt";
ok("完整路径（含 3 个空格）原样返回", path(REAL) === REAL_EXPECT, JSON.stringify(path(REAL)));
ok("值里的空格必须保留，不能被当成分隔符",
   path(REAL).indexOf("2026Q1 sales summary draft.cpt") > 0);

/* ============================================================
 * [2] 多层编码：值的二次解码
 * ============================================================ */
console.log("\n[2] 多层编码");
ok("%252F → /（示例里的单条链接）",
   path("https://example.com/WebReport/ReportServer?viewlet=%252Fdemo%252Fsales%252Fmonthly.frm")
   === "/demo/sales/monthly.frm");
ok("%25252F → /（三层）",
   path("https://example.com/WebReport/ReportServer?reportlet=%25252Fdemo%25252Fanalysis%25252Fyearly.cpt")
   === "/demo/analysis/yearly.cpt");
ok("中文名解码不乱码",
   path("https://x/y?viewlet=%25E9%2594%2580%25E5%2594%25AE%25E6%258A%25A5%25E8%25A1%25A8.cpt") === "销售报表.cpt",
   JSON.stringify(path("https://x/y?viewlet=%25E9%2594%2580%25E5%2594%25AE%25E6%258A%25A5%25E8%25A1%25A8.cpt")));

/* ============================================================
 * [3] 值的边界：分隔符只有 & 和 #
 * ============================================================ */
console.log("\n[3] 值的边界");
ok("值里的 %26（编码过的 &）不被当参数分隔符",
   path("https://x/y?viewlet=a%26b.cpt&user=1") === "a&b.cpt",
   JSON.stringify(path("https://x/y?viewlet=a%26b.cpt&user=1")));
ok("值在 # 前结束",
   path("https://x/y?viewlet=a.cpt#frag") === "a.cpt");
ok("viewlet 不是第一个参数也能取到",
   path("https://x/y?user=1&viewlet=DATABASE/A%20B.cpt&skin=s1") === "DATABASE/A B.cpt");
ok("参数名大小写不敏感",
   path("https://x/y?VIEWLET=A/B.cpt") === "A/B.cpt");

/* ============================================================
 * [4] 整条 URL 被编码：值在解码后才带真空格
 * ============================================================ */
console.log("\n[4] 整条 URL 被编码");
ok("只解码到第 1 层就出现真空格，也要拿全",
   path("https%3A%2F%2Fx%2Fy%3Fviewlet%3DDATABASE%2FA%20B%20C.cpt%26user%3D1")
   === "DATABASE/A B C.cpt",
   JSON.stringify(path("https%3A%2F%2Fx%2Fy%3Fviewlet%3DDATABASE%2FA%20B%20C.cpt%26user%3D1")));

/* ============================================================
 * [5] 不伪造结果
 * ============================================================ */
console.log("\n[5] 没有就是没有");
ok("无 viewlet / reportlet → 空串", path("https://x/y?user=1") === "");
ok("空值 viewlet= → 空串（不返回 '&user' 之类的垃圾）", path("https://x/y?viewlet=&user=1") === "");
ok("纯文本 → 空串", path("这只是一个普通字符串，没有参数") === "");
ok("空输入不抛错", path("") === "");

/* ============================================================
 * [6] decodeAll 的定点保护
 * ============================================================ */
console.log("\n[6] decodeAll");
const d1 = decodeAll("https://x/y?viewlet=%252Fdemo%252Fa.cpt");
ok("steps 从原始输入开始，逐层追加", d1.steps[0].indexOf("%252F") > 0 && d1.steps.length >= 2);
ok("final 是不再含 %XX 的那一层", !/%[0-9a-fA-F]{2}/.test(d1.final), d1.final);
ok("无编码时只有 1 层", decodeAll("https://x/y?viewlet=a.cpt").steps.length === 1);
const lone = decodeAll("https://x/y?viewlet=100%.cpt");
ok("畸形 %（非法转义）不抛错，返回可用的结果", typeof lone.final === "string" && lone.final.length > 0);

/* ============================================================
 * [7] HTML 实体与 + 号口径
 * ------------------------------------------------------------
 * 链接从网页源码 / 邮件 / 富文本里复制出来时，& 常被写成 &amp;。
 * 旧实现里 [?&]viewlet= 直接匹配不上（中间隔着 "amp;"），
 * 结果是静默返回空串 —— 用户看到的是"未识别到参数"，比报错更难查。
 * ============================================================ */
console.log("\n[7] HTML 实体与 + 号");
ok("&amp; 形态能正常取出路径",
   path("https://x/y?a=1&amp;viewlet=A%20B.cpt") === "A B.cpt",
   JSON.stringify(path("https://x/y?a=1&amp;viewlet=A%20B.cpt")));
ok("viewlet 后面跟 &amp; 也不影响截断位置",
   path("https://x/y?viewlet=A%252FB.cpt&amp;user=1") === "A/B.cpt");
ok("&#38; 数字实体同样还原",
   path("https://x/y?a=1&#38;viewlet=A%20B.cpt") === "A B.cpt");
ok("两层转义 &amp;amp; 也能还原",
   path("https://x/y?a=1&amp;amp;viewlet=A.cpt") === "A.cpt");
ok("无需改动的输入原样返回（不做多余变换）",
   normalizeInput("https://x/y?viewlet=A%20B.cpt") === "https://x/y?viewlet=A%20B.cpt");
ok("其他实体不碰（&lt; 之类留给别人）",
   normalizeInput("https://x/y?a=%26lt%3B&amp;b=1") === "https://x/y?a=%26lt%3B&b=1");
ok("值里的 + 按表单约定当空格（与 param-analysis 同口径）",
   path("https://x/y?viewlet=Q1+retail+sales.cpt") === "Q1 retail sales.cpt",
   JSON.stringify(path("https://x/y?viewlet=Q1+retail+sales.cpt")));
ok("字面加号 %2B 保持 +",
   path("https://x/y?viewlet=Q1%2Bretail.cpt") === "Q1+retail.cpt");
const n1 = analyzeOne("https://x/y?a=1&amp;viewlet=A.cpt");
ok("输入被规范化过时，raw 与 steps[0] 不同（UI 靠这个标注提示）", n1.raw !== n1.steps[0]);
const n2 = analyzeOne("https://x/y?viewlet=A.cpt");
ok("普通输入不误报「已规范化」", n2.raw === n2.steps[0]);

/* ============================================================
 * [8] UI 冒烟：整段脚本在 DOM 桩里真跑一遍
 * ------------------------------------------------------------
 * 只测核心不够。脚本里还散着「隐式全局」的坑：用了 btnClearExample，
 * 却没写进 DOM 引用表 —— 浏览器靠「id 自动成为全局变量」的遗留行为兜着，
 * 换个运行环境（vm / 将来改成模块）就是加载即 ReferenceError、整页死掉；
 * 真实用户只看到"点了没反应"，比报错更难查。
 * 这条冒烟专门让这种"浏览器能跑、别处不能跑"的写法当场暴露。
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
try { vm.runInContext(blocks[1], ui.sb, { filename: "url-helper#app" }); } catch (e) { uiErr = e; }
ok("整段应用脚本能加载（不依赖『id 自动成为全局变量』）", !uiErr, uiErr && uiErr.message);
ok("加载后 doDecode 可用（说明脚本跑到底、没中途抛错）", typeof ui.sb.doDecode === "function");
if (!uiErr) {
  ui.reg.get("inputBox").value = REAL;
  ui.sb.doDecode();
  ok("UI 渲染出的路径与核心一致", ui.reg.get("pathValue").textContent === REAL_EXPECT,
     JSON.stringify(ui.reg.get("pathValue").textContent));
  const steps = ui.reg.get("stepList").children;
  ok("解码过程渲染 2 步（原始 + 1 层）", steps.length === 2, steps.length);
  ok("首步标签是『原始』", steps[0].children[0].textContent === "原始");
}

/* ============================================================
 * [9] 图标与文案卫生（交付物层面的约束）
 * ------------------------------------------------------------
 * 这节守的是"看得见但测不到"的两件事：
 *   ① 彩色 emoji 混进 UI。它与单色界面冲突，且各平台字形不同，
 *      属于"改完截图才发现"的那类问题。
 *   ② sprite 的 <use href="#x"> 指向不存在的 <symbol id="x">。
 *      这种错**不报错、不抛异常**，只是那个图标永远不显示 ——
 *      正是本仓库反复强调的"不报错但结果是错的"。
 * ============================================================ */
console.log("\n[9] 图标与文案卫生");

/* 判据用 Unicode 属性 `\p{Emoji_Presentation}`（"默认就以彩色 emoji 渲染"），
   不要手写码位区间 —— 手写的那版漏掉了 U+23F3 ⏳，让 table-helper 的"解析中"
   一路带着彩色 emoji 没被发现。⚠ ★ ✓ ✗ ↺ 天然属于"文本呈现"，不会被误伤。
   FE0F 另禁：它把 ⚠ 这类文本符号"升级"成彩色呈现。 */
const EMOJI = /\p{Emoji_Presentation}|\uFE0F/gu;
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

/* 图标只是装饰：按钮要么有自己的文字，要么有无障碍名称（aria-label / title）。
   顶部那两个纯图标按钮（提示 / 主题切换）走 aria-label 这条路，是合规的。 */
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
