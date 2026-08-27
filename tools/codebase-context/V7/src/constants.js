/* ============================================================
 * constants.js — 只读常量与语言映射（纯数据，无副作用）
 * ============================================================ */

export const COPY_LIMIT   = 500 * 1024;   // 复制上限（字符）
export const CONCURRENCY  = 50;           // 并发读取上限
export const PREVIEW_HEAD = 2000;         // 预览首部行数
export const PREVIEW_TAIL = 200;          // 预览尾部行数

export const DEFAULT_PROMPT_INTRO = "⚙️ 系统指令（System Prompt）：请严格遵循以下场景设定进行回答。";

export const FALLBACK_SCENARIO = {
  id: "general-fallback",
  name: "通用模式",
  systemPrompt: "你是一位技术专家，请全面分析以下代码库。"
};

/* 文件的扩展名 → highlight.js 语言名 */
export const LANG_MAP = {
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