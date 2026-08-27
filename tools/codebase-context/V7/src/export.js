/* ============================================================
 * export.js — 导出（复制到剪贴板 / 下载 .md）
 * ============================================================ */

import { els } from "./dom.js";
import { toast, timestamp, num } from "./utils.js";
import { state } from "./state.js";

export function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("execCommand copy failed");
}

els.copyBtn.addEventListener("click", async () => {
  if (!state.fullMarkdown) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(state.fullMarkdown);
    } else {
      fallbackCopy(state.fullMarkdown);
    }
    toast("已复制 " + num(state.fileCount) + " 个文件");
  } catch (e) {
    try {
      fallbackCopy(state.fullMarkdown);
      toast("已复制 " + num(state.fileCount) + " 个文件");
    } catch (e2) {
      toast("复制失败，请改用下载", "error");
    }
  }
});

els.downloadBtn.addEventListener("click", () => {
  if (!state.fullMarkdown) return;
  const filename = "context_" + timestamp() + ".md";
  const blob = new Blob([state.fullMarkdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  toast("已下载 " + filename);
});