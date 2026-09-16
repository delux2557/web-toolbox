/* ============================================================
 * mdview.js — Markdown → HTML 渲染（零依赖、面向不可信输入）
 * ------------------------------------------------------------
 * 【为什么自己写而不用 marked / markdown-it】
 *   1) 本工具的硬约束是「纯静态 · 零构建 · 离线可用」，引库要么走 CDN（断网就废），
 *      要么照离线 vendor 流程再塞一个包进来。渲染器本身只要百来行，不值得。
 *   2) 更关键的是**安全可控**：这里渲染的是「用户磁盘上任意 .md 文件」，
 *      属于不可信输入。第三方库默认放行内联 HTML，必须再配一个 sanitizer 兜着；
 *      而自己写的这套策略是**先全量转义、再套白名单内联规则**——
 *      输出里出现的每一个 `<` 都是我们主动生成的标签，天然免疫 XSS。
 *
 * 【明确的取舍】不支持内联 HTML（`<div>` 之类原样显示成文字）。
 *   这是有意的：在「可写盘」的工具里，允许 .md 注入任意 HTML 的收益远小于风险。
 *
 * 覆盖范围：ATX 标题 h1~h6 / 围栏代码（含语言名）/ 引用（可嵌套）/
 *   无序列表（可嵌套）/ 有序列表 / 任务列表 / 表格（GFM 管道表）/
 *   分隔线 / 段落；内联支持 粗体 斜体 删除线 行内码 链接 图片 自动链接。
 * ============================================================ */

import { escapeHTML } from "./security.js";

const MD_EXT = /\.(md|markdown|mdx)$/i;

export function isMarkdown(path) {
  return MD_EXT.test(String(path || ""));
}

/* 链接/图片地址白名单：挡掉 javascript: / data: / vbscript: 这类可执行协议。
   允许 http(s) / mailto / tel，以及相对路径与锚点。 */
function safeUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return null;
  /* 去掉不可见字符，防 "java\nscript:" 这类绕过 */
  const probe = url.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  if (/^(https?:|mailto:|tel:)/.test(probe)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(probe)) return null;   // 其他协议一律拒绝
  return url;                                            // 相对路径 / #锚点
}

/* ---------- 内联 ---------- */

function renderInline(text) {
  let out = escapeHTML(text);

  /* 行内码优先级最高：先把它抠出来占位，避免里面的 `*` `_` 被当成强调 */
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return "\u0000C" + (codes.length - 1) + "\u0000";
  });

  /* 图片要在链接之前处理（![alt](src) 比 [text](src) 多一个 !） */
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, alt, src, title) => {
    const href = safeUrl(src);
    if (!href) return escapeHTML(m);
    return '<img src="' + escapeHTML(href) + '" alt="' + alt + '"' +
           (title ? ' title="' + title + '"' : "") + ' loading="lazy">';
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, label, href0, title) => {
    const href = safeUrl(href0);
    if (!href) return escapeHTML(m);
    return '<a href="' + escapeHTML(href) + '" target="_blank" rel="noopener noreferrer"' +
           (title ? ' title="' + title + '"' : "") + ">" + label + "</a>";
  });

  /* 裸链接自动识别（不再重复匹配已经在 <a href> 里的） */
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g,
    (m, pre, url) => pre + '<a href="' + escapeHTML(url) + '" target="_blank" rel="noopener noreferrer">' + url + "</a>");

  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  /* 换行：两个以上空格 + 换行 → <br> */
  out = out.replace(/ {2,}\n/g, "<br>\n");

  /* 还原行内码（此时内容已是转义过的安全文本） */
  out = out.replace(/\u0000C(\d+)\u0000/g, (_, i) => "<code>" + codes[Number(i)] + "</code>");

  return out;
}

/* ---------- 列表判定 ---------- */

const RE_UL = /^(\s*)([-*+])\s+(.*)$/;
const RE_OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RE_TASK = /^\[([ xX])\]\s+(.*)$/;
const RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([^`]*)$/;
const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_QUOTE = /^>\s?(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (s) => s.replace(/\t/g, "    ").length;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/* 递归渲染列表：同一层收集成条目，缩进更深的挂成上一个条目的子列表。
 * 先收集再组装（而不是边扫边拼字符串）—— 嵌套时「父 <li> 不能提前闭合」，
 * 靠字符串替换去补救是错的。 */
function renderList(lines, startIdx) {
  const items = [];
  let i = startIdx;
  let baseIndent = null;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      /* 列表内空行：后面仍有同层或更深层条目就继续，否则本列表结束 */
      const nm = lines[i + 1] && (lines[i + 1].match(RE_UL) || lines[i + 1].match(RE_OL));
      if (nm && indentOf(nm[1]) >= baseIndent) { i++; continue; }
      break;
    }

    const mu = line.match(RE_UL);
    const mo = line.match(RE_OL);
    if (!mu && !mo) break;

    const m = mu || mo;
    const indent = indentOf(m[1]);

    if (baseIndent === null) baseIndent = indent;
    else if (indent < baseIndent) break;
    else if (indent > baseIndent) {
      /* 更深缩进 → 是上一个条目的子列表 */
      const sub = renderList(lines, i);
      if (items.length) items[items.length - 1].subs.push(sub.html);
      else return { html: sub.html, next: sub.next };
      i = sub.next;
      continue;
    }

    items.push({ body: m[3], ordered: !!(mo && !mu), subs: [] });
    i++;
  }

  /* 组装：同层里 ul / ol 混排时，按连续同类型分组 */
  let html = "";
  let j = 0;
  while (j < items.length) {
    const ord = items[j].ordered;
    html += ord ? "<ol>" : "<ul>";
    while (j < items.length && items[j].ordered === ord) {
      const it = items[j];
      const mt = it.body.match(RE_TASK);
      if (mt) {
        const checked = mt[1].toLowerCase() === "x";
        html += '<li class="task"><input type="checkbox" disabled' + (checked ? " checked" : "") +
                "><span>" + renderInline(mt[2]) + "</span>" + it.subs.join("") + "</li>";
      } else {
        html += "<li>" + renderInline(it.body) + it.subs.join("") + "</li>";
      }
      j++;
    }
    html += ord ? "</ol>" : "</ul>";
  }

  return { html, next: i };
}

/* ---------- 主渲染 ---------- */

export function mdToHTML(md) {
  const lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
  let html = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* 围栏代码块 */
    const mf = line.match(RE_FENCE);
    if (mf) {
      const fence = mf[2][0];
      const len = mf[2].length;
      const lang = mf[3].trim();
      const buf = [];
      i++;
      while (i < lines.length) {
        const close = new RegExp("^\\s*" + (fence === "`" ? "`" : "~") + "{" + len + ",}\\s*$");
        if (close.test(lines[i])) { i++; break; }
        buf.push(lines[i]);
        i++;
      }
      html += '<figure class="md-code">' +
              (lang ? '<figcaption>' + escapeHTML(lang) + "</figcaption>" : "") +
              "<pre><code>" + escapeHTML(buf.join("\n")) + "</code></pre></figure>";
      continue;
    }

    /* 标题 */
    const mh = line.match(RE_HEADING);
    if (mh) {
      const lv = mh[1].length;
      html += "<h" + lv + ">" + renderInline(mh[2]) + "</h" + lv + ">";
      i++;
      continue;
    }

    /* 分隔线（必须在列表之前判，否则 --- 会被当成 ul） */
    if (RE_HR.test(line)) { html += "<hr>"; i++; continue; }

    /* 引用（支持嵌套：递归处理去掉一层 > 之后的内容） */
    if (RE_QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) { buf.push(lines[i].match(RE_QUOTE)[1]); i++; }
      html += '<blockquote>' + mdToHTML(buf.join("\n")) + "</blockquote>";
      continue;
    }

    /* 表格：当前行含 | 且下一行是分隔行 */
    if (line.includes("|") && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const aligns = splitRow(lines[i - 1]).map((c) => {
        const l = c.startsWith(":"), r = c.endsWith(":");
        if (l && r) return "center";
        if (r) return "right";
        if (l) return "left";
        return "";
      });
      let body = "";
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        body += "<tr>" + head.map((_, ci) =>
          "<td" + (aligns[ci] ? ' style="text-align:' + aligns[ci] + '"' : "") + ">" +
          renderInline(cells[ci] || "") + "</td>").join("") + "</tr>";
        i++;
      }
      html += "<table><thead><tr>" + head.map((h, ci) =>
        "<th" + (aligns[ci] ? ' style="text-align:' + aligns[ci] + '"' : "") + ">" +
        renderInline(h) + "</th>").join("") + "</tr></thead><tbody>" + body + "</tbody></table>";
      continue;
    }

    /* 列表 */
    if (RE_UL.test(line) || RE_OL.test(line)) {
      const r = renderList(lines, i);
      html += r.html;
      i = r.next;
      continue;
    }

    /* 空行 */
    if (!line.trim()) { i++; continue; }

    /* 段落：连续非空行合并，软换行保留为空格 */
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
           !RE_FENCE.test(lines[i]) && !RE_HEADING.test(lines[i]) &&
           !RE_HR.test(lines[i]) && !RE_QUOTE.test(lines[i]) &&
           !RE_UL.test(lines[i]) && !RE_OL.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    html += "<p>" + renderInline(buf.join("\n")) + "</p>";
  }

  return html;
}
