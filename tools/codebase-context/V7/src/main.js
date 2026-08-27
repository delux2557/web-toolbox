/* ============================================================
 * main.js — 入口：流程状态机 + 用户操作事件挂载 + 启动
 * ============================================================ */

import { els, $ } from "./dom.js";
import { state } from "./state.js";
import { loadFilters, getRules } from "./filters.js";
import { readEntry, walkHandle, walkEntry, classifyEntry } from "./filesystem.js";
import { buildTreeObject, buildDirFirstFile, treeDOM } from "./tree.js";
import { updateExportData } from "./markdown.js";
import { renderPreview, locateFile } from "./preview.js";
import { ensureHighlight } from "./renderer.js";
import { loadScenarios } from "./scenario.js";
import { initTheme, initLineNumbers } from "./theme.js";
import { initRulesUI, bindReaggregate } from "./rules.js";
import { num, humanSize, setLog, toast, mapWithConcurrency } from "./utils.js";
import { CONCURRENCY, COPY_LIMIT } from "./constants.js";

/* 渲染结果：汇总条 + 过滤摘要 + 目录树 + 预览 + 状态栏 + 导出分流 */
async function renderResults(rootName, files, warnings, skippedRule) {
  state.currentRootName = rootName;
  state.currentFiles = files;
  state.currentWarnings = warnings;
  state.skippedRule = skippedRule || [];
  state.fileCount = files.length;
  state.totalChars = files.reduce((s, f) => s + f.content.length, 0);
  state.tokenEst = Math.round(state.totalChars / 4);
  state.skipCount = warnings.length;
  state.hasResult = true;

  await loadScenarios();       // 确保场景就绪（真实默认或兜底）
  updateExportData();
  state.dirFirstFile = buildDirFirstFile(files);
  state.locatePath = null;           // 重新扫描后重置定位状态，回到默认首尾折叠

  // tree
  const treeObj = buildTreeObject(files.map((f) => f.path));
  els.treeRoot.innerHTML = "";
  els.treeRoot.appendChild(treeDOM(treeObj, "", {
    onFile: (rel) => locateFile(rel),
    onDir: (rel) => {
      const first = state.dirFirstFile.get(rel);
      if (first) locateFile(first);
    }
  }));
  els.treeCount.textContent = num(state.fileCount) + " 文件";

  // preview（先确保高亮库就绪）
  await ensureHighlight();
  renderPreview();

  // statusbar（KPI 唯一归宿）
  els.statusbar.hidden = false;
  els.stProject.textContent = rootName;
  els.stFiles.textContent = num(state.fileCount);
  els.stChars.textContent = humanSize(state.totalChars);
  els.stTokens.textContent = "~" + num(state.tokenEst);
  if (ruleExcludedCount() + state.skipCount > 0) {
    setLog("已排除 " + ruleExcludedCount() + " · 读取跳过 " + state.skipCount);
  } else {
    setLog("就绪 · 生成于 " + new Date().toLocaleTimeString("zh-CN"));
  }

  // 导出分流：内容 ≥ 500KB 时禁用复制、突出下载
  const canCopy = state.fullMarkdown.length < COPY_LIMIT;
  els.copyBtn.disabled = !canCopy;
  els.copyBtn.title = canCopy ? "" : "内容过大，建议下载";
  els.downloadBtn.classList.toggle("btn-primary", !canCopy);
  els.downloadBtn.classList.toggle("btn-ghost", canCopy);
  if (!canCopy) els.copyBtn.textContent = "📋 内容过大（禁用）";
  else els.copyBtn.textContent = "📋 一键复制";

  els.empty.hidden = true;
  els.scan.hidden = true;
  els.results.hidden = false;
}

function ruleExcludedCount() { return state.skippedRule.length; }

/* 处理管线（picker / input / drop / 规则调整后的重聚合 共用）。
   rawEntries 为完整清单（含被规则排除者）。 */
async function processFiles(rootName, rawEntries) {
  state.sourceName = rootName;
  state.rawEntries = rawEntries;
  state.hasResult = false;

  els.empty.hidden = true;
  els.results.hidden = true;
  els.statusbar.hidden = true;
  els.scan.hidden = false;
  els.progressFill.style.width = "0%";
  els.progressText.textContent = "已扫描 0 个文件";
  els.progressPct.textContent = "0%";
  els.currentFile.textContent = "准备中";

  await loadFilters();   // 确保规则就绪（filters.json 或内置默认）后再过滤
  const rules = getRules();

  // 分类：纳入 / 被规则排除（一次遍历）——强制包含(放行)在此处最高优先级生效
  const included = [];
  const skippedRule = [];
  for (const e of rawEntries) {
    const reason = classifyEntry(e.path, e.name, rules);
    if (reason === null) included.push(e);
    else skippedRule.push({ path: e.path, name: e.name, reason });
  }
  included.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
  skippedRule.sort((a, b) => a.path.localeCompare(b.path));

  const total = included.length;
  let done = 0;
  let lastPaint = 0;

  // 读取（带缓存：规则调整后重聚合时，内容未变则直接复用，不重复读盘）
  const results = await mapWithConcurrency(included, CONCURRENCY, async (entry) => {
    let r;
    if (state.readCache.has(entry.path)) {
      r = state.readCache.get(entry.path);
    } else {
      r = await readEntry(entry);
      state.readCache.set(entry.path, { ok: r.ok, size: r.size, content: r.content, reason: r.reason, error: r.error });
    }
    done++;
    const now = performance.now();
    if (now - lastPaint > 60 || done === total) {
      lastPaint = now;
      const pct = total ? ((done / total) * 100).toFixed(1) : "100";
      els.progressFill.style.width = pct + "%";
      els.progressText.textContent = "已扫描 " + done + " / " + total + " 个文件";
      els.progressPct.textContent = pct + "%";
      els.currentFile.textContent = entry.path;
    }
    return { path: entry.path, ...r };
  });

  const files = [];
  const warnings = [];
  for (const r of results) {
    if (r.ok) files.push({ path: r.path, content: r.content, size: r.size });
    else warnings.push({ path: r.path, reason: r.reason });
  }

  // 让进度条走满后再切屏，避免闪烁
  els.progressFill.style.width = "100%";
  els.progressPct.textContent = "100%";
  await new Promise((res) => setTimeout(res, 180));

  await renderResults(rootName, files, warnings, skippedRule);
  const excl = skippedRule.length;
  toast("已聚合 " + num(files.length) + " 个文件" +
    (excl ? " · 规则排除 " + excl : "") +
    (warnings.length ? " · 读取跳过 " + warnings.length : ""));
}

/* 就地重聚合：复用已读取的完整清单与内容缓存，无需重新选文件夹 */
async function reaggregate() {
  if (!state.rawEntries.length) return;
  await processFiles(state.sourceName, state.rawEntries);
}

async function pickDirectory() {
  if (window.isSecureContext && "showDirectoryPicker" in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      const entries = await walkHandle(dirHandle, "", []);
      await processFiles(dirHandle.name, entries);
    } catch (e) {
      if (e && e.name === "AbortError") return; // 用户取消
      throw e;
    }
  } else {
    els.fileInput.value = "";
    els.fileInput.click();
  }
}

els.dropzone.addEventListener("click", pickDirectory);
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickDirectory(); }
});

els.reselectBtn.addEventListener("click", () => {
  els.results.hidden = true;
  els.statusbar.hidden = true;
  els.empty.hidden = false;
});

els.fileInput.addEventListener("change", async () => {
  const fl = [...els.fileInput.files];
  if (!fl.length) return;
  const rootName = fl[0].webkitRelativePath.split("/")[0] || "project";
  const entries = fl.map((f) => {
    const rel = f.webkitRelativePath.split("/").slice(1).join("/");
    return { path: rel, name: f.name, file: f };
  });
  await processFiles(rootName, entries);
});

/* 拖拽文件夹（FileSystemEntry API） */
["dragenter", "dragover"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove("drag"); })
);
els.dropzone.addEventListener("drop", async (e) => {
  const items = e.dataTransfer && e.dataTransfer.items;
  if (!items || !items.length) return;
  const entry = items[0].webkitGetAsEntry && items[0].webkitGetAsEntry();
  if (!entry) { toast("当前浏览器不支持拖拽文件夹，请点击选择", "error"); return; }
  const out = [];
  await walkEntry(entry, "", out);
  await processFiles(entry.name, out);
});

/* ============ Boot ============ */
initTheme();
initLineNumbers();

// 预加载代码高亮库（并行，不阻塞首屏）
ensureHighlight();

// 预加载过滤规则配置（并行；processFiles 内会 await 确保就绪）
loadFilters();

// 预加载场景模板（并行；renderResults 内会 await 确保就绪）
loadScenarios();

// 过滤规则 UI / 透明度 入口 + 就地重聚合回调注入
initRulesUI();
bindReaggregate(() => reaggregate());

// 若上次会话遗留结果界面残留，兜底置空
if (!state.hasResult) { /* 无操作 */ }

const hasFS = window.isSecureContext && "showDirectoryPicker" in window;
els.compat.textContent = hasFS
  ? "✓ 当前浏览器支持文件系统访问，可选择任意文件夹"
  : "当前环境不支持目录选择 API，将使用上传方式（不支持子目录递归拖拽）";