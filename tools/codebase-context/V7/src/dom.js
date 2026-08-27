/* ============================================================
 * dom.js — DOM 引用集中管理（防止各处重复 getElementById）
 * ============================================================ */

export function $(id) { return document.getElementById(id); }

export const els = {
  empty: $("emptyState"), scan: $("scanState"), results: $("resultsState"),
  dropzone: $("dropzone"), compat: $("compatNote"), fileInput: $("fileInput"),
  currentFile: $("currentFile"), progressFill: $("progressFill"),
  progressText: $("progressText"), progressPct: $("progressPct"),
  copyBtn: $("copyBtn"), downloadBtn: $("downloadBtn"),
  lineNumToggle: $("lineNumToggle"), reselectBtn: $("reselectBtn"),
  rulesToggleBtn: $("rulesToggleBtn"),
  treeRoot: $("treeRoot"), treeCount: $("treeCount"), preview: $("preview"),
  previewCount: $("previewCount"), previewBanner: $("previewBanner"),
  statusbar: $("statusbar"), stProject: $("stProject"),
  stFiles: $("stFiles"), stChars: $("stChars"), stTokens: $("stTokens"),
  stLog: $("stLog"), toastWrap: $("toastWrap"),
  themeToggle: $("themeToggle"), themeIconSun: $("themeIconSun"),
  themeIconMoon: $("themeIconMoon")
};