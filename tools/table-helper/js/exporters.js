'use strict';
/* =====================================================================
 * exporters.js - 导出格式（纯函数）+ 导出器注册表（命名空间 Exporters）
 * 新增导出格式（如 SQL 插入语句）：在此注册一个 exporter，
 * 并在 MODES 对应模式的 exporters 列表引用即可。
 * 对外暴露 fmtCSV / fmtJSON / exporters，为公共 API。
 * ================================================================== */
const Exporters = (function () {
  const { today, csvEscape } = TableUtils;

  /* ---------- 导出格式（纯函数）：把 TableData 转成本文本，供拷贝/下载复用 ---------- */
  function fmtCSV(data) {
    const lines = [['序号', ...data.columns].map(csvEscape).join(',')];
    data.rows.forEach((r, i) => lines.push([i + 1, ...r].map(csvEscape).join(',')));
    return lines.join('\r\n');
  }
  function fmtJSON(data, opts) {
    const o = opts || {};
    if (o.structure === 'array2d') return JSON.stringify(data.rows, null, 2); // 二维数组：纯数据，不含表头
    const arr = data.rows.map(r => {
      const obj = {};
      data.columns.forEach((c, i) => obj[c] = r[i] ?? '');
      return obj;
    });
    return JSON.stringify(arr, null, 2);
  }

  /* ---------- 导出器注册表（kind 决定行为：download 触发下载，copy 复制到剪贴板） ---------- */
  const exporters = {
    csvDownload: {
      label: '⬇️ 下载 CSV', kind: 'download',
      build: d => ({ text: fmtCSV(d), mime: 'text/csv;charset=utf-8;', filename: '表格数据_' + today() + '.csv', bom: true, toast: 'CSV 已下载（含 BOM）' })
    },
    csvCopy: {
      label: '📋 复制 CSV', kind: 'copy',
      build: d => ({ text: fmtCSV(d), toast: 'CSV 已复制到剪贴板' })
    },
    jsonCopy: {
      label: '📄 复制 JSON', kind: 'copy',
      build: (d, o) => ({ text: fmtJSON(d, o), toast: 'JSON 已复制到剪贴板' })
    },
    jsonDownload: {
      label: '⬇️ 下载 JSON', kind: 'download',
      build: (d, o) => ({ text: fmtJSON(d, o), mime: 'application/json;charset=utf-8;', filename: 'JSON数据_' + today() + '.json', toast: 'JSON 已下载' })
    }
    // ⭐ 未来扩展示例 —— SQL 插入语句下载：
    // sqlInsert: {
    //   label: '⬇️ 下载 SQL', kind: 'download',
    //   build: (d, o) => {
    //     const table = (o && o.tableName) || 'my_table';
    //     const esc = v => String(v ?? '').replace(/'/g, "''");
    //     const lines = d.rows.map(r => 'INSERT INTO `' + table + '` (`' + d.columns.join('`,`') + '`) VALUES (' + r.map(v => "'" + esc(v) + "'").join(',') + ');');
    //     return { text: lines.join('\n'), mime: 'text/plain;charset=utf-8;', filename: 'insert_' + table + '_' + today() + '.sql' };
    //   }
    // }
  };

  return { fmtCSV, fmtJSON, exporters };
})();