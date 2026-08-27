/* ============================================================
 * theme.js — 明暗主题 + 行号偏好（偏好持久化到 localStorage）
 * ============================================================ */

import { els } from "./dom.js";

const THEME_KEY = "cca-theme";
const LINE_KEY = "cca-lineNumbers";

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeIconSun.style.display = theme === "dark" ? "none" : "block";
  els.themeIconMoon.style.display = theme === "dark" ? "block" : "none";
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}

export function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (_) {}
  const pref = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(stored || pref);
}

/* 行号偏好：独立 key 记忆（首访默认关闭） */
export function initLineNumbers() {
  try { els.lineNumToggle.checked = localStorage.getItem(LINE_KEY) === "1"; } catch (_) {}
}

els.themeToggle.addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme;
  applyTheme(cur === "dark" ? "light" : "dark");
});