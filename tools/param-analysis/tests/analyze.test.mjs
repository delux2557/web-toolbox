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
try { vm.runInContext(CORE + "\n;globalThis.__api = { normalizeInput, decodeAll, splitUrl, detectType, analyzeUrl, "
  + "jsonEntries, groupJsonEntries, isInfraKey, jsonTypeLabel, jsonEntryMatches, jsonValueText, jsonCopyText, "
  + "applyJsonFilter };", sandbox); }
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
/* 桩里的 classList 用真 Set 记账：只在「判断类名有没有加上」时才靠得住。
   className 仍单独存 —— 现有断言读的是 className 字符串，两者不强行对齐
   （生产代码对这几个类名只用 classList 增删，没有读写 className 的分支）。 */
function makeClassList() {
  const set = new Set();
  return {
    set,
    add(...cs) { cs.forEach(c => { if (c) set.add(c); }); },
    remove(...cs) { cs.forEach(c => set.delete(c)); },
    toggle(c, force) {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    contains(c) { return set.has(c); },
  };
}
function makeNode(tag) {
  return {
    tagName: String(tag).toUpperCase(), textContent: '', value: '', hidden: false,
    className: '', title: '', dataset: {}, style: {}, colSpan: 0, type: '', children: [],
    classList: makeClassList(),
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {},
    addEventListener(t, fn) { (this.__on || (this.__on = {}))[t] = fn; },
    setAttribute(k, v) { (this.__attrs || (this.__attrs = {}))[k] = v; },
    getAttribute(k) { return (this.__attrs || {})[k] ?? null; },
    querySelector(sel) {
      if (sel === 'span') return this.children.find(c => c.tagName === 'SPAN') || null;
      if (sel[0] === '.') {
        const cls = sel.slice(1);
        return this.children.find(c => String(c.className).split(/\s+/).includes(cls)) || null;
      }
      return null;
    },
    scrollIntoView() { this.__scrolled = (this.__scrolled || 0) + 1; },
    select() {}, click() {}, focus() {},
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

/* ============================================================
 * [10] JSON 参数：摊平 / 分组 / 过滤 / 面板渲染
 * ------------------------------------------------------------
 * 场景：`__parameters__` 这类参数解码后是几百字符的 JSON，整段铺进一个 <td>
 * 就是一团文本。这里守的是"能不能把它摊成键值、能不能把容器噪声分开"。
 *
 * ★ 分组规则是**启发式**正则，所以断言分两边都要钉：
 *   既要有「该收的收进去了」，也要有「不该误伤的没被误伤」（尤其 FINEMARKID
 *   和 FINE_DIGITAL_SIGNATURE 只差一个下划线）。
 * ============================================================ */
console.log("\n[10] JSON 参数：摊平 / 分组 / 过滤");

const api = sandbox.__api || {};
const je = api.jsonEntries, gj = api.groupJsonEntries, ii = api.isInfraKey;
const jt = api.jsonTypeLabel, jm = api.jsonEntryMatches, jv = api.jsonValueText;
const applyJsonFilter = api.applyJsonFilter;

ok("核心片段导出了 JSON 处理函数",
   [je, gj, ii, jt, jm, jv, applyJsonFilter].every(f => typeof f === "function"));

/* 等形脱敏的 JSON 参数包：7 个业务键 + 5 个容器噪声键，含各类型值 */
const JSON_OBJ = {
  stagename: "StageA",
  date_time: "2026-10-19",
  USER: "10000001",
  APPID: "20240101000000",
  SITE: "",
  flag: true,
  n: 42,
  __pi__: true,
  REF_T: "design",
  "JAVAX.SERVLET.REQUEST.CIPHER_SUITE": "TLS_AES_128_GCM_SHA256",
  "ORG.APACHE.TOMCAT.UTIL.NET.SECURE_PROTOCOL_VERSION": "TLSv1.3:TLS",
  FINE_DIGITAL_SIGNATURE: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig"
};
const JSON_KEYS = Object.keys(JSON_OBJ);
const JSON_URL = "https://example.com:4434/webroot/decision/view/form"
  + "?viewlet=demo%2Fretail%2Fa%2520b.cpt"
  + "&__parameters__=" + encodeURIComponent(encodeURIComponent(JSON.stringify(JSON_OBJ)));

/* --- 摊平 --- */
const eObj = je(JSON_OBJ);
ok("对象摊平后键数正确", eObj.length === JSON_KEYS.length, eObj.length);
ok("摊平保持原有顺序（首尾都对）",
   eObj[0].key === "stagename" && eObj[eObj.length - 1].key === "FINE_DIGITAL_SIGNATURE",
   eObj[0].key + " … " + eObj[eObj.length - 1].key);
const eArr = je(["a", "b"]);
ok("数组用下标当键", eArr.length === 2 && eArr[1].key === "1" && eArr[1].value === "b",
   JSON.stringify(eArr));
ok("标量 / null 摊平为空", je("x").length === 0 && je(null).length === 0 && je(42).length === 0);

/* --- 噪声识别：该收的收 --- */
["__pi__", "REF_T", "JAVAX.SERVLET.REQUEST.CIPHER_SUITE",
 "ORG.APACHE.TOMCAT.UTIL.NET.SECURE_PROTOCOL_VERSION", "FINE_DIGITAL_SIGNATURE"]
  .forEach(k => ok("识别为容器参数：" + k, ii(k) === true));

/* --- 噪声识别：不该误伤的别误伤 --- */
["USER", "APPID", "FINEMARKID", "stagename", "date_time", "SITE", "flag", "n"]
  .forEach(k => ok("不误判为容器参数：" + k, ii(k) === false));

const g = gj(JSON_OBJ);
ok("业务 / 容器分组计数 7 / 5", g.biz.length === 7 && g.infra.length === 5,
   g.biz.length + " / " + g.infra.length);
ok("分组不打乱顺序", g.biz[0].key === "stagename" && g.infra[0].key === "__pi__",
   g.biz[0].key + " | " + g.infra[0].key);

/* --- 类型标签：颜色之外的第二层信号 --- */
ok("空字符串单独说", jt("") === "空字符串", jt(""));
ok("字符串带长度", jt("abcd") === "字符串 4 字符", jt("abcd"));
ok("整数 / 小数分开", jt(42) === "整数" && jt(1.5) === "小数", jt(42) + " / " + jt(1.5));
ok("布尔 / null", jt(true) === "布尔" && jt(null) === "null", jt(true) + " / " + jt(null));
ok("对象带键数", jt({ a: 1, b: 2 }) === "对象 2 键", jt({ a: 1, b: 2 }));
ok("数组带项数", jt([1, 2, 3]) === "数组 3 项", jt([1, 2, 3]));

/* --- 过滤 --- */
const e1 = { key: "JAVAX.SERVLET.REQUEST.CIPHER_SUITE", value: "TLS_AES_128_GCM_SHA256" };
ok("空查询恒命中", jm(e1, "") === true);
ok("按键名命中（不区分大小写）", jm(e1, "cipher") === true);
ok("按值命中（不区分大小写）", jm(e1, "tls_aes") === true);
ok("不相关查询不命中", jm(e1, "zzz") === false);
ok("null 与嵌套对象也能被搜到",
   jm({ key: "x", value: null }, "null") === true && jm({ key: "y", value: { a: "q" } }, "q") === true);

/* --- 过滤落到分组上：显隐 / 命中自动展开 / 清空后恢复默认折叠 ---
   applyJsonFilter 只碰 g.el.style、g.el.classList、r.tr.style 三样，
   所以这里用假节点就够，不必上 DOM 桩（也不必等浏览器）。 */
const fakeCls = () => {
  const s = new Set();
  return {
    add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
    toggle(c, f) { if (f) s.add(c); else s.delete(c); return !!f; }
  };
};
const fakeGrp = (entries, defClosed) => ({
  el: { style: {}, classList: fakeCls() },
  rows: entries.map(e => ({ tr: { style: {} }, entry: e })),
  cntEl: { textContent: entries.length + " 个" },
  defClosed
});
const mkState = () => {
  const st = {
    groups: {
      biz: fakeGrp([
        { key: "USER", value: "10000001" },
        { key: "SITE", value: "" }
      ], false),
      infra: fakeGrp([
        { key: "JAVAX.SERVLET.REQUEST.SSL_SESSION_ID", value: "a1b2c3" },
        { key: "__pi__", value: true }
      ], true)
    },
    entries: []
  };
  st.groups.infra.el.classList.add("closed");   // 容器组默认收起
  return st;
};

const sA = mkState();
ok("搜到业务键：命中 1 条", applyJsonFilter(sA, "user") === 1);
ok("搜业务键 → 业务行留着、容器行藏起来",
   sA.groups.biz.rows[0].tr.style.display !== "none" && sA.groups.infra.rows[0].tr.style.display === "none");
ok("整组没命中 → 组本身也藏起来（不占空位）", sA.groups.infra.el.style.display === "none");
ok("有过滤时计数改成「命中 / 总数」（否则 1 行配『9 个』像统计错了）",
   sA.groups.biz.cntEl.textContent === "1 / 2" && sA.groups.infra.cntEl.textContent === "0 / 2",
   sA.groups.biz.cntEl.textContent + " | " + sA.groups.infra.cntEl.textContent);

const sB = mkState();
ok("搜到容器键：命中 1 条", applyJsonFilter(sB, "session_id") === 1);
ok("命中的收起组会被自动展开（否则搜到了却看不见）",
   !sB.groups.infra.el.classList.contains("closed") && sB.groups.infra.el.style.display !== "none");

const sC = mkState();
applyJsonFilter(sC, "session_id");
ok("清空搜索 → 容器组回到默认收起（搜索时的展开不该变成默认）",
   (applyJsonFilter(sC, ""), sC.groups.infra.el.classList.contains("closed")));
ok("清空搜索 → 全部行与组都恢复显示",
   sC.groups.biz.el.style.display !== "none" && sC.groups.infra.el.style.display !== "none" &&
   sC.groups.biz.rows[1].tr.style.display !== "none");
ok("清空搜索 → 计数回到『N 个』",
   sC.groups.biz.cntEl.textContent === "2 个" && sC.groups.infra.cntEl.textContent === "2 个",
   sC.groups.biz.cntEl.textContent + " | " + sC.groups.infra.cntEl.textContent);

/* --- 值渲染：字符串带引号就是类型信号 --- */
ok("字符串带引号", jv("abc") === '"abc"', jv("abc"));
ok("数字 / 布尔不带引号", jv(42) === "42" && jv(false) === "false");
ok("null 原样", jv(null) === "null");
ok("嵌套对象给占位与规模", jv({ a: 1 }) === "{…} 1 键" && jv([1, 2]) === "[…] 2 项",
   jv({ a: 1 }) + " / " + jv([1, 2]));

/* --- 分析接线：面板数据只挂在 JSON 参数上 --- */
const rj = one(JSON_URL);
const pj = P(rj, "__parameters__");
ok("JSON 参数挂上了摊平结果",
   Array.isArray(pj.jsonEntries) && pj.jsonEntries.length === JSON_KEYS.length,
   pj.jsonEntries && pj.jsonEntries.length);
ok("已解析的值一并带出（JSON.parse 只做一次）",
   pj.jsonValue && pj.jsonValue.USER === "10000001");
ok("非 JSON 参数不挂面板数据", P(rj, "viewlet").jsonEntries === undefined);
ok("空对象不挂面板（免得点开什么都没有）",
   P(one("https://example.com/a?p=%7B%7D"), "p").jsonEntries === undefined);

/* --- DOM 冒烟：面板真的建出来了 --- */
const ui2 = makeSandbox();
let ui2Err = null;
try { vm.runInContext(blocks[1], ui2.sb, { filename: "param-analysis#json" }); }
catch (err) { ui2Err = err; }
ok("带 JSON 参数的页面能加载", !ui2Err, ui2Err && ui2Err.message);

if (!ui2Err) {
  ui2.reg.get("inputBox").value = JSON_URL;
  ui2.sb.doAnalyze();

  /* 向下取子节点一律走 kid()：结构一旦被改坏，断言应该**干净地报红**，
     而不是抛 TypeError 把后面所有断言一起吞掉（上次就是这么吃掉半份报告的）。 */
  const kid = (n, i) => (n && n.children && n.children[i]) || null;
  const rowsIn = (grp) => {
    const tbody = kid(kid(kid(grp, 1), 0), 0);
    return (tbody && tbody.children) || [];
  };

  const rows2 = ui2.reg.get("detailTable").children[1].children;
  ok("2 个参数 + 1 行展开面板 = 3 行", rows2.length === 3, rows2.length);

  const sum = kid(kid(rows2[1], 3), 0);
  ok("解码后值列只放摘要", sum && sum.className === "json-sum", sum && sum.className);
  ok("摘要里带键数", sum && String(sum.children[0].textContent).indexOf(JSON_KEYS.length + " 个键 · ") === 0,
     sum && sum.children[0].textContent);

  const panel = kid(kid(rows2[2], 0), 0);
  ok("展开行里是面板容器", panel && panel.className === "json-panel", panel && panel.className);

  const groupsBox = kid(kid(panel, 1), 2);
  const grpCount = (groupsBox && groupsBox.children.length) || 0;
  ok("分成业务 / 容器两组", grpCount === 2, grpCount);

  const bizGrp = kid(groupsBox, 0), infraGrp = kid(groupsBox, 1);
  const bizRows = rowsIn(bizGrp), infraRows = rowsIn(infraGrp);
  ok("业务组 7 行 / 容器组 5 行", bizRows.length === 7 && infraRows.length === 5,
     bizRows.length + " / " + infraRows.length);
  ok("业务组默认展开", !!bizGrp && !bizGrp.classList.contains("closed"));
  ok("容器组默认收起", !!infraGrp && infraGrp.classList.contains("closed"));

  /* --- 展开 / 收起：容器高度必须跟着让路 ---
     .table-wrap 有 max-height:60vh，面板塞在表格行里，容器不放行就会被裁掉，
     用户点了"展开"什么都看不见。这里把这条路径真跑一遍。 */
  const wrap = ui2.reg.get("detailWrap");
  const detailRow = rows2[2];
  ok("默认展开时表格容器放开 60vh 限制", wrap.classList.contains("grow"));

  const toggleBtn = sum.children[1];
  ok("摘要里是展开/收起按钮", toggleBtn && toggleBtn.className === "json-open", toggleBtn && toggleBtn.className);

  /* 事件委托挂在 detailTable 上，桩把监听器记下来了，这里造一个小事件直接打进去 */
  const fireClick = (node, re) => ui2.reg.get("detailTable").__on.click({
    target: { closest: sel => (re.test(sel) ? node : null) }
  });
  const fireToggle = () => fireClick(toggleBtn, /data-json-toggle/);

  fireToggle();
  ok("点『收起』→ 面板行加上 json-off", detailRow.classList.contains("json-off"));
  ok("点『收起』→ 按钮文字变『展开』", toggleBtn.children[0].textContent === "展开",
     toggleBtn.children[0].textContent);
  ok("点『收起』→ aria-expanded=false", toggleBtn.getAttribute("aria-expanded") === "false",
     toggleBtn.getAttribute("aria-expanded"));
  ok("面板全收起了 → 容器高度限制收回", !wrap.classList.contains("grow"));

  fireToggle();
  ok("再点『展开』→ 面板恢复显示", !detailRow.classList.contains("json-off"));
  ok("再点『展开』→ 容器重新放开高度", wrap.classList.contains("grow"));
  ok("展开后把面板滚进视野（收起时不滚）", detailRow.__scrolled === 1, detailRow.__scrolled);

  /* --- 超长原始值默认压 3 行 ---
     JSON 参数的原始值是一整段百分号编码，铺开十几行会把整行撑爆、还抢光列宽。 */
  const rawLong = kid(rows2[1], 2), rawShort = kid(rows2[0], 2);
  const rawParam = rj.params.filter(x => x.key === "__parameters__")[0];
  // 折叠壳可能压根不存在（断言要被改坏时），所以一律走空对象兜底，
  // 别让 TypeError 把后面几条断言一起吞掉 —— 这个坑之前踩过一次。
  const clip = kid(rawLong, 0) || {};
  const has = (n, c) => !!n && n.classList.contains(c);
  ok("超长原始值被折起来（挂 raw-clip）",
     has(rawLong, "raw-cell") && clip.className === "raw-clip",
     (rawLong && rawLong.className) + " / " + clip.className);
  ok("折叠的是壳、文本仍完整在 DOM 里（导出不受影响）",
     !!rawParam && clip.textContent === rawParam.raw);
  ok("折叠时提示可展开", /点击展开完整原文（\d+ 字符）/.test(String(clip.title)), clip.title);
  ok("短值不折叠（viewlet 保持原样）",
     !has(rawShort, "raw-cell") && !!rawShort && rawShort.children.length === 0,
     rawShort && rawShort.className);

  fireClick(rawLong, /td\.raw-cell/);
  ok("点一下 → 展开全文（raw-open）", rawLong.classList.contains("raw-open"));
  ok("再点一下 → 收回 3 行", (fireClick(rawLong, /td\.raw-cell/), !rawLong.classList.contains("raw-open")));
}

/* 折叠靠一条 CSS 规则，JS 只加类 —— 规则被删掉等于白做 */
ok("CSS 里有 .raw-clip 的三行折叠规则",
   /\.raw-clip\s*\{[^}]*-webkit-line-clamp:\s*3/.test(HTML));
ok("展开态有对应的解除折叠规则",
   /\.raw-open \.raw-clip\s*\{[^}]*line-clamp:\s*unset/.test(HTML));

/* kv 表嵌在明细表 tbody 里，会吃到「首列居中 + 次要色」那条通用规则 —— 回归过 */
const kvKeyRule = (HTML.match(/table\.kv td\.k\s*\{[^}]*\}/) || [""])[0];
ok("kv 键名列不被明细表首列规则带偏（左对齐 + 主文字色）",
   /text-align:\s*left/.test(kvKeyRule) && /color:\s*var\(--text\)/.test(kvKeyRule), kvKeyRule);
ok("kv 键名列保留 break-all（通用规则用 !important 钉成了 normal）",
   /word-break:\s*break-all\s*!important/.test(kvKeyRule), kvKeyRule);

/* 高度让路靠的是一条 CSS 规则，JS 加类只是其中一半 —— 规则被删掉等于白做 */
ok("CSS 里有 .table-wrap.grow 放开高度的规则",
   /\.table-wrap\.grow\s*\{[^}]*max-height:\s*none/.test(HTML));

/* ============================================================ */
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
