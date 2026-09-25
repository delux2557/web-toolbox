/* 验证反向实验的「断点还原」真的能自愈。
   做法：手工构造一次"被强杀留下的现场"（journal + 已被改坏的 app.js），
   再跑一次反向实验，断言它**先还原再干活**、且不把坏内容当成新基线。

   为什么手工构造而不是真去 kill：真 kill 的时点不可控，可能正好落在两次变异之间，
   就成了"有时过有时不过"的脆弱测试。手工构造是确定性的。 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const TARGET = 'tools/excel2sql/js/app.js';
const ABS = join(ROOT, TARGET);
const JOURNAL = join(HERE, '.mutation-journal.json');

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const good = readFileSync(ABS, 'utf8');
const goodHash = sha(good);

/* 1. 造现场：journal 存原文，文件改成"坏"的 */
const broken = good.replace(
  '    else if (genStateOwned) clearGenState();',
  '    else if (false) clearGenState();'
);
if (broken === good) { console.log('❌ 构造失败：找不到用于打坏的目标串'); process.exit(1); }
writeFileSync(JOURNAL, JSON.stringify({ file: TARGET, original: good }));
writeFileSync(ABS, broken);
console.log(`现场已构造：app.js ${goodHash} → ${sha(broken)}，journal 已落盘`);

/* 2. 跑一次（只跑 pure-logic 用例，它不碰 app.js，能把注意力留在"启动时有没有先还原"） */
let out = '';
try {
  out = execFileSync(process.execPath, [join(HERE, 'mutation-excel2sql.mjs'), '--only=logic'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  out = String(e.stdout || '') + String(e.stderr || '');
}

/* 3. 断言 */
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond, extra: extra || '' }); };

check('★ 启动时检测到 journal 并明确提示', /上次运行被中断/.test(out), out.split('\n').filter((l) => /中断|journal/.test(l)).join(' / '));
check('★★ 被改坏的源文件已自动还原', readFileSync(ABS, 'utf8') === good, '当前 ' + sha(readFileSync(ABS, 'utf8')) + '，期望 ' + goodHash);
check('还原后 journal 被撤掉（不留悬空状态）', !existsSync(JOURNAL));
check('★ 基线判定用的是还原后的真源码（没有把坏内容当基线）', /基线 纯逻辑\s*✅/.test(out) && !/基线就不绿/.test(out));
check('用例照常跑完', /用例合计/.test(out), (out.match(/用例合计.*/) || [''])[0]);

console.log('');
let bad = 0;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  → ' + r.extra}`);
  if (!r.ok) bad++;
}
console.log(`\n通过 ${results.length - bad} · 失败 ${bad}`);

/* 兜底清理，免得测试自己留下垃圾 */
rmSync(JOURNAL, { force: true });
writeFileSync(ABS, good);
process.exit(bad ? 1 : 0);
