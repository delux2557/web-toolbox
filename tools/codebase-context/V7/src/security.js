/* ============================================================
 * security.js — 注入防护（XSS / HTML 注入 / 脚本注入）
 * ------------------------------------------------------------
 * 约定：任何「用户可控文本」（文件名、路径、文件内容、场景数据）在写入
 * innerHTML 前，都必须经过 escapeHTML 或 sanitizeHighlightedHTML 之一。
 *
 * 防范的注入类型与对应手段：
 * 1) HTML 标签注入   <img onerror=...> / <script>  → escapeHTML 转义 & < > " '
 * 2) 事件属性注入   on* / javascript: URL          → 转义引号 + 白名单清洗
 * 3) 第三方库输出污染（hljs 的 .value）              → sanitizeHighlightedHTML 白名单
 * 4) 属性值逃逸      " 或 ' 提前闭合属性             → escapeHTML 同时转义双/单引号
 *
 * 其余写入路径（textContent / option.value / textarea.value）为属性赋值，
 * 浏览器不解析为 HTML，天然安全，无需转义。
 * ============================================================ */

export function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 白名单清洗高亮输出：hljs 的 .value 虽已自行转义，但它是唯一「未经本地 escapeHTML」
   就直接写入 innerHTML 的路径。这里再加一道纵深防御——只放行 hljs 约定的
   <span class="hljs-*"> 与 </span>，其余任何标签、事件属性或孤立 < > 一律转义，
   杜绝第三方库输出被污染时引入任意标签 / 脚本。 */
export function sanitizeHighlightedHTML(html) {
  return html.replace(/<\/?[a-zA-Z][^>]*>|[<>]/g, (tag) => {
    if (tag === "<") return "&lt;";
    if (tag === ">") return "&gt;";
    if (tag.toLowerCase() === "</span>") return tag;
    const m = /^<span\s+class="([^"]*)"\s*>$/i.exec(tag);
    if (m && /^hljs-[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*$/.test(m[1].trim())) return tag;
    return tag.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  });
}