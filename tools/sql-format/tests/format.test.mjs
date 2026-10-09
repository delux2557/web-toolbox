/* ============================================================
 * format.test.mjs — sql-format 的零依赖测试
 * ------------------------------------------------------------
 * 跑法：node tools/sql-format/tests/format.test.mjs   （退出码 0 / 1）
 *
 * 设计上的一个刻意选择：**测的就是交付物本身**。
 * 这个工具是「单个自包含 HTML」，所以测试不是 import 某个模块，
 * 而是把 index.html 里的 <script> 抠出来、在 vm 沙箱里真跑一遍，
 * 再对暴露出的核心函数下断言。
 * 好处：不存在「测试版 / 生产版」两份代码可以各自漂移 ——
 * 谁把核心改坏、或者改完忘了同步，这里立刻红。
 * ============================================================ */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
};
const L = (...lines) => lines.join("\n");

/* ============================================================
 * [0] 「能双击打开」这条产品属性，先用静态断言守住
 * ============================================================ */
console.log("\n[0] 形态契约：必须能 file:// 双击打开");
ok("没有任何 <script src>（外部脚本）", !/<script[^>]+src=/i.test(HTML));
ok("没有 type=\"module\"（file:// 下会被 CORS 直接拦掉）", !/type\s*=\s*["']module["']/i.test(HTML));
ok("没有 fetch( —— 依赖 fetch 就必须起 HTTP 服务", !/\bfetch\s*\(/.test(HTML));
ok("没有外部 http(s) 资源（CDN 字体 / 样式一律不要）",
   !/(?:src|href)\s*=\s*["']https?:/i.test(HTML),
   "找到了外链：" + (HTML.match(/(?:src|href)\s*=\s*["']https?:[^"']*/i) || [""])[0]);
ok("CSS 与 JS 全部内联（没有 <link rel=stylesheet>）",
   !/<link[^>]+rel=["']stylesheet["']/i.test(HTML));

const scripts = [...HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
ok("恰好 1 个内联 <script> 块", scripts.length === 1, "实际 " + scripts.length);

/* ============================================================
 * [1] 在 vm 沙箱里跑核心
 * ------------------------------------------------------------
 * 沙箱里只给 module 与 TextEncoder：
 *   - 不给 document → 核心跑完就 return，UI 代码不执行；
 *   - 不注入 Object / Array / RegExp 这类宿主内置（vm 有独立 realm，
 *     注入会让产物里的 instanceof 判断恒为 false）。
 * ============================================================ */
console.log("\n[1] 从交付物里加载核心");
const sandbox = { module: { exports: {} }, TextEncoder, console };
vm.createContext(sandbox);
let loadError = null;
try { vm.runInContext(scripts[0], sandbox, { filename: "sql-format/index.html#script1" }); }
catch (e) { loadError = e; }
ok("核心脚本可执行（UI 因缺 document 被跳过）", !loadError, loadError && loadError.message);

const S = sandbox.module.exports;
ok("核心暴露了 API 对象", S && typeof S === "object");
ok("API 含 formatSql / minifySql / validateSql / tokenize",
   !!(S && S.formatSql && S.minifySql && S.validateSql && S.tokenize));
ok("API 含着色纯函数（可在无 DOM 下测）",
   !!(S && S.hlClassFor && S.buildFrags && S.splitLines && S.countElements));

/* ============================================================
 * [2] 词法：字符串 / 注释 / 数字 / 别名的引号形态
 * ============================================================ */
console.log("\n[2] 词法");
const kinds = (sql) => S.tokenize(sql).map((t) => t.type);

ok("分号在字符串里不算语句结束",
   kinds("select ';'").filter((k) => k === "string").length === 1);
ok("单引号内的 -- 不是注释",
   kinds("select 'a--b'").every((k) => k !== "line_comment"));
ok("真实 -- 注释被识别", kinds("select 1 -- x").includes("line_comment"));
ok("/* */ 块注释被识别", kinds("select 1 /* x */").includes("block_comment"));
ok("反引号标识符算字符串类 token", kinds("select `a`").includes("string"));
ok("方括号标识符算字符串类 token", kinds("select [order]").includes("string"));
ok("数字（含小数、指数）被识别",
   S.tokenize("1 2.5 1e3 0xFF").filter((t) => t.type === "number").length === 4);
ok("SQL Server 的 ]] 转义能正确闭合",
   S.tokenize("select [a]]b] from t").filter((t) => t.type === "string")[0].closed === true);
ok("连字符序列（a-b）不会被当成注释",
   !kinds("select a-b from t").includes("line_comment"));

/* ============================================================
 * [3] 结构错误：字符串 / 注释未闭合、括号不配平、空输入
 * ============================================================ */
console.log("\n[3] 结构错误");
const e1 = S.formatSql("select 'abc");
ok("未闭合字符串 → ok:false", !e1.ok);
ok("未闭合字符串报出行列", e1.ok === false && e1.error.line === 1 && e1.error.column === 8,
   JSON.stringify(e1.error));
const e2 = S.formatSql("select (1");
ok("左括号未闭合 → ok:false 且提示 ( 的位置", !e2.ok && e2.error.line === 1 && e2.error.column === 8,
   JSON.stringify(e2.error));
const e3 = S.formatSql("select 1)");
ok("多余右括号 → ok:false", !e3.ok && /右括号/.test(e3.error.message), JSON.stringify(e3.error));
ok("块注释未闭合 → ok:false", !S.formatSql("select 1 /* x").ok);
const e4 = S.formatSql("   \n  ");
ok("纯空白 → 空输入且不编造行列", !e4.ok && e4.error.empty === true && e4.error.line === null);
ok("空输入提示里告诉用户怎么做", /粘贴/.test(S.formatSql("").error.hint));
ok("括号在字符串内不参与配平（'(' 不算未闭合）",
   S.validateSql("select '(' from t").ok);

/* ============================================================
 * [4] 格式化：子句分行 / 逗号断行 / 条件缩进
 * ============================================================ */
console.log("\n[4] 格式化基础");
const F = (sql, opts) => S.formatSql(sql, opts || { indent: "2", case: "upper" }).value;

ok("SELECT/FROM/WHERE/ORDER BY 各占一行，列表缩进一层",
   F("select a,b from t where a=1 and b=2 order by a desc;") === L(
     "SELECT", "  a,", "  b", "FROM", "  t",
     "WHERE", "  a = 1", "  AND b = 2", "ORDER BY", "  a DESC;"),
   JSON.stringify(F("select a,b from t where a=1 and b=2 order by a desc;")));

ok("运算符两侧补空格、逗号后补空格",
   F("select a+b,c from t") === L("SELECT", "  a + b,", "  c", "FROM", "  t"),
   JSON.stringify(F("select a+b,c from t")));

ok("UPDATE ... SET 的赋值逐个断行",
   F("update t set a=1,b=2 where id=3;") === L(
     "UPDATE t", "SET", "  a = 1,", "  b = 2", "WHERE", "  id = 3;"),
   JSON.stringify(F("update t set a=1,b=2 where id=3;")));

ok("GROUP BY / ORDER BY / HAVING 被当成完整子句",
   F("select a,count(*) from t group by a having count(*)>1 order by a").indexOf("GROUP BY\n  a") >= 0 &&
   F("select a from t group by a order by a").indexOf("ORDER BY\n  a") >= 0);

ok("JOIN ... ON 保持在一行", F("select * from a join b on a.id=b.id").indexOf("JOIN b ON a.id = b.id") >= 0);

ok("UNION ALL 是完整关键字（不拆成 UNION / ALL）",
   F("select 1 union all select 2").indexOf("UNION ALL\nSELECT") >= 0);

/* ============================================================
 * [5] 括号：函数调用保持内联、子查询整体缩进
 * ============================================================ */
console.log("\n[5] 括号");
ok("函数调用括号内不换行", F("select count(*),coalesce(a,b) from t").indexOf("COALESCE(a, b)") >= 0);
ok("IN (...) 列表保持内联", F("select a from t where x in (1,2,3)").indexOf("x IN (1, 2, 3)") >= 0);
ok("窗口函数 OVER (...) 保持内联",
   F("select row_number() over (partition by a order by b) rn from t")
     .indexOf("OVER (PARTITION BY a ORDER BY b)") >= 0);

const sub = F("select * from (select id from u where active=1) x");
ok("子查询整体缩进，且与外侧对齐闭合",
   sub === L(
     "SELECT", "  *", "FROM", "  (", "    SELECT", "      id", "    FROM", "      u",
     "    WHERE", "      active = 1", "  ) x"),
   JSON.stringify(sub));

ok("NOT IN (SELECT ...) 走子查询缩进",
   F("select a from t where id not in (select id from z)").indexOf("NOT IN (\n    SELECT") >= 0);

/* ============================================================
 * [6] CASE：WHEN / ELSE 相对 CASE 再缩一层，END 对齐 CASE
 * ============================================================ */
console.log("\n[6] CASE 表达式");
const cse = F("select case when a=1 then 'x' when a=2 then 'y' else 'z' end as k from t");
ok("CASE / WHEN / ELSE / END 层级正确",
   cse === L(
     "SELECT", "  CASE", "    WHEN a = 1 THEN 'x'", "    WHEN a = 2 THEN 'y'",
     "    ELSE 'z'", "  END AS k", "FROM", "  t"),
   JSON.stringify(cse));

/* ============================================================
 * [7] 幂等性：格式化结果再格式化一次必须逐字节不变
 * ------------------------------------------------------------
 * 排版器最容易出的错就是「二次处理还会动」，用户点两下就漂了。
 * ============================================================ */
console.log("\n[7] 幂等性");
const IDEM = [
  "select a,b from t where a=1 and b=2 order by a desc;",
  "select * from (select id from u where active=1) x join o on o.uid=x.id where o.total>100;",
  "insert into t(a,b) values(1,2),(3,4);",
  "with c as (select 1) select * from c;",
  "select case when a=1 then 'x' else 'z' end as k from t;",
  "select a from t where name in ('a','b') and id not in (select id from z);",
  "update t set a=1,b=2 where id=3;",
  "select row_number() over (partition by a order by b) rn from t;",
  "create table t (a int,b text);"
];
let idemAll = true, idemBad = "";
for (const q of IDEM) {
  const once = F(q), twice = F(once);
  if (once !== twice) { idemAll = false; idemBad = q; break; }
}
ok("9 组样例格式化两次逐字节一致", idemAll, idemBad);

/* ============================================================
 * [8] 缩进档位与大小写
 * ============================================================ */
console.log("\n[8] 缩进与大小写");
ok("2 空格（默认）", F("select a from t").indexOf("\n  a") >= 0);
ok("4 空格", S.formatSql("select a from t", { indent: "4" }).value.indexOf("\n    a") >= 0);
ok("Tab", S.formatSql("select a from t", { indent: "tab" }).value.indexOf("\n\ta") >= 0);
ok("关键字大写（默认）", F("select a from t").indexOf("SELECT") >= 0);
ok("关键字小写", S.formatSql("SELECT A FROM T", { case: "lower" }).value.indexOf("select") >= 0);
/* 格式化会把关键字拆到各自的行上，所以不能拿整句 "Select A From T" 去 indexOf
   —— 那串在输出里不可能连续出现。要断的是「关键字保留了原始大小写」，即输入里的
   Select / From 原样保留，且没有被转成 SELECT / FROM。 */
ok("保持原样：关键字大小写原封不动",
   (function () {
     var v = S.formatSql("Select A From T", { case: "preserve" }).value;
     return v.indexOf("Select") >= 0 && v.indexOf("From") >= 0 && v.indexOf("SELECT") < 0;
   })());
ok("保持原样时函数名也不动",
   S.formatSql("select MyFunc(a) from t", { case: "preserve" }).value.indexOf("MyFunc(a)") >= 0);

/* ============================================================
 * [9] 压缩：空白收敛、注释移除并如实上报
 * ============================================================ */
console.log("\n[9] 压缩");
const m1 = S.minifySql("select  a ,  b\nfrom t where x in (1,2)");
ok("压缩成一行且空白收敛", m1.ok && m1.value === "SELECT a, b FROM t WHERE x IN (1, 2)", JSON.stringify(m1.value));
const m2 = S.minifySql("select a -- c1\nfrom t /* c2 */ where a=1");
ok("压缩移除注释", m2.value.indexOf("c1") < 0 && m2.value.indexOf("c2") < 0, JSON.stringify(m2.value));
ok("移除的注释数量如实上报", m2.droppedComments === 2, String(m2.droppedComments));
ok("无注释时上报 0", S.minifySql("select 1 from t").droppedComments === 0);
ok("字符串里的内容不被改动",
   S.minifySql("select 'a  b' from t").value === "SELECT 'a  b' FROM t",
   JSON.stringify(S.minifySql("select 'a  b' from t").value));
ok("压缩不改动字符串里的分号/注释符号",
   S.minifySql("select 'x -- y' from t").value.indexOf("'x -- y'") >= 0);

/* ============================================================
 * [10] 校验与工具函数
 * ============================================================ */
console.log("\n[10] 校验与工具函数");
ok("结构正确 → validateSql ok", S.validateSql("select 1 from t;").ok);
ok("结构错误 → validateSql 报错", !S.validateSql("select (1").ok);
ok("stripBOM 只削开头一个 BOM", S.stripBOM("\ufeff\ufeffx") === "\ufeffx");
ok("带 BOM 的 SQL 能正常格式化", S.formatSql("\ufeffselect 1").ok);
ok("lineCol 计算 1-based 行列", (() => {
  const p = S.lineCol("ab\ncde", 4);   // 下标 4 落在第 2 行第 2 列
  return p.line === 2 && p.column === 2;
})());
ok("byteSize 用 UTF-8 字节（中文 3 字节）", S.byteSize("中") === 3);
ok("countLines 空串为 0", S.countLines("") === 0 && S.countLines("a\nb") === 2);

/* ============================================================
 * [11] 着色分类（纯函数）
 * ============================================================ */
console.log("\n[11] 着色分类");
const frags = S.buildFrags("select 1 from t -- c");
const clsOf = (raw) => { const f = frags.find((x) => x.raw === raw); return f ? f.cls : null; };
ok("关键字 → tok-kw", clsOf("select") === "tok-kw");
ok("数字 → tok-num", clsOf("1") === "tok-num");
ok("行注释 → tok-cmt", frags.some((f) => f.cls === "tok-cmt"));
ok("函数（后跟括号）→ tok-fn",
   S.buildFrags("select count(*)").some((f) => f.raw === "count" && f.cls === "tok-fn"));
ok("普通标识符不上色（返回空 class）",
   S.buildFrags("select ab from t").some((f) => f.raw === "ab" && f.cls === ""));
ok("splitLines 按换行切行", S.splitLines(S.buildFrags("a\nb")).length === 2);
ok("countElements 只数带 class 的片段",
   S.countElements(S.splitLines(S.buildFrags("select 1"))) === 2 /* select + 1 */);

/* ============================================================
 * [12] 大输入稳定性：不崩、结果完整、可被压缩取回
 * ============================================================ */
console.log("\n[12] 大输入稳定性");
let big = "select ";
const cols = [];
for (let i = 0; i < 400; i++) cols.push("c" + i + " as col_" + i);
big += cols.join(", ") + " from t where " +
  Array.from({ length: 200 }, (_, i) => "c" + i + " = " + i).join(" and ") + ";";
const bigR = S.formatSql(big);
ok("400 列 + 200 个条件的输入能格式化成功", bigR.ok, bigR.ok ? "" : JSON.stringify(bigR.error));
/* 行数拆解：SELECT 1 + 400 列（每列一行）+ FROM 1 + 表名 t 1 + WHERE 1
   + 200 个条件（首个裸行，其余 199 个各带一个 AND 另起一行）= 604 */
ok("大输入格式化后行数与列数一致（1 + 400 + 1 + 1 + 1 + 200 = 604）",
   bigR.ok && S.countLines(bigR.value) === 604,
   bigR.ok ? String(S.countLines(bigR.value)) : "");
ok("大输入结果幂等", bigR.ok && S.formatSql(bigR.value).value === bigR.value);
ok("压缩能把大输入收回一行", S.minifySql(big).ok && S.countLines(S.minifySql(big).value) === 1);

/* ============================================================ */
console.log("\n———————————————");
console.log("通过 " + pass + " · 失败 " + fail);
process.exit(fail ? 1 : 0);