/* ============================================================
 * rules.js — 「过滤」枢纽弹窗：顶部「结果概要 / 过滤规则」页签，
 *            结果概要按原因×目录/模式聚合展示（只读计数），
 *            过滤规则为可编辑项，全部沿用既有设计令牌
 * ============================================================ */

import { $ } from "./dom.js";
import { state } from "./state.js";
import {
  getUserRules, resetUserRules,
  addUserIgnoreDir, removeUserIgnoreDir, addUserIgnoreName, removeUserIgnoreName,
  addUserAllowExt, removeUserAllowExt, forceIncludeFile, removeForceIncludeFile,
  setUserMaxSize, setUserSkipNoExt, getRules, rulesSummary, REASON_LABELS
} from "./filters.js";
import { num, extOf, toast } from "./utils.js";
import { escapeHTML } from "./security.js";

let reaggregate = null;
let activeTab = "rules"; // 记录上次停留的页签，重开弹窗保持一致

/* main 在启动时注入「就地重聚合」回调，避免循环依赖 */
export function bindReaggregate(fn) { reaggregate = fn; }

/* ================= 过滤规则页签 ================= */
function tagHTML(value) {
  return '<span class="tag">' + escapeHTML(value) + '<button class="tag-x" data-remove="' + escapeHTML(value) + '" aria-label="移除" type="button">&times;</button></span>';
}
function renderTagWrap(el, items) { el.innerHTML = items.map(tagHTML).join("") || '<span class="tag-empty">（无）</span>'; }

function fieldPlaceholder(field) {
  return { dirs: "目录名，如 node_modules", names: "文件名，如 secret.key", exts: "扩展名，如 qmd", files: "相对路径，如 src/util.js" }[field] || "";
}

function buildSections(u, defaultMB) {
  const section = (title, badge, field, items, extraHint) =>
    '<div class="rules-section">' +
      '<div class="rules-sec-head"><span>' + title + "</span><em class=" + '"count"' + ">" + (badge || "") + "</em></div>" +
      '<div class="tag-wrap" data-field="' + field + '">' + items.map(tagHTML).join("") + "</div>" +
      '<div class="tag-add" data-field="' + field + '">' +
        '<input type="text" placeholder="' + escapeHTML(extraHint || fieldPlaceholder(field)) + '" spellcheck="false" />' +
        '<button class="btn btn-ghost btn-sm" type="button">添加</button>' +
      "</div>" +
    "</div>";

  const s = rulesSummary();
  let html = "";
  html += '<div class="rules-info">规则即时保存到本浏览器；改动需点「应用并重新聚合」才对本次结果生效。</div>';
  html += section("忽略目录", s.dirCount, "dirs", u.ignoreDirs);
  html += section("忽略的文件名", s.nameCount, "names", u.ignoreNames);
  html += section("允许的扩展名（追加白名单）", s.extCount, "exts", u.allowExts, "扩展名，如 qmd");
  html += section("放行文件（强制包含）", s.includeCount, "files", u.includeFiles, "相对路径，如 src/util.js");
  html +=
    '<div class="rules-section rules-options">' +
      '<div class="opt">' +
        '<label for="rulesSize">最大文件大小 (MB)</label>' +
        '<input id="rulesSize" class="opt-input" type="number" min="0" step="0.5" value="' + (u.maxFileSize || "") + '" placeholder="' + defaultMB + '（默认）" />' +
        '<span class="opt-hint">留空使用默认 ' + defaultMB + 'MB</span>' +
      "</div>" +
      '<div class="opt opt-switch">' +
        '<label class="switch"><input type="checkbox" id="rulesNoExt" ' + (u.skipNoExt ? "checked" : "") + ' /><span class="track"></span>忽略无扩展名文件（点文件默认排除）</label>' +
      "</div>" +
    "</div>";
  return html;
}

/* ================= 结果概要页签（只读 + 聚合） ================= */
function topIgnoredDir(p) {
  const set = getRules().ignoredDirSet;
  const parts = p.split("/");
  for (let i = 0; i < parts.length - 1; i++) if (set.has(parts[i])) return parts[i];
  return "";
}
function groupKey(it) {
  const r = it.reason;
  const p = it.path || it.name || "";
  if (r === "dir") return topIgnoredDir(p) || "";
  if (r === "ext") return extOf(p) || "";
  return "";
}
function detailText(reason, key) {
  if ((reason === "dir" || reason === "ext") && key) return key;
  return "";
}

function buildSummaryHTML() {
  const items = [
    ...state.skippedRule.map((it) => ({ path: it.path, reason: it.reason })),
    ...state.currentWarnings.map((w) => ({ path: w.path, reason: w.reason }))
  ];
  if (!state.hasResult) {
    return '<div class="summary-empty">尚无聚合结果；扫描后这里会展示本次被排除的概况。</div>';
  }
  if (!items.length) {
    return '<div class="summary-empty">本次聚合没有排除任何文件。</div>';
  }
  const groups = new Map();
  for (const it of items) {
    const k = groupKey(it);
    const id = it.reason + "\u0000" + k;
    let g = groups.get(id);
    if (!g) { g = { reason: it.reason, detail: detailText(it.reason, k), count: 0 }; groups.set(id, g); }
    g.count++;
  }
  const order = { error: 0, size: 1, dir: 2, name: 3, hard: 4, ext: 5, noext: 6 };
  const rows = [...groups.values()]
    .sort((a, b) => (b.count - a.count) || ((order[a.reason] ?? 9) - (order[b.reason] ?? 9)))
    .map((g) =>
      '<div class="skip-row">' +
        '<span class="skip-reason">' + escapeHTML(REASON_LABELS[g.reason] || g.reason) + "</span>" +
        (g.detail
          ? '<code class="skip-detail">' + escapeHTML(g.detail) + "</code>"
          : '<span class="skip-detail-void"></span>') +
        '<em class="skip-count">' + num(g.count) + "</em>" +
      "</div>"
    ).join("");
  return (
    '<div class="summary-hint">按原因 × 目录/模式聚合，仅展示计数。如需调整，切到上方「过滤规则」后点「应用并重新聚合」。</div>' +
    '<div class="skip-list">' + rows + "</div>"
  );
}

/* ================= 过滤枢纽弹窗 ================= */
export function openRulesModal(opts) {
  const noAnim = !!(opts && opts.anim === false);
  const old = document.getElementById("rulesOverlay");
  if (old) old.remove();
  const u = getUserRules();
  const def = rulesSummary().maxSizeMB;

  const overlay = document.createElement("div");
  overlay.id = "rulesOverlay";
  overlay.className = "rules-overlay" + (noAnim ? " rules-overlay--noanim" : "");
  overlay.innerHTML =
    '<div class="rules-modal" role="dialog" aria-modal="true" aria-label="过滤">' +
      '<div class="rules-head">' +
        '<span class="rules-title"><span class="rules-title-ico"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v6l-4 2v-8L3 4z"/></svg></span>过滤</span>' +
        '<button class="rules-close" data-close aria-label="关闭" type="button">&times;</button>' +
      "</div>" +
      '<div class="rules-tabs" role="tablist" aria-label="过滤视图">' +
        '<button class="rules-tab" data-tab="summary" role="tab" aria-selected="false" type="button">结果概要</button>' +
        '<button class="rules-tab" data-tab="rules" role="tab" aria-selected="false" type="button">过滤规则</button>' +
      "</div>" +
      '<div class="rules-body">' +
        '<div class="rules-pane" data-pane="summary" hidden></div>' +
        '<div class="rules-pane" data-pane="rules"></div>' +
      "</div>" +
      '<div class="rules-foot">' +
        '<button class="btn btn-ghost btn-sm" data-rules-act="reset" type="button">恢复默认</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary btn-sm" data-rules-act="apply" type="button">应用并重新聚合</button>' +
      "</div>" +
    "</div>";
  document.body.appendChild(overlay);

  const paneRules = overlay.querySelector('[data-pane="rules"]');
  const paneSummary = overlay.querySelector('[data-pane="summary"]');
  paneRules.innerHTML = buildSections(u, def);
  paneSummary.innerHTML = buildSummaryHTML();

  /* 页签切换（底部操作按钮仅「过滤规则」页显示，footer 常驻保持弹窗高度恒定，切换不跳动） */
  const footReset = overlay.querySelector('[data-rules-act="reset"]');
  const footApply = overlay.querySelector('[data-rules-act="apply"]');
  const footWrap = overlay.querySelector(".rules-foot");
  const tabBtn = {
    summary: overlay.querySelector('[data-tab="summary"]'),
    rules: overlay.querySelector('[data-tab="rules"]')
  };
  function setTab(name) {
    activeTab = name;
    tabBtn.summary.setAttribute("aria-selected", String(name === "summary"));
    tabBtn.rules.setAttribute("aria-selected", String(name === "rules"));
    tabBtn.summary.classList.toggle("is-active", name === "summary");
    tabBtn.rules.classList.toggle("is-active", name === "rules");
    paneSummary.hidden = name !== "summary";
    paneRules.hidden = name !== "rules";
    footReset.hidden = name !== "rules";
    footApply.hidden = name !== "rules";
    footWrap.classList.toggle("is-bare", name !== "rules");
    if (name === "summary") paneSummary.innerHTML = buildSummaryHTML(); // 每次都按当前状态刷新
  }
  tabBtn.summary.addEventListener("click", () => setTab("summary"));
  tabBtn.rules.addEventListener("click", () => setTab("rules"));
  setTab(activeTab);

  /* 关闭 */
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
    if (e.target.closest("[data-close]")) overlay.remove();
  });

  /* 标签移除（只影响「过滤规则」页签内容） */
  overlay.querySelectorAll(".tag-wrap").forEach((wrap) => {
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".tag-x");
      if (!btn) return;
      const val = btn.getAttribute("data-remove");
      const field = wrap.dataset.field;
      if (field === "dirs") { removeUserIgnoreDir(val); renderTagWrap(wrap, getUserRules().ignoreDirs); toast("已移除忽略目录"); }
      else if (field === "names") { removeUserIgnoreName(val); renderTagWrap(wrap, getUserRules().ignoreNames); toast("已移除忽略文件名"); }
      else if (field === "exts") { removeUserAllowExt(val); renderTagWrap(wrap, getUserRules().allowExts); toast("已移除扩展名"); }
      else if (field === "files") { removeForceIncludeFile(val); renderTagWrap(wrap, getUserRules().includeFiles); toast("已取消放行"); }
    });
  });

  /* 标签添加 */
  overlay.querySelectorAll(".tag-add").forEach((row) => {
    const field = row.dataset.field;
    const input = row.querySelector("input");
    const btn = row.querySelector("button");
    const commit = () => {
      const v = input.value.trim();
      if (!v) return;
      if (field === "dirs") addUserIgnoreDir(v);
      else if (field === "names") addUserIgnoreName(v);
      else if (field === "exts") addUserAllowExt(v);
      else if (field === "files") forceIncludeFile(v);
      input.value = "";
      const map = { dirs: getUserRules().ignoreDirs, names: getUserRules().ignoreNames, exts: getUserRules().allowExts, files: getUserRules().includeFiles };
      renderTagWrap(overlay.querySelector('.tag-wrap[data-field="' + field + '"]'), map[field]);
      toast("已添加");
    };
    btn.addEventListener("click", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
  });

  /* 大小上限 */
  const sizeInput = overlay.querySelector("#rulesSize");
  sizeInput.addEventListener("change", () => {
    const v = parseFloat(sizeInput.value);
    const ok = v > 0;
    setUserMaxSize(ok ? v : null);
    toast(ok ? "大小上限已设为 " + v + "MB" : "大小上限恢复默认");
  });

  /* 无扩展名开关 */
  overlay.querySelector("#rulesNoExt").addEventListener("change", (e) => {
    setUserSkipNoExt(e.target.checked);
    toast(e.target.checked ? "已忽略无扩展名文件" : "已纳入无扩展名文件");
  });

  /* 底部动作 */
  overlay.addEventListener("click", (e) => {
    const act = e.target.closest("[data-rules-act]");
    if (!act) return;
    const kind = act.dataset.rulesAct;
    if (kind === "reset") {
      resetUserRules();
      openRulesModal({ anim: false }); // 静默重建，避免淡入动画导致闪烁
      toast("已恢复默认规则");
    } else if (kind === "apply") {
      overlay.remove();
      if (reaggregate && state.hasResult) reaggregate();
      else toast("尚无扫描结果，改规则将在下次聚合生效");
    }
  });
}

/* ================= 触发入口 ================= */
export function initRulesUI() {
  // 工具栏「过滤」按钮 → 过滤枢纽弹窗（单一入口）
  const toggleBtn = $("rulesToggleBtn");
  if (toggleBtn) toggleBtn.addEventListener("click", () => openRulesModal());
}