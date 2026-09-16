/* ============================================================
 * theme.js — 明暗主题（与壳的首帧主题引导脚本共用 cw-theme key）
 * ============================================================ */

import { els } from "./dom.js";

const THEME_KEY = "cw-theme";

const listeners = new Set();

/* 订阅主题变化（编辑器用它切换代码配色） */
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  els.themeIconSun.style.display = theme === "dark" ? "none" : "block";
  els.themeIconMoon.style.display = theme === "dark" ? "block" : "none";
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* 隐私模式下忽略 */ }
  listeners.forEach((fn) => { try { fn(theme); } catch (_) {} });
}

export function initTheme() {
  /* 壳已在首帧前写好 data-theme；这里只做图标同步，避免二次写入造成闪动 */
  const theme = currentTheme();
  els.themeIconSun.style.display = theme === "dark" ? "none" : "block";
  els.themeIconMoon.style.display = theme === "dark" ? "block" : "none";
}

els.themeToggle.addEventListener("click", () => {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
});
