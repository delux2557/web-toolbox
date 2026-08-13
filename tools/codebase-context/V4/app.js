"use strict";

/* ============================================================
 * Code Context Aggregator
 * 单文件实现：文件遍历 → 过滤 → 聚合 → 导出
 * ============================================================ */

/* ---------- Constants ---------- */
const MAX_FILE_SIZE = 5 * 1024 * 1024;   // 5MB
const COPY_LIMIT    = 500 * 1024;        // 500KB 字符
const CONCURRENCY   = 50;                // 并发读取上限
const PREVIEW_HEAD  = 2000;              // 预览首部行数
const PREVIEW_TAIL  = 200;               // 预览尾部行数

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "output",
  "__pycache__", ".venv", "venv", ".env", "env", "coverage", ".next", ".nuxt",
  ".output", ".cache", ".parcel-cache", ".idea", ".vscode", ".vs", "target",
  "vendor", "bower_components", ".gradle", ".turbo", ".expo", ".svelte-kit",
  ".angular", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".eggs",
  ".docusaurus", ".astro", ".vercel", ".netlify", ".yarn", ".pnpm-store",
  "Pods", "DerivedData", "bin", "obj", "cmake-build-debug", "__pypackages__"
]);

const IGNORED_NAMES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
  "cargo.lock", "gemfile.lock", "poetry.lock", "composer.lock", "pipfile.lock",
  "npm-shrinkwrap.json", ".ds_store", "thumbs.db", "desktop.ini"
]);

const TEXT_EXTS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "java", "go", "rs", "rb", "php",
  "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "cs", "sh", "bash", "zsh", "fish",
  "ps1", "bat", "cmd", "sql", "graphql", "gql", "swift", "kt", "kts", "dart",
  "r", "lua", "pl", "pm", "ex", "exs", "erl", "hrl", "clj", "cljs", "cljc",
  "scala", "sc", "groovy", "gradle", "ini", "cfg", "conf", "toml", "yaml", "yml",
  "json", "jsonc", "json5", "xml", "svg", "html", "htm", "xhtml", "css", "scss",
  "sass", "less", "styl", "vue", "svelte", "astro", "md", "mdx", "markdown",
  "txt", "text", "log", "csv", "tsv", "properties", "rst", "adoc", "tex", "bib",
  "proto", "thrift", "sol", "nix", "elm", "hs", "fs", "fsx", "fsi", "zig", "nim",
  "vb", "prisma", "edge", "liquid", "ejs", "hbs", "twig", "jinja", "pug",
  "mustache", "handlebars", "http", "rest", "dockerfile", "makefile", "cmake"
]);

const LANG_MAP = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", tsx: "tsx", py: "python", java: "java", go: "go",
  rs: "rust", rb: "ruby", php: "php", c: "c", h: "c", cc: "cpp", cpp: "cpp",
  cxx: "cpp", hpp: "cpp", hh: "cpp", cs: "csharp", sh: "bash", bash: "bash",
  zsh: "bash", fish: "fish", ps1: "powershell", bat: "batch", sql: "sql",
  graphql: "graphql", gql: "graphql", swift: "swift", kt: "kotlin", kts: "kotlin",
  dart: "dart", r: "r", lua: "lua", pl: "perl", ex: "elixir", exs: "elixir",
  erl: "erlang", hrl: "erlang", clj: "clojure", cljs: "clojure", scala: "scala",
  groovy: "groovy", toml: "toml", yaml: "yaml", yml: "yaml", json: "json",
  jsonc: "jsonc", xml: "xml", html: "html", htm: "html", css: "css", scss: "scss",
  sass: "sass", less: "less", vue: "vue", svelte: "svelte", astro: "astro",
  md: "markdown", mdx: "mdx", txt: "text", csv: "text", log: "text",
  dockerfile: "dockerfile", makefile: "makefile", cmake: "cmake", proto: "protobuf",
  sol: "solidity", nix: "nix", elm: "elm", hs: "haskell", fs: "fsharp",
  fsx: "fsharp", zig: "zig", nim: "nim", vb: "vbnet", tex: "latex", pug: "pug",
  ejs: "ejs", hbs: "handlebars", ini: "ini", conf: "ini", properties: "properties",
  rst: "rst", http: "http", prisma: "prisma"
};

/* ---------- DOM refs ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  empty: $("emptyState"), scan: $("scanState"), results: $("resultsState"),
  dropzone: $("dropzone"), compat: $("compatNote"), fileInput: $("fileInput"),
  currentFile: $("currentFile"), progressFill: $("progressFill"),
  progressText: $("progressText"), progressPct: $("progressPct"),
  summary: $("summary"), copyBtn: $("copyBtn"), downloadBtn: $("downloadBtn"),
  lineNumToggle: $("lineNumToggle"), reselectBtn: $("reselectBtn"),
  treeRoot: $("treeRoot"), treeCount: $("treeCount"), preview: $("preview"),
  previewCount: $("previewCount"), previewBanner: $("previewBanner"),
  statusbar: $("statusbar"), stFiles: $("stFiles"), stChars: $("stChars"),
  stTokens: $("stTokens"), stLog: $("stLog"), toastWrap: $("toastWrap")
};

/* ---------- App state ---------- */
let fullMarkdown = "";
let fileCount = 0;
let totalChars = 0;
let tokenEst = 0;
let skipCount = 0;
let logLine = "";

/* ---------- 场景状态（纯配置驱动，零硬编码） ---------- */
const FALLBACK_SCENARIO = {
  id: "general-fallback",
  name: "通用模式",
  systemPrompt: "你是一位技术专家，请全面分析以下代码库。"
};
let scenarios = [];
let currentScenario = FALLBACK_SCENARIO;
let scenariosPromise = null;
let currentFiles = [];
let currentRootName = "";
let currentWarnings = [];

/* ============================================================
 * Theme
 * ============================================================ */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("themeIconSun").style.display = theme === "dark" ? "none" : "block";
  $("themeIconMoon").style.display = theme === "dark" ? "block" : "none";
  try { localStorage.setItem("cca-theme", theme); } catch (_) {}
}
function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem("cca-theme"); } catch (_) {}
  const pref = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(stored || pref);
}
$("themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme;
  applyTheme(cur === "dark" ? "light" : "dark");
});

/* ============================================================
 * Helpers
 * ============================================================ */
function extOf(name) {
  const i = name.lastIndexOf(".");
  if (i <= 0) return "";
  return name.slice(i + 1).toLowerCase();
}
function pathHasIgnoredDir(path) {
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    if (IGNORED_DIRS.has(parts[i])) return true;
  }
  return false;
}
function shouldInclude(path, name) {
  const base = name.toLowerCase();
  if (IGNORED_NAMES.has(base)) return false;
  if (/\.min\.(js|css|mjs)$/i.test(base)) return false;
  if (/\.(map|d\.ts)$/i.test(base)) return false;
  if (/\.lock$/i.test(base)) return false;
  const ext = extOf(base);
  if (!ext) return false;            // 无扩展名的点文件（.env / .gitignore 等）默认跳过
  return TEXT_EXTS.has(ext);
}
function humanSize(chars) {
  if (chars < 1000) return chars + " 字符";
  if (chars < 1e6) return (chars / 1024).toFixed(1) + " KB";
  return (chars / 1048576).toFixed(2) + " MB";
}
function num(n) { return (n || 0).toLocaleString("en-US"); }
function langFor(path) { return LANG_MAP[extOf(path)] || ""; }
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
/* ============================================================
 * 注入防护（XSS / HTML 注入 / 脚本注入）
 * ------------------------------------------------------------
 * 约定：任何「用户可控文本」（文件名、路径、文件内容、场景数据）在写入
 * innerHTML 前，都必须经过 escapeHTML 或 sanitizeHighlightedHTML 之一。
 *
 * 防范的注入类型与对应手段：
 * 1) HTML 标签注入   <img onerror=...> / <script>  → escapeHTML 转义 & < > " '
 * 2) 事件属性注入   on* / javascript: URL          → 转义引号 + 白名单清洗
 * 3) 第三方库输出污染（hljs 的 .value）              → sanitizeHighlightedHTML 白名单
 * 4) 属性值逃逸      " 或 ' 提前闭合属性             → escapeHTML 同时转义双/单引号
 *
 * 其余写入路径（textContent / option.value / textarea.value）为属性赋值，
 * 浏览器不解析为 HTML，天然安全，无需转义。
 * ============================================================ */
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/* ---- highlight.js 动态加载（CDN，业内主流高亮库）---- */
let highlightReady = null;
function ensureHighlight() {
  if (highlightReady) return highlightReady;
  highlightReady = new Promise((resolve) => {
    if (window.hljs) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return highlightReady;
}
function toast(msg, type) {
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  els.toastWrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 220);
  }, 2400);
}
function setLog(msg) { logLine = msg; els.stLog.textContent = msg; }

/* 并发受限的 map */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ============================================================
 * File reading
 * ============================================================ */
async function readEntry(entry) {
  try {
    const file = entry.file ? entry.file : await entry.handle.getFile();
    if (file.size > MAX_FILE_SIZE) return { ok: false, reason: "size", size: file.size };
    const content = await file.text();
    return { ok: true, size: file.size, content };
  } catch (e) {
    return { ok: false, reason: "error", error: e };
  }
}

/* ============================================================
 * Directory traversal
 * ============================================================ */
async function walkHandle(handle, base, out) {
  for await (const entry of handle.values()) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walkHandle(entry, rel, out);
    } else {
      out.push({ path: rel, name: entry.name, handle: entry });
    }
  }
  return out;
}

/* ============================================================
 * Tree (nested object → ASCII string + DOM)
 * ============================================================ */
function buildTreeObject(paths) {
  const root = { children: new Map() };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() });
      node = node.children.get(part);
    }
    node.isFile = true;
  }
  return root;
}
function treeASCII(node, prefix, out) {
  const entries = [...node.children.entries()];
  entries.forEach(([name, child], i) => {
    const last = i === entries.length - 1;
    out.push(prefix + (last ? "└── " : "├── ") + name + (child.isFile ? "" : "/"));
    if (!child.isFile) treeASCII(child, prefix + (last ? "    " : "│   "), out);
  });
}

const ICON_FOLDER = '<svg class="fi" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_FILE = '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>';

function treeDOM(node) {
  const ul = document.createElement("ul");
  for (const [name, child] of node.children) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    if (child.isFile) {
      row.className = "tree-row is-file";
      row.innerHTML = ICON_FILE + '<span>' + escapeHTML(name) + "</span>";
      li.appendChild(row);
    } else {
      row.className = "tree-row is-dir";
      const tw = document.createElement("span");
      tw.className = "tw"; tw.textContent = "▾";
      row.innerHTML = ICON_FOLDER + '<span>' + escapeHTML(name) + "</span>";
      row.prepend(tw);
      const nested = treeDOM(child);
      nested.className = "nested";
      li.appendChild(row);
      li.appendChild(nested);
      li.classList.add("open");
      row.addEventListener("click", () => {
        const open = li.classList.toggle("open");
        tw.textContent = open ? "▾" : "▸";
      });
    }
    ul.appendChild(li);
  }
  return ul;
}

/* ============================================================
 * Markdown generation
 * ============================================================ */
function fence(content, lang) {
  let ticks = "```";
  while (content.includes(ticks)) ticks += "`";
  const open = ticks + (lang ? lang : "");
  return open + "\n" + content + (content.endsWith("\n") ? "" : "\n") + ticks;
}
function buildMarkdown(rootName, files, warnings) {
  const chars = files.reduce((s, f) => s + f.content.length, 0);
  const tokens = Math.round(chars / 4);
  const treeObj = buildTreeObject(files.map((f) => f.path));
  const treeLines = [];
  treeASCII(treeObj, "", treeLines);

  const lines = [];
  lines.push("# 📊 Codebase Context");
  lines.push("");
  lines.push("**项目**: `" + rootName + "`");
  lines.push("");
  lines.push("- **总文件数**: " + files.length);
  lines.push("- **总字符数**: " + humanSize(chars) + " (" + num(chars) + ")");
  lines.push("- **预估 Token**: ~" + num(tokens));
  if (warnings.length) lines.push("- **跳过文件**: " + warnings.length);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 🌳 目录结构");
  lines.push("");
  lines.push(fence(treeLines.join("\n"), "text"));
  lines.push("");
  lines.push("## 📁 文件内容聚合");
  lines.push("");

  for (const f of files) {
    lines.push("### `" + f.path + "`");
    lines.push("");
    lines.push(fence(f.content, langFor(f.path)));
    lines.push("");
  }
  return lines.join("\n");
}

/* 场景 System Prompt 注入块：人类可读强引导（引用块） */
function buildSystemPromptBlock(scenario) {
  const s = scenario || FALLBACK_SCENARIO;
  const prompt = s.systemPrompt || "";
  const parts = [];
  parts.push("> ⚙️ 系统指令（System Prompt）：请严格遵循以下场景设定进行回答。");
  prompt.split("\n").forEach((l) => parts.push("> " + l));
  parts.push("");
  return parts.join("\n") + "\n";
}

/* 重建待导出 Markdown（场景切换时调用，不触发重新扫描） */
function updateExportData() {
  fullMarkdown = buildSystemPromptBlock(currentScenario) +
    buildMarkdown(currentRootName, currentFiles, currentWarnings);
}

/* ============================================================
 * Markdown → HTML (轻量渲染器，无第三方库)
 * ============================================================ */
function inlineMarkdown(text) {
  return escapeHTML(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
/* 白名单清洗高亮输出：hljs 的 .value 虽已自行转义，但它是唯一「未经本地 escapeHTML」
   就直接写入 innerHTML 的路径。这里再加一道纵深防御——只放行 hljs 约定的
   <span class="hljs-*"> 与 </span>，其余任何标签、事件属性或孤立 < > 一律转义，
   杜绝第三方库输出被污染时引入任意标签 / 脚本。 */
function sanitizeHighlightedHTML(html) {
  return html.replace(/<\/?[a-zA-Z][^>]*>|[<>]/g, (tag) => {
    if (tag === "<") return "&lt;";
    if (tag === ">") return "&gt;";
    if (tag.toLowerCase() === "</span>") return tag;
    const m = /^<span\s+class="([^"]*)"\s*>$/i.exec(tag);
    if (m && /^hljs-[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*$/.test(m[1].trim())) return tag;
    return tag.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  });
}
function highlightCode(code, lang) {
  if (window.hljs && lang && window.hljs.getLanguage(lang)) {
    try {
      return sanitizeHighlightedHTML(
        window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      );
    } catch (e) { /* 忽略，退回纯文本 */ }
  }
  return null;
}
/* 把高亮后的 HTML 按行拆分，并保证每行的 <span> 平衡（多行注释/字符串不破色） */
function splitHighlighted(html) {
  const raw = html.split("\n");
  const tagRe = /<span[^>]*>|<\/span>/g;
  const startStack = [], endStack = [];
  const open = [];
  raw.forEach((line) => {
    startStack.push(open.slice());
    let m;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(line)) !== null) {
      if (m[0].charAt(1) === "/") open.pop();
      else open.push(m[0]);
    }
    endStack.push(open.slice());
  });
  return raw.map((line, i) =>
    startStack[i].join("") + line + "</span>".repeat(endStack[i].length)
  );
}
function renderCodeBlock(code, lang, lineNumbers) {
  const label = escapeHTML(lang || "text");
  const highlighted = highlightCode(code, lang);
  const html = highlighted != null ? highlighted : escapeHTML(code);
  if (lineNumbers) {
    const ls = splitHighlighted(html);
    if (ls.length && ls[ls.length - 1] === "") ls.pop();
    const body = ls.map((l, i) =>
      '<div class="cl"><span class="cln">' + (i + 1) + '</span><span class="clc">' + (l || " ") + "</span></div>"
    ).join("");
    return '<figure class="code"><figcaption>' + label + "</figcaption><pre>" + body + "</pre></figure>";
  }
  return '<figure class="code"><figcaption>' + label + "</figcaption><pre><code>" + html + "</code></pre></figure>";
}
function mdToHTML(md, lineNumbers) {
  const lines = md.split("\n");
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 引用块（人类可读的 System Prompt 引导）
    if (line.startsWith("> ")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith("> ")) { buf.push(lines[i].slice(2)); i++; }
      html += "<blockquote>" + buf.map((l) => inlineMarkdown(l)).join("<br>") + "</blockquote>";
      continue;
    }
    const open = line.match(/^(`{3,})([^`]*)$/);
    if (open) {
      const fenceLen = open[1].length;
      const lang = open[2].trim();
      const buf = [];
      i++;
      while (i < lines.length) {
        const close = lines[i].match(/^(`{3,})\s*$/);
        if (close && close[1].length >= fenceLen) { i++; break; }
        buf.push(lines[i]);
        i++;
      }
      html += renderCodeBlock(buf.join("\n"), lang, lineNumbers);
      continue;
    }
    if (/^###\s/.test(line)) { html += "<h3>" + inlineMarkdown(line.slice(4).trim()) + "</h3>"; i++; continue; }
    if (/^##\s/.test(line)) { html += "<h2>" + inlineMarkdown(line.slice(3).trim()) + "</h2>"; i++; continue; }
    if (/^#\s/.test(line)) { html += "<h1>" + inlineMarkdown(line.slice(2).trim()) + "</h1>"; i++; continue; }
    if (/^-{3,}\s*$/.test(line)) { html += "<hr>"; i++; continue; }
    if (line.trim() === "") { i++; continue; }
    if (/^[-*]\s+/.test(line)) { html += '<p class="kpi">' + inlineMarkdown(line.replace(/^[-*]\s+/, "")) + "</p>"; i++; continue; }
    html += "<p>" + inlineMarkdown(line) + "</p>";
    i++;
  }
  return html;
}

/* ============================================================
 * Preview (fold-aware truncation)
 * ============================================================ */
function previewSplit(md, headLines, tailLines) {
  const lines = md.split("\n");
  const total = lines.length;
  if (total <= headLines + tailLines) return { head: md, tail: "", fold: 0 };

  let hi = headLines;
  let openLen = 0;
  for (let i = 0; i < hi; i++) {
    const m = lines[i].match(/^(`{3,})(.*)$/);
    if (m) {
      if (openLen === 0) openLen = m[1].length;
      else if (m[1].length >= openLen) openLen = 0;
    }
  }
  if (openLen > 0) {
    while (hi < total) {
      const m = lines[hi].match(/^(`{3,})\s*$/);
      hi++;
      if (m && m[1].length >= openLen) break;
    }
  }

  let lo = total - tailLines;
  while (lo > hi && !lines[lo].startsWith("### ")) lo--;
  if (lo <= hi) lo = total;

  return {
    head: lines.slice(0, hi).join("\n"),
    tail: lo < total ? lines.slice(lo).join("\n") : "",
    fold: Math.max(0, lo - hi)
  };
}

/* ============================================================
 * Render pipeline
 * ============================================================ */
async function renderResults(rootName, files, warnings) {
  currentRootName = rootName;
  currentFiles = files;
  currentWarnings = warnings;
  fileCount = files.length;
  totalChars = files.reduce((s, f) => s + f.content.length, 0);
  tokenEst = Math.round(totalChars / 4);
  skipCount = warnings.length;

  await loadScenarios();       // 确保场景就绪（真实默认或兜底）
  updateExportData();

  // summary chips
  let chipHTML = "";
  chipHTML += '<div class="chip"><span class="k">项目</span><span class="v">' + escapeHTML(rootName) + "</span></div>";
  chipHTML += '<div class="chip"><span class="k">文件</span><span class="v">' + num(fileCount) + "</span></div>";
  chipHTML += '<div class="chip"><span class="k">字符</span><span class="v">' + humanSize(totalChars) + "</span></div>";
  chipHTML += '<div class="chip"><span class="k">Token</span><span class="v">~' + num(tokenEst) + "</span></div>";
  if (skipCount > 0) chipHTML += '<div class="chip warn"><span class="k">跳过</span><span class="v">' + num(skipCount) + "</span></div>";
  els.summary.innerHTML = chipHTML;

  // tree
  const treeObj = buildTreeObject(files.map((f) => f.path));
  els.treeRoot.innerHTML = "";
  els.treeRoot.appendChild(treeDOM(treeObj));
  els.treeCount.textContent = num(fileCount) + " 文件";

  // preview（先确保高亮库就绪）
  await ensureHighlight();
  renderPreview();

  // statusbar
  els.statusbar.hidden = false;
  els.stFiles.textContent = num(fileCount);
  els.stChars.textContent = humanSize(totalChars);
  els.stTokens.textContent = "~" + num(tokenEst);
  if (skipCount > 0) setLog("已跳过 " + skipCount + " 个文件（过大 / 无权限 / 非文本）");
  else setLog("就绪 · 生成于 " + new Date().toLocaleTimeString("zh-CN"));

  // 导出分流：内容 ≥ 500KB 时禁用复制、突出下载
  const canCopy = fullMarkdown.length < COPY_LIMIT;
  els.copyBtn.disabled = !canCopy;
  els.copyBtn.title = canCopy ? "" : "内容过大，建议下载";
  els.downloadBtn.classList.toggle("btn-primary", !canCopy);
  els.downloadBtn.classList.toggle("btn-ghost", canCopy);
  if (!canCopy) els.copyBtn.textContent = "📋 内容过大（禁用）";
  else els.copyBtn.textContent = "📋 一键复制";

  els.empty.hidden = true;
  els.scan.hidden = true;
  els.results.hidden = false;
}

function renderPreview() {
  const lineNumbers = els.lineNumToggle.checked;
  const { head, tail, fold } = previewSplit(fullMarkdown, PREVIEW_HEAD, PREVIEW_TAIL);
  const headHTML = mdToHTML(head, lineNumbers);
  const tailHTML = tail ? mdToHTML(tail, lineNumbers) : "";
  const foldHTML = fold > 0
    ? '<div class="fold"><span class="fold-dot"></span><p>中间 ' + num(fold) + ' 行已折叠 · 请下载完整文件查看</p><span class="fold-dot"></span></div>'
    : "";
  els.preview.innerHTML = headHTML + foldHTML + tailHTML;
  els.preview.classList.toggle("line-nums", lineNumbers);
  els.previewBanner.classList.toggle("visible", fold > 0);
  els.previewCount.textContent = (fold > 0 ? "预览已折叠" : num(fullMarkdown.split("\n").length) + " 行");
}

/* ============================================================
 * Processing pipeline (shared by picker / input / drop)
 * ============================================================ */
async function processFiles(rootName, rawEntries) {
  els.empty.hidden = true;
  els.results.hidden = true;
  els.statusbar.hidden = true;
  els.scan.hidden = false;
  els.progressFill.style.width = "0%";
  els.progressText.textContent = "已扫描 0 个文件";
  els.progressPct.textContent = "0%";
  els.currentFile.textContent = "准备中";

  const included = rawEntries.filter((e) => !pathHasIgnoredDir(e.path) && shouldInclude(e.path, e.name));
  included.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));

  const total = included.length;
  let done = 0;
  let lastPaint = 0;

  const results = await mapWithConcurrency(included, CONCURRENCY, async (entry) => {
    const r = await readEntry(entry);
    done++;
    const now = performance.now();
    if (now - lastPaint > 60 || done === total) {
      lastPaint = now;
      const pct = total ? ((done / total) * 100).toFixed(1) : "100";
      els.progressFill.style.width = pct + "%";
      els.progressText.textContent = "已扫描 " + done + " / " + total + " 个文件";
      els.progressPct.textContent = pct + "%";
      els.currentFile.textContent = entry.path;
    }
    return { path: entry.path, ...r };
  });

  const files = [];
  const warnings = [];
  for (const r of results) {
    if (r.ok) files.push({ path: r.path, content: r.content, size: r.size });
    else warnings.push({ path: r.path, reason: r.reason });
  }

  // 让进度条走满后再切屏，避免闪烁
  els.progressFill.style.width = "100%";
  els.progressPct.textContent = "100%";
  await new Promise((res) => setTimeout(res, 180));

  await renderResults(rootName, files, warnings);
  toast("已聚合 " + num(files.length) + " 个文件" + (warnings.length ? " · 跳过 " + warnings.length : ""));
}

/* ============================================================
 * Entry points
 * ============================================================ */
async function pickDirectory() {
  if (window.isSecureContext && "showDirectoryPicker" in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      const entries = await walkHandle(dirHandle, "", []);
      await processFiles(dirHandle.name, entries);
    } catch (e) {
      if (e && e.name === "AbortError") return; // 用户取消
      throw e;
    }
  } else {
    els.fileInput.value = "";
    els.fileInput.click();
  }
}

els.dropzone.addEventListener("click", pickDirectory);
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickDirectory(); }
});
els.reselectBtn.addEventListener("click", () => {
  els.results.hidden = true;
  els.statusbar.hidden = true;
  els.empty.hidden = false;
});

els.fileInput.addEventListener("change", async () => {
  const fl = [...els.fileInput.files];
  if (!fl.length) return;
  const rootName = fl[0].webkitRelativePath.split("/")[0] || "project";
  const entries = fl.map((f) => {
    const rel = f.webkitRelativePath.split("/").slice(1).join("/");
    return { path: rel, name: f.name, file: f };
  });
  await processFiles(rootName, entries);
});

/* 拖拽文件夹（FileSystemEntry API） */
function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const read = () => reader.readEntries((batch) => {
      if (!batch.length) { resolve(all); return; }
      all.push(...batch);
      read();
    }, reject);
    read();
  });
}
function walkEntry(entry, base, out) {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file((file) => {
        out.push({ path: base ? base + "/" + entry.name : entry.name, name: entry.name, file });
        resolve();
      }, reject);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      readAllEntries(reader).then(async (entries) => {
        for (const c of entries) await walkEntry(c, base ? base + "/" + entry.name : entry.name, out);
        resolve();
      }).catch(reject);
    } else { resolve(); }
  });
}
["dragenter", "dragover"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove("drag"); })
);
els.dropzone.addEventListener("drop", async (e) => {
  const items = e.dataTransfer && e.dataTransfer.items;
  if (!items || !items.length) return;
  const entry = items[0].webkitGetAsEntry && items[0].webkitGetAsEntry();
  if (!entry) { toast("当前浏览器不支持拖拽文件夹，请点击选择", "error"); return; }
  const out = [];
  await walkEntry(entry, "", out);
  await processFiles(entry.name, out);
});

/* ============================================================
 * Export
 * ============================================================ */
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("execCommand copy failed");
}
els.copyBtn.addEventListener("click", async () => {
  if (!fullMarkdown) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(fullMarkdown);
    } else {
      fallbackCopy(fullMarkdown);
    }
    toast("已复制 " + num(fileCount) + " 个文件");
  } catch (e) {
    try {
      fallbackCopy(fullMarkdown);
      toast("已复制 " + num(fileCount) + " 个文件");
    } catch (e2) {
      toast("复制失败，请改用下载", "error");
    }
  }
});
els.downloadBtn.addEventListener("click", () => {
  if (!fullMarkdown) return;
  const filename = "context_" + timestamp() + ".md";
  const blob = new Blob([fullMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  toast("已下载 " + filename);
});

/* line-number toggle re-renders preview */
els.lineNumToggle.addEventListener("change", renderPreview);

/* ============================================================
 * 场景模板（Scenario）—— 纯配置驱动，零硬编码
 * ============================================================ */
function renderScenarioOptions() {
  const sel = document.getElementById("scenarioSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const list = scenarios.length ? scenarios : [FALLBACK_SCENARIO];
  list.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    if (currentScenario && s.id === currentScenario.id) opt.selected = true;
    sel.appendChild(opt);
  });
}

function switchScenario(next) {
  currentScenario = next || FALLBACK_SCENARIO;
  updateExportData();
  // 防白屏：先占位，下一帧再渲染
  els.preview.innerHTML = '<div class="preview-loading">正在切换场景…</div>';
  requestAnimationFrame(() => requestAnimationFrame(renderPreview));
}

function showPromptModal() {
  if (!currentScenario) return;
  const old = document.getElementById("promptModalOverlay");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.id = "promptModalOverlay";
  overlay.className = "prompt-modal-overlay";
  overlay.innerHTML =
    '<div class="prompt-modal" role="dialog" aria-modal="true" aria-label="场景提示词">' +
      '<div class="prompt-modal-head"><span class="prompt-modal-title">⚙️ ' + escapeHTML(currentScenario.name) + '</span>' +
        '<button class="prompt-modal-close" id="promptModalClose" aria-label="关闭">&times;</button></div>' +
      '<div class="prompt-modal-body">' + escapeHTML(currentScenario.systemPrompt) + '</div>' +
      '<div class="prompt-modal-foot">' +
        '<button class="btn btn-ghost btn-sm" id="promptModalCopy">📋 复制提示词</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("promptModalClose").addEventListener("click", () => overlay.remove());
  document.getElementById("promptModalCopy").addEventListener("click", async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentScenario.systemPrompt);
      } else {
        fallbackCopy(currentScenario.systemPrompt);
      }
      toast("已复制提示词");
    } catch (e) {
      try { fallbackCopy(currentScenario.systemPrompt); toast("已复制提示词"); }
      catch (e2) { toast("复制失败", "error"); }
    }
  });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onEsc); }
  });
}

function loadScenarios() {
  if (!scenariosPromise) {
    scenariosPromise = (async () => {
      try {
        const resp = await fetch("data/scenarios.json?t=" + Date.now());
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        const list = (data && Array.isArray(data.list)) ? data.list : [];
        scenarios = list;
        const defId = data && data.defaultId;
        currentScenario = list.find((s) => s.id === defId) || list[0] || FALLBACK_SCENARIO;
      } catch (e) {
        console.warn("[V4] scenarios.json 加载失败，使用兜底场景", e);
        scenarios = [];
        currentScenario = FALLBACK_SCENARIO;
      }
      renderScenarioOptions();
    })();
  }
  return scenariosPromise;
}

const scenarioSelectEl = document.getElementById("scenarioSelect");
if (scenarioSelectEl) {
  scenarioSelectEl.addEventListener("change", () => {
    const found = scenarios.find((s) => s.id === scenarioSelectEl.value);
    switchScenario(found || FALLBACK_SCENARIO);
  });
}
const previewPromptBtn = document.getElementById("previewPromptBtn");
if (previewPromptBtn) {
  previewPromptBtn.addEventListener("click", showPromptModal);
}

/* ============================================================
 * Boot
 * ============================================================ */
initTheme();

// 预加载代码高亮库（并行，不阻塞首屏）
ensureHighlight();

// 预加载场景模板（并行；renderResults 内会 await 确保就绪）
loadScenarios();

const hasFS = window.isSecureContext && "showDirectoryPicker" in window;
els.compat.textContent = hasFS
  ? "✓ 当前浏览器支持文件系统访问，可选择任意文件夹"
  : "当前环境不支持目录选择 API，将使用上传方式（不支持子目录递归拖拽）";
