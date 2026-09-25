/* ============================================================
 * mutation-excel2sql.mjs — 反向实验（mutation testing）
 * ------------------------------------------------------------
 * 用法：
 *   node tools/_build/mutation-excel2sql.mjs            # 跑全部用例
 *   node tools/_build/mutation-excel2sql.mjs --only=ui  # 只跑某一类闸门
 *
 * 它回答的问题不是「测试过不过」，而是「测试**还咬不咬人**」：
 *   把源文件故意改坏一处 → 期望闸门变红、且红的正是那条该红的断言
 *   → 一旦某条断言其实恒真（假守卫）或覆盖不到（盲区），这里会立刻暴露。
 *
 * ★ 为什么不接进 CI：
 *   ① 会改源文件；② 慢（每条用例都要起一次子进程跑整道闸门）。
 *   按需手动跑，改完断言/布局后跑一次即可。详见 README 的「反向实验」小节。
 *
 * ★ 三条硬规矩（都是踩出来的）：
 *   1. 变异必须**先证明真的动到了文件**（find 命中且唯一），否则是空转变绿。
 *   2. 用例里的 find/replace 一律不要自己拼行尾，多行变异交给 `applyMutation`
 *      做行尾自适应（本仓库文件行尾不统一：styles.css 是 CRLF，新写的 js 是 LF）。
 *   3. **还原必须能扛住强杀**。见下面 journal 那段 —— 还原原本只写在 finally 里，
 *      而进程被 SIGTERM 打断时 finally 不执行，源文件就静默留在改坏状态。
 * ============================================================ */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const NODE = process.execPath;
const CASES_FILE = join(HERE, "mutation-cases.json");
const JOURNAL = join(HERE, ".mutation-journal.json");

const GATES = {
  logic: { file: "check-excel2sql.mjs", label: "纯逻辑" },
  ui: { file: "check-excel2sql-ui.mjs", label: "界面接线" }
};

const only = (process.argv.slice(2).find((a) => a.startsWith("--only=")) || "").replace("--only=", "");

/* ---------- 断点还原（journal） ----------

   ★★ 为什么需要它：还原动作原本只写在 finally 里。进程正常跑完没问题，但被
   **强杀**时（超时、SIGTERM、Ctrl-C —— 用例变多、闸门变慢之后这很常见）finally
   根本不执行，源文件就**静默留在改坏状态**，而且事后没有任何提示。
   真踩到：app.js 里留着一句 `else if (false)`，下一次运行只打印「基线就不绿」，
   特别容易被误读成"闸门坏了"而不是"上次没还原干净"。

   机制：动手改之前先把**原文**写进 journal；正常还原后删掉。
   启动时若发现 journal 还在，说明上次没走完 —— 先用它还原，再往下跑。
   SIGKILL 拦不住，所以 journal 是兜底，信号处理只是"更早一点"。 */

let journalArmed = null;

function restoreFromJournal() {
  if (!existsSync(JOURNAL)) return;
  try {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8"));
    writeFileSync(join(ROOT, j.file), j.original);
    console.log(`⚠️  上次运行被中断（未走完 finally），已用 journal 还原 ${j.file}`);
  } catch (e) {
    console.log(`⚠️  发现 journal 但还原失败，请手动检查：${e.message}`);
  }
  rmSync(JOURNAL, { force: true });
  journalArmed = null;
}

function sweepAndExit() {
  if (journalArmed) {
    try { writeFileSync(join(ROOT, journalArmed.file), journalArmed.original); } catch { /* 尽力而为 */ }
    rmSync(JOURNAL, { force: true });
    console.log(`\n⚠️  收到中断信号，已还原 ${journalArmed.file}`);
  }
  process.exit(1);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, sweepAndExit);

/* ---------- 跑一道闸门，回传失败行的文案 ---------- */

function runGate(name) {
  const g = GATES[name];
  if (!g) throw new Error("未知闸门: " + name);
  let out = "";
  try {
    /* stdin 必须显式钉成 ignore —— 缺省会继承父进程的 stdin，在受限环境里直接 EBUSY */
    out = execFileSync(NODE, [join(HERE, g.file), ROOT], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
    if (!out.trim()) out = "  ⚠ 子进程未能启动（" + (e.code || "unknown") + "）\n";
  }
  const fails = out
    .split(/\r?\n/)
    .map((l) => (l.match(/^\s*FAIL\s+(.*)$/) || [])[1])
    .filter(Boolean)
    .map((s) => s.trim());
  const m = (out.match(/通过 (\d+) 项?，失败 (\d+) 项?/) || []);
  return { fails, pass: m ? Number(m[1]) : null, fail: m ? Number(m[2]) : fails.length };
}

/* ---------- 变异：行尾自适应 + 命中数校验 ---------- */

/* 一条用例可以带多个 edit（数组顺序应用）。需要多步的典型场景：
   某条断言只有在**两处同时**被改坏时才该响（例如明暗两套 --text-3 的交点）。 */
function editsOf(c) {
  if (Array.isArray(c.edits) && c.edits.length) return c.edits;
  return [{ find: c.find, replace: c.replace }];
}

function applyMutation(absPath, edits, relPath) {
  const original = readFileSync(absPath, "utf8");
  const nl = original.includes("\r\n") ? "\r\n" : "\n";
  let cur = original;

  for (let i = 0; i < edits.length; i++) {
    /* 用例里统一写 \n，这里按文件真实行尾换算，避免"看着改了其实没改" */
    const f = String(edits[i].find).replace(/\r?\n/g, nl);
    const r = String(edits[i].replace).replace(/\r?\n/g, nl);
    const count = cur.split(f).length - 1;
    if (count === 0) return { ok: false, reason: `第 ${i + 1} 处变异目标不存在（find 没命中，空转）` };
    if (count > 1) return { ok: false, reason: `第 ${i + 1} 处变异目标不唯一（命中 ${count} 处）` };
    cur = cur.replace(f, r);
  }

  if (cur === original) return { ok: false, reason: "替换后内容没变（find 与 replace 等价？）" };
  /* ★ 先落 journal 再动手：万一下一秒被强杀，至少还有原文可还原 */
  writeFileSync(JOURNAL, JSON.stringify({ file: relPath, original }));
  journalArmed = { file: relPath, original };
  writeFileSync(absPath, cur);
  return { ok: true, original, nls: nl };
}

/* ---------- 主流程 ---------- */

function main() {
  /* 先看有没有上次没走完留下的 journal（强杀场景），有就先还原再往下 */
  restoreFromJournal();

  const spec = JSON.parse(readFileSync(CASES_FILE, "utf8"));
  const cases = spec.cases.filter((c) => !only || c.gate === only);

  console.log("=".repeat(64));
  console.log("反向实验 · excel2sql —— 把源文件改坏，看闸门咬不咬人");
  console.log("=".repeat(64));

  /* 基线：不改任何东西时，两道闸门必须全绿。否则后面的"咬到了"没有意义。 */
  const base = {};
  for (const n of Object.keys(GATES)) {
    base[n] = runGate(n);
    const okMark = base[n].fail === 0 ? "✅" : "❌";
    console.log(`基线 ${GATES[n].label.padEnd(6)} ${okMark} 通过 ${base[n].pass} · 失败 ${base[n].fail}`);
  }
  const baseBad = Object.keys(GATES).filter((n) => base[n].fail !== 0);
  if (baseBad.length) {
    console.log("\n❗ 基线就不绿，先修闸门再谈反向实验。");
    process.exitCode = 1;
    return;
  }

  let caught = 0, missed = 0, harness = 0;

  for (const c of cases) {
    const abs = join(ROOT, c.file);
    const g = GATES[c.gate];
    console.log("\n" + "─".repeat(64));
    console.log(`▸ ${c.id}  [${g.label}]`);
    console.log(`  为什么：${c.why}`);
    console.log(`  变异：${c.file}`);
    editsOf(c).forEach((e) => console.log(`        ${JSON.stringify(e.find)}  →  ${JSON.stringify(e.replace)}`));

    const mut = applyMutation(abs, editsOf(c), c.file);
    if (!mut.ok) {
      console.log(`  ❗ 用例本身没生效：${mut.reason}`);
      harness++;
      continue;
    }

    try {
      const res = runGate(c.gate);
      if (res.fail === 0) {
        console.log(`  ❗ 改坏了闸门却仍全绿 —— 假守卫或覆盖盲区（通过 ${res.pass} · 失败 0）`);
        missed++;
        continue;
      }
      /* 不仅要红，还要**红对了地方**：预期文案必须逐条出现在失败行里 */
      const wanted = c.expect || [];
      const notFound = wanted.filter((w) => !res.fails.some((f) => f.includes(w)));
      if (notFound.length) {
        console.log(`  ❗ 变红了，但不是预期那条（失败 ${res.fail}）`);
        res.fails.forEach((f) => console.log(`      · ${f}`));
        notFound.forEach((w) => console.log(`      缺：${w}`));
        missed++;
        continue;
      }
      console.log(`  ✅ 咬到 ${res.fails.length} 条（本次变异共 ${res.fail} 处失败）`);
      res.fails.forEach((f) => console.log(`      · ${f}`));
      caught++;
    } finally {
      /* 无论断言结果如何，源文件必须回到原样 —— 并在写回后复核一次 */
      writeFileSync(abs, mut.original);
      const back = readFileSync(abs, "utf8");
      if (back !== mut.original) {
        console.log(`  ❗ 还原失败！请手动检查 ${c.file}`);
        process.exitCode = 1;
      } else {
        /* 复核通过才撤 journal：顺序反过来会在"写回失败"时把兜底也一起丢掉 */
        rmSync(JOURNAL, { force: true });
        journalArmed = null;
      }
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log(`用例合计 ${cases.length}：咬到 ${caught} · 漏掉 ${missed} · 用例自身无效 ${harness}`);
  if (missed || harness) {
    console.log("\n需要处理：漏掉的用例说明断言不够硬或变异选点不对。");
    process.exitCode = 1;
  } else {
    console.log("\n全部咬到 ✅（源文件均已还原）");
  }
}

try {
  main();
} catch (e) {
  console.error("\n反向实验异常终止：", e);
  process.exitCode = 1;
}
