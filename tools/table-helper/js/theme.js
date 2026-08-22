'use strict';
/* =====================================================================
 * theme.js - 明暗主题切换
 * 说明：CSS 首帧的主题初始化脚本仍保留在 index.html 的 <head> 中，
 *       以避免首帧闪白；此文件负责点击按钮后的切换与持久化。
 * ================================================================== */
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('table-helper-theme', next); } catch (e) {}
  });
}