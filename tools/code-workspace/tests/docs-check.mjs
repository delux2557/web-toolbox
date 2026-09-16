/* ============================================================
 * docs-check.mjs — 防过期测试：overview.md 里写的数字，现在还成立吗？
 * ------------------------------------------------------------
 * 动机：「加文档不会过期，加测试才会」。overview.md 里写着
 *   「12 模块 · 48 个 els 键 · 48 个 id · 71 项冒烟 · 17/20 项接线 · 100 个语言 key …」
 * 这些是**会腐烂的数字**：改了代码忘了改文档，文档就成了谎话，
 * 而且没有任何机制能发现。这个脚本就是那个机制。
 *
 * 做法：数字不硬编码在测试里（否则只是把腐烂点挪了个位置），而是
 *   1) 真的去跑 verify / smoke / wiring，从它们的 stdout 里取**实测值**；
 *   2) 真的去读磁盘量字节数；
 *   3) 和 overview.md 里写的**声称值**逐项比对。
 *
 * 用法：node docs-check.mjs <项目根> [脚本目录]
 * ============================================================ */

import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/* 项目根：优先取命令行参数，缺省则用脚本所在目录的上一级 */
const ROOT = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || join(HERE, ".."));
const NODE = process.execPath;

const DOC = join(ROOT, "overview.md");
const CSS = join(ROOT, "V1/style.css");
const BUNDLE = join(ROOT, "vendor/codemirror/codemirror.bundle.js");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  cond ? (pass++, console.log("  ✓ " + name))
       : (fail++, console.log("  ✗ " + name + (detail ? "  → " + detail : "")));
};

/* ---------- 1) 采集实测值 ---------- */
function run(script, extraArgs = []) {
  try {
    return execFileSync(NODE, [join(HERE, script), ROOT, ...extraArgs], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

const outVerify = run("verify.mjs");
const outSmoke = run("smoke.mjs");
const outWiring = run("wiring.mjs");
const outWiringEmb = run("wiring.mjs", ["--embedded"]);

const grab = (text, re, label) => {
  const m = text.match(re);
  if (!m) { console.log(`  ! 无法从 ${label} 的输出里取到数字，正则 ${re} 没匹配上`); return null; }
  return m.slice(1).map((s) => (s === undefined ? null : Number(s)));
};
const grabAll = (text, re) => {
  const m = [...text.matchAll(re)];
  return m.length ? m[m.length - 1].slice(1).map(Number) : null;
};

const [mods] = grab(outVerify, /检查模块数：(\d+)/, "verify.mjs") || [];
const [elsCount, idCount] = grab(outVerify, /els 键数：(\d+) · HTML id 数：(\d+)/, "verify.mjs") || [];
const smokeRes = grabAll(outSmoke, /通过 (\d+) · 失败 (\d+)/g);
const smokePass = smokeRes ? smokeRes[0] : null;
const smokeFail = smokeRes ? smokeRes[1] : null;
const wiringRes = grabAll(outWiring, /通过 (\d+) · 失败 (\d+)/g);
const wiringPass = wiringRes ? wiringRes[0] : null;
const wiringFail = wiringRes ? wiringRes[1] : null;
const wiringEmbRes = grabAll(outWiringEmb, /通过 (\d+) · 失败 (\d+)/g);
const wiringEmbPass = wiringEmbRes ? wiringEmbRes[0] : null;
const wiringEmbFail = wiringEmbRes ? wiringEmbRes[1] : null;

const [langKeys, registryTotal] = grab(outSmoke, /映射用到 (\d+) 个语言 key，全部存在于注册表（共 (\d+) 项）/, "smoke.mjs") || [];
const [exportCount] = grab(outSmoke, /(\d+) 项导出全部存在/, "smoke.mjs") || [];

const cssBytes = statSync(CSS).size;
const cssKB = Math.round(cssBytes / 1024);
const bundleBytes = statSync(BUNDLE).size;
const bundleMB = (bundleBytes / 1e6).toFixed(2);

/* ---------- 2) 采集文档声称值 ---------- */
const doc = readFileSync(DOC, "utf8");
const claim = (re, label) => {
  const m = doc.match(re);
  if (!m) { console.log(`  ! overview.md 里找不到「${label}」，正则没匹配上（文档结构变了？）`); return null; }
  return m.slice(1).map((s) => (s === undefined ? null : Number(s)));
};
/* 表格行里有 `|` 分隔符，所以中间一律用 [\s\S]*? 跨过去，别用 [^|]* */
const cCheckMods = claim(/`node --check` 全部 (\d+) 个模块/, "node --check 模块数")?.[0];
const [cMods, cEls, cId] = claim(/（(\d+) 模块 · (\d+) 个 `els` 键 · (\d+) 个 `id`/, "一致性校验三元组") || [];
const [cSmoke] = claim(/逻辑冒烟测试[\s\S]*?\*\*(\d+) 项全部通过\*\*/, "冒烟测试项数") || [];
const [cWiring, cWiringEmb] = claim(/接线冒烟测试[\s\S]*?\*\*(\d+) 项通过\*\*；嵌入 iframe 模式 \*\*(\d+) 项通过\*\*/, "接线测试项数") || [];
const [cLangKeys] = claim(/映射用到的 (\d+) 个语言 key/, "语言 key 数") || [];
const [cRegistryTotal] = claim(/离线包注册表（共 (\d+) 项）/, "注册表总项数") || [];
const [cExports] = claim(/(\d+) 项需要的导出全部存在/, "导出项数") || [];
const [cCssKB] = claim(/样式（(\d+) KB）/, "样式 KB") || [];
const [cBundleMB] = claim(/离线包（([\d.]+) MB）/, "离线包 MB") || [];

/* ---------- 3) 逐项比对 ---------- */
console.log("\n[A] 先确认底下的测试本身是绿的（红的话下面的数字没有意义）");
ok("verify.mjs 零失败", outVerify.includes("全部通过"), "verify 输出异常");
ok("smoke.mjs 零失败", smokeFail === 0, `实测失败 ${smokeFail} 项`);
ok("wiring.mjs 零失败（顶层模式）", wiringFail === 0, `实测失败 ${wiringFail} 项`);
ok("wiring.mjs 零失败（iframe 模式）", wiringEmbFail === 0, `实测失败 ${wiringEmbFail} 项`);

console.log("\n[B] overview.md 声称的数字 vs 实测");
ok("`node --check` 模块数", cCheckMods === mods, `文档 ${cCheckMods} · 实测 ${mods}`);
ok("一致性校验：模块数", cMods === mods, `文档 ${cMods} · 实测 ${mods}`);
ok("一致性校验：els 键数", cEls === elsCount, `文档 ${cEls} · 实测 ${elsCount}`);
ok("一致性校验：HTML id 数", cId === idCount, `文档 ${cId} · 实测 ${idCount}`);
ok("冒烟测试通过项数", cSmoke === smokePass, `文档 ${cSmoke} · 实测 ${smokePass}`);
ok("接线测试通过项数（顶层）", cWiring === wiringPass, `文档 ${cWiring} · 实测 ${wiringPass}`);
ok("接线测试通过项数（iframe）", cWiringEmb === wiringEmbPass, `文档 ${cWiringEmb} · 实测 ${wiringEmbPass}`);
ok("语言映射 key 数", cLangKeys === langKeys, `文档 ${cLangKeys} · 实测 ${langKeys}`);
ok("离线包注册表总项数", cRegistryTotal === registryTotal, `文档 ${cRegistryTotal} · 实测 ${registryTotal}`);
ok("离线包导出项数", cExports === exportCount, `文档 ${cExports} · 实测 ${exportCount}`);
ok("样式文件大小（KB，允许 ±1 取整误差）", Math.abs(cCssKB - cssKB) <= 1, `文档 ${cCssKB} KB · 实测 ${cssKB} KB（${cssBytes} B）`);
ok("离线包大小（MB，允许 ±0.01）", Math.abs(Number(cBundleMB) - Number(bundleMB)) <= 0.01, `文档 ${cBundleMB} MB · 实测 ${bundleMB} MB（${bundleBytes} B）`);

console.log("\n================================");
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail) {
  console.log("→ overview.md 的数字与代码现状不一致，请同步文档（别改测试，改文档）。");
  process.exitCode = 1;
} else {
  console.log("→ overview.md 里所有会腐烂的数字都与代码现状一致。");
}
