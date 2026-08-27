/* ============================================================
 * scenario.js — 场景模板（纯配置驱动，零硬编码）
 * ============================================================ */

import { $, els } from "./dom.js";
import { state } from "./state.js";
import { escapeHTML } from "./security.js";
import { buildSystemPromptBlock } from "./markdown.js";
import { mdToHTML } from "./renderer.js";
import { renderPreview } from "./preview.js";
import { FALLBACK_SCENARIO } from "./constants.js";
import { toast } from "./utils.js";
import { fallbackCopy } from "./export.js";

let scenariosPromise = null;

export function renderScenarioOptions() {
  const sel = $("scenarioSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const list = state.scenarios.length ? state.scenarios : [FALLBACK_SCENARIO];
  list.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    if (state.currentScenario && s.id === state.currentScenario.id) opt.selected = true;
    sel.appendChild(opt);
  });
}

export function switchScenario(next) {
  state.currentScenario = next || FALLBACK_SCENARIO;

  // 仅重建导出数据：主体复用缓存的 state.markdownBody，不重新扫描，导出内容始终完整
  const promptMD = buildSystemPromptBlock(state.currentScenario);
  state.fullMarkdown = promptMD + state.markdownBody;

  // 局部刷新：只替换预览区顶部的提示词引用块，下方目录树 / 代码块保持静止
  const promptHTML = mdToHTML(promptMD, els.lineNumToggle.checked);
  const quote = els.preview.querySelector("blockquote");
  if (quote) {
    quote.outerHTML = promptHTML;
  } else {
    // 兜底：边缘情况找不到 blockquote 时，回退全量重绘以保证 UI 一致
    renderPreview();
  }
}

export function showPromptModal() {
  if (!state.currentScenario) return;
  const old = document.getElementById("promptModalOverlay");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.id = "promptModalOverlay";
  overlay.className = "prompt-modal-overlay";
  overlay.innerHTML =
    '<div class="prompt-modal" role="dialog" aria-modal="true" aria-label="场景提示词">' +
      '<div class="prompt-modal-head"><span class="prompt-modal-title">⚙️ ' + escapeHTML(state.currentScenario.name) + '</span>' +
        '<button class="prompt-modal-close" id="promptModalClose" aria-label="关闭">&times;</button></div>' +
      '<div class="prompt-modal-body">' + escapeHTML(state.currentScenario.systemPrompt) + '</div>' +
      '<div class="prompt-modal-foot">' +
        '<button class="btn btn-ghost btn-sm" id="promptModalCopy">📋 复制提示词</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("promptModalClose").addEventListener("click", () => overlay.remove());
  document.getElementById("promptModalCopy").addEventListener("click", async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(state.currentScenario.systemPrompt);
      } else {
        fallbackCopy(state.currentScenario.systemPrompt);
      }
      toast("已复制提示词");
    } catch (e) {
      try { fallbackCopy(state.currentScenario.systemPrompt); toast("已复制提示词"); }
      catch (e2) { toast("复制失败", "error"); }
    }
  });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onEsc); }
  });
}

export function loadScenarios() {
  if (!scenariosPromise) {
    scenariosPromise = (async () => {
      try {
        const resp = await fetch("data/scenarios.json?t=" + Date.now());
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        const list = (data && Array.isArray(data.list)) ? data.list : [];
        state.scenarios = list;
        if (data && typeof data.promptIntro === "string" && data.promptIntro) state.promptIntro = data.promptIntro;
        const defId = data && data.defaultId;
        state.currentScenario = list.find((s) => s.id === defId) || list[0] || FALLBACK_SCENARIO;
      } catch (e) {
        console.warn("[V7] scenarios.json 加载失败，使用兜底场景", e);
        state.scenarios = [];
        state.currentScenario = FALLBACK_SCENARIO;
      }
      renderScenarioOptions();
    })();
  }
  return scenariosPromise;
}

const scenarioSelectEl = $("scenarioSelect");
if (scenarioSelectEl) {
  scenarioSelectEl.addEventListener("change", () => {
    const found = state.scenarios.find((s) => s.id === scenarioSelectEl.value);
    switchScenario(found || FALLBACK_SCENARIO);
  });
}
const previewPromptBtn = $("previewPromptBtn");
if (previewPromptBtn) {
  previewPromptBtn.addEventListener("click", showPromptModal);
}