'use strict';
/* =====================================================================
 * reader.js - 文件读取（命名空间 E2sReaders）
 *   .xlsx / .xlsm -> 零依赖原生解析（ZIP + SpreadsheetML）
 *   .csv / 文本   -> 编码探测 + 分隔符探测
 *   .xls          -> 明确不支持，给出可操作提示
 *
 * 与 Python 版 src/excel2sql/reader.py 对应，差异见文件末尾「迁移说明」。
 *
 * 数据模型：Cell = null | { t, v }
 *   t ∈ 'str' | 'num' | 'bignum' | 'bool' | 'date' | 'datetime' | 'err'
 *   'date'     v = 'YYYY-MM-DD'
 *   'datetime' v = 'YYYY-MM-DDTHH:MM:SS'
 *   'bignum'   v = 原始数字文本（超 15 位，避免 JS 丢精度）
 *
 * 全部只用浏览器原生 API，无任何第三方依赖：
 *   DecompressionStream('deflate-raw') ← ZIP 解压（Chrome/Edge 103+、FF 113+、Safari 16.4+）
 *   Uint8Array / DataView / TextDecoder / Blob / Response
 * ================================================================== */
const E2sReaders = (function () {

  const TEXT_DECODER = new TextDecoder('utf-8');
  const CSV_DELIMITERS = [',', ';', '\t', '|'];

  /* 浏览器是否具备解 xlsx 所需的原生能力 */
  function canReadXlsx() {
    try {
      if (typeof DecompressionStream !== 'function') return false;
      /* eslint-disable no-new */
      new DecompressionStream('deflate-raw');
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------
   * 一、ZIP（OPC 容器）
   * ------------------------------------------------------------------ */

  function findEOCD(bytes, dv) {
    const min = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new Error('不是合法的 .xlsx：未找到 ZIP 结尾记录（文件可能已损坏或被加密）');
  }

  function readCentralDirectory(bytes, dv) {
    const eocd = findEOCD(bytes, dv);
    const total = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('ZIP 中央目录签名异常');
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      out.push({
        name: TEXT_DECODER.decode(bytes.subarray(off + 46, off + 46 + nameLen)),
        method: dv.getUint16(off + 10, true),
        csize: dv.getUint32(off + 20, true),
        lho: dv.getUint32(off + 42, true)
      });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  async function readEntry(bytes, dv, e) {
    const nameLen = dv.getUint16(e.lho + 26, true);
    const extraLen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + nameLen + extraLen;
    const raw = bytes.subarray(start, start + e.csize);
    if (e.method === 0) return TEXT_DECODER.decode(raw);              // stored
    if (e.method !== 8) throw new Error('不支持的 ZIP 压缩方式：' + e.method);
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return TEXT_DECODER.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
  }

  /* ------------------------------------------------------------------
   * 二、XML 小工具
   * ------------------------------------------------------------------ */

  function decodeXml(s) {
    return s
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(Number(d)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /* OOXML 的 _xHHHH_ 转义（Excel 用它存控制字符，如换行 _x000D_） */
  function clean(s) {
    return decodeXml(s).replace(/_x([0-9A-Fa-f]{4})_/g, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    });
  }

  function textOf(frag) {
    const out = [];
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(frag)) !== null) out.push(clean(m[1]));
    return out.join('');
  }

  function colIndex(ref) {
    let n = 0;
    const letters = (ref.match(/^[A-Z]+/) || [''])[0];
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  /* ------------------------------------------------------------------
   * 三、日期格式判定（Excel 把日期存成数字 + numFmt）
   * ------------------------------------------------------------------ */

  const BUILTIN_DATE = { 14: 1, 15: 1, 16: 1, 17: 1 };
  const BUILTIN_DATETIME = { 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 45: 1, 46: 1, 47: 1 };

  /* 返回 null | 'date' | 'datetime' */
  function fmtKind(numFmtId, code) {
    if (code) {
      const bare = code
        .replace(/\[[^\]]*\]/g, '')
        .replace(/"[^"]*"/g, '')
        .replace(/\\./g, '');
      const hasDate = /[ymd]/i.test(bare);
      const hasTime = /[hs]/i.test(bare);
      if (!hasDate && !hasTime) return null;
      return hasTime ? 'datetime' : 'date';
    }
    if (BUILTIN_DATETIME[numFmtId]) return 'datetime';
    if (BUILTIN_DATE[numFmtId]) return 'date';
    return null;
  }

  function serialToParts(serial, date1904) {
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const d = new Date(base + Math.round(serial * 86400000));
    return {
      date: d.toISOString().slice(0, 10),
      time: d.toISOString().slice(11, 19)
    };
  }

  /* ------------------------------------------------------------------
   * 四、xlsx 主流程
   * ------------------------------------------------------------------ */

  async function readXlsx(input, options) {
    const opt = Object.assign({ keepBigNumberAsText: true }, options || {});
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = readCentralDirectory(bytes, dv);
    const read = function (n) {
      let found = null;
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].name === n) { found = entries[i]; break; }
      }
      return found ? readEntry(bytes, dv, found) : Promise.resolve(null);
    };

    const wbXml = await read('xl/workbook.xml');
    if (!wbXml) throw new Error('缺少 xl/workbook.xml —— 可能不是 .xlsx 文件');
    const relsXml = await read('xl/_rels/workbook.xml.rels');
    const sstXml = await read('xl/sharedStrings.xml');
    const stylesXml = await read('xl/styles.xml');
    const date1904 = /date1904="(1|true)"/.test(wbXml);

    /* sheet 名 + rId（按工作簿里的顺序） */
    const sheetRefs = [];
    const sheetRe = /<sheet\s[^>]*\/>/g;
    let sm;
    while ((sm = sheetRe.exec(wbXml)) !== null) {
      sheetRefs.push({
        name: clean((sm[0].match(/name="([^"]*)"/) || [, ''])[1]),
        rid: (sm[0].match(/r:id="([^"]*)"/) || [, ''])[1]
      });
    }

    /* rId -> 目标路径 */
    const rels = {};
    const relRe = /<Relationship\s[^>]*\/>/g;
    let rm;
    while ((rm = relRe.exec(relsXml || '')) !== null) {
      const id = (rm[0].match(/Id="([^"]*)"/) || [, ''])[1];
      const target = (rm[0].match(/Target="([^"]*)"/) || [, ''])[1];
      rels[id] = target.replace(/^\/?xl\//, '');
    }

    /* 共享字符串表（真实 Excel 导出走这条） */
    const shared = [];
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let sim;
    while ((sim = siRe.exec(sstXml || '')) !== null) shared.push(textOf(sim[1]));

    /* 样式：cellXfs 的 numFmtId 序列 + 自定义 numFmt */
    const customFmt = {};
    const fmtRe = /<numFmt[^>]*\/>/g;
    let fm;
    while ((fm = fmtRe.exec(stylesXml || '')) !== null) {
      customFmt[Number((fm[0].match(/numFmtId="(\d+)"/) || [, 0])[1])] =
        clean((fm[0].match(/formatCode="([^"]*)"/) || [, ''])[1]);
    }
    const xfsBlock = (stylesXml || '').match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
    const cellXfs = [];
    if (xfsBlock) {
      const xfRe = /<xf\s[^>]*?(?:\/>|>)/g;
      let xm;
      while ((xm = xfRe.exec(xfsBlock[1])) !== null) {
        cellXfs.push(Number((xm[0].match(/numFmtId="(\d+)"/) || [, 0])[1]));
      }
    }
    function kindOfStyle(s) {
      if (s === undefined || s === null || s === '') return null;
      const id = cellXfs[Number(s)] || 0;
      return fmtKind(id, customFmt[id]);
    }

    const sheets = [];
    for (let si = 0; si < sheetRefs.length; si++) {
      const sh = sheetRefs[si];
      const xml = await read('xl/' + (rels[sh.rid] || ''));
      if (!xml) continue;
      const dim = (xml.match(/<dimension\s+ref="([^"]*)"/) || [, ''])[1];
      const rows = [];

      const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
      let rowM;
      while ((rowM = rowRe.exec(xml)) !== null) {
        const rowIdx = Number((rowM[0].match(/\br="(\d+)"/) || [, 0])[1]);
        const row = [];
        const cellRe = /<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
        let cm;
        while ((cm = cellRe.exec(rowM[1])) !== null) {
          const attrs = cm[1];
          const inner = cm[3] || '';
          const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
          const t = (attrs.match(/\bt="([^"]*)"/) || [])[1];
          const s = (attrs.match(/\bs="(\d+)"/) || [])[1];
          const ci = ref ? colIndex(ref) : row.length;
          const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
          const rawV = vm ? decodeXml(vm[1]) : null;

          let cell;
          if (t === 'inlineStr') cell = { t: 'str', v: textOf(inner) };
          else if (t === 's') cell = { t: 'str', v: shared[Number(rawV)] != null ? shared[Number(rawV)] : null };
          else if (t === 'str') cell = { t: 'str', v: clean(rawV) };
          else if (t === 'b') cell = { t: 'bool', v: rawV === '1' };
          else if (t === 'e') cell = { t: 'err', v: rawV };
          else if (rawV === null) cell = null;
          else {
            const kind = kindOfStyle(s);
            if (kind) {
              const p = serialToParts(Number(rawV), date1904);
              cell = kind === 'datetime'
                ? { t: 'datetime', v: p.date + 'T' + p.time }
                : { t: 'date', v: p.date };
            } else {
              const digits = rawV.replace(/^[+-]/, '').replace(/\..*$/, '');
              const n = Number(rawV);
              /* 超 15 位纯整数：JS 双精度会丢精度（9007199254740993 -> ...992），
                 保留原始文本；与 Python 版"前导零也保文本"同一思路 */
              if (opt.keepBigNumberAsText && digits.length > 15 && isFinite(n) && Math.floor(n) === n) {
                cell = { t: 'bignum', v: rawV };
              } else {
                cell = { t: 'num', v: n };
              }
            }
          }
          while (row.length < ci) row.push(null);
          row[ci] = cell;
        }
        while (rows.length < rowIdx - 1) rows.push([]);
        rows[rowIdx - 1] = row;
      }

      sheets.push({ name: sh.name, dim: dim, rows: rows });
    }

    if (!sheets.length) throw new Error('这个工作簿里没有可读的工作表');
    return sheets;
  }

  /* ------------------------------------------------------------------
   * 五、CSV：编码探测 + 分隔符探测
   * ------------------------------------------------------------------ */

  /* RFC 4180 风格状态机，支持双引号转义、字段内换行 */
  function parseCsvText(text, delimiter) {
    const src = String(text).replace(/^\uFEFF/, '');
    const sep = delimiter || ',';
    const rows = [];
    let cur = [], cell = '', inQuotes = false, i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i += 2; }
          else { inQuotes = false; i++; }
        } else { cell += ch; i++; }
      } else if (ch === '"' && cell === '') { inQuotes = true; i++; }
      else if (ch === sep) { cur.push(cell); cell = ''; i++; }
      else if (ch === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; i++; }
      else if (ch === '\r') {
        if (src[i + 1] === '\n') i++;
        cur.push(cell); rows.push(cur); cur = []; cell = ''; i++;
      } else { cell += ch; i++; }
    }
    if (cell !== '' || cur.length) { cur.push(cell); rows.push(cur); }
    return rows;
  }

  function maxCols(rows) {
    let n = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i].length > n) n = rows[i].length;
    return n;
  }

  /* 依次尝试各分隔符，取"切出的列数最多"的那个（与 Python 版同策略） */
  function parseCsvAuto(text) {
    let best = null, bestSep = ',';
    for (let i = 0; i < CSV_DELIMITERS.length; i++) {
      const sep = CSV_DELIMITERS[i];
      const rows = parseCsvText(text, sep);
      const n = maxCols(rows);
      if (!best || n > best.n) { best = { n: n, rows: rows }; bestSep = sep; }
    }
    return { delimiter: bestSep, grid: best ? best.rows : [] };
  }

  const ENCODING_NAMES = { 'utf-8': 'UTF-8', 'gb18030': 'GB18030' };

  /* 解码字节：先 UTF-8（严格），失败退回 GB18030 —— 与 Python 版探测顺序一致 */
  function decodeText(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
    } catch (e) {
      try {
        return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'GB18030' };
      } catch (e2) {
        return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8 (含替换字符)' };
      }
    }
  }

  function gridToRows(grid) {
    return grid.map(function (r) {
      return r.map(function (v) { return { t: 'str', v: v }; });
    });
  }

  function readCsvBytes(bytes, name) {
    const dec = decodeText(bytes);
    const parsed = parseCsvAuto(dec.text);
    const grid = parsed.grid;
    /* 与 Python 版一致：纯空行也保留（后续由 prepare 过滤），列数以最宽行为准 */
    return {
      kind: 'csv',
      encoding: dec.encoding,
      delimiter: parsed.delimiter,
      sheets: [{
        name: name || 'CSV',
        dim: grid.length ? 'A1:' + maxCols(grid) + 'x' + grid.length : '',
        nrows: grid.length,
        ncols: maxCols(grid),
        rows: gridToRows(grid)
      }]
    };
  }

  /* ------------------------------------------------------------------
   * 六、统一入口
   * ------------------------------------------------------------------ */

  function extOf(name) {
    const m = String(name || '').match(/\.[^.\\/]+$/);
    return m ? m[0].toLowerCase() : '';
  }

  async function readFile(file) {
    const name = file.name || '';
    const ext = extOf(name);
    const stem = name.replace(/\.[^.]+$/, '') || 'data';

    if (ext === '.xls') {
      throw new Error('不支持 .xls（老式二进制格式）。请在 Excel / WPS 里「另存为 .xlsx」后再试。');
    }

    const buf = new Uint8Array(await file.arrayBuffer());

    if (ext === '.xlsx' || ext === '.xlsm') {
      if (!canReadXlsx()) {
        throw new Error('当前浏览器不支持 DecompressionStream("deflate-raw")，无法解析 .xlsx。' +
                        '请换用 Chrome / Edge 103+、Firefox 113+ 或 Safari 16.4+；' +
                        '或先把表格另存为 .csv 再试。');
      }
      const sheets = await readXlsx(buf);
      return { kind: 'xlsx', ext: ext, size: buf.length, sheets: sheets };
    }

    /* 其余（.csv / .txt / 无扩展名）一律按文本表格处理 */
    const r = readCsvBytes(buf, stem);
    r.ext = ext;
    r.size = buf.length;
    return r;
  }

  return {
    readFile: readFile,
    readXlsx: readXlsx,
    readCsvBytes: readCsvBytes,
    parseCsvText: parseCsvText,
    parseCsvAuto: parseCsvAuto,
    decodeText: decodeText,
    canReadXlsx: canReadXlsx,
    extOf: extOf,
    CSV_DELIMITERS: CSV_DELIMITERS
  };
})();

/* ----------------------------------------------------------------------
 * 迁移说明（与 Python 版 reader.py 的差异，均属有意为之）
 *   1. .xls 不支持        —— BIFF 二进制格式，前端不现实，改为明确提示另存为 .xlsx
 *   2. 超 15 位整数保文本 —— JS 只有双精度浮点，> 2^53 会丢精度；这是唯一的功能降级
 *   3. CSV 编码探测顺序   —— 先 UTF-8 严格解码，失败退 GB18030；等价于 Python 的
 *                            (utf-8-sig, gb18030, utf-8, gbk) 实际效果
 *   4. 日期类型区分       —— 读取器如实给出 'date' / 'datetime'，是否"按纯日期输出"
 *                            由 sqlgen 的 legacyDateMode 决定（对齐 Python 行为）
 * -------------------------------------------------------------------- */
