/* ============================================================
 * utils.js — 通用小工具（无渲染职责）
 * ============================================================ */

import { els } from "./dom.js";
import { LANG_MAP } from "./constants.js";
import { state } from "./state.js";

export function extOf(name) {
  const i = name.lastIndexOf(".");
  if (i <= 0) return "";
  return name.slice(i + 1).toLowerCase();
}

export function humanSize(chars) {
  if (chars < 1000) return chars + " 字符";
  if (chars < 1e6) return (chars / 1024).toFixed(1) + " KB";
  return (chars / 1048576).toFixed(2) + " MB";
}

export function num(n) { return (n || 0).toLocaleString("en-US"); }

export function langFor(path) { return LANG_MAP[extOf(path)] || ""; }

export function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* 并发受限的 map */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
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
  }, 2400);
}

export function setLog(msg) {
  state.logLine = msg;
  els.stLog.textContent = msg;
}