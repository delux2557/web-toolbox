/**
 * check-excel2sql.mjs —— excel2sql 前端工具的零依赖自检
 *
 * 作用：在不开浏览器的情况下，把 js/ 下的核心逻辑（读取 / 表头 / 类型 / 渲染）
 * 跑一遍真实夹具并逐条断言，确认移植没有走样。
 *
 * 用法：node tools/_build/check-excel2sql.mjs
 * 依赖：无（只用 Node 内建模块 + 工具自身的 .js）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, '..', 'excel2sql');
const JS = join(TOOL, 'js');

/* ---------- 按页面加载顺序把 IIFE 模块串起来执行 ---------- */
function loadTool() {
  const order = ['dialects.js', 'headers.js', 'reader.js', 'sqlgen.js'];
  const src = order
    .map((f) => '/* ==== ' + f + ' ==== */\n' + readFileSync(join(JS, f), 'utf8'))
    .join('\n;\n');
  const factory = new Function(
    src + '\n; return { E2sDialects, E2sHeaders, E2sReaders, E2sSqlGen };'
  );
  return factory();
}

const { E2sDialects: Dialects, E2sReaders: Readers, E2sSqlGen: SqlGen } = loadTool();

/* ---------- 极简断言框架 ---------- */
let pass = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
  console.log('\n' + name);
  console.log('-'.repeat(Math.max(24, name.length)));
}

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(group + ' / ' + name + (detail ? '  → ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '\n        → ' + detail : ''));
  }
}

const has = (hay, needle) => String(hay).indexOf(needle) >= 0;

async function main() {
  /* ============ 1. 能力探测 ============ */
  section('1. 运行环境能力');
  ok('DecompressionStream(deflate-raw) 可用', Readers.canReadXlsx());

  /* ============ 2. 零依赖解析 xlsx（openpyxl 夹具） ============ */
  section('2. 解析 boundary.xlsx（openpyxl 产出，走 inlineStr）');
  const boundaryBytes = new Uint8Array(readFileSync(join(TOOL, 'test-fixtures', 'boundary.xlsx')));
  const boundary = await Readers.readXlsx(boundaryBytes);

  ok('读到 2 个工作表', boundary.length === 2, '实际 ' + boundary.length);
  ok('工作表名正确', boundary[0].name === '订单明细' && boundary[1].name === '汇总',
    boundary.map((s) => s.name).join(' / '));

  const bRows = boundary[0].rows;
  ok('表头第 1 格是「行 ID」', bRows[0][0] && bRows[0][0].v === '行 ID');
  ok('数字识别为 num', bRows[1][0] && bRows[1][0].t === 'num' && bRows[1][0].v === 40098);
  ok('纯日期识别为 date', bRows[1][2] && bRows[1][2].t === 'date' && bRows[1][2].v === '2024-11-11',
    bRows[1][2] && bRows[1][2].t + ':' + bRows[1][2].v);
  ok('含时间识别为 datetime', bRows[1][3] && bRows[1][3].t === 'datetime' &&
    bRows[1][3].v === '2024-11-11T14:30:00', bRows[1][3] && bRows[1][3].t + ':' + bRows[1][3].v);
  ok('布尔识别为 bool', bRows[1][8] && bRows[1][8].t === 'bool' && bRows[1][8].v === true);
  ok("前导零文本保持原样 '007'", bRows[1][9] && bRows[1][9].t === 'str' && bRows[1][9].v === '007');
  ok('多行文本被读出（含 \\r\\n）', bRows[2][7] && bRows[2][7].v.indexOf('\n') >= 0,
    JSON.stringify(bRows[2][7] && bRows[2][7].v));
  ok('空行整行为空', Array.isArray(bRows[3]) && bRows[3].every((c) => c === null));

  /* ============ 3. 解析真实 Excel 风格夹具（sharedStrings + 转义 + 大整数） ============ */
  section('3. 解析 excel-style.xlsx（真实 Excel 风格，走 sharedStrings）');
  const exBytes = new Uint8Array(readFileSync(join(TOOL, 'test-fixtures', 'excel-style.xlsx')));
  const excelStyle = await Readers.readXlsx(exBytes);
  const eRows = excelStyle[0].rows;

  ok('sharedStrings 取值正确', eRows[1][0] && eRows[1][0].v === 'CA-2014-AB1001');
  ok('内置日期格式(numFmtId=14) -> date', eRows[1][2] && eRows[1][2].t === 'date' && eRows[1][2].v === '2024-11-11');
  ok('自定义纯日期(164) -> date', eRows[1][3] && eRows[1][3].t === 'date' && eRows[1][3].v === '2024-11-11');
  ok('含时间(165) -> datetime', eRows[1][4] && eRows[1][4].t === 'datetime' && eRows[1][4].v === '2024-11-11T14:30:00');
  ok('XML 实体还原', eRows[1][5] && eRows[1][5].v === 'A & B <C> "D" \'E\'',
    JSON.stringify(eRows[1][5] && eRows[1][5].v));
  ok('_x000D_ 转义还原为 CR', eRows[2][5] && eRows[2][5].v === '行一\r行二',
    JSON.stringify(eRows[2][5] && eRows[2][5].v));
  ok('18 位大整数保留为文本（不丢精度）',
    eRows[1][6] && eRows[1][6].t === 'bignum' && eRows[1][6].v === '9007199254740993',
    eRows[1][6] && eRows[1][6].t + ':' + eRows[1][6].v);
  ok('稀疏行只保留有值的列（由 prepare 统一补齐到 ncols）',
    eRows[3].length === 2 && eRows[3][1].v === 3, 'length=' + eRows[3].length);

  /* ============ 4. 表头识别 ============ */
  section('4. 表头识别');
  const built = SqlGen.buildSql(bRows, { dialect: Dialects.DIALECTS.sqlserver });
  ok('自动选中第 1 行为表头', built.headerRow === 1, '实际第 ' + built.headerRow);
  ok('表头体检通过', built.check.ok === true, built.check.issues.join('；'));
  ok('数据行数 4（跳过全空行）', built.rowCount === 4, '实际 ' + built.rowCount);
  ok('列数 10', built.colCount === 10, '实际 ' + built.colCount);
  ok('检测理由可读', typeof built.detectWhy === 'string' && built.detectWhy.length > 4, built.detectWhy);

  /* ============ 5. SQL Server 渲染 ============ */
  section('5. SQL Server（union / CTE）');
  const ss = built.sql;
  ok('CTE 包裹', has(ss, 'WITH [HARDCODE] AS (') && has(ss, 'SELECT * FROM [HARDCODE];'));
  ok('字符串带 N 前缀', has(ss, "N'CA-2014-AB1001'"));
  ok('标识符用方括号', has(ss, 'AS [行 ID]'));
  ok('数字不加引号', has(ss, '2 AS [数量]'));
  ok("单引号双写转义", has(ss, "'含''单引号'''"));
  ok('前导零列按文本输出', has(ss, "'007' AS [编号]"));
  ok('布尔 -> 1/0', has(ss, "'1' AS [是否加急]"));
  ok('列级类型统一：头注释点名「订单 ID」按字符串输出',
    /按字符串输出的列（[^）]*）：[^\n]*订单 ID/.test(ss));
  ok('头注释：按字符串输出的列', has(ss, '-- 按字符串输出的列'));
  ok('头注释：不含"CSV 无类型信息"（xlsx 场景文案正确）',
    !has(ss, 'CSV 无类型信息'));

  /* ============ 6. legacyDateMode 开关 ============ */
  section('6. 日期行为开关 legacyDateMode');
  ok('默认（对齐 Python）纯日期带 00:00:00', has(ss, "N'2024-11-11 00:00:00' AS [订购日期]"));
  const precise = SqlGen.buildSql(bRows, {
    dialect: Dialects.DIALECTS.sqlserver, legacyDateMode: false
  }).sql;
  ok('关闭后纯日期不带时间', has(precise, "N'2024-11-11' AS [订购日期]"));
  ok('关闭后 datetime 列不受影响', has(precise, "N'2024-11-11 14:30:00' AS [下单时间]"));

  const ora = SqlGen.buildSql(bRows, { dialect: Dialects.DIALECTS.oracle, wrap: 'plain' }).sql;
  ok('Oracle legacy：纯日期走 datetime 格式串',
    has(ora, "TO_DATE('2024-11-11 00:00:00','YYYY-MM-DD HH24:MI:SS') AS \"订购日期\""));
  const oraPrecise = SqlGen.buildSql(bRows, {
    dialect: Dialects.DIALECTS.oracle, wrap: 'plain', legacyDateMode: false
  }).sql;
  ok('Oracle 精确：纯日期走 date 格式串',
    has(oraPrecise, "TO_DATE('2024-11-11','YYYY-MM-DD') AS \"订购日期\""));

  /* ============ 7. 多行文本拼接（各方言换行表达式） ============ */
  section('7. 多行文本按方言拼接');
  ok('SQL Server 用 + CHAR(10)', has(ss, "N'多行' + CHAR(10) + N'文本'"));
  const myUnion = SqlGen.buildSql(bRows, { dialect: Dialects.DIALECTS.mysql }).sql;
  ok('MySQL 用 CONCAT + CHAR(10 USING utf8mb4)',
    has(myUnion, 'CONCAT(') && has(myUnion, 'CHAR(10 USING utf8mb4)'));
  ok('MySQL 标识符用反引号', has(myUnion, 'AS `行 ID`'));
  const pgUnion = SqlGen.buildSql(bRows, { dialect: Dialects.DIALECTS.postgresql }).sql;
  ok('PostgreSQL 用 || 拼接', has(pgUnion, ' || '));
  ok('PostgreSQL 无 N 前缀', has(pgUnion, "'CA-2014-AB1001' AS \"订单 ID\""));
  ok('Oracle 用 CHR(10)', has(ora, 'CHR(10)'));
  ok('Oracle 带 FROM dual', has(ora, ' FROM dual'));

  /* ---- SQLite（对齐 Python 0.4.0）----
     双引号标识符、|| 拼接、CHAR(10)、无 N 前缀、无反斜杠转义、无 dual、日期不包装。 */
  const lite = SqlGen.buildSql(bRows, { dialect: Dialects.DIALECTS.sqlite, wrap: 'plain' }).sql;
  ok('SQLite 标识符用双引号', has(lite, 'AS "订单 ID"'));
  ok('SQLite 无 N 前缀', has(lite, "'CA-2014-AB1001' AS \"订单 ID\""));
  ok('SQLite 用 || 拼接', has(lite, " || "));
  ok('SQLite 换行用 CHAR(10)', has(lite, 'CHAR(10)'));
  ok('SQLite 无 dual', !has(lite, 'dual'));
  /* ★ 日期不包装：SQLite 没有日期类型，ISO-8601 文本就是它的规范表示，
     date() / strftime() 能直接识别。规律是「只有真正需要包装的方言才加前缀」——
     目前仍只有 Oracle 需要 TO_DATE。 */
  ok('★ SQLite 日期不加 TO_DATE 包装', !has(lite, 'TO_DATE'));
  ok('★ SQLite 日期就是 ISO-8601 文本', /'2024-11-11[^']*' AS "订购日期"/.test(lite));
  /* 反斜杠不转义：与 MySQL 区分（MySQL 要把 \ 写成 \\） */
  ok('SQLite 反斜杠不转义（与 MySQL 区分）',
    !Dialects.DIALECTS.sqlite.backslashEscape && Dialects.DIALECTS.mysql.backslashEscape === true);

  /* ============ 8. UNION ALL 必须独立成行（防 Oracle 语法错） ============ */
  section('8. UNION ALL 换行（历史 P0）');
  ok('不存在 dualUNION 粘连', !has(ora, 'dualUNION'));
  ok('UNION ALL 独立成行', has(ora, '\nUNION ALL\n'));

  /* ---- CTE 体内缩进（对齐 Python 0.4.0 / sqlfluff 默认风格）----
     plain **不缩进** —— 那是给「嵌进已有 SQL」用的，缩进交给调用方按所在层级对齐。
     这是行为变化：产物文本与 0.3.x 不再逐字节相同，语义完全一致。 */
  const ssCte = SqlGen.buildSql(bRows, { dialect: Dialects.DIALECTS.sqlserver, wrap: 'cte' }).sql;
  const ssPlain = SqlGen.buildSql(bRows, { dialect: Dialects.DIALECTS.sqlserver, wrap: 'plain' }).sql;
  ok('★ CTE 体内第一行 SELECT 缩进一级', has(ssCte, 'AS (\n    SELECT '));
  ok('★ CTE 体内 UNION ALL 缩进一级（独立成行且带缩进）', has(ssCte, '\n    UNION ALL\n    SELECT '));
  ok('★ CTE 闭合括号回到行首', has(ssCte, '\n)\nSELECT * FROM [HARDCODE];'));
  ok('★ plain **不**缩进（给嵌入已有 SQL 用）', has(ssPlain, '\nSELECT ') && !has(ssPlain, '\n    SELECT '));

  /* ============ 9. UNION 裸块（--wrap plain） ============ */
  section('9. 包裹方式');
  ok('plain 不含 WITH', !has(ora, 'WITH '));
  const cte = SqlGen.buildSql(bRows, { dialect: Dialects.DIALECTS.sqlserver, wrap: 'cte' }).sql;
  ok('cte 含 WITH ... AS (', has(cte, 'WITH [HARDCODE] AS ('));

  /* ============ 10. INSERT 分批 ============ */
  section('10. INSERT 形式与分批');
  const ins = SqlGen.buildSql(bRows, {
    dialect: Dialects.DIALECTS.mysql, fmt: 'insert', batchSize: 2
  }).sql;
  ok('INSERT 头正确', has(ins, 'INSERT INTO `HARDCODE` (`行 ID`, `订单 ID`'));
  ok('VALUES 行不带 AS 别名', !has(ins, ') AS '));
  const insCount = (ins.match(/INSERT INTO/g) || []).length;
  ok('4 行数据 / batchSize 2 => 2 条 INSERT', insCount === 2, '实际 ' + insCount);
  ok('每条语句以分号结尾', has(ins, ';\n'));

  /* ============ 11. 空值策略 ============ */
  section('11. 空值策略 --empty-as-null');
  const sparse = SqlGen.buildSql(eRows, { dialect: Dialects.DIALECTS.sqlserver }).sql;
  ok('稀疏行的空单元格 -> NULL', has(sparse, 'NULL AS [大整数]'));
  ok('超长数字列被点名（原因明确）',
    /按字符串输出的列（超长数字按文本输出[^）]*）：[^\n]*大整数/.test(sparse));
  /* xlsx 存不了空字符串（openpyxl 会把 '' 落成 None），只能用 CSV 测：
     逗号之间的空字段就是真正的空字符串 */
  const blankCsv = Readers.readCsvBytes(new TextEncoder().encode('名称,备注\n甲,\n'), 'x').sheets;
  const keepEmpty = SqlGen.buildSql(blankCsv[0].rows, {
    dialect: Dialects.DIALECTS.sqlserver, source: 'csv'
  }).sql;
  ok('默认：空字段保留为空字符串', has(keepEmpty, "N'' AS [备注]"));
  const asNull = SqlGen.buildSql(blankCsv[0].rows, {
    dialect: Dialects.DIALECTS.sqlserver, source: 'csv', emptyAsNull: true
  }).sql;
  ok('empty-as-null：空字段变 NULL', has(asNull, 'NULL AS [备注]'));

  /* ============ 12. CSV 读取（编码 / 分隔符探测） ============ */
  section('12. CSV 读取');
  const csvUtf8 = new TextEncoder().encode('编号,名称,数量\n001,甲,2\n002,乙,3\n');
  const r1 = Readers.readCsvBytes(csvUtf8, 'x');
  ok('逗号分隔探测正确', r1.delimiter === ',');
  ok('UTF-8 编码识别', r1.encoding === 'UTF-8', r1.encoding);
  ok('CSV 单元格一律为 str', r1.sheets[0].rows[1][0].t === 'str' && r1.sheets[0].rows[1][0].v === '001');

  const csvSemi = new TextEncoder().encode('a;b;c\n1;2;3\n');
  ok('分号分隔探测正确', Readers.readCsvBytes(csvSemi, 'x').delimiter === ';');
  const csvTab = new TextEncoder().encode('a\tb\tc\n1\t2\t3\n');
  ok('制表符分隔探测正确', Readers.readCsvBytes(csvTab, 'x').delimiter === '\t');
  const csvBom = new Uint8Array([0xEF, 0xBB, 0xBF, 0x61, 0x2C, 0x62, 0x0A, 0x31, 0x2C, 0x32, 0x0A]);
  const rBom = Readers.readCsvBytes(csvBom, 'x');
  ok('BOM 被剥离且识别为 UTF-8 (BOM)', rBom.encoding.indexOf('BOM') >= 0 && rBom.sheets[0].rows[0][0].v === 'a');

  /* GB18030：用 0xB1 0xED 表示"表"（GBK 编码） */
  const gbk = new Uint8Array([0xB1, 0xED, 0x2C, 0x31, 0x0A]);
  const rGbk = Readers.readCsvBytes(gbk, 'x');
  ok('非 UTF-8 字节退回 GB18030 且不乱码',
    rGbk.encoding === 'GB18030' && rGbk.sheets[0].rows[0][0].v === '表',
    rGbk.encoding + ':' + rGbk.sheets[0].rows[0][0].v);

  /* ============ 13. CSV 数字推断开关 ============ */
  section('13. CSV 类型推断 --infer-types');
  const csvNum = new TextEncoder().encode('数量,金额\n2,221.98\n3,10.5\n');
  const csvSheets = Readers.readCsvBytes(csvNum, 'x').sheets;
  const csvOff = SqlGen.buildSql(csvSheets[0].rows, { dialect: Dialects.DIALECTS.sqlserver, source: 'csv' }).sql;
  ok('默认：纯数字 CSV 也整列字符串化', has(csvOff, "N'2' AS [数量]"));
  ok('默认：头注释说明原因是 CSV', has(csvOff, 'CSV 无类型信息'));
  const csvOn = SqlGen.buildSql(csvSheets[0].rows, {
    dialect: Dialects.DIALECTS.sqlserver, source: 'csv', inferTypes: true
  }).sql;
  ok('开启后：数字列不加引号', has(csvOn, '2 AS [数量]') && has(csvOn, '221.98 AS [金额]'));
  const csvLeadZero = new TextEncoder().encode('编号,数量\n007,2\n008,3\n');
  const lz = Readers.readCsvBytes(csvLeadZero, 'x').sheets;
  const lzSql = SqlGen.buildSql(lz[0].rows, {
    dialect: Dialects.DIALECTS.sqlserver, source: 'csv', inferTypes: true
  }).sql;
  ok('前导零列不参与数字推断', has(lzSql, "N'007' AS [编号]"));

  /* ---- ★★ 推断的两条安全边界（对齐 Python 0.4.0 的 MAX_SIG_DIGITS = 15）----
     这条比 Number.isSafeInteger（2^53 ≈ 16 位）**更严**：一个 16 位但小于 2^53 的
     编号，isSafeInteger 会放行、JS 也能精确表示，但它是"编号"的概率远大于"数量"。
     越过 15 位几乎一定是编号/账号，且 19 位以上会超出三库的 bigint 范围 ——
     硬转成数字字面量会让灌库直接报错。 */
  const sigSql = (csv) => {
    const sh = Readers.readCsvBytes(new TextEncoder().encode(csv), 'x').sheets;
    return SqlGen.buildSql(sh[0].rows, {
      dialect: Dialects.DIALECTS.sqlserver, source: 'csv', inferTypes: true
    }).sql;
  };
  /* 15 位：仍按数字（在安全线内） */
  ok('边界内：15 位数字列按数字输出', has(sigSql('编号\n123456789012345\n'), '123456789012345 AS'));
  /* 16 位但 < 2^53：isSafeInteger 会放行 —— 必须靠 15 位规则拦下 */
  ok('★★ 16 位编号（< 2^53）保持文本', has(sigSql('编号\n1234567890123456\n'), "'1234567890123456' AS"));
  ok('★★ 19 位编号（超 bigint）保持文本',
    has(sigSql('编号\n1234567890123456789\n'), "'1234567890123456789' AS"));
  /* 超过 15 位有效数字的小数同样不转（JS 双精度会丢尾数） */
  ok('★ 有效数字超 15 位的小数保持文本',
    has(sigSql('金额\n0.1234567890123456789\n'), "'0.1234567890123456789' AS"));
  ok('★ 15 位以内的小数仍按数字输出', has(sigSql('金额\n0.125\n'), '0.125 AS'));
  /* 尾随零算有效数字（对齐 Decimal('1.50') → 3 位） */
  ok('前导零不算有效数字（0.0015 是 2 位）', has(sigSql('比例\n0.0015\n'), '0.0015 AS'));

  /* ---- ★ --all-string 时不再做数字转换（对齐 Python 0.4.0）----
     ★ 这里必须挑**能区分**的观测量。第一版我用 '数量,备注\n2,\n3,x\n' 断言
     `N'2'` 仍是字符串 —— 那是假守卫：数字列就算被转成 num、再被 allString
     强制字符串化，渲染出来还是 `N'2'`，两条路径产物逐字节相同，把守卫拿掉也照样绿。
     真正能区分的只有**数字列里的空白格**：
       · 有守卫：不转换 → 空白格保持空串 → `N''`
       · 无守卫：先转换 → 空白格被改成 NULL → `NULL`
     （反向实验实测：拿掉守卫后原断言全绿，换成下面这组才咬住。） */
  const allStrCsv = '数量,备注\n2,a\n,b\n3,c\n';
  const asSh = Readers.readCsvBytes(new TextEncoder().encode(allStrCsv), 'x').sheets;
  const asSql = SqlGen.buildSql(asSh[0].rows, {
    dialect: Dialects.DIALECTS.sqlserver, source: 'csv', inferTypes: true, allString: true
  }).sql;
  ok('★ all-string + 推断：不转数字（列仍是字符串）', has(asSql, "N'2' AS [数量]"));
  ok('★★ all-string + 推断：数字列里的空白仍是空串，没被改成 NULL',
    has(asSql, "N'' AS [数量]") && !has(asSql, 'NULL AS [数量]'), asSql.split('\n').find((l) => l.indexOf('SELECT') >= 0));
  /* 对照：没有 allString 时，同一份数据**应该**转换、空白**应该**变 NULL ——
     否则上面那条"没变 NULL"可能只是因为整个转换从来没生效（另一种假守卫）。 */
  const noAllStr = SqlGen.buildSql(asSh[0].rows, {
    dialect: Dialects.DIALECTS.sqlserver, source: 'csv', inferTypes: true
  }).sql;
  ok('★★ 对照：不带 all-string 时同一列确实被转换、空白变成 NULL',
    has(noAllStr, '2 AS [数量]') && has(noAllStr, 'NULL AS [数量]'), noAllStr.split('\n').find((l) => l.indexOf('SELECT') >= 0));

  /* ============ 14. 表头体检与修复 ============ */
  section('14. 表头体检与修复');
  const messy = [
    [{ t: 'str', v: '名称' }, { t: 'str', v: '' }, { t: 'str', v: '名称' }],
    [{ t: 'str', v: '甲' }, { t: 'str', v: 'x' }, { t: 'str', v: 'y' }],
    [{ t: 'str', v: '乙' }, { t: 'str', v: 'p' }, { t: 'str', v: 'q' }]
  ];
  const messySql = SqlGen.buildSql(messy, { dialect: Dialects.DIALECTS.sqlserver });
  ok('空列名补 col_2', messySql.header[1] === 'col_2', messySql.header.join(','));
  ok('重名自动加后缀', messySql.header[2] === '名称_2', messySql.header.join(','));
  ok('体检报告列出问题', messySql.check.ok === false && messySql.warnings.length > 0);

  /* 表头是数字的情况：不应误判成表头 */
  const numericHeader = [
    [{ t: 'num', v: 1 }, { t: 'num', v: 2 }],
    [{ t: 'num', v: 3 }, { t: 'num', v: 4 }]
  ];
  const nh = SqlGen.buildSql(numericHeader, { dialect: Dialects.DIALECTS.sqlserver });
  ok('全数字表头被体检拦下', nh.check.issues.some((s) => s.indexOf('表头行全是数字') >= 0),
    nh.check.issues.join('；'));

  /* ============ 15. 大表护栏 ============ */
  section('15. 性能护栏');
  ok('UNION_ROW_WARN = 2000', SqlGen.UNION_ROW_WARN === 2000);
  ok('MAX_ROWS = 200000', SqlGen.MAX_ROWS === 200000);
  const plan = SqlGen.estimatePlan(30000, 'union');
  ok('3 万行给出两条提示', plan.notes.length === 2, JSON.stringify(plan.notes));

  /* ============ 16. 方言解析别名 ============ */
  section('16. 方言解析');
  ok('-d 1 -> SQL Server', Dialects.resolve('1').key === 'sqlserver');
  ok('-d pg -> PostgreSQL', Dialects.resolve('pg').key === 'postgresql');
  ok('-d sqlite3 -> SQLite', Dialects.resolve('sqlite3').key === 'sqlite');
  ok('-d 5 -> SQLite', Dialects.resolve('5').key === 'sqlite');
  /* ★ 未知值**抛错**，不静默回落成 SQL Server（对齐 Python 0.4.1）。
     静默回退是最坏的一类失败：产物语法完全正确、只是方言错了 ——
     往往要到灌库才暴露，更糟的是被隐式转换掩盖过去，看起来像"跑通了"。
     所以这条断言不是"等于 sqlserver"，而是"必须抛"。 */
  let threw = null;
  try { Dialects.resolve('zzz'); } catch (e) { threw = e; }
  ok('★ 未知方言抛 UnknownDialect（不再静默回退）', !!threw && threw.name === 'UnknownDialect',
    threw ? threw.message : '没有抛，静默得到了 ' + Dialects.resolve('zzz').name);
  ok('★ 报错文案里列出全部可选值（从 ORDER 派生）',
    !!threw && Dialects.ORDER.every(function (k, i) {
      return has(threw.message, k + '(' + (i + 1) + ')');
    }), threw ? threw.message : '');
  /* 空串也要抛 —— 对齐 Python「-d '' 现在报错」：
     shell 里 -d "$VAR" 而变量为空，恰恰是最容易静默用错方言的场景 */
  let threwEmpty = null;
  try { Dialects.resolve(''); } catch (e) { threwEmpty = e; }
  ok('★ 空方言值也抛（不能当成"没给"）', !!threwEmpty, threwEmpty ? '已抛' : '没抛');
  ok('isValid 对合法/非法值分别返回 true/false',
    Dialects.isValid('mysql') === true && Dialects.isValid('zzz') === false &&
    Dialects.isValid('5') === true && Dialects.isValid('') === false);
  /* 方言清单单一来源：ORDER 与 DIALECTS / 下拉选项三者必须一致 */
  ok('★ ORDER 与 DIALECTS 完全一致（清单单一来源）',
    Dialects.ORDER.length === Object.keys(Dialects.DIALECTS).length &&
    Dialects.ORDER.every(function (k) { return !!Dialects.DIALECTS[k]; }),
    Dialects.ORDER.join(','));
  ok('★ 下拉选项从 ORDER 派生且顺序一致',
    Dialects.options().map(function (o) { return o.key; }).join(',') === Dialects.ORDER.join(','));
  /* 编号必须正好是 ORDER 的 1..N —— 别名表里漏一个编号，'-d 5' 就会静默失效 */
  ok('★ 每个方言都有编号别名，且编号连续',
    Dialects.ORDER.every(function (k, i) { return Dialects.ALIASES[String(i + 1)] === k; }));

  /* ============ 17. 转义安全（防注入破坏语句结构） ============ */
  section('17. 标识符与字符串转义');
  const evil = [[{ t: 'str', v: "a] FROM x; DROP TABLE y; --" }],
                [{ t: 'str', v: "b' OR '1'='1" }]];
  const evilSql = SqlGen.buildSql(evil, { dialect: Dialects.DIALECTS.sqlserver });
  ok('列名里的 ] 被双写', has(evilSql.sql, '[a]] FROM x; DROP TABLE y; --]'), evilSql.sql.split('\n')[4]);
  ok("字符串里的单引号被双写", has(evilSql.sql, "'b'' OR ''1''=''1'"));

  /* ============ 18. utils.js 纯函数 ============ */
  section('18. utils 工具函数');
  const utilSrc = readFileSync(join(JS, 'utils.js'), 'utf8');
  const Utils = new Function(utilSrc + '\n; return E2sUtils;')();

  ok('fmtInt 加千分位', Utils.fmtInt(51290) === '51,290', Utils.fmtInt(51290));
  ok('fmtInt 处理 0/负数', Utils.fmtInt(0) === '0' && Utils.fmtInt(-1234) === '-1,234');
  ok('fmtBytes 分档', Utils.fmtBytes(512) === '512 B' && Utils.fmtBytes(2048) === '2.0 KB'
    && Utils.fmtBytes(8912345) === '8.5 MB', [Utils.fmtBytes(512), Utils.fmtBytes(2048), Utils.fmtBytes(8912345)].join('|'));
  ok('fmtMs 分档', Utils.fmtMs(230) === '230 ms' && Utils.fmtMs(2300) === '2.30 s',
    Utils.fmtMs(230) + '|' + Utils.fmtMs(2300));
  /* 界面不走 HTML 字符串（一律 textContent / createElement），所以这里
     刻意**没有** escapeHtml —— 留一个没人用的转义函数只会诱人再去拼 HTML */
  ok('utils 不暴露 escapeHtml（防止有人回头去拼 HTML 字符串）',
    Utils.escapeHtml === undefined);

  /* 与 Python 版 default_output 的 safe_sheet 同规则：非 \w / 非中文 -> 下划线 */
  ok('safeFileStem 保留中文', Utils.safeFileStem('销售 明细') === '销售_明细', Utils.safeFileStem('销售 明细'));
  ok('safeFileStem 去掉路径分隔符', Utils.safeFileStem('a/b\\c').indexOf('/') < 0
    && Utils.safeFileStem('a/b\\c').indexOf('\\') < 0, Utils.safeFileStem('a/b\\c'));
  ok('safeFileStem 全符号时回落 sheet', Utils.safeFileStem('///') === 'sheet', Utils.safeFileStem('///'));
  ok('stemOf 去扩展名', Utils.stemOf('超市数据集.xlsx') === '超市数据集', Utils.stemOf('超市数据集.xlsx'));
  ok('stemOf 无扩展名时原样', Utils.stemOf('report') === 'report');

  ok('previewCell: 日期时间换成空格', Utils.previewCell({ t: 'datetime', v: '2026-03-01T09:30:00' }) === '2026-03-01 09:30:00');
  ok('previewCell: 布尔显式化', Utils.previewCell({ t: 'bool', v: true }) === 'TRUE');
  ok('previewCell: 超长数字原文返回', Utils.previewCell({ t: 'bignum', v: '9007199254740993' }) === '9007199254740993');
  ok('previewCell: 空单元格为空串', Utils.previewCell(null) === '');
  ok('cellKind 认得 bignum', has(Utils.cellKind({ t: 'bignum', v: '1' }), '超长'));
  ok('cellKind 对 null 返回「空」', Utils.cellKind(null) === '空');

  /* 下载文件名必须与命令行版 config.DEFAULT_FILENAME 同构：
     {name}_{sheet}_hardcode.sql（name 取源文件主干，sheet 走安全化） */
  ok('默认产物名与命令行版同构',
    Utils.stemOf('示例.xlsx') + '_' + Utils.safeFileStem('销售 明细') + '_hardcode.sql'
      === '示例_销售_明细_hardcode.sql',
    Utils.stemOf('示例.xlsx') + '_' + Utils.safeFileStem('销售 明细') + '_hardcode.sql');

  /* ============ 19. app.js 与 index.html 的静态一致性 ============ */
  /* 这两块是纯静态检查，不需要 DOM —— 抓的是 "改 HTML 时忘了同步 app.js"
     这类静默失效：$('xxx') 拿到 null，报错却发生在很远的地方。 */
  section('19. app.js / index.html 静态一致性');
  const html = readFileSync(join(TOOL, 'index.html'), 'utf8');
  const appSrc = readFileSync(join(JS, 'app.js'), 'utf8');

  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const appIds = [...appSrc.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  const missing = [...new Set(appIds)].filter((id) => !htmlIds.has(id));
  ok('app.js 引用的 id 都能在 index.html 找到（' + new Set(appIds).size + ' 个）',
    missing.length === 0, '缺失：' + missing.join(', '));

  /* 脚本加载顺序：依赖方必须排在提供方之后 */
  const scriptOrder = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  const expectOrder = ['theme.js', 'utils.js', 'dialects.js', 'headers.js', 'reader.js', 'sqlgen.js', 'app.js'];
  ok('脚本加载顺序与依赖一致', scriptOrder.join(',') === expectOrder.join(','), scriptOrder.join(','));

  /* app.js 里用到的命名空间必须都真的被提供 */
  ['E2sUtils', 'E2sDialects', 'E2sHeaders', 'E2sReaders', 'E2sSqlGen'].forEach((ns) => {
    const provided = scriptOrder.some((f) => has(readFileSync(join(JS, f), 'utf8'), 'const ' + ns + ' ='));
    ok('命名空间 ' + ns + ' 有定义且在 app.js 之前加载', provided && has(appSrc, ns));
  });

  /* 界面一律走 textContent / createElement，不拼 HTML 字符串 ——
     拼 HTML 最容易在转义上漏一个字符，而且桩里测不准。
     这条反向断言守住它，免得以后有人图省事又写回 innerHTML。 */
  const appCode = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('★ app.js 不使用 innerHTML（一律 textContent / createElement）',
    !/\binnerHTML\s*=/.test(appCode));

  /* settings 里其实有两类键，断言要**双向**做，只判一个方向会两头漏：
     ① SQL 参数 —— 必须真的传进 sqlOptions()。否则界面上能改、实际没生效，
        而且不会有任何报错（这类"改了没用"最难发现）。
     ② 纯界面状态（页签 / 自动换行 / 设置版本号）—— 只影响观感或持久化迁移，
        **不该**出现在 sqlOptions() 里。混进去的话，读代码的人会以为它们参与 SQL 生成，
        以后改渲染逻辑时还会被当成有效参数带下去。 */
  const UI_ONLY_KEYS = ['tab', 'wordWrap', 'settingsVersion'];
  const settingsBlock = appSrc.match(/const settings = \{([\s\S]*?)\n  \};/);
  const settingsKeys = [...(settingsBlock ? settingsBlock[1] : '').matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  const sqlOptsBody = (appSrc.match(/function sqlOptions\(\) \{([\s\S]*?)\n  \}/) || ['', ''])[1];
  ok('纯界面状态键确实登记在 settings 里（' + UI_ONLY_KEYS.join(' / ') + '）',
    UI_ONLY_KEYS.every((k) => settingsKeys.includes(k)),
    '不在 settings 中：' + UI_ONLY_KEYS.filter((k) => !settingsKeys.includes(k)).join(','));
  const sqlKeys = settingsKeys.filter((k) => !UI_ONLY_KEYS.includes(k));
  const notWired = sqlKeys.filter((k) => !new RegExp('\\b' + k + ':').test(sqlOptsBody));
  ok('settings 的 ' + sqlKeys.length + ' 个 SQL 参数都接进了 sqlOptions()',
    sqlKeys.length >= 8 && notWired.length === 0, '漏接：' + notWired.join(', '));
  const misWired = UI_ONLY_KEYS.filter((k) => new RegExp('\\b' + k + ':').test(sqlOptsBody));
  ok('★ 纯界面状态没有混进 sqlOptions()（它们不影响 SQL，混进去会误导后来人）',
    misWired.length === 0, '误接：' + misWired.join(', '));

  /* 用户可调的键必须都在 settings 里（防止某个开关写死成常量、绕过了持久化） */
  const switchIds = [...html.matchAll(/<input type="checkbox" id="(opt\w+)"/g)].map((m) => m[1]);
  const switchToKey = {
    optEmptyNull: 'emptyAsNull',
    optInferTypes: 'inferTypes',
    optLegacyDate: 'legacyDateMode',
    optWordWrap: 'wordWrap'
  };
  /* 比对的是「开关集合」与「映射表」是否一一对应，而不是写死一个数字：
     新加开关却忘了登记映射，会算成"未登记"报出来，而不是静默通过。 */
  const unmapped = switchIds.filter((id) => !switchToKey[id]);
  const staleMap = Object.keys(switchToKey).filter((id) => !switchIds.includes(id));
  ok('每个复选框开关都在 settings 里有对应键（' + switchIds.length + ' 个）',
    unmapped.length === 0 && staleMap.length === 0 &&
    switchIds.every((id) => settingsKeys.includes(switchToKey[id])),
    '未登记：' + unmapped.join(',') + '；映射表多余：' + staleMap.join(','));

  /* ============ 汇总 ============ */
  console.log('\n' + '='.repeat(60));
  console.log('断言通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过。');
}

main().catch((e) => {
  console.error('\n自检异常终止：', e);
  process.exit(1);
});
