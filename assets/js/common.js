/**
 * common.js — Web Toolbox 通用工具函数
 */
window.WB = window.WB || {};

// ---- localStorage 封装 ----
WB.store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  }
};

// ---- DOM 工具 ----
WB.$ = (sel, parent) => (parent || document).querySelector(sel);
WB.$$ = (sel, parent) => Array.from((parent || document).querySelectorAll(sel));

// ---- Overlay / Dialog ----
WB.openOverlay = (id) => WB.$(id).classList.add('open');
WB.closeOverlay = (id) => WB.$(id).classList.remove('open');
WB.closeOnBackdrop = (overlayId) => {
  WB.$(overlayId).addEventListener('click', (e) => {
    if (e.target === e.currentTarget) WB.closeOverlay(overlayId);
  });
};

// ---- 朗读（浏览器 TTS） ----
WB.speak = (text, lang) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang || 'en-US';
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
};

// ---- 励志短句 ----
WB.quotes = [
  'The secret of getting ahead is getting started.',
  'Small steps every day add up to big results.',
  'Learning is a treasure that follows its owner everywhere.',
  'Every expert was once a beginner.',
  'Words are the wings of thought.',
  'The beautiful thing about learning is nobody can take it away from you.',
];
WB.getQuote = () => WB.quotes[Math.floor(Math.random() * WB.quotes.length)];
