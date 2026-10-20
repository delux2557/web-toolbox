/* ============================================================
 * icons.test.mjs — codebase-context 的图标与文案卫生
 * ------------------------------------------------------------
 * 跑法：node tools/codebase-context/tests/icons.test.mjs   （退出码 0 / 1）
 *
 * 为什么要单独一个文件：本工具的界面图标**散在 5 个文件里**
 * （V7/index.html 的静态标记 + main.js / scenario.js / preview.js 里拼的 HTML 字符串），
 * 靠人眼扫一遍必然漏。CI 只跑构建与快照验收，那两步发现不了"UI 里混进彩色 emoji"。
 *
 * 同时守两件容易被"顺手清理"搞坏的事：
 *   ① 导出文档里的 emoji（markdown.js 的标题 / scenarios.json 的提示词开头）**是内容**，
 *      不是界面图标，删了会改用户拿到的 .md；
 *   ② `## 📁 文件内容聚合` 被 preview.js 逐字匹配 —— 改一边不改另一边不会报错，
 *      只是预览顶部那截悄悄消失。
 * ============================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

/* 判据用 Unicode 属性，不手写码位区间 —— 手写那版漏掉了 U+23F3 ⏳，
   让 table-helper 的"解析中"一路带着彩色 emoji 没被发现。 */
const EMOJI = /\p{Emoji_Presentation}|\uFE0F/gu;

/* ------------------------------------------------------------
 * [1] 界面文件里不许有彩色 emoji
 * ------------------------------------------------------------
 * 数一下"界面文件"到底有哪些：片段标记 + 样式 + 全部模块。
 * ★ 唯一放行的是 preview.js 里那串**内容常量**（见 [3]），逐行跳过，
 *   而不是整个文件跳过 —— 整文件跳过正是漏检的老路。
 * ---------------------------------------------------------- */
console.log("\n[1] 界面文件里的彩色 emoji");

const SRC = join(ROOT, "V7", "src");
const UI_FILES = [
  "V7/index.html",
  "V7/style.css",
  ...readdirSync(SRC).filter(f => f.endsWith(".js")).map(f => "V7/src/" + f),
];
ok("界面文件清单覆盖到 5 个以上文件（标记 / 样式 / 模块）", UI_FILES.length >= 5, UI_FILES.length);

/* 允许出现在界面文件里的**内容字符串**：它们会写进导出文档或被解析器逐字匹配，
   不是图标。★ 按"字符串"放行、不按"文件"放行 —— 整文件跳过正是漏检的老路：
   同一个文件里新加一枚彩色 emoji，整文件豁免就再也发现不了。 */
const CONTENT_STRINGS = [
  '"# 📊 Codebase Context"',    // markdown.js：导出文档标题
  '"## 🌳 目录结构"',            // markdown.js：导出文档小节
  '"## 📁 文件内容聚合"',        // markdown.js 写入 + preview.js 逐字匹配，两处都用它
  "⚙️ 系统指令",                 // constants.js：默认提示词前缀
];

const hits = [];
let allowedLines = 0;
for (const rel of UI_FILES) {
  const lines = read(rel).split(/\r?\n/);
  lines.forEach((line, i) => {
    EMOJI.lastIndex = 0;
    if (!EMOJI.test(line)) return;
    EMOJI.lastIndex = 0;
    if (CONTENT_STRINGS.some(s => line.includes(s))) { allowedLines++; return; }
    hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
  });
}
ok("界面里没有彩色 emoji（会跟单色界面打架，且各平台字形不同）",
   hits.length === 0, hits.join("\n      "));
/* 放行面要能被数出来：markdown.js 三行（文档标题 + 两个小节）
   + preview.js 一行（逐字匹配那个小节）+ constants.js 一行（默认提示词前缀）= 5 行。
   数字变了说明有人又往界面文件里加了一条带 emoji 的内容，得人工过一眼。 */
const ALLOWED_LINE_COUNT = 5;
ok("放行的只有那几条导出内容字符串（放行面别扩大）",
   allowedLines === ALLOWED_LINE_COUNT, `${allowedLines} 行，期望 ${ALLOWED_LINE_COUNT}`);

/* ------------------------------------------------------------
 * [2] sprite 的引用都能落地
 * ------------------------------------------------------------
 * 静态 <use> 与 JS 字符串里拼的引用都要扫：指向不存在的 <symbol> **不报错**，
 * 只是那个图标永远不显示（本仓库反复踩的"静默失败"）。
 * ---------------------------------------------------------- */
console.log("\n[2] 图标集与引用");

const fragment = read("V7/index.html");
const symbols = new Set([...fragment.matchAll(/<symbol\s+id="(ic-[^"]+)"/g)].map(m => m[1]));
ok("片段里有 <symbol> 定义", symbols.size >= 5, symbols.size);

const refs = new Map();   // id -> [来源文件]
for (const rel of ["V7/index.html", ...readdirSync(SRC).filter(f => f.endsWith(".js")).map(f => "V7/src/" + f)]) {
  for (const m of read(rel).matchAll(/#(ic-[a-z-]+)/g)) {
    if (!refs.has(m[1])) refs.set(m[1], []);
    if (!refs.get(m[1]).includes(rel)) refs.get(m[1]).push(rel);
  }
}
ok("确实在用图标（静态 + JS 字符串）", refs.size >= 5, refs.size);
ok("JS 里也在用 sprite 引用（说明动态生成的那几处没退回 emoji）",
   [...refs.values()].some(from => from.some(f => f.startsWith("V7/src/"))));
const dangling = [...refs.keys()].filter(id => !symbols.has(id));
ok("每个引用都指向存在的 <symbol>（否则图标静默消失）", dangling.length === 0, dangling.join(", "));
const unused = [...symbols].filter(id => !refs.has(id));
ok("没有定义了却没人用的图标（死代码也是噪声）", unused.length === 0, unused.join(", "));

/* ------------------------------------------------------------
 * [3] 导出内容里的 emoji 是**内容**，不能顺手清掉
 * ------------------------------------------------------------
 * markdown.js 的标题会原样进 .md；scenarios.json / constants.js 的提示词前缀
 * 会进用户复制的 prompt。删掉它们 = 改了用户的产出。
 * ---------------------------------------------------------- */
console.log("\n[3] 导出文档内容（不是界面图标）");

const md = read("V7/src/markdown.js");
ok("导出文档标题仍是 # 📊 Codebase Context", md.includes('"# 📊 Codebase Context"'));
ok("目录结构标题仍是 ## 🌳 目录结构", md.includes('"## 🌳 目录结构"'));

/* 这一对必须逐字一致：对不上不会报错，只是预览顶部那截消失 */
const heading = (md.match(/"(## [^"]*文件内容聚合)"/) || [])[1];
const pv = read("V7/src/preview.js");
ok("markdown.js 里能取出「文件内容聚合」标题", !!heading, heading);
ok("preview.js 用同一串做前缀匹配（改一边不改另一边会静默失效）",
   !!heading && pv.includes(`startsWith("${heading}")`), heading);

/* scenarios.json 的形状是 { defaultId, promptIntro, list[] }：
   单条场景可以自带 promptIntro，没有的就回落到顶层那个（scenario.js 就是这么做回落的）。 */
const scenarios = JSON.parse(read("data", "scenarios.json"));
const list = Array.isArray(scenarios.list) ? scenarios.list : [];
ok("场景清单读得出来（{ defaultId, promptIntro, list[] }）", list.length > 0, list.length);

/* 判据要同时认两种"彩色 emoji 开头"：
   ① \p{Emoji_Presentation} 默认就彩色渲染（🎯）；② \p{Emoji}\uFE0F 靠 FE0F 升级（⚙️）。 */
const STARTS_EMOJI = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u;
const badIntro = list.filter(s => !STARTS_EMOJI.test(String(s.promptIntro || scenarios.promptIntro || "")));
ok("每条场景的提示词都以它的 emoji 前缀开头（含回落到顶层的那条）",
   list.length > 0 && badIntro.length === 0,
   badIntro.map(s => s.id || s.name).join(", "));
ok("顶层兜底的 promptIntro 也带 emoji 前缀", STARTS_EMOJI.test(String(scenarios.promptIntro || "")));
ok("默认提示词前缀仍带 ⚙️",
   read("V7/src/constants.js").includes("⚙️ 系统指令"));

/* ------------------------------------------------------------
 * [4] 状态文案别整体覆写按钮
 * ------------------------------------------------------------ */
console.log("\n[4] 按钮状态文案");

const main = read("V7/src/main.js");
ok("复制按钮的文案改的是内部文字块（btnParseText 那类做法）",
   /els\.copyBtnText\.textContent/.test(main));
ok("没有整体覆写 copyBtn.textContent（会把里面的 <svg> 一起抹掉）",
   !/els\.copyBtn\.textContent\s*=/.test(main), "出现 els.copyBtn.textContent =");
ok("片段里复制按钮确实是「图标 + 文字块」两截",
   /id="copyBtn"[\s\S]{0,160}id="copyBtnText"/.test(fragment));

/* ------------------------------------------------------------
 * [5] 纯图标按钮要有可读名称
 * ------------------------------------------------------------ */
console.log("\n[5] 无障碍名称");

const nameless = [...fragment.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .filter(([, attrs, inner]) => {
    const text = inner.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/\s+/g, "");
    return text === "" && !/\b(aria-label|title)\s*=\s*"[^"]+"/.test(attrs);
  });
ok("没有「既无文字又无无障碍名称」的按钮", nameless.length === 0, "无名称按钮 " + nameless.length + " 个");

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
