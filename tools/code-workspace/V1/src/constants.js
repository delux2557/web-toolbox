/* ============================================================
 * constants.js — 常量与语言映射（纯数据，无副作用）
 * ============================================================ */

/* 回收站目录名（伪删除的落地位置）。以点号开头，尽量不与项目自身目录冲突。 */
export const TRASH_DIR = ".cw-trash";
/* 回收站索引文件名，记录「回收站内文件名 → 原路径」，用于还原 */
export const TRASH_INDEX = "manifest.json";

/* 可编辑文本大小上限（字节）。超过则只读展示提示，不进编辑器。 */
export const MAX_EDIT_BYTES = 3 * 1024 * 1024;
/* 单目录扫描条目上限，防止误选到盘符根目录把页面拖死 */
export const MAX_SCAN_ENTRIES = 20000;
/* 递归删除 / 移动时，目录树的深度上限（防御性） */
export const MAX_DEPTH = 24;

/* 明显是二进制的扩展名：直接标记为不可编辑，不进编辑器（避免读到乱码 / 撑爆内存） */
export const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "tif", "tiff", "avif",
  "mp3", "wav", "flac", "ogg", "m4a", "aac", "wma",
  "mp4", "mov", "avi", "mkv", "webm", "wmv", "flv",
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "exe", "dll", "so", "dylib", "bin", "class", "jar", "war", "o", "obj", "a", "lib",
  "pyc", "pyo", "wasm", "node", "dat", "db", "sqlite", "sqlite3", "mdb",
  "ttf", "otf", "woff", "woff2", "eot", "psd", "ai", "sketch", "fig",
  "iso", "img", "dmg", "pkg", "deb", "rpm", "msi", "apk", "ipa"
]);

/* 危险目录名：不参与递归删除 / 移动，避免误操作（仍需用户显式确认） */
export const GUARDED_DIR = new Set([".git", "node_modules", TRASH_DIR]);

/* 扩展名 → 离线编辑器语言 key（key 必须在 vendor 包的 langs 注册表内） */
export const EXT_TO_LANG = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx",
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx",
  py: "python", pyw: "python", pyi: "python",
  html: "html", htm: "html", xhtml: "html", vue: "html", svelte: "html",
  css: "css", scss: "css",
  json: "json", jsonc: "json", json5: "json", imports: "properties",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  sql: "sql",
  xml: "xml", svg: "xml", plist: "xml", xsd: "xml", xsl: "xml", csproj: "xml", pom: "xml",
  c: "c",
  h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
  java: "java",
  rs: "rust",
  yaml: "yaml", yml: "yaml",
  php: "php", phtml: "php",
  sh: "shell", bash: "shell", zsh: "shell", ksh: "shell", fish: "shell",
  dockerfile: "dockerfile",
  ini: "properties", cfg: "properties", conf: "properties", properties: "properties",
  env: "properties", editorconfig: "properties", gitignore: "properties",
  gitattributes: "properties", npmrc: "properties", yamllint: "yaml",
  toml: "toml",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  cs: "csharp",
  scala: "scala", sc: "scala",
  kt: "kotlin", kts: "kotlin",
  m: "objectivec", mm: "objectivec",
  dart: "dart",
  go: "go",
  lua: "lua",
  rb: "ruby", rake: "ruby", gemspec: "ruby", ru: "ruby",
  pl: "perl", pm: "perl", t: "perl",
  r: "r",
  swift: "swift",
  diff: "diff", patch: "diff",
  groovy: "groovy", gradle: "groovy",
  erl: "erlang", hrl: "erlang",
  pas: "pascal", pp: "pascal",
  proto: "protobuf",
  hs: "haskell", lhs: "haskell",
  nginx: "nginx",
  cmake: "cmake",
  clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
  coffee: "coffeescript",
  d: "d",
  dtd: "dtd",
  s: "gas", asm: "z80",
  feature: "gherkin",
  hx: "haxe", hxml: "haxe",
  http: "http", rest: "http",
  idl: "idl",
  jinja: "jinja2", jinja2: "jinja2", j2: "jinja2",
  jl: "julia",
  wl: "mathematica", nb: "mathematica",
  ml: "ocaml", mli: "ocaml",
  fs: "fsharp", fsi: "fsharp", fsx: "fsharp",
  mo: "modelica",
  nsi: "nsis", nsh: "nsis",
  m4: "mumps",
  oz: "oz",
  pig: "pig",
  sas: "sas",
  sass: "sass",
  less: "less",
  scm: "scheme", ss: "scheme", rkt: "scheme",
  sieve: "sieve",
  st: "smalltalk",
  rq: "sparql",
  styl: "stylus",
  tcl: "tcl",
  textile: "textile",
  ttl: "turtle",
  vb: "vb",
  vbs: "vbscript",
  vm: "velocity",
  v: "verilog", vh: "verilog", sv: "verilog", svh: "verilog",
  vhd: "vhdl", vhdl: "vhdl",
  wat: "wast",
  webidl: "webidl",
  xq: "xquery", xquery: "xquery", xqy: "xquery",
  z80: "z80",
  lisp: "commonlisp", lsp: "commonlisp", el: "commonlisp",
  cr: "crystal",
  cql: "cypher",
  ecl: "ecl",
  e: "eiffel",
  forth: "forth", "4th": "forth",
  ls: "livescript",
  nt: "ntriples",
  pegjs: "pegjs",
  tex: "latex", sty: "latex", cls: "latex",
  man: "troff",
  yacas: "yacas",
  ebnf: "ebnf",
  fcl: "fcl",
  msc: "mscgen", mscgen: "mscgen",
  ttcn: "ttcn", ttcn3: "ttcn",
  ttcncfg: "ttcncfg",
  spec: "rpmspec",
  apl: "apl",
  bf: "brainfuck",
  makefile: "shell", mk: "shell", mak: "shell"
};

/* 无扩展名文件（小写文件名 / 前缀）→ 语言 key */
export const NAME_TO_LANG = {
  dockerfile: "dockerfile", "dockerfile.dev": "dockerfile", "dockerfile.prod": "dockerfile",
  makefile: "shell", gnumakefile: "shell", "cmakelists.txt": "cmake",
  ".gitignore": "properties", ".gitattributes": "properties", ".dockerignore": "properties",
  ".editorconfig": "properties", ".env": "properties", ".babelrc": "json",
  "package.json": "json", "tsconfig.json": "json", "composer.json": "json",
  "nginx.conf": "nginx", "requirements.txt": "properties",
  license: "properties", "license.md": "markdown", readme: "markdown"
};

/* 状态栏 / 日志用语 */
export const MSG = {
  noFS: "当前浏览器不支持文件系统访问 API（需 Chrome / Edge 等基于 Chromium 的浏览器 + HTTPS 或 localhost）。",
  needRW: "需要「读写」权限才能保存到磁盘。若只授予了只读，请重新选择文件夹并允许编辑。"
};
