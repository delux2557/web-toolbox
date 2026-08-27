/* ============================================================
 * filters.js — 过滤规则三层模型：
 *   ① 代码内置默认（兜底）
 *   ② data/filters.json（出厂默认，可被本地规则覆盖加载）
 *   ③ localStorage 用户规则（可视化面板增删，优先级最高）
 *
 * 模型采用「默认白名单 + 增量覆盖 + 强制包含」：
 *   - 忽略目录/文件名：内置默认 + 用户追加
 *   - 允许扩展名：内置白名单 + 用户追加（无需改代码即可纳入新类型）
 *   - 强制包含（放行单个文件）：按相对路径，最高优先级
 *   - 最大文件大小 / 无扩展名文件：可调开关
 * ============================================================ */

const FILTER_DEFAULTS = {
  maxFileSize: 5 * 1024 * 1024,
  ignoredDirs: [
    "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "output",
    "__pycache__", ".venv", "venv", ".env", "env", "coverage", ".next", ".nuxt",
    ".output", ".cache", ".parcel-cache", ".idea", ".vscode", ".vs", "target",
    "vendor", "bower_components", ".gradle", ".turbo", ".expo", ".svelte-kit",
    ".angular", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".eggs",
    ".docusaurus", ".astro", ".vercel", ".netlify", ".yarn", ".pnpm-store",
    "Pods", "DerivedData", "bin", "obj", "cmake-build-debug", "__pypackages__"
  ],
  ignoredNames: [
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
    "cargo.lock", "gemfile.lock", "poetry.lock", "composer.lock", "pipfile.lock",
    "npm-shrinkwrap.json", ".ds_store", "thumbs.db", "desktop.ini"
  ],
  textExts: [
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
    "mustache", "handlebars", "http", "rest", "dockerfile", "makefile", "cmake",
    "wxml", "wxss"
  ]
};

const USER_KEY = "cca-user-rules";
const IGNORE_REASON_SET = ["dir", "name", "hard", "ext", "noext"]; // 规则型可「放行」

function emptyUserRules() {
  return { ignoreDirs: [], ignoreNames: [], allowExts: [], includeFiles: [], maxFileSize: null, skipNoExt: true };
}

/* —— 出厂默认（可被 filters.json 覆盖） —— */
let defaultIgnoredDirs = FILTER_DEFAULTS.ignoredDirs;
let defaultIgnoredNames = FILTER_DEFAULTS.ignoredNames;
let defaultTextExts = FILTER_DEFAULTS.textExts;
let maxFileSizeDefault = FILTER_DEFAULTS.maxFileSize;

/* —— 用户规则（localStorage 持久化） —— */
let userRules = loadUserRules();

function loadUserRules() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return emptyUserRules();
    const p = JSON.parse(raw);
    const r = emptyUserRules();
    r.ignoreDirs = Array.isArray(p.ignoreDirs) ? p.ignoreDirs : [];
    r.ignoreNames = Array.isArray(p.ignoreNames) ? p.ignoreNames : [];
    r.allowExts = Array.isArray(p.allowExts) ? p.allowExts : [];
    r.includeFiles = Array.isArray(p.includeFiles) ? p.includeFiles : [];
    r.maxFileSize = typeof p.maxFileSize === "number" && p.maxFileSize > 0 ? p.maxFileSize : null;
    r.skipNoExt = p.skipNoExt !== false;
    return r;
  } catch (_) { return emptyUserRules(); }
}

/* —— 持久化 / 查询 —— */
export function saveUserRules() {
  try { localStorage.setItem(USER_KEY, JSON.stringify(userRules)); } catch (_) {}
}
export function getUserRules() { return userRules; }
export function resetUserRules() {
  userRules = emptyUserRules(); saveUserRules();
}
export function replaceUserRules(next) {
  const r = emptyUserRules();
  const p = next || {};
  r.ignoreDirs = Array.isArray(p.ignoreDirs) ? p.ignoreDirs.filter(normNameProp) : [];
  r.ignoreNames = Array.isArray(p.ignoreNames) ? p.ignoreNames.filter(normNameProp) : [];
  r.allowExts = Array.isArray(p.allowExts) ? p.allowExts.filter(normExtProp) : [];
  r.includeFiles = Array.isArray(p.includeFiles) ? p.includeFiles : [];
  r.maxFileSize = typeof p.maxFileSize === "number" && p.maxFileSize > 0 ? p.maxFileSize : null;
  r.skipNoExt = p.skipNoExt !== false;
  userRules = r; saveUserRules();
}
export function exportUserRules() {
  return JSON.stringify(userRules, null, 2);
}

/* —— 规整辅助 —— */
export function normExtProp(e) { return String(e == null ? "" : e).trim().replace(/^\./, "").toLowerCase(); }
export function normNameProp(n) { return String(n == null ? "" : n).trim().replace(/^[/\\]+|[/\\]+$/g, "").toLowerCase(); }
export function normPathProp(p) { return String(p == null ? "" : p).trim().replace(/^[./\\]+/, ""); }

/* —— 单项增删（UI 直接调用，即时持久化） —— */
export function addUserIgnoreDir(v) { const x = normNameProp(v); if (x && !userRules.ignoreDirs.includes(x)) { userRules.ignoreDirs.push(x); saveUserRules(); } }
export function removeUserIgnoreDir(v) { userRules.ignoreDirs = userRules.ignoreDirs.filter((x) => x !== v); saveUserRules(); }
export function addUserIgnoreName(v) { const x = normNameProp(v); if (x && !userRules.ignoreNames.includes(x)) { userRules.ignoreNames.push(x); saveUserRules(); } }
export function removeUserIgnoreName(v) { userRules.ignoreNames = userRules.ignoreNames.filter((x) => x !== v); saveUserRules(); }
export function addUserAllowExt(v) { const x = normExtProp(v); if (x && !userRules.allowExts.includes(x)) { userRules.allowExts.push(x); saveUserRules(); } }
export function removeUserAllowExt(v) { userRules.allowExts = userRules.allowExts.filter((x) => x !== v); saveUserRules(); }
export function forceIncludeFile(p) { const x = normPathProp(p); if (x && !userRules.includeFiles.includes(x)) { userRules.includeFiles.push(x); saveUserRules(); } }
export function removeForceIncludeFile(p) { userRules.includeFiles = userRules.includeFiles.filter((x) => x !== p); saveUserRules(); }
export function setUserMaxSize(mb) { userRules.maxFileSize = (typeof mb === "number" && mb > 0) ? mb : null; saveUserRules(); }
export function setUserSkipNoExt(b) { userRules.skipNoExt = !!b; saveUserRules(); }

/* —— 加载出厂默认（data/filters.json） —— */
let filtersPromise = null;
export function loadFilters() {
  if (filtersPromise) return filtersPromise;
  filtersPromise = (async () => {
    let cfg = null;
    try {
      const resp = await fetch("data/filters.json?t=" + Date.now());
      if (resp.ok) cfg = await resp.json();
    } catch (e) { console.warn("[V7] filters.json 加载失败，使用内置默认", e); }
    if (cfg) {
      if (Array.isArray(cfg.ignoredDirs) && cfg.ignoredDirs.length) defaultIgnoredDirs = cfg.ignoredDirs;
      if (Array.isArray(cfg.ignoredNames)) defaultIgnoredNames = cfg.ignoredNames;
      if (Array.isArray(cfg.textExts) && cfg.textExts.length) defaultTextExts = cfg.textExts;
      if (typeof cfg.maxFileSizeMB === "number" && cfg.maxFileSizeMB > 0) maxFileSizeDefault = cfg.maxFileSizeMB * 1024 * 1024;
    }
  })();
  return filtersPromise;
}

/* —— 生效规则（合并后） —— */
export function getRules() {
  const ignoredDirSet = new Set(defaultIgnoredDirs);
  for (const d of userRules.ignoreDirs) ignoredDirSet.add(d);
  const ignoredNameSet = new Set(defaultIgnoredNames);
  for (const n of userRules.ignoreNames) ignoredNameSet.add(n);
  const textExtSet = new Set(defaultTextExts);
  for (const e of userRules.allowExts) textExtSet.add(e);
  return {
    ignoredDirSet,
    ignoredNameSet,
    textExtSet,
    maxFileSize: userRules.maxFileSize ? userRules.maxFileSize * 1024 * 1024 : maxFileSizeDefault,
    skipNoExt: userRules.skipNoExt,
    forceIncludeSet: new Set(userRules.includeFiles)
  };
}

export function pathHasIgnoredDir(path) {
  const { ignoredDirSet } = getRules();
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 1; i++) if (ignoredDirSet.has(parts[i])) return true;
  return false;
}

/* —— 透明摘要（规则面板 / 结果区复用） —— */
export function rulesSummary() {
  return {
    dirCount: new Set([...defaultIgnoredDirs, ...userRules.ignoreDirs]).size,
    nameCount: new Set([...defaultIgnoredNames, ...userRules.ignoreNames]).size,
    extCount: new Set([...defaultTextExts, ...userRules.allowExts]).size,
    userExtCount: userRules.allowExts.length,
    maxSizeMB: userRules.maxFileSize || Math.round(maxFileSizeDefault / 1048576),
    skipNoExt: userRules.skipNoExt,
    includeCount: userRules.includeFiles.length
  };
}

/* 用户是否对内置默认做过任何自定义（用于顶部按钮状态指示点） */
export function hasUserRules() {
  return !!(
    userRules.ignoreDirs.length || userRules.ignoreNames.length ||
    userRules.allowExts.length || userRules.includeFiles.length ||
    userRules.maxFileSize || userRules.skipNoExt !== true
  );
}

export function isRuleReason(reason) { return IGNORE_REASON_SET.includes(reason); }

export const REASON_LABELS = {
  dir: "目录被忽略",
  name: "文件名被忽略",
  hard: "内置规则排除",
  ext: "扩展名未在允许范围",
  noext: "无扩展名",
  size: "超过大小上限",
  error: "读取失败"
};