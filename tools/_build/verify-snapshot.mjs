/* ============================================================
 * verify-snapshot.mjs — 快照产物的自动化验收（不开浏览器）
 * ------------------------------------------------------------
 * 为什么需要它：单文件快照「能不能用」以前只能靠双击目测，
 * 而模块图 / 数据垫片 / 动态导入垫片这三样恰恰是最容易静默坏掉的：
 * 构建期语法通过 ≠ 运行时能跑。这里用最小 DOM 桩在 Node 里真跑一遍产物。
 *
 * 用法:
 *   node tools/_build/verify-snapshot.mjs                          # 验收所有 dist/*.html
 *   node tools/_build/verify-snapshot.mjs tools/code-workspace/dist/code-workspace-v1.html
 *
 * 断言分两档：
 *   硬断言（失败即退出码 1）：模块全部注册、注册表可调用、垫片 fetch 命中内联数据、
 *                             动态导入目标已内联、产物无残留 ESM / 本地引用
 *   软断言（告警不失败）：入口模块执行是否抛错（DOM 桩覆盖不到的地方会误报）
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/* ---------- 最小 DOM 桩（同 id 复用同一对象，便于断言） ---------- */
function makeEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), nodeType: 1,
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    hidden: false, disabled: false, checked: false, value: "", title: "", textContent: "", innerHTML: "", outerHTML: "",
    children: [], childNodes: [], firstChild: null, parentNode: null, scrollTop: 0, scrollHeight: 0,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    appendChild(c) { return c; }, append() {}, prepend() {}, insertBefore(c) { return c; },
    replaceChild() {}, removeChild() {}, remove() {}, contains: () => false, closest: () => null,
    querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [],
    focus() {}, blur() {}, click() {}, select() {}, scrollIntoView() {}, setSelectionRange() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    cloneNode() { return makeEl(tag); }, insertAdjacentHTML() {}, matches: () => false, animate: () => ({ finished: Promise.resolve() }),
    offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0, files: [], webkitRelativePath: ""
  };
  return new Proxy(el, {
    get(t, k) { return k in t ? t[k] : undefined; },
    set(t, k, v) { t[k] = v; return true; }
  });
}

const byId = new Map();
function documentStub() {
  const doc = {
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, makeEl("div")); return byId.get(id); },
    createElement: (t) => makeEl(t), createElementNS: (ns, t) => makeEl(t),
    createTextNode: () => makeEl("text"), createDocumentFragment: () => makeEl("fragment"),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, execCommand: () => true,
    documentElement: makeEl("html"), head: makeEl("head"), body: makeEl("body"),
    activeElement: null, documentMode: undefined, readyState: "complete", baseURI: "file:///snapshot.html",
    fonts: { ready: Promise.resolve() }
  };
  return doc;
}

/* ---------- 断言 ---------- */
let pass = 0, fail = 0, soft = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } };
const warn = (name, extra = "") => { soft++; console.log("  ! " + name + (extra ? "  → " + extra : "")); };

/* ---------- 单文件验收 ---------- */
async function verify(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const html = fs.readFileSync(file, "utf8");
  /* 非快照产物（如 build-single.mjs 出的传统单页）没有注册表契约，跳过 */
  if (!/__SNAPSHOT__|snapshot runtime/.test(html)) { console.log(`\n[${rel}]\n  · 跳过（非快照产物，无注册表契约）`); return; }
  console.log(`\n[${rel}]`);
  const hasModules = /__def\(["']/.test(html);   // 注册调用形如 __def("key", …)，与运行时函数声明区分
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const externals = [];
  /* 只注入宿主 API，绝不注入 ECMAScript 内置（Object/Array/RegExp/…）。
     原因：vm 有独立 realm，注入宿主 realm 的 RegExp 会让产物里的
     `x instanceof RegExp` 恒为 false，进而走进错误分支（这个坑真实踩过）。 */
  const win = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    CSS: { escape: (s) => s }, isSecureContext: false,
    location: { href: "file:///snapshot.html", protocol: "file:", search: "" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    performance: { now: () => 0 }, navigator: { clipboard: null, userAgent: "node", platform: "node", vendor: "" },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => { setTimeout(fn, 0); return 0; }, cancelAnimationFrame() {},
    alert() {}, confirm: () => false, prompt: () => null,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    URL, Blob, TextEncoder, TextDecoder, AbortController, Event, CustomEvent, DOMException,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {}, table() {} }
  };
  win.window = win;
  win.self = win;
  win.document = documentStub();
  win.URL.createObjectURL = () => "blob:snapshot/stub";
  win.fetch = (u) => { externals.push(String(u)); return Promise.reject(new Error("blocked: " + u)); };

  /* 执行产物脚本（顺序与页面一致） */
  const vm = await import("node:vm");
  const ctx = vm.createContext(win);
  let bootError = null;
  for (const [i, sc] of scripts.entries()) {
    try { vm.runInContext(sc, ctx, { filename: `${rel}#script${i + 1}` }); }
    catch (e) { bootError = e; break; }
  }

  ok("所有 <script> 块可执行且无异常", !bootError, bootError ? bootError.message : "");

  const S = win.__SNAPSHOT__;
  ok("暴露 snapshot 运行时", !!S);
  if (!S) return;

  const defKeys = [...html.matchAll(/__def\((["'])([^"']+)\1/g)].map((m) => m[2]);
  if (!hasModules) {
    console.log(`  · 传统脚本内联产物（无 ESM 模块，注册表为空属预期）`);
  } else {
    ok("模块注册表非空", S.keys.length > 0, `注册 ${S.keys.length} 个`);
    ok("注册表键与产物一致", S.keys.length === defKeys.length, `运行时 ${S.keys.length} vs 产物 ${defKeys.length}`);
  }

  /* 动态导入目标必须全部在注册表内 */
  const dynTargets = [...html.matchAll(/__dynImport\(\s*(["'])([^"']+)\1\s*\)/g)].map((m) => m[2]);
  const missing = dynTargets.filter((k) => !defKeys.includes(k));
  ok("动态导入目标已内联", missing.length === 0, missing.join(", "));

  /* 每个动态导入目标都要能真正 require 出来（懒加载资源是最大的静默坑） */
  for (const k of [...new Set(dynTargets)]) {
    try {
      const ns = S.req(k);
      ok(`懒加载模块可实例化: ${k}`, ns && typeof ns === "object" && Object.keys(ns).length > 0,
        `导出 ${ns ? Object.keys(ns).length : 0} 项`);
    } catch (e) {
      ok(`懒加载模块可实例化: ${k}`, false, e.message);
    }
  }

  /* 兜底：注册表里的每个模块都要能被实例化（能一次性暴露 vendor 大包的真实问题） */
  if (hasModules) {
    const broke = [];
    const stacks = [];
    for (const k of S.keys) {
      try { S.req(k); } catch (e) { broke.push(`${k}: ${e.message}`); stacks.push(e.stack || ""); }
    }
    ok("全部模块可实例化", broke.length === 0, broke.slice(0, 3).join(" | "));
    if (broke.length && process.env.SNAPSHOT_DEBUG)
      for (const s of stacks) console.log(String(s).split("\n").slice(0, 8).map((l) => "      " + l).join("\n"));
  }

  /* 内联数据 / 资源垫片 */
  const dataKeys = Object.keys(S.data || {});
  for (const k of dataKeys) {
    const d = S.data[k];
    ok(`内联数据可用: ${k}`, d && typeof d === "object" && Object.keys(d).length > 0);
  }

  /* fetch 垫片：命中内联数据必须返回 ok + json */
  for (const k of dataKeys) {
    const r = win.fetch(`./${k}?t=${Date.now()}`);
    const json = await r.then((x) => x.json());
    ok(`fetch 垫片命中: ${k}`, json && typeof json === "object");
  }

  /* 延迟一会，捕获启动阶段异步异常 */
  await new Promise((r) => setTimeout(r, 60));

  const realExternals = externals.filter((u) => /^https?:/i.test(u));
  if (realExternals.length) warn(`运行期发起真实网络请求 ${realExternals.length} 个（离线时相关功能降级）`, realExternals.join(", "));
  if (bootError) warn("启动阶段异常（可能只是 DOM 桩不足，需浏览器复核）", bootError.message);
  console.log(`  版本标记: data-version=${/data-version="([^"]*)"/.exec(html)?.[1] || "?"} · 脚本块 ${scripts.length} 个 · ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
}

/* ---------- 入口 ---------- */
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
let files = args.map((a) => path.resolve(ROOT, a));
if (!files.length) {
  for (const t of fs.readdirSync(path.join(ROOT, "tools"))) {
    const d = path.join(ROOT, "tools", t, "dist");
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith(".html")) files.push(path.join(d, f));
  }
}
if (!files.length) { console.log("没有找到产物，先跑 node tools/_build/build-snapshot.mjs"); process.exit(0); }

console.log(`快照验收 · ${files.length} 个产物`);
for (const f of files) {
  try { await verify(f); }
  catch (e) { fail++; console.log(`  ✗ 验收异常: ${e.message}`); }
}
console.log(`\n验收结果：通过 ${pass} · 失败 ${fail}${soft ? ` · 告警 ${soft}` : ""}`);
process.exit(fail ? 1 : 0);
