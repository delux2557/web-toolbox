/* ============================================================
 * build-snapshot.mjs — manifest 版本快照 → 单文件 HTML 打包器
 * ------------------------------------------------------------
 * 与 build-single.mjs 的分工：
 *   build-single.mjs   面向「传统单页工具」：完整 HTML + 多 script 原位内联
 *   build-snapshot.mjs 面向「SPA 壳 + manifest 版本注册」架构：把某个版本快照
 *                      打成可 file:// 双击、可外发的单文件 HTML
 *
 * 用法:
 *   node tools/_build/build-snapshot.mjs                    # 打包所有可识别工具的 latest
 *   node tools/_build/build-snapshot.mjs codebase-context   # 指定工具（默认 latest）
 *   node tools/_build/build-snapshot.mjs codebase-context@v7 # 指定版本 id
 *   node tools/_build/build-snapshot.mjs --list             # 列出可打包的工具与版本
 *   node tools/_build/build-snapshot.mjs --release          # 输出到 tools/<name>/release/（入库，对齐 prompt-helper 约定）
 *   node tools/_build/build-snapshot.mjs --out=path/to.html # 覆盖产物路径（单目标时有效）
 *   node tools/_build/build-snapshot.mjs --strict           # 存在未内联外链则失败（CI 用）
 *
 * 识别条件（零配置接入）：tools/<name>/manifest.json 含 versions[].entry
 * 可选覆盖：tools/<name>/build.snapshot.json
 *   { "dataDirs": ["data"], "extraAssets": ["vendor/x.js"], "allowRemote": ["https://cdn..."] }
 *
 * 打进去的东西：
 *   1) 片段 entry（如 V7/index.html，无 <html> 骨架）→ 从壳 tools/<name>/index.html 取 <head> 骨架
 *   2) <link rel=stylesheet 本地> → <style>（提到 <head> 末尾，保证覆盖壳样式）
 *   3) <script type=module src> → 自动解析 import 图 → 拓扑序 + 模块注册表（IIFE 隔离，零命名冲突）
 *   4) data/**.json + 模块内 fetch("...") → 内联数据表 + fetch 拦截垫片（源码零改写）
 *   5) new URL(rel, import.meta.url) + import(url) → 虚拟基址 + 动态导入垫片（vendor 懒加载仍可工作）
 *   6) 外链（CDN / 字体）原样保留，报告告警（--strict 时判定失败）
 *
 * 自检（构建期强制，失败即中止）：
 *   · 每个模块工厂 new Function 语法自检
 *   · 拼接后整段 bundle 语法自检
 *   · 产物中不得残留 import / export / import.meta / 本地 <script src> / 本地 <link href>
 *
 * 只读保证（并行开发友好）：
 *   本脚本只「读取」工具目录下的源文件，唯一写入是 dist/（或 --release 时的 release/）产物。
 *   不生成中间文件、不改源码、不在工具目录写配置 —— 因此工具随时可被打包，
 *   快照内容 = 打包那一刻的源码状态；重跑一次即自动跟随最新源码，无需任何登记步骤。
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TOOLS_DIR = path.join(ROOT, "tools");

/* ============================================================
 * 0. 小工具
 * ============================================================ */
function fail(msg) { throw new Error(msg); }
function isRemoteRef(ref) { return /^(https?:)?\/\//i.test(ref) || /^data:/i.test(ref) || ref.startsWith("/"); }
/* XML/SVG 命名空间不是网络请求，不能算外链（如 createElementNS("http://www.w3.org/2000/svg", ...)） */
function isNamespaceURL(u) { return /^https?:\/\/www\.w3\.org\//i.test(u); }
/* 字体托管：离线时仅视觉降级（回落系统字体），功能不受影响 */
function isFontHost(u) { return /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.googleusercontent\.com)/i.test(u); }
function kb(n) { return (n / 1024).toFixed(1); }

/* 按位置倒序应用替换（区间不得重叠） */
function applyEdits(text, edits) {
  const sorted = edits.slice().sort((a, b) => a.start - b.start);
  let out = "", cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) fail(`内部错误：编辑区间重叠（${e.start} < ${cursor}）`);
    out += text.slice(cursor, e.start) + (e.text ?? "");
    cursor = e.end;
  }
  return out + text.slice(cursor);
}

/* ============================================================
 * 1. 代码掩码：把字符串内容 / 注释 / 模板串 / 正则字面量抹成空格
 *    —— 长度与换行完全不变，引号与转义符保留（便于用 d flag 反查原文）
 * ============================================================ */
function maskCode(src) {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  let lastChar = "";      // 上一个有效字符
  let lastWord = "";      // 上一个有效单词
  const stringRanges = [];  // 字符串 / 模板串区间（含定界符），供「代码内隐藏外链」扫描用
  const blank = (from, to) => { for (let k = from; k < to; k++) if (src[k] !== "\n") out[k] = " "; };

  while (i < n) {
    const c = src[i], c2 = src[i + 1];

    /* 行注释 */
    if (c === "/" && c2 === "/") {
      const s = i; while (i < n && src[i] !== "\n") i++; blank(s, i); continue;
    }
    /* 块注释 */
    if (c === "/" && c2 === "*") {
      const s = i; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(n, i + 2); blank(s, i); continue;
    }
    /* 字符串 / 模板串：保留定界符，抹内容（转义对保留） */
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      const s0 = i;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      stringRanges.push([s0, i]);
      lastChar = q; lastWord = "";
      continue;
    }
    /* 正则字面量启发式：/ 出现在「期待值」位置才算正则 */
    if (c === "/") {
      const expectValue =
        lastChar === "" || /[=(,:[!&|?{};+\-*%~^<>\n]/.test(lastChar) ||
        /^(return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/.test(lastWord);
      if (expectValue) {
        const s = i; i++;
        let inClass = false, closed = false;
        while (i < n) {
          const ch = src[i];
          if (ch === "\n") break;
          if (ch === "\\") { i += 2; continue; }
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) { i++; closed = true; break; }
          i++;
        }
        if (closed) { blank(s, i); lastChar = "/"; lastWord = ""; continue; }
        i = s; // 未闭合 → 当除号处理
      }
      lastChar = "/"; lastWord = ""; i++; continue;
    }
    /* 普通字符 */
    if (!/\s/.test(c)) { lastChar = c; lastWord = ""; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return { masked: out.join(""), stringRanges };
}

/* 掩码缓存（vendor 之类的大文件会被多次掩码，按 key 复用） */
const MASK_CACHE = new Map();
function maskOf(text, key) {
  if (key && MASK_CACHE.has(key)) return MASK_CACHE.get(key);
  const r = maskCode(text);
  if (key) MASK_CACHE.set(key, r);
  return r;
}

/* ============================================================
 * 2. ESM 语句抽取（在掩码文本上定位，用 indices 从原文取字符串）
 * ============================================================ */
const RE_IMPORT_FROM = /\bimport\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\*\s*as\s+([A-Za-z_$][\w$]*)|(\{[^}]*\}))?\s*from\s*(["'])([^"'\n]+)\4\s*;?/gd;
const RE_IMPORT_BARE = /\bimport\s*(["'])([^"'\n]+)\1\s*;?/gd;
const RE_IMPORT_DYN = /\bimport\s*\(/g;
const RE_EXPORT_LIST = /\bexport\s*\{([^}]*)\}\s*(?:from\s*(["'])([^"'\n]+)\2\s*)?;?/gd;
const RE_EXPORT_DECL = /\bexport(\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*))/g;
const RE_EXPORT_DEFAULT = /\bexport(\s+default)/g;
const RE_EXPORT_STAR = /\bexport\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*(["'])([^"'\n]+)\2\s*;?/gd;
const RE_META_URL = /\bimport\s*\.\s*meta\s*\.\s*url\b/g;
const RE_NEW_URL_META = /\bnew\s+URL\s*\(\s*(["'])([^"'\n]+)\1\s*,\s*import\s*\.\s*meta\s*\.\s*url/gd;
const RE_IMPORT_DYN_LIT = /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/gd;
const RE_FETCH_LIT = /\bfetch\s*\(\s*(["'])([^"'\n]+)\1/gd;
const RE_HTTP_LIT = /https?:\/\/[^"'\s<>()]+/g;

function scanEsm(masked, raw, label) {
  const at = (r) => raw.slice(r[0], r[1]);
  const res = { fromImports: [], bareImports: [], dynImports: [], dynLitImports: [], urlRefs: [], fetchRefs: [], exportLists: [], exportDecls: [], exportDefaults: [], exportStars: [], metaUrls: [], externals: [] };

  for (const m of masked.matchAll(RE_IMPORT_FROM)) {
    const ix = m.indices;
    res.fromImports.push({
      start: m.index, end: m.index + m[0].length,
      defaultName: m[1] || "", nsName: m[2] || "",
      namedBlock: m[3] ? at(ix[3]).trim().replace(/^\{/, "").replace(/\}$/, "") : "",
      source: at(ix[5])
    });
  }
  for (const m of masked.matchAll(RE_IMPORT_BARE)) {
    res.bareImports.push({ start: m.index, end: m.index + m[0].length, source: at(m.indices[2]) });
  }
  for (const m of masked.matchAll(RE_IMPORT_DYN)) res.dynImports.push({ start: m.index, end: m.index + m[0].length });
  for (const m of masked.matchAll(RE_EXPORT_LIST)) {
    const ix = m.indices;
    res.exportLists.push({
      start: m.index, end: m.index + m[0].length,
      listRaw: at(ix[1]).trim(),
      source: m[3] ? at(ix[3]) : ""
    });
  }
  for (const m of masked.matchAll(RE_EXPORT_DECL)) {
    res.exportDecls.push({ start: m.index, end: m.index + m[0].length - m[1].length, name: m[2] });
  }
  for (const m of masked.matchAll(RE_EXPORT_DEFAULT)) {
    res.exportDefaults.push({ start: m.index, end: m.index + m[0].length - m[1].length });
  }
  for (const m of masked.matchAll(RE_EXPORT_STAR)) {
    const ix = m.indices;
    res.exportStars.push({ start: m.index, end: m.index + m[0].length, nsName: m[1] || "", source: at(ix[3]) });
  }
  for (const m of masked.matchAll(RE_META_URL)) res.metaUrls.push({ start: m.index, end: m.index + m[0].length });
  for (const m of masked.matchAll(RE_NEW_URL_META)) {
    res.urlRefs.push({ start: m.index, end: m.index + m[0].length, source: at(m.indices[2]) });
  }
  for (const m of masked.matchAll(RE_IMPORT_DYN_LIT)) {
    res.dynLitImports.push({ start: m.index, end: m.index + m[0].length, source: at(m.indices[2]) });
  }
  for (const m of masked.matchAll(RE_FETCH_LIT)) {
    res.fetchRefs.push({ start: m.index, end: m.index + m[0].length, source: at(m.indices[2]) });
  }

  /* 静态 import 与 export 语句不该重叠 */
  const ranges = [...res.fromImports, ...res.bareImports, ...res.exportLists, ...res.exportStars].sort((a, b) => a.start - b.start);
  for (let k = 1; k < ranges.length; k++) {
    if (ranges[k].start < ranges[k - 1].end) fail(`[${label}] import/export 语句解析重叠，请检查第 ${ranges[k].start} 字符附近`);
  }
  return res;
}

/* named block："a, b as c" → { a: "a", c: "b" } */
function parseNamedBlock(block, label) {
  const pairs = [];
  for (const part of block.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(t);
    if (m) { pairs.push({ local: m[1], exported: m[2] }); continue; }
    if (/^[A-Za-z_$][\w$]*$/.test(t)) { pairs.push({ local: t, exported: t }); continue; }
    fail(`[${label}] 无法解析导出/导入名: "${t}"（请手工调整后重试）`);
  }
  return pairs;
}

/* ============================================================
 * 3. 模块转换：ESM 源码 → 注册表工厂体
 * ============================================================ */
function transformModule(code, relKey, baseURL, label, ctx, cacheKey) {
  const mask = maskOf(code, cacheKey || null);
  const masked = mask.masked;
  const scan = scanEsm(masked, code, label);
  /* 代码内隐藏外链：字符串字面量里的 https:// （如运行时注入 CDN 脚本） */
  for (const [s, e] of mask.stringRanges) {
    for (const m of code.slice(s, e).matchAll(RE_HTTP_LIT)) {
      if (!isNamespaceURL(m[0])) scan.externals.push(m[0]);
    }
  }
  if (process.env.SNAPSHOT_DEBUG) {
    console.log(`   [dbg] ${relKey}`);
    console.log(`         from=${JSON.stringify(scan.fromImports.map((i) => ({ d: i.defaultName, ns: i.nsName, nb: i.namedBlock, s: i.source })))}`);
    console.log(`         lists=${JSON.stringify(scan.exportLists.map((e) => ({ raw: e.listRaw, from: e.source })))}`);
    console.log(`         decls=${JSON.stringify(scan.exportDecls.map((e) => e.name))}`);
  }
  const edits = [];
  const moduleDeps = [];        // 依赖的模块 key（已是工具根相对路径）
  const localExports = [];      // 本地声明的导出名
  const reExports = [];         // 以语句形式内联的 re-export
  const externalsRemote = [];   // 模块内静态引用的远程 URL（保留）

  /* 静态 import / re-export 的 source：必须落成注册表 key。
     注意 __req 的入参必须是「解析后的 key」——运行时没有「当前模块」概念，
     传 "./dom.js" 会直接报「模块未打包」（这是本打包器最容易踩的坑）。 */
  function depReq(spec, fromKey) {
    const r = ctx.localModule(fromKey, spec);
    if (r.kind === "remote") fail(`[${label}] 无法内联远程模块导入 "${spec}"（来自 ${fromKey}）：请改为本地 vendor 文件`);
    moduleDeps.push(r.key);
    return `__req(${JSON.stringify(r.key)})`;
  }

  /* import { a, b as c } / * as ns / default from "x" */
  for (const im of scan.fromImports) {
    const rq = depReq(im.source, relKey);
    const stmts = [];
    if (im.defaultName) stmts.push(`const ${im.defaultName} = ${rq}.default;`);
    if (im.nsName) stmts.push(`const ${im.nsName} = ${rq};`);
    if (im.namedBlock) {
      const pairs = parseNamedBlock(im.namedBlock, label);
      if (pairs.length) stmts.push(`const { ${pairs.map((p) => `${p.local}: ${p.exported}`).join(", ")} } = ${rq};`);
    }
    edits.push({ start: im.start, end: im.end, text: stmts.length ? stmts.join(" ") : `${rq};` });
  }
  /* import "x"（副作用导入） */
  for (const im of scan.bareImports) {
    edits.push({ start: im.start, end: im.end, text: `${depReq(im.source, relKey)};` });
  }
  /* export { a, b as c } [from "x"] */
  for (const ex of scan.exportLists) {
    const pairs = parseNamedBlock(ex.listRaw, label);
    if (ex.source) {
      const rq = depReq(ex.source, relKey);
      const body = pairs.map((p) => `${JSON.stringify(p.exported)}: ${rq}[${JSON.stringify(p.local)}]`).join(", ");
      edits.push({ start: ex.start, end: ex.end, text: `__exp({ ${body} });` });
    } else {
      const body = pairs.map((p) => `${JSON.stringify(p.exported)}: ${p.local}`).join(", ");
      reExports.push(body);
      edits.push({ start: ex.start, end: ex.end, text: "" });
    }
  }
  /* export const/let/var/function/class NAME */
  for (const ex of scan.exportDecls) {
    localExports.push(ex.name);
    edits.push({ start: ex.start, end: ex.end, text: "" });
  }
  /* export * [as ns] from "x" */
  for (const ex of scan.exportStars) {
    const rq = depReq(ex.source, relKey);
    edits.push({
      start: ex.start, end: ex.end,
      text: ex.nsName ? `__exp({ ${JSON.stringify(ex.nsName)}: ${rq} });` : `__exp(${rq});`
    });
  }
  /* export default（仅支持导出具名绑定 / 标识符） */
  for (const ex of scan.exportDefaults) {
    const afterIdx = ex.end;
    const tail = masked.slice(afterIdx, afterIdx + 120);
    if (/^\s*(?:async\s+)?function\s*\*?\s*[A-Za-z_$]/.test(tail) || /^\s*class\s+[A-Za-z_$]/.test(tail)) {
      /* export default function name(){} → function name(){} + 导出 default */
      const nm = /^\s*(?:async\s+)?(?:function\s*\*?\s*|class\s+)([A-Za-z_$][\w$]*)/.exec(tail);
      localExports.push(`__default = ${nm[1]}`);
      edits.push({ start: ex.start, end: ex.end, text: "" });
    } else {
      const dm = /^\s*([A-Za-z_$][\w$]*)\s*;?/.exec(tail);
      if (!dm) fail(`[${label}] 无法解析 export default 形态（仅支持具名绑定），请手工确认`);
      reExports.push(`"default": ${dm[1]}`);
      edits.push({ start: ex.start, end: ex.end + dm[0].length, text: "" });
    }
  }
  /* import.meta.url → 虚拟基址常量 */
  for (const mu of scan.metaUrls) {
    edits.push({ start: mu.start, end: mu.end, text: "__MODULE_URL__" });
  }
  /* new URL(rel, import.meta.url)：目标是 ESM 模块 → 不改写（虚拟基址归一化后能命中注册表）；
     是普通资源 → 换成 blob / data URI，保持 new URL(...).href 的用法可用 */
  for (const u of scan.urlRefs) {
    const r = ctx.local(relKey, u.source);
    if (r.kind === "remote") { externalsRemote.push(r.url); continue; }
    if (r.kind === "module") { moduleDeps.push(r.key); continue; }
    ctx.needAsset(r.key);
    edits.push({ start: u.start, end: u.end, text: `new URL(__assetURL(${JSON.stringify(r.key)}), document.baseURI)` });
  }
  /* import("字面量")：改写为注册表 key（__dynImport 以 BASE 为基准，故必须重写为归一化 key） */
  for (const d of scan.dynLitImports) {
    const r = ctx.local(relKey, d.source);
    if (r.kind === "module") moduleDeps.push(r.key);
    else if (r.kind !== "remote") ctx.needAsset(r.key);
    edits.push({ start: d.start, end: d.end, text: `__dynImport(${JSON.stringify(r.kind === "remote" ? d.source : r.key)})` });
  }
  /* fetch("本地文件")：json 走数据表，其它走资源表；解析不到的一律忽略（可能是运行时 API） */
  for (const f of scan.fetchRefs) {
    const r = ctx.ref(relKey, f.source);
    if (r.kind === "json") ctx.needData(r.key);
    else if (r.kind === "asset") ctx.needAsset(r.key);
    else if (r.kind === "remote") externalsRemote.push(r.url);
  }

  let body = applyEdits(code, edits);

  /* 动态 import(...) → __dynImport(...)。
     注意：字面量动态导入已在上一批被改写成 __dynImport("key")，而 \bimport 大小写敏感，
     不会二次命中 __dynImport，故无需再排除区间。 */
  const mask2 = maskOf(body, null);
  const dynEdits = [];
  for (const d of mask2.masked.matchAll(/\bimport\s*\(/g)) {
    dynEdits.push({ start: d.index, end: d.index + d[0].length, text: "__dynImport(" });
  }
  body = applyEdits(body, dynEdits);

  /* 模块尾部统一导出 */
  const expEntries = [];
  for (const n of localExports) {
    if (n.startsWith("__default = ")) expEntries.push(`"default": ${n.slice("__default = ".length)}`);
    else expEntries.push(`${JSON.stringify(n)}: ${n}`);
  }
  expEntries.push(...reExports);

  const factory =
    `__def(${JSON.stringify(relKey)}, function (__req, __exp) {\n` +
    `var __MODULE_URL__ = ${JSON.stringify(baseURL)};\n` +
    body.trimEnd() + "\n" +
    (expEntries.length ? `__exp({ ${expEntries.join(", ")} });\n` : "") +
    `});`;

  try { new Function("__def", factory); }
  catch (e) { fail(`[${label}] 语法自检失败: ${e.message}`); }

  return { factory, moduleDeps, externals: scan.externals, externalsRemote };
}

/* ============================================================
 * 4. 资源 / 数据收集
 * ============================================================ */
const MIME = {
  js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json",
  svg: "image/svg+xml", txt: "text/plain", md: "text/markdown", html: "text/html",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", ico: "image/x-icon"
};
function mimeOf(p) { return MIME[path.extname(p).slice(1).toLowerCase()] || "application/octet-stream"; }
function isTextMime(m) { return /^text\/|json|javascript|svg|markdown|xml/.test(m); }

function normKey(p) { return path.posix.normalize(p.replace(/\\/g, "/")).replace(/^\.\//, ""); }

function readTextOrBinary(abs, rel) {
  const mime = mimeOf(rel);
  if (isTextMime(mime)) return { kind: "text", mime, data: fs.readFileSync(abs, "utf8") };
  return { kind: "binary", mime, data: "data:" + mime + ";base64," + fs.readFileSync(abs).toString("base64") };
}

/* ============================================================
 * 5. 工具 / 版本发现
 * ============================================================ */
function semverCompare(a, b) {
  const pa = String(a).replace(/^v/i, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
function pickVersion(manifest, want) {
  const list = (manifest && Array.isArray(manifest.versions)) ? manifest.versions : [];
  if (!list.length) return null;
  if (want) {
    const hit = list.find((v) => v.id === want || v.version === want);
    if (!hit) fail(`manifest.json 中没有版本 "${want}"（可选: ${list.map((v) => v.id).join(", ")}）`);
    return hit;
  }
  if (manifest.latest) {
    const byId = list.find((v) => v.id === manifest.latest || v.version === manifest.latest);
    if (byId) return byId;
  }
  return list.slice().sort((a, b) => semverCompare(b.version || b.id, a.version || a.id))[0];
}
function discover() {
  return fs.readdirSync(TOOLS_DIR)
    .filter((n) => !n.startsWith("_") && fs.statSync(path.join(TOOLS_DIR, n)).isDirectory())
    .map((n) => {
      const mf = path.join(TOOLS_DIR, n, "manifest.json");
      if (!fs.existsSync(mf)) return null;
      let manifest; try { manifest = JSON.parse(fs.readFileSync(mf, "utf8")); } catch { return null; }
      if (!manifest || !Array.isArray(manifest.versions) || !manifest.versions.length) return null;
      return { name: n, dir: path.join(TOOLS_DIR, n), manifest };
    })
    .filter(Boolean);
}

/* ============================================================
 * 6. 单次打包
 * ============================================================ */
function buildSnapshot(tool, wantVersion, opts) {
  const { name, dir, manifest } = tool;
  const version = pickVersion(manifest, wantVersion);
  if (!version) fail(`[${name}] manifest.json 未提供可用版本`);
  const versionId = version.id || version.version || "latest";
  const label = `${name}@${versionId}`;

  /* 可选覆盖配置 */
  const cfgFile = path.join(dir, "build.snapshot.json");
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : {};
  const dataDirs = Array.isArray(cfg.dataDirs) && cfg.dataDirs.length ? cfg.dataDirs : ["data"];

  const baseURL = `https://snapshot.local/${name}/`;
  const remote = [];          // 保留的外链
  const assets = {};          // 内联资源（blob / data URI）
  const dataTable = {};       // 内联数据（fetch 目标）
  const modKeys = [];         // 已打包模块（拓扑序）
  const modules = {};

  /* ---- 6.1 entry ---- */
  const entryRel = normKey(version.entry || "index.html");
  const entryAbs = path.join(dir, entryRel);
  if (!fs.existsSync(entryAbs)) fail(`[${label}] entry 不存在: ${entryRel}`);
  const entryRaw = fs.readFileSync(entryAbs, "utf8");
  const isFragment = !/<!DOCTYPE|<html[\s>]/i.test(entryRaw);

  /* 片段 → 从壳取 <head> 骨架 */
  let headInner = "", shellNote = "", skeletonRaw = entryRaw;
  if (isFragment) {
    const shellAbs = path.join(dir, "index.html");
    if (!fs.existsSync(shellAbs)) fail(`[${label}] entry 是片段，但未找到壳 index.html 以提供骨架`);
    const shell = fs.readFileSync(shellAbs, "utf8");
    skeletonRaw = shell;
    const hm = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(shell);
    if (!hm) fail(`[${label}] 壳 index.html 中未找到 <head>`);
    headInner = hm[1]
      /* 壳自己的本地 <link rel=stylesheet> 不进快照（壳样式是内联 <style>，通常没有） */
      .replace(/<link\b[^>]*>/gi, (tag) => {
        if (!/rel=["']stylesheet["']/i.test(tag)) return tag;
        const href = /href=["']([^"']+)["']/i.exec(tag);
        if (href && isRemoteRef(href[1])) { remote.push(href[1]); return tag; }
        return "";
      })
      .trim();
    shellNote = `骨架取自壳 index.html（丢弃其 loader 引导脚本，快照不再依赖 fetch 加载版本）`;
  } else {
    const hm = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(entryRaw);
    headInner = hm ? hm[1].trim() : "";
  }
  /* 保留骨架的 <html> / <body> 属性（如 lang、data-theme），只接管 data-version */
  const htmlAttrM = /<html\b([^>]*)>/i.exec(skeletonRaw);
  const htmlAttrs = (htmlAttrM ? htmlAttrM[1] : "").replace(/\s*data-version=["'][^"']*["']/i, "").trim();
  const bodyAttrM = /<body\b([^>]*)>/i.exec(skeletonRaw);
  const bodyAttrs = (bodyAttrM ? bodyAttrM[1] : "").replace(/\s*data-version=["'][^"']*["']/i, "").trim();

  /* ---- 6.2 片段正文 + 版本元数据 ---- */
  let body = entryRaw;
  if (!isFragment) {
    const bm = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(entryRaw);
    body = bm ? bm[1] : entryRaw;
    body = body.replace(/<script\b[^>]*src=[^>]*>\s*<\/script>/gi, "");   // 完整 HTML 模式下也统一由打包器接管脚本
  }

  /* ---- 6.3 模块图（自动拓扑序） ---- */
  const meta = version;
  const pendingAssets = new Set();
  const pendingData = new Set();
  const externals = [];          // 模块内静态引用的远程 URL

  /* 统一引用解析：模块内 spec → 工具根相对 key（kind: module / asset / json / remote / bare / missing） */
  function refOf(fromKey, spec) {
    if (/^(https?:)?\/\//i.test(spec) || spec.startsWith("data:") || spec.startsWith("blob:")) return { kind: "remote", url: spec };
    const clean = spec.split("?")[0].split("#")[0];
    let key = normKey(clean.startsWith("/") ? clean.slice(1) : path.posix.join(path.posix.dirname(fromKey), clean));
    if (!fs.existsSync(path.join(dir, key)) && fs.existsSync(path.join(dir, key + ".js"))) key += ".js";
    const abs = path.join(dir, key);
    if (!fs.existsSync(abs)) return { kind: "bare", spec, key };
    const isJs = /\.m?js$/i.test(key);
    if (isJs) {
      const m = maskOf(fs.readFileSync(abs, "utf8"), abs).masked;
      return /\b(?:export|import)\b/.test(m) ? { kind: "module", key } : { kind: "asset", key };
    }
    if (/\.json$/i.test(key)) return { kind: "json", key };
    return { kind: "asset", key };
  }
  const ctx = {
    ref: refOf,
    /* 必须能本地化的引用：裸模块名 / 文件不存在 → 直接失败，不做静默降级 */
    local(fromKey, spec) {
      const r = refOf(fromKey, spec);
      if (r.kind === "bare" || r.kind === "missing")
        fail(`[${label}] 无法内联依赖 "${spec}"（来自 ${fromKey}）：既不是工具内文件，也不是可保留的外链`);
      return r;
    },
    /* 静态 import / re-export 目标：一律按 ESM 模块处理（副作用导入也是模块） */
    localModule(fromKey, spec) {
      const r = refOf(fromKey, spec);
      if (r.kind === "remote") return r;
      if (r.kind === "bare" || r.kind === "missing")
        fail(`[${label}] 无法内联依赖 "${spec}"（来自 ${fromKey}）：既不是工具内文件，也不是可保留的外链`);
      return { kind: "module", key: r.key };
    },
    needAsset: (k) => { if (k) pendingAssets.add(k); },
    needData: (k) => { if (k) pendingData.add(k); }
  };

  function addModule(key) {
    if (modules[key]) return key;
    const abs = path.join(dir, key);
    if (!fs.existsSync(abs)) fail(`[${label}] 模块不存在: ${key}`);
    const code = fs.readFileSync(abs, "utf8");
    const modURL = baseURL + key;
    const t = transformModule(code, key, modURL, label, ctx, abs);
    externals.push(...t.externals, ...t.externalsRemote);
    modules[key] = t.factory;          // 先占位，避免循环时无限递归
    for (const dk of t.moduleDeps) addModule(dk);   // DFS 后序 → 拓扑序
    if (!modKeys.includes(key)) modKeys.push(key);
    return key;
  }

  /* 脚本处理：head 与 body 统一走一遍（完整 HTML 模式的资源常声明在 head 里） */
  const moduleScripts = [];
  function handleScripts(text) {
    return text.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
      const srcM = /\ssrc=["']([^"']+)["']/i.exec(attrs);
      const isModule = /type=["']module["']/i.test(attrs);
      if (!srcM) return tag;                                    // 内联脚本原样保留
      const ref = srcM[1];
      if (isRemoteRef(ref)) { remote.push(ref); return tag; }   // 外链原样保留
      const key = normKey(ref);
      const abs = path.join(dir, key);
      if (!fs.existsSync(abs)) fail(`[${label}] 脚本不存在: ${ref}`);
      if (isModule) { moduleScripts.push({ key }); return `<!--SNAPSHOT_BUNDLE-->`; }
      const code = fs.readFileSync(abs, "utf8");                // 传统脚本：原位内联（语法自检）
      try { new Function(code); } catch (e) { fail(`[${label}] 语法自检失败 ${ref}: ${e.message}`); }
      return "<script>\n" + code.trimEnd() + "\n</script>";
    });
  }
  headInner = handleScripts(headInner);
  body = handleScripts(body);
  for (const ms of moduleScripts) addModule(ms.key);

  /* ---- 6.4 data/**.json → 内联数据表 ---- */
  for (const dd of dataDirs) {
    const absDir = path.join(dir, dd);
    if (!fs.existsSync(absDir)) continue;
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) { walk(p); continue; }
        if (!n.endsWith(".json")) continue;
        const rel = normKey(path.relative(dir, p));
        try { dataTable[rel] = JSON.parse(fs.readFileSync(p, "utf8")); }
        catch (e) { console.log(`   ⚠️ [${label}] 跳过无法解析的 JSON: ${rel}（${e.message}）`); }
      }
    };
    walk(absDir);
  }
  /* 显式声明的额外资源 */
  for (const rel of (cfg.extraAssets || [])) {
    const key = normKey(rel);
    const abs = path.join(dir, key);
    if (!fs.existsSync(abs)) fail(`[${label}] extraAssets 不存在: ${rel}`);
    assets[key] = readTextOrBinary(abs, key);
  }

  /* ---- 6.4b 模块内静态引用的资源 / 数据落表 ---- */
  for (const k of pendingAssets) {
    const abs = path.join(dir, k);
    if (!fs.existsSync(abs)) { console.log(`   ⚠️ [${label}] 资源不存在，跳过: ${k}`); continue; }
    if (!assets[k]) assets[k] = readTextOrBinary(abs, k);
  }
  for (const k of pendingData) {
    if (Object.prototype.hasOwnProperty.call(dataTable, k)) continue;
    const abs = path.join(dir, k);
    if (!fs.existsSync(abs)) { console.log(`   ⚠️ [${label}] 数据文件不存在，跳过: ${k}`); continue; }
    try { dataTable[k] = JSON.parse(fs.readFileSync(abs, "utf8")); }
    catch (e) { console.log(`   ⚠️ [${label}] JSON 解析失败，跳过: ${k}（${e.message}）`); }
  }

  /* ---- 6.5 CSS：<link rel=stylesheet> → <style>（统一提到 <head> 末尾，保证覆盖壳样式） ---- */
  const inlineCss = [], cssFiles = [];
  function handleCss(text) {
    return text.replace(/<link\b[^>]*>/gi, (tag) => {
      const hrefM = /href=["']([^"']+)["']/i.exec(tag);
      if (!hrefM) return tag;
      const relM = /rel=["']([^"']+)["']/i.exec(tag);
      const relType = relM ? relM[1].toLowerCase() : "";
      const href = hrefM[1];
      if (isRemoteRef(href)) { remote.push(href); return tag; }   // 远程 / data: → 原样保留
      const rel = normKey(href.split("?")[0]);
      const abs = path.join(dir, rel);
      if (relType === "stylesheet") {
        if (!fs.existsSync(abs)) fail(`[${label}] 样式不存在: ${href}`);
        let css = fs.readFileSync(abs, "utf8");
        /* CSS 内的相对资源：本地 → data URI；外链 → 保留并告警 */
        css = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, q, url) => {
          if (isRemoteRef(url) || url.startsWith("data:") || url.startsWith("#")) { remote.push(url); return full; }
          const assetKey = normKey(path.posix.join(path.posix.dirname(rel), url.split("?")[0]));
          const aAbs = path.join(dir, assetKey);
          if (!fs.existsSync(aAbs)) { remote.push(url); return full; }
          const a = readTextOrBinary(aAbs, assetKey);
          assets[assetKey] = a;
          return `url("${a.kind === "binary" ? a.data : "data:" + a.mime + ";base64," + Buffer.from(a.data, "utf8").toString("base64")}")`;
        });
        inlineCss.push(`/* ======== ${rel} ======== */\n` + css.trimEnd());
        cssFiles.push(rel);
        return "";
      }
      /* 图标：内联为 data URI（文件不存在则删除，避免产物残留死链） */
      if (/\bicon\b/.test(relType)) {
        if (!fs.existsSync(abs)) return "";
        const a = readTextOrBinary(abs, rel);
        assets[rel] = a;
        const dataURI = a.kind === "binary" ? a.data : "data:" + a.mime + ";base64," + Buffer.from(a.data, "utf8").toString("base64");
        return `<link rel="${relType}" href="${dataURI}" />`;
      }
      /* 其它本地 link（preload / modulepreload / manifest…）：目标已被内联，移除并告警 */
      console.log(`   ℹ️ [${label}] 移除本地 <link rel="${relType}">: ${href}`);
      return "";
    });
  }
  headInner = handleCss(headInner);
  body = handleCss(body);

  /* ---- 6.6 模块 bundle 组装 ---- */
  let bundle = "";
  if (modKeys.length) {
    const parts = modKeys.map((k) => `/* ======== module: ${k} ======== */\n` + modules[k]);
    bundle = parts.join("\n\n");
    try { new Function("__def", "__req", "__dynImport", bundle); }
    catch (e) { fail(`[${label}] bundle 语法自检失败: ${e.message}`); }
  }

  /* ---- 6.7 运行时（数据垫片 + 模块注册表 + 动态导入垫片） ---- */
  const runtime = renderRuntime(baseURL, dataTable, assets);
  const metaScript =
    `<script>\n/* 版本元数据（等价于壳的 injectMeta） */\n` +
    `document.documentElement.setAttribute("data-version", ${JSON.stringify(meta.version || versionId)});\n` +
    `window.__APP_META__ = ${JSON.stringify({ id: versionId, version: version.version || versionId, label: version.label || version.description || "", build: version.build || "", buildTime: version.buildTime || "" })};\n` +
    `</script>`;

  const bootScript =
    `<script>\n${runtime}\n` +
    (bundle ? `\n/* ======== modules（拓扑序） ======== */\n${bundle}\n` : "") +
    (modKeys.length ? `\n/* ======== 启动入口 ======== */\n__req(${JSON.stringify(moduleScripts[0].key)});\n` : "") +
    "\n/* ======== 版本徽章（壳已被丢弃，这里补齐；无 .brand 时自动跳过） ======== */\n" + VERSION_CHIP_JS + "\n" +
    `</script>`;

  /* ---- 6.8 拼装产物 ---- */
  const isNetworkURL = (u) => /^https?:\/\//i.test(u);   // data: URI 已内联，不算外链
  const allRemote = [...new Set([...remote, ...externals])].filter(isNetworkURL);
  const blockingList = allRemote.filter((u) => !isFontHost(u)
    && !(Array.isArray(cfg.allowRemote) && cfg.allowRemote.some((p) => u.startsWith(p))));
  const remoteNote = allRemote.length
    ? `保留外链 ${allRemote.length} 个${blockingList.length ? `（其中 ${blockingList.length} 个阻塞型，离线时相应功能不可用）` : "（仅字体等视觉降级）"}:\n           ${allRemote.join("\n           ")}`
    : `无外链，完全离线可用`;
  const banner =
    `<!-- ⚠️ 本文件由 tools/_build/build-snapshot.mjs 自动生成，请勿手改！\n` +
    `     源: tools/${name}/${entryRel}  ·  版本: ${versionId}（v${version.version || versionId}）  ·  启动: ${moduleScripts[0] ? moduleScripts[0].key : "无"}\n` +
    `     内联: 模块 ${modKeys.length} 个 / 样式 ${cssFiles.length} 个 / 数据 ${Object.keys(dataTable).length} 项 / 资源 ${Object.keys(assets).length} 项\n` +
    `     ${remoteNote}\n` +
    `     重新生成: node tools/_build/build-snapshot.mjs ${name}${wantVersion ? "@" + wantVersion : ""} -->`;

  const html =
    `<!DOCTYPE html>\n${banner}\n<html ${htmlAttrs} data-version="${meta.version || versionId}">\n<head>\n` +
    headInner + "\n" +
    (inlineCss.length ? `<style>\n${inlineCss.join("\n\n")}\n</style>\n` : "") +
    `</head>\n<body${bodyAttrs ? " " + bodyAttrs : ""}>\n` +
    metaScript + "\n" +
    body.trim() + "\n" +
    bootScript + "\n" +
    `</body>\n</html>\n`;

  /* ---- 6.9 产物自检 ---- */
  const problems = [];
  if (/\bimport\s*\.\s*meta\b/.test(maskOf(html, null).masked)) problems.push("残留 import.meta");
  if (/<script\b[^>]*\ssrc=["'](?!https?:|\/\/)/i.test(html)) problems.push("残留本地 <script src>");
  if (/<link\b[^>]*\shref=["'](?!https?:|\/\/|data:)/i.test(html)) problems.push("残留本地 <link href>");
  const bodyScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const [i, sc] of bodyScripts.entries()) {
    if (/\bexport\s*[{(]|\bexport\s+(?:const|let|var|function|class|default)\b/.test(maskOf(sc, null).masked))
      problems.push(`第 ${i + 1} 段脚本残留 ESM export`);
    if (/\b(?:from\s*["'][^"']+["']|\bimport\s*\{)/.test(maskOf(sc, null).masked))
      problems.push(`第 ${i + 1} 段脚本残留 import from 语句`);
    try { new Function(sc); } catch (e) { problems.push(`第 ${i + 1} 段脚本语法错误: ${e.message}`); }
  }
  /* 动态导入的目标必须都在注册表内（否则运行到该功能才报错，属静默缺陷） */
  const defKeys = [...html.matchAll(/__def\((["'])([^"']+)\1/g)].map((m) => m[2]);
  for (const m of html.matchAll(/__dynImport\(\s*(["'])([^"']+)\1\s*\)/g)) {
    if (!defKeys.includes(m[2])) problems.push(`动态导入未内联: ${m[2]}`);
  }
  if (problems.length) fail(`[${label}] 产物自检未通过:\n   - ${problems.join("\n   - ")}`);

  /* ---- 6.10 落盘 ---- */
  const outRel = opts.out || path.join(opts.release ? "release" : "dist", `${name}-${versionId}.html`);
  const outAbs = path.isAbsolute(outRel) ? outRel : path.join(dir, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, "utf8");

  const size = fs.statSync(outAbs).size;
  console.log(`✓ [${label}] ${path.relative(ROOT, outAbs).replace(/\\/g, "/")}`);
  console.log(`  产物 ${html.split("\n").length} 行 / ${kb(size)} KB` +
    ` | 模块 ${modKeys.length} · 样式 ${cssFiles.length} · 数据 ${Object.keys(dataTable).length} · 资源 ${Object.keys(assets).length}`);
  if (shellNote) console.log(`  ${shellNote}`);
  const uniqRemote = [...new Set(remote)].filter(isNetworkURL);
  const uniqExternal = [...new Set(externals)].filter(isNetworkURL);
  const allowRemote = Array.isArray(cfg.allowRemote) ? cfg.allowRemote : [];
  const isAllowed = (u) => isFontHost(u) || allowRemote.some((p) => u.startsWith(p));
  const blocking = [...uniqRemote, ...uniqExternal].filter((u) => !isAllowed(u));
  const degradable = [...uniqRemote, ...uniqExternal].filter(isAllowed);

  if (degradable.length) console.log(`  ⚠️ 保留外链 ${degradable.length} 个（离线仅视觉降级，功能不受影响）: ${degradable.join(", ")}`);
  if (blocking.length) console.log(`  ⚠️ 阻塞型外链 ${blocking.length} 个（离线时相应功能不可用，建议内联为本地 vendor）: ${blocking.join(", ")}`);
  if (!uniqRemote.length && !uniqExternal.length) console.log(`  无外链 · 可完全离线 file:// 双击使用`);

  return { name, versionId, outAbs, size, modules: modKeys.length, data: Object.keys(dataTable).length, assets: Object.keys(assets).length, remote: [...uniqRemote, ...uniqExternal], blocking, ok: true };
}

/* ============================================================
 * 7. 运行时源码模板
 * ============================================================ */
function renderRuntime(baseURL, dataTable, assets) {
  return `/* ===== snapshot runtime（数据垫片 + 模块注册表 + 动态导入垫片） ===== */
var __snapshot = (function () {
  "use strict";
  var BASE = ${JSON.stringify(baseURL)};
  var DATA = ${JSON.stringify(dataTable)};
  var ASSETS = ${JSON.stringify(assets)};
  var DEFS = {}, CACHE = {}, LOADING = {};

  /* 归一化：绝对 URL / 相对 URL / 带 query 的路径 → 相对工具根的 key */
  function toKey(u) {
    var s = String(u == null ? "" : u);
    if (s.indexOf(BASE) === 0) s = s.slice(BASE.length);
    else {
      try { var abs = new URL(s, BASE).href; if (abs.indexOf(BASE) === 0) s = abs.slice(BASE.length); } catch (e) {}
    }
    s = s.split("?")[0].split("#")[0].replace(/^\\.\\//, "");
    return s;
  }

  /* fetch 垫片：命中内联数据表则本地应答；否则回落原生 fetch（外链） */
  var _fetch = typeof window !== "undefined" && window.fetch ? window.fetch.bind(window) : null;
  if (typeof window !== "undefined") {
    window.fetch = function (input, init) {
      var url = (typeof input === "string") ? input : (input && input.url) || "";
      var k = toKey(url);
      if (Object.prototype.hasOwnProperty.call(DATA, k)) {
        var d = DATA[k];
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK (snapshot inline)", url: k,
          headers: { get: function () { return "application/json"; } },
          json: function () { return Promise.resolve(d); },
          text: function () { return Promise.resolve(JSON.stringify(d)); }
        });
      }
      if (_fetch) return _fetch(input, init);
      return Promise.reject(new Error("[snapshot] 未内联且无网络: " + url));
    };
  }

  function __def(key, factory) { DEFS[key] = factory; }

  function __req(key) {
    if (Object.prototype.hasOwnProperty.call(CACHE, key)) return CACHE[key];
    if (!Object.prototype.hasOwnProperty.call(DEFS, key)) throw new Error("[snapshot] 模块未打包: " + key);
    if (LOADING[key]) {
      console.warn("[snapshot] 循环依赖（返回半初始化命名空间）: " + key);
      return CACHE[key] || {};
    }
    LOADING[key] = true;
    var ns = {};
    try { DEFS[key](__req, function (obj) { if (obj) for (var k in obj) ns[k] = obj[k]; }); }
    finally { delete LOADING[key]; }
    CACHE[key] = ns;
    return ns;
  }

  /* 动态导入垫片：注册表命中 → 立即返回（懒执行语义保留）；外链 → 走原生 import() */
  function __dynImport(u) {
    var href;
    try { href = new URL(String(u), BASE).href; } catch (e) { return Promise.reject(e); }
    var k = toKey(href);
    if (Object.prototype.hasOwnProperty.call(DEFS, k)) {
      try { return Promise.resolve(__req(k)); } catch (e) { return Promise.reject(e); }
    }
    if (/^(blob:|data:|https?:)/.test(href)) return import(href);
    return Promise.reject(new Error("[snapshot] 动态导入未内联: " + u +
      "（解析为 " + href + "；如需内联请在 build.snapshot.json 的 extraAssets 中声明）"));
  }

  /* 静态资源 → blob / data URI（供 new URL(rel, import.meta.url) 这类用法消费） */
  function __assetURL(p) {
    var k = toKey(p);
    var a = ASSETS[k];
    if (!a) throw new Error("[snapshot] 资源未内联: " + k);
    if (a.url) return a.url;
    a.url = (a.kind === "binary") ? a.data : URL.createObjectURL(new Blob([a.data], { type: a.mime }));
    return a.url;
  }

  return {
    def: __def, req: __req, dynImport: __dynImport, asset: __assetURL,
    data: DATA, assets: ASSETS, base: BASE,
    /* 惰性取值：模块工厂在 runtime 之后才注册，这里不能提前求值 */
    get keys() { return Object.keys(DEFS); }
  };
})();
var __def = __snapshot.def, __req = __snapshot.req, __dynImport = __snapshot.dynImport, __assetURL = __snapshot.asset;
window.__SNAPSHOT__ = __snapshot;`;
}

/* 版本徽章 + 关于弹窗（等价壳 index.html 的 mountVersionUI / showAbout，样式复用壳内联 CSS） */
const VERSION_CHIP_JS = `(function () {
  var meta = window.__APP_META__ || {};
  var brand = document.querySelector(".brand");
  if (!brand || document.getElementById("versionChip")) return;
  var chip = document.createElement("button");
  chip.id = "versionChip";
  chip.className = "version-chip";
  chip.type = "button";
  chip.title = "关于版本（快照）";
  chip.textContent = "v" + (meta.version || meta.id || "");
  chip.addEventListener("click", function () {
    var old = document.getElementById("aboutOverlay");
    if (old) { old.remove(); return; }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    var rows = [["版本", "v" + meta.version], ["名称", meta.label], ["构建", meta.build], ["构建时间", meta.buildTime], ["分发形态", "单文件快照"]]
      .filter(function (r) { return r[1]; })
      .map(function (r) { return '<div class="about-row"><span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + '</span></div>'; }).join("");
    var ov = document.createElement("div");
    ov.id = "aboutOverlay";
    ov.className = "about-overlay";
    ov.innerHTML = '<div class="about-modal" role="dialog" aria-modal="true" aria-label="关于版本">' +
      '<div class="about-head"><span class="about-title">关于</span><button class="about-close" aria-label="关闭">&times;</button></div>' + rows + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector(".about-close").addEventListener("click", function () { ov.remove(); });
    document.addEventListener("keydown", function onEsc(e) { if (e.key === "Escape") { ov.remove(); document.removeEventListener("keydown", onEsc); } });
  });
  brand.appendChild(chip);
})();`;

/* ============================================================
 * 8. 入口
 * ============================================================ */
const args = process.argv.slice(2);
const opts = {
  release: args.includes("--release"),
  strict: args.includes("--strict"),
  list: args.includes("--list"),
  out: (args.find((a) => a.startsWith("--out=")) || "").slice(6) || ""
};
const targets = args.filter((a) => !a.startsWith("--")).map((a) => {
  const at = a.indexOf("@");
  return at < 0 ? { name: a, version: "" } : { name: a.slice(0, at), version: a.slice(at + 1) };
});

const all = discover();
if (opts.list) {
  console.log("可打包工具（manifest.json 含 versions[].entry）:");
  for (const t of all) {
    console.log(`  ${t.name}  latest=${t.manifest.latest || "-"}`);
    for (const v of t.manifest.versions) console.log(`     - ${v.id}  v${v.version || v.id}  ${v.entry}  ${v.label || v.description || ""}`);
  }
  process.exit(0);
}

/* 目标解析：显式指定工具时逐个校验并给出可操作的提示（不泄漏堆栈） */
const queue = [];
if (targets.length) {
  for (const t of targets) {
    const hit = all.find((x) => x.name === t.name);
    if (!hit) {
      console.error(`✗ 无法打包 "${t.name}"。`);
      console.error(`  本打包器按 manifest 版本快照工作：需要 tools/${t.name}/manifest.json 且含 versions[].entry。`);
      console.error(`  用 --list 查看当前可打包清单${all.length ? `（现有：${all.map((x) => x.name).join(", ")}）` : ""}。`);
      process.exit(1);
    }
    queue.push({ hit, version: t.version });
  }
} else {
  for (const hit of all) queue.push({ hit, version: "" });
}

if (!queue.length) {
  console.log("没有可打包的工具（tools/<name>/manifest.json 需含 versions[].entry）。");
  process.exit(0);
}
if (opts.out && queue.length > 1) fail("--out 仅支持单目标；请分别指定工具。");

const report = [];
let failed = 0, hasBlocking = false;
console.log(`构建快照 · ${queue.length} 个目标${opts.release ? " · 输出到 release/" : ""}\n`);
for (const q of queue) {
  try {
    const r = buildSnapshot(q.hit, q.version, opts);
    if (r.blocking.length) hasBlocking = true;
    report.push(r);
  } catch (e) {
    failed++;
    console.error(`✗ ${e.message}`);
  }
}
console.log(`\n完成：成功 ${report.length} · 失败 ${failed}`);
if (report.length) {
  const total = report.reduce((s, r) => s + r.size, 0);
  console.log(`产物合计 ${kb(total)} KB`);
}
if (opts.strict && hasBlocking) {
  console.error("✗ --strict：存在阻塞型外链（离线时功能不可用），构建判定失败");
  process.exit(1);
}
process.exit(failed ? 1 : 0);
