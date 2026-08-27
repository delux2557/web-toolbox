/* ============================================================
 * renderer.js — Markdown → HTML 轻量渲染器（无第三方 Markdown 库）
 *                + highlight.js 动态加载与代码高亮
 * ============================================================ */

import { escapeHTML, sanitizeHighlightedHTML } from "./security.js";

export function inlineMarkdown(text) {
  return escapeHTML(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/* highlight.js 动态加载（CDN，业内主流高亮库） */
let highlightReady = null;
export function ensureHighlight() {
  if (highlightReady) return highlightReady;
  highlightReady = new Promise((resolve) => {
    if (window.hljs) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return highlightReady;
}

function highlightCode(code, lang) {
  if (window.hljs && lang && window.hljs.getLanguage(lang)) {
    try {
      return sanitizeHighlightedHTML(
        window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      );
    } catch (e) { /* 忽略，退回纯文本 */ }
  }
  return null;
}

/* 把高亮后的 HTML 按行拆分，并保证每行的 <span> 平衡（多行注释/字符串不破色） */
export function splitHighlighted(html) {
  const raw = html.split("\n");
  const tagRe = /<span[^>]*>|<\/span>/g;
  const startStack = [], endStack = [];
  const open = [];
  raw.forEach((line) => {
    startStack.push(open.slice());
    let m;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(line)) !== null) {
      if (m[0].charAt(1) === "/") open.pop();
      else open.push(m[0]);
    }
    endStack.push(open.slice());
  });
  return raw.map((line, i) =>
    startStack[i].join("") + line + "</span>".repeat(endStack[i].length)
  );
}

export function renderCodeBlock(code, lang, lineNumbers) {
  const label = escapeHTML(lang || "text");
  const highlighted = highlightCode(code, lang);
  const html = highlighted != null ? highlighted : escapeHTML(code);
  if (lineNumbers) {
    const ls = splitHighlighted(html);
    if (ls.length && ls[ls.length - 1] === "") ls.pop();
    const body = ls.map((l, i) =>
      '<div class="cl"><span class="cln">' + (i + 1) + '</span><span class="clc">' + (l || " ") + "</span></div>"
    ).join("");
    return '<figure class="code"><figcaption>' + label + "</figcaption><pre>" + body + "</pre></figure>";
  }
  return '<figure class="code"><figcaption>' + label + "</figcaption><pre><code>" + html + "</code></pre></figure>";
}

export function mdToHTML(md, lineNumbers) {
  const lines = md.split("\n");
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 引用块（人类可读的 System Prompt 引导）
    if (line.startsWith("> ")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith("> ")) { buf.push(lines[i].slice(2)); i++; }
      html += "<blockquote>" + buf.map((l) => inlineMarkdown(l)).join("<br>") + "</blockquote>";
      continue;
    }
    const open = line.match(/^(`{3,})([^`]*)$/);
    if (open) {
      const fenceLen = open[1].length;
      const lang = open[2].trim();
      const buf = [];
      i++;
      while (i < lines.length) {
        const close = lines[i].match(/^(`{3,})\s*$/);
        if (close && close[1].length >= fenceLen) { i++; break; }
        buf.push(lines[i]);
        i++;
      }
      html += renderCodeBlock(buf.join("\n"), lang, lineNumbers);
      continue;
    }
    if (/^###\s/.test(line)) {
      const htxt = line.slice(4).trim();
      const fm = /^`(.+)`$/.exec(htxt);   // 文件标题形如 ### `path`
      html += fm
        ? '<h3 data-path="' + escapeHTML(fm[1]) + '">' + inlineMarkdown(htxt) + "</h3>"
        : "<h3>" + inlineMarkdown(htxt) + "</h3>";
      i++; continue;
    }
    if (/^##\s/.test(line)) { html += "<h2>" + inlineMarkdown(line.slice(3).trim()) + "</h2>"; i++; continue; }
    if (/^#\s/.test(line)) { html += "<h1>" + inlineMarkdown(line.slice(2).trim()) + "</h1>"; i++; continue; }
    if (/^-{3,}\s*$/.test(line)) { html += "<hr>"; i++; continue; }
    if (line.trim() === "") { i++; continue; }
    if (/^[-*]\s+/.test(line)) { html += '<p class="kpi">' + inlineMarkdown(line.replace(/^[-*]\s+/, "")) + "</p>"; i++; continue; }
    html += "<p>" + inlineMarkdown(line) + "</p>";
    i++;
  }
  return html;
}