/* ============================================================
 * verify.mjs — code-workspace 静态一致性校验
 * ------------------------------------------------------------
 * node --check 只看单文件语法，抓不到以下三类「只在浏览器里才炸」的错误：
 *   1) import { X } from "./y.js" 里的 X 在 y.js 里根本没导出
 *   2) 业务模块里用了 els.foo，但 dom.js 的 els 对象没有 foo 这个键
 *   3) dom.js 里 $("someId") 取的 id，在 V1/index.html 里并不存在
 * 这个脚本把三类都查一遍。
 * ============================================================ */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* 项目根：优先取命令行参数，缺省则用脚本所在目录的上一级
   （脚本约定放在 <项目根>/tests/ 下）——不写死本机绝对路径。
   只认第一个不以 -- 开头的参数，避免把开关当成路径。 */
const ROOT = resolve(process.argv.slice(2).find((a) => !a.startsWith("--"))
  || join(dirname(fileURLToPath(import.meta.url)), ".."));
const SRC = join(ROOT, "V1/src");
const HTML = join(ROOT, "V1/index.html");

const files = readdirSync(SRC).filter((f) => f.endsWith(".js"));
const src = new Map(files.map((f) => [f, readFileSync(join(SRC, f), "utf8")]));

const problems = [];
const note = [];

/* ---------- 1) 收集每个文件的具名导出 ---------- */
function exportsOf(name) {
  const text = src.get(name) || "";
  const set = new Set();

  const declRe = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = declRe.exec(text))) set.add(m[1]);

  // export { a, b as c };
  const listRe = /^export\s*\{([^}]*)\}\s*;?/gm;
  while ((m = listRe.exec(text))) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const as = seg.split(/\s+as\s+/);
      set.add((as[1] || as[0]).trim());
    }
  }
  return set;
}

const exportMap = new Map(files.map((f) => [f, exportsOf(f)]));

/* ---------- 2) 校验具名导入 ---------- */
for (const [file, text] of src) {
  const importRe = /import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g;
  let m;
  while ((m = importRe.exec(text))) {
    const spec = m[1];
    const target = m[2].replace(/^\.\//, "").split("/").pop();
    if (!exportMap.has(target)) {
      problems.push(`${file}: 导入了不存在的模块 ./${m[2]}`);
      continue;
    }
    const avail = exportMap.get(target);
    for (const part of spec.split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const name = seg.split(/\s+as\s+/)[0].trim();
      if (!avail.has(name)) {
        problems.push(`${file}: 从 ${target} 导入的 "${name}" 并不存在（该模块导出：${[...avail].join(", ")}）`);
      }
    }
  }
}

/* ---------- 3) 校验 els.<key> 使用面 ---------- */
const domText = src.get("dom.js") || "";
const elsBlock = domText.slice(domText.indexOf("export const els"));
const definedEls = new Set();
{
  const re = /(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*:/gm;
  let m;
  while ((m = re.exec(elsBlock))) definedEls.add(m[1]);
}
for (const [file, text] of src) {
  if (file === "dom.js") continue;
  const re = /\bels\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(text))) {
    if (!definedEls.has(m[1])) {
      problems.push(`${file}: 使用了 els.${m[1]}，但 dom.js 的 els 未定义该键`);
    }
  }
}

/* ---------- 4) 校验 $("id") 在 HTML 里存在 ---------- */
const html = readFileSync(HTML, "utf8");
const ids = new Set();
{
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
}
{
  const re = /\$\("([^"]+)"\)/g;
  let m;
  while ((m = re.exec(domText))) {
    if (!ids.has(m[1])) problems.push(`dom.js: $("${m[1]}") 在 V1/index.html 中找不到对应 id`);
  }
}

/* ---------- 5) 校验 HTML 里的 id 是否被 dom.js 全部接管（提示级） ---------- */
{
  const used = new Set();
  const re = /\$\("([^"]+)"\)/g;
  let m;
  while ((m = re.exec(domText))) used.add(m[1]);
  for (const id of ids) {
    if (!used.has(id)) note.push(`index.html: id="${id}" 未被 dom.js 引用（可能是纯样式锚点，可忽略）`);
  }
}

/* ---------- 6) 校验「用到的标识符」是否真的有来源（未导入 / 未声明） ----------
 *
 * 起因：fsrepo.js 用了 MAX_EDIT_BYTES 却忘了从 constants.js 导入。
 *   node --check 只管语法，过；第 2 节只查「导入的东西有没有被导出」，也过；
 *   于是这个 ReferenceError 一直藏到运行时 —— 而且被 readFileText 的 try/catch
 *   吞成 reason:"error"，界面上只显示「无法读取这个文件。」，每个文件都这样。
 * 这类「用了但没来源」的错，必须静态拦住。
 *
 * 实现是启发式的（没有引 AST 依赖）：声明 / 导入 / 参数 / 常见全局放行，
 * 其余出现在「调用、成员访问、下标、比较」位置的裸标识符即为可疑。
 * 误报率靠「把参数名收集全」压下来；宁可少量漏报，不要误报淹没信号。
 */

const GLOBALS = new Set([
  "window", "document", "console", "navigator", "location", "history",
  "localStorage", "sessionStorage", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "Array", "Object", "String",
  "Number", "Boolean", "Symbol", "JSON", "Math", "Date", "RegExp", "Error",
  "TypeError", "RangeError", "SyntaxError", "EvalError", "URIError",
  "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array",
  "Int32Array", "Float32Array", "Float64Array", "ArrayBuffer", "DataView",
  "TextEncoder", "TextDecoder", "Blob", "File", "FileReader", "URL",
  "URLSearchParams", "fetch", "alert", "confirm", "prompt", "structuredClone",
  "queueMicrotask", "performance", "crypto", "AbortController", "KeyboardEvent",
  "MouseEvent", "Event", "CustomEvent", "Node", "Element", "HTMLElement",
  "DOMParser", "Intl", "isNaN", "parseInt", "parseFloat", "encodeURIComponent",
  "decodeURIComponent", "encodeURI", "decodeURI", "undefined", "NaN", "Infinity",
  "globalThis", "Function", "Proxy", "Reflect", "BigInt", "atob", "btoa",
  "getComputedStyle", "ResizeObserver", "IntersectionObserver", "MutationObserver",
  "DragEvent", "FileSystemHandle", "import", "arguments", "CSS", "CSSStyleSheet"
]);

const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "return", "break", "continue", "function",
  "class", "new", "delete", "typeof", "instanceof", "in", "of", "void", "this",
  "super", "try", "catch", "finally", "throw", "switch", "case", "default",
  "const", "let", "var", "import", "export", "from", "as", "async", "await",
  "yield", "static", "get", "set", "extends", "true", "false", "null", "with",
  "debugger", "enum"
]);

/* 抹掉注释 / 字符串 / 模板串 / 正则字面量 —— 必须**单次扫描**完成。
 *
 * 踩过的坑：一开始用一串 .replace() 分步剥，
 *   1) 先剥字符串时，/[&<>"']/ 这种「自身含引号的正则」会把引号配对搞乱；
 *   2) 打乱后残留的 ' 会和文件后面某个 ' 配成一对，把中间整段代码吞掉，
 *      于是 declared 只剩第一个函数，后面的 safeName / isSafePath 全"消失"，
 *      检查器反而报出一堆假的 ReferenceError。
 * 分步 replace 无法正确处理「正则里有引号、字符串里有斜杠」这类交错，
 * 只能老老实实扫一遍。模板串里的 ${...} 会被一并丢弃 —— 这是已知取舍。
 */
function stripLiterals(text) {
  const n = text.length;

  /* 判断某个 / 是不是正则开头：看已经吐出来的真实代码的最后一个非空白字符 */
  const isRegexStart = (out) => {
    const t = out.replace(/\s+$/, "");
    if (!t) return true;
    const ch = t[t.length - 1];
    if ("([{,;:=!&|?+*%^~<>".includes(ch)) return true;
    const w = t.match(/([A-Za-z_$][\w$]*)$/);
    if (w) {
      return /^(return|typeof|instanceof|case|in|of|do|else|yield|await|delete|void|new)$/.test(w[1]);
    }
    return false;
  };

  let out = "";
  let i = 0;

  while (i < n) {
    const c = text[i];

    if (c === "/" && text[i + 1] === "/") {                 // 行注释
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {                 // 块注释
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {              // 字符串 / 模板串
      const q = c;
      i++;
      while (i < n) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === q) { i++; break; }
        i++;
      }
      out += q === "`" ? "`S`" : '"S"';
      continue;
    }
    if (c === "/" && isRegexStart(out)) {                   // 正则字面量
      let j = i + 1, inClass = false, closed = false;
      while (j < n) {
        const d = text[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;                              // 正则不跨行
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        i = j + 1;
        while (i < n && /[a-z]/i.test(text[i])) i++;        // flags
        out += " ";
        continue;
      }
    }

    out += c;
    i++;
  }
  return out;
}

function collectNames(text) {
  const declared = new Set();
  const imported = new Set();
  const params = new Set();

  /* 声明：函数 / class / const|let|var */
  for (const re of [
    /(?:^|[\s;{(,])(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
    /(?:^|[\s;{(,])(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
    /(?:^|[\s;{(,])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm
  ]) {
    let m;
    while ((m = re.exec(text))) declared.add(m[1]);
  }
  /* 解构声明：const { a, b: c, ...d } = / const [a, b] = */
  for (const m of text.matchAll(/(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g)) {
    for (const part of m[1].split(",")) {
      const id = part.split(":").pop().split("=")[0].trim().replace(/^\.\.\./, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) declared.add(id);
    }
  }
  /* 多声明符：const a = 1, b = 2 —— 上面的正则只能抓到 a，后面每个都要补上 */
  for (const m of text.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) declared.add(m[1]);
  /* 导入 */
  for (const m of text.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const id = part.split(/\s+as\s+/).pop().trim();
      if (id) imported.add(id);
    }
  }
  for (const m of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) imported.add(m[1]);
  for (const m of text.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) imported.add(m[1]);

  /* 参数：把名字都收进来（含解构与默认值里的标识符，宁可多收） */
  const addParams = (raw) => {
    for (const m of raw.matchAll(/[A-Za-z_$][\w$]*/g)) params.add(m[0]);
  };
  for (const m of text.matchAll(/function\s*\*?\s*[A-Za-z_$]*\s*\(([^)]*)\)/g)) addParams(m[1]);
  for (const m of text.matchAll(/\(([^)]*)\)\s*=>/g)) addParams(m[1]);
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) params.add(m[1]);
  for (const m of text.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) params.add(m[1]);

  return { declared, imported, params };
}

for (const [file, rawText] of src) {
  const text = stripLiterals(rawText);
  const { declared, imported, params } = collectNames(text);

  if (process.env.CW_DEBUG) {
    console.log(`\n[DEBUG] ${file}`);
    console.log("  declared:", [...declared].join(","));
    console.log("  imported:", [...imported].join(","));
    console.log("  params  :", [...params].join(","));
  }

  const useRe = /(^|[^\w$.?'"`])([A-Za-z_$][\w$]*)\s*(?=[(\[.]|\)|,|;|$|&&|\|\||\?|\+|-|\*|\/|===|!==|==|!=|<=|>=|<|>)/gm;
  const seen = new Map();
  let m;
  while ((m = useRe.exec(text))) {
    const id = m[2];
    seen.set(id, (seen.get(id) || 0) + 1);
  }

  for (const [id, count] of seen) {
    if (KEYWORDS.has(id) || GLOBALS.has(id)) continue;
    if (declared.has(id) || imported.has(id) || params.has(id)) continue;
    problems.push(
      `${file}: 使用了标识符 "${id}"（${count} 处），但本模块既没有 import 也没有声明它 —— 运行时会抛 ReferenceError`
    );
  }
}

/* ---------- 7) 版本登记：manifest.json 与壳内 FALLBACK_MANIFEST 必须一致 ----------
 *
 * 这对数据是**同一份内容存了两遍**：manifest.json 给线上用，壳里的
 * FALLBACK_MANIFEST 在 fetch 失败时兜底。典型「该一起变、但没人强制它变」的地方 ——
 * 只改一处不会报错，只会在断网/首屏兜底时悄悄指向旧版本。
 */
{
  const shellPath = join(ROOT, "index.html");
  const manifestPath = join(ROOT, "manifest.json");

  let manifest = null, shellBlock = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    problems.push(`manifest.json 不是合法 JSON：${e.message}`);
  }
  try {
    const shellText = readFileSync(shellPath, "utf8");
    const m = shellText.match(/var\s+FALLBACK_MANIFEST\s*=\s*(\{[\s\S]*?\n\});/);
    if (!m) problems.push("index.html: 找不到 FALLBACK_MANIFEST 字面量");
    else shellBlock = JSON.parse(m[1]);
  } catch (e) {
    problems.push(`index.html 读取失败：${e.message}`);
  }

  if (manifest && shellBlock) {
    const key = (v) => `${v.id}|${v.version}|${v.label}|${v.entry}|${v.build}|${v.buildTime}`;
    const a = (manifest.versions || []).map(key);
    const b = (shellBlock.versions || []).map(key);

    if (manifest.latest !== shellBlock.latest) {
      problems.push(`latest 不一致：manifest.json="${manifest.latest}"，壳内="${shellBlock.latest}"`);
    }
    if (a.join(" ;; ") !== b.join(" ;; ")) {
      problems.push(
        "manifest.json 与 index.html 的 FALLBACK_MANIFEST 版本条目不一致。\n" +
        `      manifest.json : ${a.join(" ;; ")}\n` +
        `      壳内 fallback : ${b.join(" ;; ")}`
      );
    }
    const latestEntry = (manifest.versions || []).find((v) => v.id === manifest.latest);
    if (!latestEntry) {
      problems.push(`latest="${manifest.latest}" 在 versions 里找不到对应条目`);
    } else if (latestEntry.entry && !existsSync(join(ROOT, latestEntry.entry))) {
      problems.push(`latest 指向的入口文件不存在：${latestEntry.entry}`);
    }
  }
}

/* ---------- 8) 跨文件冗余数据：品牌图形与字体族名 ----------
 *
 * 第 7 类是「同一份内容存了两遍」的一个特例（版本登记）。同一个坑还有两处，
 * 都是**只改一处不会报错、只会静默失效**的形态：
 *   · 页签 favicon 的 SVG path 与页面 logo 的 SVG path 是同一份图形数据。
 *     改了一处，页签和页面里就是两个不同的图标 —— 用户会直接看出来。
 *   · 壳的 <link> 声明了字体族名（family=Space+Grotesk…），
 *     V1/style.css 的 --font-sans 再按名字引用它。名字拼错 → 字体不生效，
 *     但页面照常渲染，没有任何报错。
 */
{
  const shellText = readFileSync(join(ROOT, "index.html"), "utf8");
  /* 只在 <head> 区域里找 <link>：壳的 <body> 脚本里有 /<link[^>]*>/ 这样的正则字面量，
     全文扫描会把它们当成真的 link 标签抓出来（第一次就是这么误报的）。 */
  const headText = (shellText.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [])[1] || "";
  if (!headText) problems.push("index.html: 找不到 <head> 区域");

  /* --- 8.1 品牌图形：页面 logo vs 页签 favicon --- */
  const logoAt = html.indexOf('class="logo"');
  if (logoAt < 0) {
    problems.push("V1/index.html: 找不到 .logo 容器（品牌图形检查无法进行）");
  } else {
    const logoScope = html.slice(logoAt, html.indexOf("</svg>", logoAt));
    const pageD = [...logoScope.matchAll(/<path[^>]*\sd=["']([^"']+)["']/g)].map((m) => m[1].trim());

    const iconTag = (headText.match(/<link[^>]*\brel=["']icon["'][^>]*>/i) || [])[0];
    if (!iconTag) {
      problems.push('index.html: 找不到 <link rel="icon"> 页签图标');
    } else if (!/data:image\/svg\+xml/i.test(iconTag)) {
      note.push("index.html: 页签图标不是内联 SVG，跳过与页面 logo 的同构比对");
    } else {
      /* href 值内部含单引号（内联 SVG 用单引号写属性，避免与 HTML 双引号冲突），
         所以绝不能写成 href=["']([^"']+)["'] —— 那样会在值里的第一个单引号处提前截断。 */
      const raw = (iconTag.match(/\shref="([^"]*)"/i) || iconTag.match(/\shref='([^']*)'/i) || [])[1] || "";
      let decoded = "";
      try { decoded = decodeURIComponent(raw.replace(/^data:image\/svg\+xml[^,]*,/i, "")); }
      catch (e) { problems.push(`index.html: 页签图标 data URI 解码失败：${e.message}`); }
      const iconD = [...decoded.matchAll(/<path[^>]*\sd=["']([^"']+)["']/g)].map((m) => m[1].trim());

      if (!pageD.length) {
        problems.push("V1/index.html: .logo 容器里找不到 <path d>，无法比对页签图标");
      } else if (iconD.join(" | ") !== pageD.join(" | ")) {
        problems.push(
          "品牌图形不同构：页签 favicon 与页面 logo 的 path 数据不一致（同一份图形存了两遍，必须一起改）。\n" +
          `      页面 logo : ${pageD.join(" | ")}\n` +
          `      页签图标  : ${iconD.join(" | ") || "（未提取到 path）"}`
        );
      }
    }
  }

  /* --- 8.2 字体：壳 <link> 声明的族名必须在样式里被引用 --- */
  const fontsHrefs = [...headText.matchAll(/<link[^>]*\shref="([^"]*)"/gi)].map((m) => m[1])
    .filter((h) => /fonts\.googleapis\.com\/css/i.test(h) && /family=/i.test(h));
  const cssText = readFileSync(join(ROOT, "V1/style.css"), "utf8");
  if (!fontsHrefs.length) {
    note.push("index.html: 未引入 Web 字体（若已改回纯系统字体栈，此提示可忽略）");
  } else {
    for (const href of fontsHrefs) {
      const fams = [...decodeURIComponent(href).matchAll(/family=([^&:]+)/g)]
        .map((m) => m[1].replace(/\+/g, " ").trim()).filter(Boolean);
      if (!fams.length) {
        problems.push(`index.html: 字体 <link> 里解析不出任何 family 名：${href}`);
      }
      for (const fam of fams) {
        if (!cssText.includes(`"${fam}"`) && !cssText.includes(`'${fam}'`)) {
          problems.push(
            `壳引入了字体 "${fam}"，但 V1/style.css 里没有引用这个族名 —— 字体不会生效（静默失效，页面照常渲染）`
          );
        }
      }
    }
  }
}

/* ---------- 输出 ---------- */
console.log("检查模块数：" + files.length);
console.log("els 键数：" + definedEls.size + " · HTML id 数：" + ids.size);
if (note.length) {
  console.log("\n--- 提示（非错误） ---");
  note.forEach((n) => console.log("  · " + n));
}
if (problems.length) {
  console.log("\n--- 错误 " + problems.length + " 项 ---");
  problems.forEach((p) => console.log("  ✗ " + p));
  process.exitCode = 1;
} else {
  console.log("\n✅ 导入 / els / id / 标识符来源 / 版本登记 / 跨文件冗余数据 六类一致性检查全部通过");
}
