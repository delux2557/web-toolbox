/* ============================================================
 * utils.js — 通用小工具（无渲染职责）
 * ============================================================ */

import { els } from "./dom.js";
import { state } from "./state.js";
import { EXT_TO_LANG, NAME_TO_LANG, BINARY_EXT } from "./constants.js";
import { basename, escapeHTML } from "./security.js";

export function extOf(name) {
  const i = name.lastIndexOf(".");
  if (i <= 0) return "";
  return name.slice(i + 1).toLowerCase();
}

export function humanSize(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(2) + " MB";
}

export function num(n) { return (n || 0).toLocaleString("en-US"); }

/* 扩展名 / 文件名 → 离线编辑器语言 key；未知返回 ""（按纯文本处理） */
export function langKeyFor(path) {
  const name = basename(path).toLowerCase();
  if (NAME_TO_LANG[name]) return NAME_TO_LANG[name];
  const ext = extOf(name);
  return EXT_TO_LANG[ext] || "";
}

/* 是否明显是二进制（按扩展名判断，读取前即可决策） */
export function looksBinary(path) {
  return BINARY_EXT.has(extOf(path));
}

export function fmtTime(d) {
  if (!d) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function debounce(fn, ms) {
  let timer = 0;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* 并发受限的 map（目录树构建 / 批量读盘时用） */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function toast(msg, type) {
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  els.toastWrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

export function setLog(msg) {
  state.logLine = msg;
  els.stLog.textContent = msg;
}

/* 文本行数（空串记 0 行） */
export function countLines(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/* 状态栏「活动文件路径」的统一渲染（文件名加粗 + 目录弱化） */
export function renderPathHTML(p) {
  const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
  return '<span class="p-dir">' + escapeHTML(dir) + "</span>" +
         '<span class="p-name">' + escapeHTML(basename(p)) + "</span>";
}
