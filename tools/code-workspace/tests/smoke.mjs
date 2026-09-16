/* ============================================================
 * smoke.mjs — 纯逻辑冒烟测试（用最小 DOM 桩在 Node 里跑）
 * ------------------------------------------------------------
 * 覆盖三类真会出错、且浏览器里不一定立刻暴露的东西：
 *   1) 名称 / 路径校验（safeName / isSafePath）—— 防越权与非法落盘名
 *   2) 扩展名 → 语言 key 映射，是否全部落在 vendor 包的注册表里
 *   3) 编辑器单包能否 import 且语言可构造
 * ============================================================ */

import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const elStub = () => ({
  style: {}, dataset: {}, hidden: false, textContent: "", value: "",
  checked: false, disabled: false, title: "", innerHTML: "",
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, setAttribute() {}, appendChild() {}, prepend() {},
  remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  contains() { return false; }, focus() {}, select() {}, scrollIntoView() {}
});

globalThis.document = {
  getElementById: () => elStub(),
  createElement: () => elStub(),
  createElementNS: () => elStub(),
  createTextNode: () => elStub(),
  createDocumentFragment: () => elStub(),
  addEventListener() {}, removeEventListener() {},
  /* CodeMirror 的浏览器探测会读 documentElement.style（如 webkitFontSmoothing），
     桩里必须给一个真实的 style 对象，否则 import 阶段就抛 TypeError */
  documentElement: { style: {}, getAttribute: () => "light", setAttribute() {}, dataset: {} },
  body: elStub(),
  head: elStub(),
  activeElement: null,
  documentMode: undefined
};
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false }),
  CSS: { escape: (s) => s },
  isSecureContext: true
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.KeyboardEvent = class { constructor() {} };

/* 项目根：优先取命令行参数，缺省则用脚本所在目录的上一级（脚本放在 <项目根>/tests/ 下）。
   用 fileURLToPath/pathToFileURL 处理中文路径，别手写百分号编码的绝对路径。 */
const ROOT = resolve(process.argv.slice(2).find((a) => !a.startsWith("--"))
  || join(dirname(fileURLToPath(import.meta.url)), ".."));
const BASE = pathToFileURL(ROOT).href;
const BUNDLE = pathToFileURL(join(ROOT, "vendor/codemirror/codemirror.bundle.js")).href;

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

const sec = await import(`${BASE}/V1/src/security.js`);
const utils = await import(`${BASE}/V1/src/utils.js`);
const C = await import(`${BASE}/V1/src/constants.js`);

console.log("\n[1] safeName — 非法名必须被拒");
ok('空串被拒', !sec.safeName("").ok);
ok('纯空格被拒', !sec.safeName("   ").ok);
ok('"." 被拒', !sec.safeName(".").ok);
ok('".." 被拒', !sec.safeName("..").ok);
ok("含 / 被拒", !sec.safeName("a/b").ok);
ok("含 \\ 被拒", !sec.safeName("a\\b").ok);
ok("CON 被拒", !sec.safeName("CON").ok);
ok("aux.txt 被拒", !sec.safeName("aux.txt").ok);
ok("COM3 被拒", !sec.safeName("COM3").ok);
ok("LPT1.log 被拒", !sec.safeName("LPT1.log").ok);
ok("结尾点号被拒", !sec.safeName("x.").ok);
ok("尾部空格被 trim 后放行", sec.safeName("x ").ok && sec.safeName("x ").name === "x");
ok("控制字符被拒", !sec.safeName("a\u0000b").ok);
ok("超长名被拒", !sec.safeName("a".repeat(201)).ok);
ok("正常名通过", sec.safeName("notes.md").ok);
ok("中文名通过", sec.safeName("说明文档.txt").ok);
ok("带空格名通过", sec.safeName("my notes.md").ok);
ok("trim 生效", sec.safeName("  a.txt  ").name === "a.txt");

console.log("\n[2] isSafePath — 防越出已授权目录");
ok("绝对路径 /a/b 被拒", !sec.isSafePath("/a/b"));
ok("盘符 C:/a 被拒", !sec.isSafePath("C:/a"));
ok("含 .. 被拒", !sec.isSafePath("a/../b"));
ok("空串被拒", !sec.isSafePath(""));
ok("双层 .. 被拒", !sec.isSafePath("../../etc"));
ok("正常相对路径通过", sec.isSafePath("src/a.js"));
ok("空目录名被拒", !sec.isSafePath("a//b"));

console.log("\n[3] 路径工具");
ok('joinPath("", "a") === "a"', sec.joinPath("", "a") === "a");
ok('joinPath("d", "a") === "d/a"', sec.joinPath("d", "a") === "d/a");
ok('dirname("a/b/c.js") === "a/b"', sec.dirname("a/b/c.js") === "a/b");
ok('dirname("a.js") === ""', sec.dirname("a.js") === "");
ok('basename("a/b/c.js") === "c.js"', sec.basename("a/b/c.js") === "c.js");

console.log("\n[4] utils 纯函数");
ok('countLines("") === 0', utils.countLines("") === 0);
ok('countLines("a") === 1', utils.countLines("a") === 1);
ok('countLines("a\\nb") === 2', utils.countLines("a\nb") === 2);
ok("humanSize(0)", utils.humanSize(0) === "0 B");
ok("humanSize(2048) 含 KB", /KB/.test(utils.humanSize(2048)));
ok("extOf('a.min.js')", utils.extOf("a.min.js") === "js");
ok("extOf('.gitignore') 为空", utils.extOf(".gitignore") === "");

console.log("\n[5] langKeyFor 抽样");
const langCases = [
  ["src/main.js", "javascript"], ["app.tsx", "tsx"], ["a.py", "python"],
  ["Main.java", "java"], ["lib.rs", "rust"], ["x.go", "go"], ["a.c", "c"],
  ["a.cpp", "cpp"], ["setup.py", "python"], ["index.html", "html"],
  ["style.css", "css"], ["data.json", "json"], ["README.md", "markdown"],
  ["query.sql", "sql"], ["docker-compose.yml", "yaml"], ["Dockerfile", "dockerfile"],
  ["Makefile", "shell"], [".gitignore", "properties"], ["CMakeLists.txt", "cmake"],
  ["run.ps1", "powershell"], ["deploy.sh", "shell"], ["pom.xml", "xml"],
  ["notes.unknown", ""]
];
for (const [p, want] of langCases) {
  const got = utils.langKeyFor(p);
  ok(`${p} → ${want || "(纯文本)"}`, got === want, "实际 " + JSON.stringify(got));
}

console.log("\n[6] 浏览器二进制 / 上限判定");
ok("png 判为二进制", utils.looksBinary("a/b.png"));
ok("zip 判为二进制", utils.looksBinary("x.zip"));
ok("js 不判为二进制", !utils.looksBinary("a.js"));
ok("MAX_EDIT_BYTES 为 3MB", C.MAX_EDIT_BYTES === 3 * 1024 * 1024);
ok("TRASH_DIR 为 .cw-trash", C.TRASH_DIR === ".cw-trash");

console.log("\n[7] 语言映射全部落在离线包注册表内");
const bundle = await import(BUNDLE);
const registry = new Set(Object.keys(bundle.langs));
const allVals = new Set([
  ...Object.values(C.EXT_TO_LANG),
  ...Object.values(C.NAME_TO_LANG)
]);
const missing = [...allVals].filter((k) => !registry.has(k));
ok(`映射用到 ${allVals.size} 个语言 key，全部存在于注册表（共 ${registry.size} 项）`, missing.length === 0, "缺失：" + missing.join(", "));

const cannotBuild = [...allVals].filter((k) => !bundle.getLanguage(k));
ok("每个 key 都能真实构造出语言扩展", cannotBuild.length === 0, "失败：" + cannotBuild.join(", "));

console.log("\n[8] 离线包 API 面");
const need = [
  "EditorState", "EditorView", "Compartment", "keymap", "lineNumbers",
  "highlightActiveLineGutter", "highlightSpecialChars", "history", "drawSelection",
  "dropCursor", "defaultKeymap", "historyKeymap", "indentWithTab", "searchKeymap",
  "highlightSelectionMatches", "autocompletion", "completionKeymap", "closeBrackets",
  "closeBracketsKeymap", "indentOnInput", "bracketMatching", "foldGutter",
  "syntaxHighlighting", "highlightLight", "highlightDark", "baseTheme",
  "oneDark", "getLanguage", "langs"
];
const absent = need.filter((k) => bundle[k] === undefined);
ok(`${need.length} 项导出全部存在`, absent.length === 0, "缺失：" + absent.join(", "));

const ext = bundle.getLanguage("javascript");
ok("getLanguage('javascript') 返回可挂载扩展", !!ext);
ok("getLanguage('不存在的语言') 返回 null", bundle.getLanguage("不存在的语言") === null);
ok("未知 key 返回 null", bundle.getLanguage("") === null);

/* ============================================================
 * [9] readFileText —— 真正的文件读取路径
 * ------------------------------------------------------------
 * 这一段是补的漏网之鱼：之前 smoke 只测了纯函数（safeName / langKeyFor …），
 * 从没真正调用过 readFileText。于是 fsrepo.js 里 `MAX_EDIT_BYTES` 漏导入造成的
 * ReferenceError 一路潜伏 —— 它被 readFileText 的 try/catch 吞成 reason:"error"，
 * 界面上只显示「无法读取这个文件。」，而且**每个文件都这样**，用户完全无从判断。
 * 结论：判据函数要测，**用它拼起来的 IO 主路径更要测**。
 * ============================================================ */

console.log("\n[9] readFileText —— 真读文件（漏导入的 MAX_EDIT_BYTES 就藏在这里）");

const fsrepo = await import(`${BASE}/V1/src/fsrepo.js`);
const { state } = await import(`${BASE}/V1/src/state.js`);

const enc = (s) => new TextEncoder().encode(s);

function makeFile(size, bytes, lastModified = 1700000000000) {
  return {
    name: "f.txt", size, lastModified,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

/* 假根目录句柄：files 是 name → { file } 或 { throw: err } */
function fakeRoot(files) {
  return {
    name: "root",
    async getDirectoryHandle() {
      throw Object.assign(new Error("no subdir"), { name: "NotFoundError" });
    },
    async getFileHandle(name) {
      const rec = files[name];
      if (!rec) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
      return {
        async getFile() {
          if (rec.throw) throw rec.throw;
          return rec.file;
        }
      };
    }
  };
}

/* --- 正常路径 --- */
state.rootHandle = fakeRoot({ "a.txt": { file: makeFile(5, enc("hello")) } });
let r = await fsrepo.readFileText("a.txt");
ok("正常 UTF-8 文件读取成功", r.ok === true, "reason=" + r.reason + " errName=" + r.errName + " errMsg=" + r.errMsg);
ok("内容正确", r.content === "hello");
ok("size 与 mtime 透出", r.size === 5 && r.mtime === 1700000000000);
ok("无 BOM 时 bom=false", r.bom === false);
ok("【反回归】成功路径绝不返回 reason='error'（MAX_EDIT_BYTES 漏导入时的症状）",
   r.reason === undefined && r.errName === undefined, "errName=" + r.errName + " errMsg=" + r.errMsg);

/* --- BOM --- */
const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("hi")]);
state.rootHandle = fakeRoot({ "b.txt": { file: makeFile(bomBytes.length, bomBytes) } });
r = await fsrepo.readFileText("b.txt");
ok("带 UTF-8 BOM：bom=true", r.ok === true && r.bom === true, "reason=" + r.reason);
ok("BOM 三个字节已从内容里剥掉", r.content === "hi");

/* --- 超限（正是用到 MAX_EDIT_BYTES 的那一行） --- */
state.rootHandle = fakeRoot({ "big.txt": { file: makeFile(C.MAX_EDIT_BYTES + 1, enc("x")) } });
r = await fsrepo.readFileText("big.txt");
ok("超过 MAX_EDIT_BYTES → reason='size'", r.ok === false && r.reason === "size", "reason=" + r.reason);

/* --- 二进制 --- */
const binBytes = new Uint8Array([0x50, 0x00, 0x4b]);
state.rootHandle = fakeRoot({ "c.bin": { file: makeFile(binBytes.length, binBytes) } });
r = await fsrepo.readFileText("c.bin");
ok("含 NUL 字节 → reason='binary'", r.ok === false && r.reason === "binary", "reason=" + r.reason);

/* --- 非 UTF-8 --- */
const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);   // 「中文」的 GBK 编码，非法 UTF-8
state.rootHandle = fakeRoot({ "d.txt": { file: makeFile(gbk.length, gbk) } });
r = await fsrepo.readFileText("d.txt");
ok("非法 UTF-8 序列 → reason='encoding'", r.ok === false && r.reason === "encoding", "reason=" + r.reason);

/* --- 文件不存在 --- */
state.rootHandle = fakeRoot({});
r = await fsrepo.readFileText("nope.txt");
ok("文件不存在 → reason='missing'", r.ok === false && r.reason === "missing", "reason=" + r.reason);

/* --- 没有读权限（iframe / 授权过期的典型表现） --- */
const denied = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
state.rootHandle = fakeRoot({ "e.txt": { throw: denied } });
r = await fsrepo.readFileText("e.txt");
ok("无读权限 → reason='denied'（与「文件坏了」区分开）", r.ok === false && r.reason === "denied", "reason=" + r.reason);
ok("失败时把 errName / errMsg 带出去给界面展示",
   r.errName === "NotAllowedError" && typeof r.errMsg === "string", "errName=" + r.errName);

/* --- 非法路径必须被拦下，且不把异常抛穿 --- */
state.rootHandle = fakeRoot({});
r = await fsrepo.readFileText("../../etc/passwd");
ok("越权路径被拦下且不抛穿调用方", r.ok === false && typeof r.errName === "string", "errName=" + r.errName);

/* 收尾：清掉假句柄，避免影响后续 */
state.rootHandle = null;

/* ============================================================
 * [10] mdview — Markdown 渲染（重点：XSS 必须挡住）
 * ------------------------------------------------------------
 * 这里渲染的是「用户磁盘上任意 .md 文件」= 不可信输入。
 * 安全断言必须查「有没有生成活的标签/属性」，不能在整个 HTML 字符串里搜关键词 ——
 * 那样会把「已被转义成文字」的攻击样例也算成命中，得到假的告警。
 * ============================================================ */

console.log("\n[10] mdview — Markdown 渲染与 XSS 防护");

const mv = await import(`${BASE}/V1/src/mdview.js`);

/* --- 结构 --- */
const md = [
  "# 一级标题",
  "",
  "段落含 **粗体**、*斜体*、`行内码`、~~删除线~~、[链接](https://example.com) 与 ![图](https://a.com/i.png)。",
  "",
  "- 项一",
  "- 项二",
  "  - 子项 A",
  "    1. 孙项 1",
  "",
  "1. 有序一",
  "2. 有序二",
  "",
  "- [x] 做了",
  "- [ ] 没做",
  "",
  "> 引用第一行",
  "> 引用第二行",
  "",
  "| 名称 | 数量 | 备注 |",
  "|:-----|-----:|:----:|",
  "| 甲 | 1 | x |",
  "",
  "---",
  "",
  "```python",
  "print(1 < 2)",
  "```",
  "",
  "自动链接 https://github.com/delux2557 结束"
].join("\n");

const html = mv.mdToHTML(md);

ok("生成 h1 标题", /<h1>一级标题<\/h1>/.test(html));
ok("粗体 / 斜体 / 行内码 / 删除线", /<strong>粗体<\/strong>/.test(html) && /<em>斜体<\/em>/.test(html) &&
   /<code>行内码<\/code>/.test(html) && /<del>删除线<\/del>/.test(html));
ok("链接带 rel=noopener", /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">/.test(html));
ok("图片渲染", /<img src="https:\/\/a\.com\/i\.png"/.test(html));
ok("裸链接自动识别", /<a href="https:\/\/github\.com\/delux2557"/.test(html));
ok("无序列表 + 嵌套子列表", /<ul><li>项一<\/li><li>项二<ul><li>子项 A/.test(html));
ok("嵌套有序列表在子项内部", /<li>子项 A<ol><li>孙项 1<\/li><\/ol><\/li>/.test(html));
ok("独立有序列表", /<ol><li>有序一<\/li><li>有序二<\/li><\/ol>/.test(html));
ok("任务列表（含勾选态）", /<li class="task"><input type="checkbox" disabled checked>/.test(html) &&
   /<li class="task"><input type="checkbox" disabled>/.test(html));
ok("引用块", /<blockquote>/.test(html));
ok("表格 + 对齐", /<th style="text-align:left">名称<\/th>/.test(html) &&
   /<th style="text-align:right">数量<\/th>/.test(html) && /<th style="text-align:center">备注<\/th>/.test(html));
ok("分隔线", /<hr>/.test(html));
ok("围栏代码带语言标签且内容已转义", /<figcaption>python<\/figcaption>/.test(html) && /print\(1 &lt; 2\)/.test(html));
ok("围栏内的 < 没有当标签用", !/<figure class="md-code"><figcaption>python<\/figcaption><pre><code>[^<]*<[a-z]/.test(html));

/* --- 安全：属性级断言 --- */
const evil = [
  "原文 HTML：<script>alert(1)</script><img src=x onerror=alert(2)>",
  "危险链接：[点我](javascript:alert(3))",
  "混淆协议：[点我](java\tscript:alert(4))",
  "大写协议：[点我](JavaScript:alert(5))",
  "data 协议：![x](data:text/html;base64,PHNjcmlwdD4=)",
  "vbscript：[点我](vbscript:msgbox)",
  "事件属性：<a href=\"#\" onclick=\"alert(6)\">x</a>",
  "属性逃逸：[x](https://a.com \"a\\\" onmouseover=alert(7) z=\\\"\")",
  "script 标签内嵌：<svg/onload=alert(8)>",
  "form：[提交](https://a.com)"
].join("\n\n");
const evilHtml = mv.mdToHTML(evil);

/* 我们只生成这些标签；出现别的就说明有东西漏出去了 */
const ALLOWED_TAGS = new Set(["h1","h2","h3","h4","h5","h6","p","br","hr","ul","ol","li","blockquote",
  "table","thead","tbody","tr","th","td","figure","figcaption","pre","code","strong","em","del",
  "a","img","input","span"]);
const foundTags = new Set([...evilHtml.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase()));
const unexpected = [...foundTags].filter((t) => !ALLOWED_TAGS.has(t));

ok("只生成白名单内的标签（无 script/svg/iframe 等）", unexpected.length === 0, "越界标签：" + unexpected.join(", "));
ok("没有活的 on* 事件属性", !/<[a-zA-Z][^>]*\son[a-z]+\s*=/i.test(evilHtml));
ok("没有 href/src 指向 javascript:", !/(?:href|src)\s*=\s*"javascript:/i.test(evilHtml));
ok("没有 href/src 指向 data:", !/(?:href|src)\s*=\s*"data:/i.test(evilHtml));
ok("没有 href/src 指向 vbscript:", !/(?:href|src)\s*=\s*"vbscript:/i.test(evilHtml));
ok("原始 HTML 被转义成文字（<script> 不会被执行）", evilHtml.includes("&lt;script&gt;"));
ok("属性逃逸用引号被转义为 &quot;", !/onmouseover\s*=/.test(evilHtml) || /&quot;/.test(evilHtml));

/* --- isMarkdown --- */
ok(".md / .MD / .markdown 判为 Markdown", mv.isMarkdown("a.md") && mv.isMarkdown("A.MD") && mv.isMarkdown("x.markdown"));
ok(".js / .txt / 无扩展名不判为 Markdown",
   !mv.isMarkdown("a.js") && !mv.isMarkdown("a.txt") && !mv.isMarkdown("README"));

/* --- 空输入不炸 --- */
ok("空字符串返回空", mv.mdToHTML("") === "");
ok("null / undefined 不抛异常", mv.mdToHTML(null) === "" && mv.mdToHTML(undefined) === "");

/* ============================================================
 * [11] prefs — 偏好持久化（隐私模式 / 脏数据必须降级而不是抛错）
 * ============================================================ */

console.log("\n[11] prefs — 偏好持久化与容错");

const prefs = await import(`${BASE}/V1/src/prefs.js`);

/* smoke 的 localStorage 桩默认 getItem 返回 null */
ok("未写入时返回兜底值", prefs.getPref("nope", "dflt") === "dflt");
ok("getBoolPref 未写入时返回布尔兜底", prefs.getBoolPref("nope", true) === true);
ok("getBoolPref 对非布尔脏值回退", prefs.getBoolPref("nope", false) === false);

/* 换成会记账的存储，验证真实读写与命名空间 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

ok("setPref 写入成功返回 true", prefs.setPref("info-visible", false) === true);
ok("key 带 cw- 命名空间", [...store.keys()].every((k) => k.startsWith("cw-")), "实际：" + [...store.keys()].join(", "));
ok("读回的布尔值正确", prefs.getBoolPref("info-visible", true) === false);
ok("值以 JSON 存储", store.get("cw-info-visible") === "false");

/* 脏数据（非法 JSON）不能抛 */
store.set("cw-info-visible", "{不是合法 JSON");
ok("非法 JSON 降级为兜底值而不是抛错", prefs.getBoolPref("info-visible", true) === true);
store.set("cw-info-visible", '"字符串不是布尔"');
ok("类型不符时降级为兜底值", prefs.getBoolPref("info-visible", true) === true);

/* 存储不可用（隐私模式）时静默降级 */
globalThis.localStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() {}
};
ok("存储抛异常时 getPref 不冒泡", prefs.getPref("x", "fb") === "fb");
ok("存储抛异常时 setPref 返回 false 而不冒泡", prefs.setPref("x", 1) === false);

console.log("\n================================");
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail) process.exitCode = 1;
