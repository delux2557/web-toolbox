/**
 * core/theme.js — 全局主题系统
 *
 * 职责：
 * 1. 读取 localStorage 主题偏好，无偏好则跟随系统
 * 2. 设置 <html data-theme="dark|light">
 * 3. 渲染极简主题切换按钮
 * 4. 切换时保存偏好到 localStorage 并即时生效
 *
 * 此脚本在 index.html 中先于 core/loader.js 同步加载，
 * 确保主题在 UI 渲染前就位。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'theme_preference';
  var TOGGLE_ID = 'theme-toggle';

  /* ==========================================================
     主题判定
     ========================================================== */

  function resolveTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (e) { /* 忽略 */ }

    if (stored === 'dark' || stored === 'light') return stored;

    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) { /* 忽略 */ }
  }

  /* ==========================================================
     应用主题
     ========================================================== */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateButtonIcon(theme);
  }

  /* ==========================================================
     切换按钮
     ========================================================== */

  var currentTheme = resolveTheme();

  function updateButtonIcon(theme) {
    var btn = document.getElementById(TOGGLE_ID);
    if (btn) {
      btn.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
      btn.setAttribute('aria-label', theme === 'dark' ? '切换浅色模式' : '切换深色模式');
    }
  }

  function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    saveTheme(currentTheme);
    applyTheme(currentTheme);
    syncButtonTheme();
  }

  function createToggleButton() {
    // 避免重复创建
    if (document.getElementById(TOGGLE_ID)) return;

    var btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.setAttribute('aria-label', '切换主题');
    btn.innerHTML = currentTheme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';

    // 按钮样式（内联，不依赖外部 CSS）
    Object.assign(btn.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '9999',
      width: '36px',
      height: '36px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '1.1rem',
      lineHeight: '1',
      background: 'oklch(100% 0 0 / 0.85)',
      border: '1px solid oklch(88% 0.005 220)',
      borderRadius: '6px',
      cursor: 'pointer',
      padding: '0',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      transition: 'background 150ms ease-out, border-color 150ms ease-out',
      boxSizing: 'border-box'
    });

    btn.addEventListener('mouseenter', function () {
      btn.style.background = 'oklch(95% 0.01 220 / 0.9)';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.background = 'oklch(100% 0 0 / 0.85)';
    });

    btn.addEventListener('click', toggleTheme);
    document.body.appendChild(btn);

    // 暗色模式下按钮颜色调整
    syncButtonTheme();
  }

  function syncButtonTheme() {
    var btn = document.getElementById(TOGGLE_ID);
    if (!btn) return;
    var isDark = currentTheme === 'dark';
    btn.style.background = isDark
      ? 'oklch(25% 0.01 220 / 0.85)'
      : 'oklch(100% 0 0 / 0.85)';
    btn.style.borderColor = isDark
      ? 'oklch(35% 0.01 220)'
      : 'oklch(88% 0.005 220)';
    btn.style.color = isDark
      ? 'oklch(90% 0 0)'
      : 'oklch(25% 0.01 70)';
  }

  /* ==========================================================
     初始化
     ========================================================== */

  // 立即应用主题（阻止闪烁）
  applyTheme(currentTheme);

  // DOM 就绪后创建按钮
  function init() {
    createToggleButton();

    // 监听系统主题变化（仅在无手动偏好时生效）
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      var stored = null;
      try { stored = localStorage.getItem(STORAGE_KEY); } catch (ex) {}
      if (!stored) {
        currentTheme = e.matches ? 'dark' : 'light';
        applyTheme(currentTheme);
        syncButtonTheme();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
