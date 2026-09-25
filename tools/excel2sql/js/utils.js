'use strict';
/* =====================================================================
 * utils.js - 通用工具（命名空间 E2sUtils）
 * 纯函数集合：格式化 / 单元格展示 / 剪贴板 / 下载 / 文件名清洗。
 * 刻意不含业务逻辑，也不在模块顶层碰 DOM —— 自检脚本可以用 new Function
 * 直接加载本文件做断言（浏览器外的 Node 环境同样成立）。
 *
 * 注：这里**没有** HTML 转义函数。界面一律走 textContent / createElement
 * 输出文本（见 app.js 的 renderTokens / renderHint），不拼 HTML 字符串，
 * 于是既不需要转义、也不会漏转义。
 * ================================================================== */
const E2sUtils = (function () {

  /* ------------------------------------------------------------------
   * 格式化
   * ------------------------------------------------------------------ */

  /* 本地当日日期 YYYY-MM-DD。
     不用 toISOString()：它按 UTC 算，东八区在 08:00 前会退回前一天。 */
  function today() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* 千分位整数（用于行数、列数这类统计值） */
  function fmtInt(n) {
    const v = Math.round(Number(n) || 0);
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* 字节数 -> 人类可读 */
  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1073741824) return (v / 1048576).toFixed(1) + ' MB';
    return (v / 1073741824).toFixed(2) + ' GB';
  }

  /* 毫秒 -> 人类可读 */
  function fmtMs(ms) {
    const v = Number(ms) || 0;
    if (v < 1000) return Math.round(v) + ' ms';
    return (v / 1000).toFixed(2) + ' s';
  }

  /* ------------------------------------------------------------------
   * 单元格展示（表头选择表 / 悬停提示用）
   * ------------------------------------------------------------------ */

  const KIND_LABEL = {
    str: '文本',
    num: '数字',
    bignum: '超长数字（按文本输出，避免精度丢失）',
    bool: '布尔值',
    date: '日期',
    datetime: '日期时间',
    err: '错误值'
  };

  /* 单元格 -> 预览文本。空单元格返回空串，由界面自行决定怎么画"空"。 */
  function previewCell(cell) {
    if (cell == null) return '';
    switch (cell.t) {
      case 'bool': return cell.v ? 'TRUE' : 'FALSE';
      case 'err': return String(cell.v);
      case 'datetime': return String(cell.v).replace('T', ' ');
      default: return String(cell.v == null ? '' : cell.v);
    }
  }

  /* 单元格 -> 类型标签（悬停提示里的"这是什么"） */
  function cellKind(cell) {
    if (cell == null) return '空';
    return KIND_LABEL[cell.t] || String(cell.t);
  }

  /* ------------------------------------------------------------------
   * 时序 / 剪贴板 / 下载
   * ------------------------------------------------------------------ */

  /* 让出一拍，好让"正在生成…"这类状态先渲染出来，再跑重活。
     ★ 刻意用 setTimeout 而不是 requestAnimationFrame：rAF 在**后台标签页里永不触发**
     （规范行为，不是 bug）。而改成自动生成之后，重算很容易在用户切走的那一刻被触发 ——
     那一卡就是永久的：按钮一直停在「正在生成…」，切回来也不好使。setTimeout 没有这个可见性依赖。 */
  function nextFrame() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  /* 老浏览器的复制兜底：临时 textarea + execCommand */
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* 复制文本，返回是否成功（上层据此提示成功/失败，不抛异常） */
  async function copyText(text) {
    const s = String(text == null ? '' : text);
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(s);
        return true;
      } catch (e) {
        /* 落到下面的兜底，常见于权限被拒 */
      }
    }
    return fallbackCopy(s);
  }

  /* 触发下载。
     bom=false 是刻意的：命令行版 write_sql 用 encoding='utf-8'、newline=''，
     即 UTF-8 无 BOM + LF 换行。前端保持一致，产物才能和命令行版逐字节比对。 */
  function downloadText(filename, text, mime, bom) {
    const parts = bom ? ['\uFEFF', text] : [text];
    const blob = new Blob(parts, { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = String(filename || 'output.txt');
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* 立刻 revoke 在部分浏览器会中断下载，给一个宽松的延迟 */
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return blob.size;
  }

  /* 文件名安全化：与 Python 版 config.default_output 的 safe_sheet 同规则
     （非单词字符/非中文一律换成下划线，再去掉首尾下划线） */
  function safeFileStem(s) {
    const out = String(s == null ? '' : s)
      .replace(/[^\w\u4e00-\u9fff]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return out || 'sheet';
  }

  /* 去掉扩展名，作为下载文件名的主干 */
  function stemOf(name) {
    const m = String(name == null ? '' : name).match(/^(.*)\.[^.\\/]+$/);
    return (m ? m[1] : String(name == null ? '' : name)) || 'data';
  }

  return {
    today: today,
    fmtInt: fmtInt,
    fmtBytes: fmtBytes,
    fmtMs: fmtMs,
    previewCell: previewCell,
    cellKind: cellKind,
    nextFrame: nextFrame,
    copyText: copyText,
    fallbackCopy: fallbackCopy,
    downloadText: downloadText,
    safeFileStem: safeFileStem,
    stemOf: stemOf
  };
})();
