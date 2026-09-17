/* ============================================================
 * check-portal-sync.mjs — 根门户一致性检查（README 工具表 ↔ index.html 卡片）
 * ------------------------------------------------------------
 * 为什么需要它：同一份「工具清单」在仓库里存了两遍 ——
 *   README.md 的「🛠 工具」表格 与 index.html 的卡片网格。
 * 没有任何机制强制两边一起变，于是必然漂移。2026-09 就真实发生过两回：
 *   · code-workspace 上线了，门户里没有卡片；
 *   · json-format 上线了，门户里那张「JSON 格式化」还挂着 disabled 占位卡。
 *
 * 第二回特别阴：占位卡的标题是中文「JSON 格式化」，既不含 slug `json-format`、
 * 也不含被删的 `json_test`，`grep` 扫全仓库显示"无残留" —— 实际卡还在。
 * 所以这里**不用关键字 grep**，改按语义条目做集合比对。
 *
 * 用法:
 *   node tools/_build/check-portal-sync.mjs
 * 退出码：0 = 一致，1 = 有漂移（可直接串进 CI / 预提交）
 *
 * 检查范围：只比 README 的「🛠 工具」一节。
 *   下方「🧪 前端探索学习项目」是刻意不进门户的实验项目（README 里已声明
 *   "非正式工具"），如果哪天要收进门户，把 SECTION_RE 改掉即可。
 * ============================================================ */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const README = path.join(ROOT, "README.md");
const PORTAL = path.join(ROOT, "index.html");

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "\n      → " + extra : "")); }
};
const note = (msg) => console.log("  · " + msg);

/* ---------- 文本工具 ---------- */

/** 去掉 HTML 标签 / 实体 / 开头装饰性 emoji，得到可比的纯名称 */
function normName(raw) {
  return String(raw)
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-zA-Z]+;/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")   // 掐掉开头的 emoji / 符号 / 空白
    .trim();
}

/** 从链接目标里取出项目目录名：./tools/en-words/ 与 tools/en-words/index.html → en-words */
function projectKey(href) {
  const m = /(?:^|\/)tools\/([^/]+)\//.exec(String(href));
  return m ? m[1] : null;
}

/** 相对仓库根解析并判断存在 */
function existsInRepo(href) {
  const rel = String(href).replace(/^\.\//, "").replace(/^\/+/, "");
  return fs.existsSync(path.join(ROOT, rel));
}

/* ---------- 解析 README 的「🛠 工具」表 ---------- */
function parseReadme() {
  const md = fs.readFileSync(README, "utf8");
  const lines = md.split(/\r?\n/);

  // 定位小节：从 "## 🛠 工具" 到下一个二级标题
  const start = lines.findIndex((l) => /^##\s+.*工具/.test(l));
  if (start < 0) throw new Error("README 里找不到「## 🛠 工具」小节标题");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  const section = lines.slice(start + 1, end);

  const entries = [];
  const anomalies = [];
  for (const line of section) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    // 跳过表头分隔行（|----|----|）
    if (/^\|[\s:|-]+\|$/.test(t)) continue;

    const cells = t.split("|");            // ['', 名称, 状态, 说明, '']
    if (cells.length < 4) { anomalies.push(t); continue; }
    const nameCell = cells[1].trim();
    const statusCell = cells[2].trim();
    if (nameCell === "工具") continue;      // 表头

    const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(nameCell);
    const status = /占位/.test(statusCell) ? "placeholder" : "available";
    entries.push({
      raw: t,
      name: normName(link ? link[1] : nameCell),
      display: link ? link[1].trim() : nameCell,
      href: link ? link[2].trim() : null,
      project: link ? projectKey(link[2]) : null,
      status
    });
  }
  return { entries, anomalies, startLine: start + 1 };
}

/* ---------- 解析 index.html 的卡片网格 ---------- */
function parsePortal() {
  const html = fs.readFileSync(PORTAL, "utf8");

  const gridStart = html.indexOf('class="tools-grid"');
  if (gridStart < 0) throw new Error("index.html 里找不到 .tools-grid 容器");
  const grid = html.slice(gridStart);

  // 收集每张卡片的开标签位置（拿它切块，避免被卡片内部的嵌套 </div> 带偏）
  const openRe = /<(a|div)\s+([^>]*class="tool-card[^"]*"[^>]*)>/g;
  const marks = [];
  let m;
  while ((m = openRe.exec(grid))) {
    marks.push({ idx: m.index, attrs: m[2], bodyStart: openRe.lastIndex });
  }

  const cards = [];
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const stop = i + 1 < marks.length ? marks[i + 1].idx : grid.length;
    const body = grid.slice(cur.bodyStart, stop);

    const hrefM = /href="([^"]+)"/.exec(cur.attrs);
    const nameM = /class="tool-name"[^>]*>([\s\S]*?)<\/div>/.exec(body);
    const statusM = /class="tool-status"[^>]*>([\s\S]*?)<\/span>/.exec(body);

    cards.push({
      href: hrefM ? hrefM[1].trim() : null,
      name: nameM ? normName(nameM[1]) : "(未取到名称)",
      statusText: statusM ? statusM[1].trim() : "",
      disabled: /\bdisabled\b/.test(cur.attrs),
      project: hrefM ? projectKey(hrefM[1]) : null
    });
  }
  return cards;
}

/* ---------- 主流程 ---------- */
console.log("门户一致性检查 · README 工具表 ↔ index.html 卡片\n");

const readme = parseReadme();
const cards = parsePortal();

const mdTools = readme.entries.filter((e) => e.status === "available");
const mdPlaceholders = readme.entries.filter((e) => e.status === "placeholder");
const cardLive = cards.filter((c) => !c.disabled);
const cardPlaceholders = cards.filter((c) => c.disabled);

note(`README 工具表：${mdTools.length} 个可用 + ${mdPlaceholders.length} 个占位`);
note(`门户卡片：${cardLive.length} 个可用 + ${cardPlaceholders.length} 个占位`);
console.log("");

/* 解析健壮性：说明列里出现 `|` 会把列切错，必须显式报出来而不是静默漏行 */
ok("README 工具表每行都能正确解析出「名称 | 状态」两列",
   readme.anomalies.length === 0,
   readme.anomalies.length ? `切列异常 ${readme.anomalies.length} 行：\n      ` + readme.anomalies.join("\n      ") : "");

/* A1 总数 */
ok(`可用条目数两边一致（README ${mdTools.length} / 门户 ${cardLive.length}）`,
   mdTools.length === cardLive.length);

/* A2 README 有、门户缺 */
const liveKeys = new Set(cardLive.map((c) => c.project).filter(Boolean));
const missingInPortal = mdTools.filter((e) => e.project && !liveKeys.has(e.project));
ok("README 里每个可用工具在门户都有卡片",
   missingInPortal.length === 0,
   missingInPortal.map((e) => `${e.project}（README 名字：${e.name}）`).join("；"));

/* A3 门户有、README 缺 */
const mdKeys = new Set(mdTools.map((e) => e.project).filter(Boolean));
const orphanCards = cardLive.filter((c) => c.project && !mdKeys.has(c.project));
ok("门户里每张可用卡片在 README 都有条目",
   orphanCards.length === 0,
   orphanCards.map((c) => `${c.project}（卡片名字：${c.name}）`).join("；"));

/* A4 配对上之后名称还要一致（防「只改了一边的显示名」） */
const nameMismatch = [];
for (const e of mdTools) {
  const c = cardLive.find((x) => x.project && x.project === e.project);
  if (c && c.name !== e.name) nameMismatch.push(`${e.project}: README「${e.name}」 ↔ 门户「${c.name}」`);
}
ok("配对的工具显示名一致",
   nameMismatch.length === 0,
   nameMismatch.join("；"));

/* A5 / A6 链接目标真实存在（防「删了目录忘删卡片」） */
const mdDeadLinks = mdTools.filter((e) => e.href && !existsInRepo(e.href));
ok("README 可用条目的链接目标都存在",
   mdDeadLinks.length === 0,
   mdDeadLinks.map((e) => `${e.href}（条目：${e.name}）`).join("；"));

const cardDeadLinks = cardLive.filter((c) => c.href && !existsInRepo(c.href));
ok("门户可用卡片的 href 目标都存在",
   cardDeadLinks.length === 0,
   cardDeadLinks.map((c) => `${c.href}（卡片：${c.name}）`).join("；"));

/* A7 / A8 占位条目按名称配对 */
const mdPhNames = mdPlaceholders.map((e) => e.name).sort();
const cardPhNames = cardPlaceholders.map((c) => c.name).sort();
const phMissing = mdPhNames.filter((n) => !cardPhNames.includes(n));
const phExtra = cardPhNames.filter((n) => !mdPhNames.includes(n));
ok(`占位条目两边一致（README ${mdPhNames.length} / 门户 ${cardPhNames.length}）`,
   phMissing.length === 0 && phExtra.length === 0,
   [phMissing.length ? `README 有门户缺：${phMissing.join("、")}` : "",
    phExtra.length ? `门户有 README 缺：${phExtra.join("、")}` : ""].filter(Boolean).join("；"));

/* ★ A9 状态交叉：README 已标可用，门户却还是占位卡 —— 2026-09-17 真实踩过的坑 */
const stuckPlaceholders = cardPlaceholders.filter((c) =>
  mdTools.some((e) => e.project === c.project || e.name === c.name));
ok("没有「README 标 ✅ 可用、门户却仍是「敬请期待」」的卡片",
   stuckPlaceholders.length === 0,
   stuckPlaceholders.map((c) => `门户卡片「${c.name}」还是 disabled 占位卡，但 README 已标可用`).join("；"));

/* A10 反向：README 标占位，门户却给了可用卡 */
const prematureCards = cardLive.filter((c) =>
  mdPlaceholders.some((e) => e.name === c.name));
ok("没有「README 标 🔜 占位、门户却已经是可用卡」的卡片",
   prematureCards.length === 0,
   prematureCards.map((c) => `门户卡片「${c.name}」已是可用卡，但 README 还标占位`).join("；"));

/* ---------- 汇总 ---------- */
console.log("\n================================");
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail === 0) {
  console.log("→ README 工具表与门户卡片完全一致。");
  console.log("  （「🧪 前端探索学习项目」按设计不进门户，未纳入比对）");
} else {
  console.log("→ 两边已经漂移。改了工具清单请把 README 与 index.html 一起改。");
}
process.exit(fail === 0 ? 0 : 1);
