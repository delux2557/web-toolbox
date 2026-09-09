/* ============================================================
 * build-single.mjs — web-toolbox 仓库级零依赖单文件拼接器
 * 用法:
 *   node tools/_build/build-single.mjs            # 构建所有声明了 build.config.json 的工具
 *   node tools/_build/build-single.mjs table-helper [name2...]  # 只构建指定工具
 *
 * 工具接入方式：在 tools/<name>/build.config.json 声明：
 *   { "entry": "index.html", "out": "dist/index.html" }
 *
 * 两种模式（自动识别）：
 *  A. 串联模式（默认）：entry html 里的多个 <script src> / <link stylesheet>
 *     按出现顺序逐个内联（语义与多 script 加载等价，适用于传统 IIFE/顶层 const 脚本）
 *  B. ESM 模式（config.esm = true）：config.modules 提供拓扑序清单，
 *     剥除单行 import / 行首 export 后拼接为一个 <script>，
 *     替换 html 中的 <script type="module" src>（适用于 ESM 源，file:// 双击可用）
 *
 * 安全规则：仅内联相对路径的本地文件；http(s)://、//、/ 开头的外链原样保留
 *（CDN 会违反 toolbox「零 CDN」红线，构建报告会列出提醒人工处理）。
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TOOLS_DIR = path.join(ROOT, "tools");

/* ---------- ESM 剥除（fvs-meta-web 同款约定：单行具名 import / 行首 export） ---------- */
function stripEsm(code){
  return code.split("\n").map(line => {
    const t = line.trim();
    if(t.startsWith("import ") || t.startsWith("import{")) return "";
    if(/^export\s+\{/.test(t) && t.endsWith("};")) return "";
    return line.replace(/^export default /, "const __default = ")
               .replace(/^export (\w+)/, "$1");
  }).join("\n");
}

/* ---------- 外链判定 ---------- */
function isRemote(ref){
  return /^(https?:)?\/\//i.test(ref) || ref.startsWith("/");
}

/* ---------- 单工具构建 ---------- */
function buildTool(name){
  const dir = path.join(TOOLS_DIR, name);
  const cfgFile = path.join(dir, "build.config.json");
  if(!fs.existsSync(cfgFile)) return null;
  const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  const entry = path.join(dir, cfg.entry || "index.html");
  const outFile = path.join(dir, cfg.out || "dist/index.html");
  let html = fs.readFileSync(entry, "utf8");
  const inlinedJs = [], inlinedCss = [], keptRemote = [];

  /* CSS：<link rel="stylesheet" href="本地"> → <style> */
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    if(!/rel=["']stylesheet["']/i.test(tag)) return tag;
    const m = /href=["']([^"']+)["']/i.exec(tag);
    if(!m) return tag;
    if(isRemote(m[1])){ keptRemote.push(m[1]); return tag; }
    const p = path.resolve(dir, m[1].split("?")[0]);
    if(!fs.existsSync(p)) throw new Error(`[${name}] css 不存在: ${m[1]}`);
    inlinedCss.push(m[1]);
    return "<style>\n" + fs.readFileSync(p, "utf8").trimEnd() + "\n</style>";
  });

  if(cfg.esm){
    /* ESM 模式：modules 拓扑序拼接 → 替换 module script 入口 */
    if(!Array.isArray(cfg.modules) || !cfg.modules.length)
      throw new Error(`[${name}] esm 模式需要在 build.config.json 提供 modules 拓扑序清单`);
    const parts = cfg.modules.map(rel => {
      const code = stripEsm(fs.readFileSync(path.join(dir, rel), "utf8"));
      try{ new Function(code); }catch(e){ throw new Error(`[${name}] 语法自检失败 ${rel}: ${e.message}`); }
      return `/* ======== ${rel} ======== */\n` + code.trimEnd();
    });
    const bundle = parts.join("\n\n");
    let replaced = false;
    html = html.replace(/<script\b[^>]*type=["']module["'][^>]*>\s*<\/script>/gi, tag => {
      if(replaced) return "";   // 多个 module 入口只保留首个拼接位
      replaced = true;
      return "<script>\n" + bundle + "\n</script>";
    });
    if(!replaced) throw new Error(`[${name}] 未找到 <script type="module" src> 入口`);
    inlinedJs.push(...cfg.modules);
  }else{
    /* 串联模式：逐个 <script src="本地"> 原位内联（顺序即依赖序） */
    html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
      const m = /\ssrc=["']([^"']+)["']/i.exec(attrs);
      if(!m) return tag;                      // 内联 script（如主题前置）原样保留
      if(isRemote(m[1])){ keptRemote.push(m[1]); return tag; }
      const p = path.resolve(dir, m[1].split("?")[0]);
      if(!fs.existsSync(p)) throw new Error(`[${name}] js 不存在: ${m[1]}`);
      const code = fs.readFileSync(p, "utf8");
      try{ new Function(code); }catch(e){ throw new Error(`[${name}] 语法自检失败 ${m[1]}: ${e.message}`); }
      inlinedJs.push(m[1]);
      return "<script>\n" + code.trimEnd() + "\n</script>";
    });
  }

  /* 产物 banner + 落盘 */
  const banner = `<!-- ⚠️ 本文件由 tools/_build/build-single.mjs 自动生成（源: tools/${name}/${cfg.entry || "index.html"}），请勿手改！ -->`;
  html = html.replace(/(<!DOCTYPE html[^>]*>)/i, `$1\n${banner}`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, "utf8");

  const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`✓ [${name}] ${path.relative(ROOT, outFile)}`);
  console.log(`  产物 ${html.split("\n").length} 行 / ${kb} KB | 内联 js ${inlinedJs.length} 个 + css ${inlinedCss.length} 个`
    + (keptRemote.length ? ` | ⚠️ 保留外链 ${keptRemote.length} 个: ${keptRemote.join(", ")}` : " | 无外链"));
  return { name, ok: true };
}

/* ---------- 入口：扫描 tools/<name>/build.config.json ---------- */
const [, , ...args] = process.argv;
const all = fs.readdirSync(TOOLS_DIR)
  .filter(n => fs.statSync(path.join(TOOLS_DIR, n)).isDirectory() && !n.startsWith("_"))
  .filter(n => fs.existsSync(path.join(TOOLS_DIR, n, "build.config.json")));
const targets = args.length ? args : all;
const skipped = args.filter(a => !all.includes(a));
if(skipped.length) console.error(`⚠️ 未声明 build.config.json，跳过: ${skipped.join(", ")}`);
if(!targets.length){
  console.log("没有可构建的工具（tools/<name>/build.config.json 均不存在）。接入方式见脚本头部注释。");
  process.exit(0);
}
let fail = 0;
for(const name of targets){
  try{ buildTool(name); }
  catch(e){ fail++; console.error(`✗ [${name}] ${e.message}`); }
}
process.exit(fail ? 1 : 0);
