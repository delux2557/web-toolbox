/* ============================================================
 * preview.js — 内容预览（折叠感知截断 + 目录联动定位）
 * ============================================================ */

import { els } from "./dom.js";
import { state } from "./state.js";
import { num } from "./utils.js";
import { escapeHTML } from "./security.js";
import { mdToHTML } from "./renderer.js";
import { PREVIEW_HEAD, PREVIEW_TAIL } from "./constants.js";

export function previewSplit(md, headLines, tailLines) {
  const lines = md.split("\n");
  const total = lines.length;
  if (total <= headLines + tailLines) return { head: md, tail: "", fold: 0 };

  let hi = headLines;
  let openLen = 0;
  for (let i = 0; i < hi; i++) {
    const m = lines[i].match(/^(`{3,})(.*)$/);
    if (m) {
      if (openLen === 0) openLen = m[1].length;
      else if (m[1].length >= openLen) openLen = 0;
    }
  }
  if (openLen > 0) {
    while (hi < total) {
      const m = lines[hi].match(/^(`{3,})\s*$/);
      hi++;
      if (m && m[1].length >= openLen) break;
    }
  }

  let lo = total - tailLines;
  while (lo > hi && !lines[lo].startsWith("### ")) lo--;
  if (lo <= hi) lo = total;

  return {
    head: lines.slice(0, hi).join("\n"),
    tail: lo < total ? lines.slice(lo).join("\n") : "",
    fold: Math.max(0, lo - hi)
  };
}

/* 计算 fullMarkdown 中「文件内容聚合」头部结束行，以及每个文件块的行号范围 */
export function computeFileAnchors(md) {
  const lines = md.split("\n");
  let headerEnd = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    if (lines[i].startsWith("## 📁 文件内容聚合")) { headerEnd = i + 1; break; }
  }
  const files = [];
  let cur = null;
  for (i = headerEnd; i < lines.length; i++) {
    const m = lines[i].match(/^### `(.+)`$/);
    if (m) {
      if (cur) { cur.end = i; files.push(cur); }
      cur = { path: m[1], start: i, end: lines.length };
    }
  }
  if (cur) files.push(cur);
  return { headerEnd, files };
}

export function locateFile(path) {
  state.locatePath = path;
  renderPreview();
}

/* 定位渲染：头部（prompt+统计+目录）+ 目标文件块 + 前后折叠提示 */
function renderLocatedPreview(lineNumbers) {
  const { headerEnd, files } = computeFileAnchors(state.fullMarkdown);
  const idx = files.findIndex((f) => f.path === state.locatePath);
  if (idx < 0) { state.locatePath = null; renderPreview(); return; }
  const target = files[idx];
  const lines = state.fullMarkdown.split("\n");

  const headHTML = mdToHTML(lines.slice(0, headerEnd).join("\n"), lineNumbers);
  const targetHTML = mdToHTML(lines.slice(target.start, target.end).join("\n"), lineNumbers);
  const before = idx;
  const after = files.length - 1 - idx;

  const bar = '<div class="locate-bar"><span>📍 已定位到 <code>' + escapeHTML(state.locatePath) + '</code></span>' +
    '<button class="locate-clear" id="locateClear" type="button">× 返回完整预览</button></div>';
  const foldBefore = before > 0
    ? '<div class="fold"><span class="fold-dot"></span><p>上方 ' + num(before) + ' 个文件已折叠</p><span class="fold-dot"></span></div>'
    : "";
  const foldAfter = after > 0
    ? '<div class="fold"><span class="fold-dot"></span><p>下方 ' + num(after) + ' 个文件已折叠</p><span class="fold-dot"></span></div>'
    : "";

  els.preview.innerHTML = bar + headHTML + foldBefore + targetHTML + foldAfter;
  els.preview.classList.toggle("line-nums", lineNumbers);
  els.previewBanner.classList.remove("visible");
  els.previewCount.textContent = "定位中 · 第 " + (idx + 1) + " / " + files.length + " 个文件";

  const clearBtn = document.getElementById("locateClear");
  if (clearBtn) clearBtn.addEventListener("click", () => { state.locatePath = null; renderPreview(); });

  requestAnimationFrame(() => {
    const hs = els.preview.querySelectorAll("h3[data-path]");
    for (const h of hs) {
      if (h.getAttribute("data-path") === state.locatePath) { h.scrollIntoView({ block: "start" }); break; }
    }
  });
}

export function renderPreview() {
  const lineNumbers = els.lineNumToggle.checked;
  if (state.locatePath) { renderLocatedPreview(lineNumbers); return; }
  const { head, tail, fold } = previewSplit(state.fullMarkdown, PREVIEW_HEAD, PREVIEW_TAIL);
  const headHTML = mdToHTML(head, lineNumbers);
  const tailHTML = tail ? mdToHTML(tail, lineNumbers) : "";
  const foldHTML = fold > 0
    ? '<div class="fold"><span class="fold-dot"></span><p>中间 ' + num(fold) + ' 行已折叠 · 请下载完整文件查看</p><span class="fold-dot"></span></div>'
    : "";
  els.preview.innerHTML = headHTML + foldHTML + tailHTML;
  els.preview.classList.toggle("line-nums", lineNumbers);
  els.previewBanner.classList.toggle("visible", fold > 0);
  els.previewCount.textContent = (fold > 0 ? "预览已折叠" : num(state.fullMarkdown.split("\n").length) + " 行");
}

/* line-number toggle re-renders preview + 记住偏好 */
els.lineNumToggle.addEventListener("change", () => {
  try { localStorage.setItem("cca-lineNumbers", els.lineNumToggle.checked ? "1" : "0"); } catch (_) {}
  renderPreview();
});