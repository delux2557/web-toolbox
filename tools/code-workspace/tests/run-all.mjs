/* ============================================================
 * run-all.mjs — 一条命令跑完 code-workspace 的全部校验
 * ------------------------------------------------------------
 * 用法：node tests/run-all.mjs
 * 退出码：0 全绿；1 有失败（可直接接进任何 CI / 钩子）
 *
 * 四层校验，越往下越「接近真实浏览器」：
 *   verify     · 静态一致性（导入 / els 键 / HTML id / 标识符来源 四类悬空引用）
 *   smoke      · 纯逻辑单元（安全校验、路径、语言映射、离线包 API 面）
 *   wiring     · DOM 桩加载 main.js：事件真挂上了吗、点击真触发了吗、失败真可见吗
 *   docs-check · 防过期：overview.md 里写的数字现在还成立吗（内部会复跑前三层取实测值）
 * ============================================================ */

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || join(HERE, ".."));
const NODE = process.execPath;

const SUITES = [
  { name: "verify",        file: "verify.mjs",     args: [],           desc: "静态一致性（悬空引用）" },
  { name: "smoke",         file: "smoke.mjs",      args: [],           desc: "纯逻辑单元" },
  { name: "wiring",        file: "wiring.mjs",     args: [],           desc: "接线冒烟（顶层页面）" },
  { name: "wiring-iframe", file: "wiring.mjs",     args: ["--embedded"], desc: "接线冒烟（嵌入 iframe）" },
  { name: "docs-check",    file: "docs-check.mjs", args: [],           desc: "文档数字防过期" }
];

const results = [];
let grandPass = 0, grandFail = 0;

for (const s of SUITES) {
  process.stdout.write(`\n${"─".repeat(62)}\n▸ ${s.name} — ${s.desc}\n${"─".repeat(62)}\n`);
  let out = "", code = 0;
  try {
    out = execFileSync(NODE, [join(HERE, s.file), ROOT, ...s.args], { encoding: "utf8" });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
    code = e.status ?? 1;
  }
  process.stdout.write(out);

  /* 各脚本统一以「通过 N · 失败 M」收尾 */
  const m = [...out.matchAll(/通过 (\d+) · 失败 (\d+)/g)].pop();
  const pass = m ? Number(m[1]) : 0;
  const fail = m ? Number(m[2]) : (code ? 1 : 0);
  grandPass += pass; grandFail += fail;

  /* verify 的输出格式与其他套件不同（不报通过/失败计数），单独判定。
     这里只匹配「一致性检查全部通过」，**不要**把类别数（三类/四类…）写进正则：
     以后加一类检查就会让这条判定静默失效，然后 run-all 把红的 verify 报成绿。 */
  const verifyOk = s.name === "verify" && /一致性检查全部通过/.test(out);
  results.push({ ...s, pass, fail, code, verifyOk, ok: verifyOk || (fail === 0 && pass > 0) });
}

console.log(`\n${"═".repeat(62)}`);
console.log("汇总");
console.log("═".repeat(62));
for (const r of results) {
  const mark = r.ok ? "✅" : "❌";
  const num = r.verifyOk ? "通过" : `通过 ${r.pass} · 失败 ${r.fail}`;
  console.log(`  ${mark} ${r.name.padEnd(14)} ${num}`);
}
const bad = results.filter((r) => !r.ok);
console.log("─".repeat(62));
console.log(`断言合计：通过 ${grandPass} · 失败 ${grandFail}；失败的套件 ${bad.length} 个`);

if (bad.length) {
  console.log("\n需要处理：" + bad.map((r) => r.name).join(", "));
  process.exitCode = 1;
} else {
  console.log("\n全部通过 ✅");
}
