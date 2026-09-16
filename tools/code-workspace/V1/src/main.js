/* ============================================================
 * main.js — 入口：流程编排 + 事件挂载 + 启动
 * ------------------------------------------------------------
 * 分层：main.js 只做「编排与交互」，不直接碰 File System API，
 *       所有落盘操作都经 fsrepo.js，所有弹窗都经 dialog.js。
 * ============================================================ */

import { els } from "./dom.js";
import { state, findTab, activeTab } from "./state.js";
import { TRASH_DIR, MAX_SCAN_ENTRIES, MAX_EDIT_BYTES, MSG } from "./constants.js";
import { safeName, basename, dirname, joinPath } from "./security.js";
import {
  toast, setLog, humanSize, num, countLines, fmtTime, langKeyFor, looksBinary, debounce
} from "./utils.js";
import { initTheme } from "./theme.js";
import { getBoolPref, setPref } from "./prefs.js";
import { mdToHTML, isMarkdown } from "./mdview.js";
import { promptDialog, confirmDialog, dangerConfirm, selectDialog, alertDialog } from "./dialog.js";
import { showMenu, hideMenu } from "./menu.js";
import {
  hasFSAccess, pickRoot, ensurePermission, walk,
  readFileText, writeFileText, createFile, createFolder, moveEntry,
  deleteEntry, loadTrash, restoreFromTrash, purgeTrashEntry, getMeta,
  DELETE_MODE, CAPABILITIES
} from "./fsrepo.js";
import {
  initTree, buildTree, renderTree, expandTo, showTrashView
} from "./treeview.js";
import {
  ensureEditor, showTab, pullContent, dropTabState, resetAll,
  onSaveRequest, onDocChange, isReady, focusEditor
} from "./editor.js";

/* ============ 状态栏 / 顶栏 ============ */

function fileCount() { return state.entries.filter((e) => e.kind === "file").length; }

function refreshStatus() {
  els.stProject.textContent = state.rootName || "—";
  els.stFiles.textContent = num(fileCount());
  els.stTabs.textContent = num(state.tabs.length);
}

function refreshPerm() {
  if (!state.rootHandle) { els.permBadge.hidden = true; return; }
  els.permBadge.hidden = false;
  els.permBadge.textContent = state.readwrite ? "读写" : "只读";
  els.permBadge.classList.toggle("is-ro", !state.readwrite);
}

/* ============ 环境诊断 ============
 * 教训：文件系统 API 被拒是**致命失败**，绝不能只用一个 2.6 秒后消失、
 * 还固定在右下角的 toast —— 在小尺寸嵌入面板里等于「点了没反应」。
 * 所以这里统一走一个持久、高对比、带可复制地址的告警卡片。
 */

function isEmbedded() {
  /* 跨域访问 window.top 会抛异常，抛了就说明确实被嵌在别的页面里 */
  try { return window.self !== window.top; } catch (_) { return true; }
}

const tNode = (s) => document.createTextNode(s);
const bNode = (s) => { const e = document.createElement("b"); e.textContent = s; return e; };
const brNode = () => document.createElement("br");

function showEnvWarn(title, bodyNodes, detailText, actions) {
  const box = els.envWarn;
  box.textContent = "";

  const t = document.createElement("div");
  t.className = "env-warn-title";
  t.textContent = "⚠ " + title;
  box.appendChild(t);

  const b = document.createElement("div");
  b.className = "env-warn-body";
  bodyNodes.forEach((n) => b.appendChild(n));
  box.appendChild(b);

  if (detailText) {
    const d = document.createElement("div");
    d.className = "env-warn-detail";
    d.textContent = detailText;
    box.appendChild(d);
  }

  if (actions && actions.length) {
    const wrap = document.createElement("div");
    wrap.className = "env-warn-actions";
    actions.forEach((a) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm " + (a.primary ? "btn-primary" : "btn-ghost");
      btn.textContent = a.label;
      btn.addEventListener("click", a.onClick);
      wrap.appendChild(btn);
    });
    box.appendChild(wrap);
  }

  box.hidden = false;
  els.empty.hidden = false;
}

function hideEnvWarn() {
  els.envWarn.hidden = true;
  els.envWarn.textContent = "";
}

function openInNewTab() {
  /* 被 sandbox 限制时 window.open 会返回 null，此时用户只能手动复制地址 */
  const w = window.open(location.href, "_blank");
  if (!w) toast("浏览器拦截了新标签页，请手动复制页面上的地址", "error");
}

const newTabAction = () => ({ label: "在新标签页打开", primary: true, onClick: openInNewTab });

/* 把 DOMException 翻译成「用户能照着做」的话 */
function explainPickerError(errName, message) {
  const lines = [];

  if (errName === "SecurityError") {
    lines.push(tNode("浏览器直接拒绝了目录选择器请求。最常见的原因是"));
    lines.push(bNode("本页被嵌在 iframe 里"));
    lines.push(tNode("——Chrome 明确禁止跨域子框架调用文件系统访问 API；另一种可能是当前不在 HTTPS / localhost 安全上下文中。"));
    lines.push(brNode());
    lines.push(tNode("解决办法：把本页在"));
    lines.push(bNode("独立标签页"));
    lines.push(tNode("打开后重试，功能不受影响。"));
  } else if (errName === "NotAllowedError") {
    lines.push(tNode("权限被拒绝。请点地址栏左侧的站点设置，把「本地文件系统」改为允许，然后重试。"));
  } else if (errName === "InvalidStateError") {
    lines.push(tNode("已经有一个目录选择器正在等待操作，请先关掉它再点一次。"));
  } else if (errName === "AbortError") {
    lines.push(tNode("目录选择器被关闭了。"));
  } else {
    lines.push(tNode("未能打开目录选择器，异常类型："));
    lines.push(bNode(errName));
  }

  showEnvWarn(
    "打不开目录选择器",
    lines,
    errName + ": " + message + "\n当前地址：" + location.href,
    isEmbedded() ? [newTabAction()] : []
  );
  toast("打不开目录选择器 — 请看页面上的红色提示", "error");
}


/* ============ 扫描 ============ */

async function rescan() {
  if (!state.rootHandle) return;
  els.treeCount.textContent = "扫描中…";
  try {
    const { entries, hidden, truncated } = await walk(state.showNoise);
    state.entries = entries;
    state.entryMap = new Map(entries.map((e) => [e.path, e]));
    state.hiddenNoise = hidden;
    state.truncated = truncated;
    state.tree = buildTree(entries);
    renderTree();
    refreshStatus();

    let extra = "";
    if (hidden) extra += " · 已隐藏 " + hidden + " 个噪音目录";
    if (truncated) extra += " · 已达 " + MAX_SCAN_ENTRIES + " 条上限，未列全";
    setLog("扫描完成 · " + fileCount() + " 文件 · " + (entries.length - fileCount()) + " 目录" + extra);
    els.trashHint.textContent = hidden ? "已隐藏 " + hidden + " 个目录" : "";
  } catch (e) {
    toast("扫描失败：" + (e && e.message ? e.message : e), "error");
    els.treeCount.textContent = "扫描失败";
  }
}

/* 重扫后把选中项与展开状态恢复到新清单上 */
async function rescanAndFocus(path) {
  await rescan();
  if (path) {
    if (path.split("/").length > 1) expandTo(path);
    state.selected = path;
    renderTree();
    requestAnimationFrame(() => {
      const el = els.treeRoot.querySelector(".tree-row.selected");
      if (el) el.scrollIntoView({ block: "nearest" });
    });
  }
  updateInfo();
}

/* ============ 标签页 ============ */

function renderTabs() {
  els.tabBar.textContent = "";
  const frag = document.createDocumentFragment();

  for (const t of state.tabs) {
    const el = document.createElement("div");
    el.className = "tab" +
      (t.path === state.activePath ? " active" : "") +
      (t.dirty ? " dirty" : "") +
      (t.readonly ? " ro" : "");
    el.title = t.path;

    const dot = document.createElement("span");
    dot.className = "tab-dot";
    const nm = document.createElement("span");
    nm.className = "tab-name";
    nm.textContent = t.name;

    const x = document.createElement("button");
    x.type = "button";
    x.className = "tab-close";
    x.textContent = "×";
    x.title = "关闭（Ctrl+W）";
    x.setAttribute("aria-label", "关闭标签");
    x.addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.path); });

    el.appendChild(dot);
    el.appendChild(nm);
    el.appendChild(x);
    el.addEventListener("click", () => activateTab(t.path));
    el.addEventListener("auxclick", (e) => { if (e.button === 1) closeTab(t.path); });
    frag.appendChild(el);
  }

  els.tabBar.appendChild(frag);
  els.stTabs.textContent = num(state.tabs.length);

  const t = activeTab();
  els.btnSave.disabled = !t || t.readonly;
  els.btnSave.textContent = t && t.dirty ? "保存 *" : "保存";
  els.dirtyChip.hidden = !(t && t.dirty);
}

function reasonText(reason, size) {
  switch (reason) {
    case "binary": return "这是二进制文件，不提供文本编辑，以免保存时损坏原始内容。";
    case "encoding": return "这个文件不是 UTF-8 编码的文本（可能是 GBK / UTF-16 等）。为了不写坏原文件，本工具不对它开放编辑。";
    case "size": return "文件大小 " + humanSize(size || 0) + "，超出可编辑上限（" + humanSize(MAX_EDIT_BYTES) + "），已跳过加载。";
    case "missing": return "文件已不存在（可能被外部程序移动或删除）。请重新扫描。";
    case "denied": return "浏览器没有授予这个文件的读取权限（NotAllowedError）。通常是授权时只勾了「查看」，或授权已过期。请点上方「重新授权读写」后再试。";
    default: return "读取时抛出了未预期的异常，具体原因见下方技术信息。";
  }
}

function showNotice(tab) {
  els.editorHost.hidden = true;
  els.editorWelcome.hidden = true;
  els.editorNotice.hidden = false;

  els.editorNotice.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "ew-inner";
  const icon = document.createElement("div");
  icon.className = "ew-icon";
  icon.textContent = "⚠";
  const title = document.createElement("div");
  title.className = "ew-title";
  title.textContent = basename(tab.path) + " · 只读";
  const desc = document.createElement("p");
  desc.className = "ew-desc";
  desc.textContent = reasonText(tab.reason, tab.size);
  wrap.appendChild(icon);
  wrap.appendChild(title);
  wrap.appendChild(desc);

  /* 非预期失败：把原始异常摆出来。没有这段，用户只能看到一句
     「无法读取这个文件。」，既不知道原因也不知道该找谁。 */
  if (tab.errName) {
    const diag = document.createElement("pre");
    diag.className = "ew-diag";
    diag.textContent =
      "异常类型：" + tab.errName + "\n" +
      "异常消息：" + (tab.errMsg || "（无）") + "\n" +
      "文件路径：" + tab.path + "\n" +
      "当前权限：" + (state.readwrite ? "读写" : "只读") + "\n" +
      "根目录：" + (state.rootName || "（未打开）");
    wrap.appendChild(diag);
  }

  els.editorNotice.appendChild(wrap);
}

function showWelcome() {
  els.editorHost.hidden = true;
  els.editorNotice.hidden = true;
  hideMdChrome();
  els.editorWelcome.hidden = false;
}

async function openFile(path) {
  state.selected = path;
  if (state.view === "trash") { state.view = "files"; renderTree(); }

  const existing = findTab(path);
  if (existing) { await activateTab(path); return; }

  const entry = state.entryMap.get(path);
  if (!entry) { toast("该文件已不在清单中，请重新扫描", "error"); return; }

  const tab = {
    path, name: entry.name, content: "", dirty: false,
    size: null, mtime: null, bom: false, readonly: false, reason: "",
    errName: "", errMsg: ""
  };

  if (looksBinary(path)) {
    tab.readonly = true;
    tab.reason = "binary";
  } else {
    const r = await readFileText(path);
    if (!r.ok) {
      tab.readonly = true;
      tab.reason = r.reason;
      tab.size = r.size != null ? r.size : null;
      /* 把真实异常名与消息一并留住 —— 兜底的「无法读取这个文件。」对排查毫无帮助 */
      tab.errName = r.errName || "";
      tab.errMsg = r.errMsg || "";
    } else {
      tab.content = r.content;
      tab.size = r.size;
      tab.mtime = r.mtime;
      tab.bom = r.bom;
    }
  }

  state.tabs.push(tab);
  await activateTab(path);
}

async function activateTab(path) {
  const prev = activeTab();
  if (prev && prev.path !== path && isReady()) {
    const v = pullContent(prev);
    if (v != null) prev.content = v;
  }

  state.activePath = path;
  state.selected = path;
  const tab = findTab(path);
  if (!tab) { renderTabs(); updateInfo(); return; }

  if (tab.readonly) {
    renderTabs();
    showNotice(tab);
    hideMdChrome();
    renderTree();
    updateInfo();
    return;
  }

  renderTabs();
  renderTree();
  try {
    await ensureEditor();
    showTab(tab);
    applyMdView(tab);
    if (!isMdPreview(tab)) focusEditor();
  } catch (e) {
    showWelcome();
    toast("编辑器加载失败：" + (e && e.message ? e.message : e), "error");
  }
  updateInfo();
}

/* ============ Markdown 编辑 / 预览 ============
 * 设计取舍：预览**不是**替代编辑器，而是盖在它上面的一层。
 *   始终照常调用 showTab()，让 CodeMirror 一直持有该标签的现场，
 *   于是切标签时的 pullContent / 撤销史 / 光标位置全部沿用原有逻辑，
 *   不会因为「进过预览」而丢内容或丢撤销历史。
 *   预览模式下只是把 editorHost 视觉上藏起来，换 mdPreviewPane 显示。
 */

const MD_MODE_KEY = "md-mode";

function isMdPreview(tab) {
  return !!tab && !tab.readonly && isMarkdown(tab.path) && state.mdPreview;
}

function mdPreviewMarkup(tab) {
  const content = (isReady() && activeTab() === tab ? pullContent(tab) : null) ?? tab.content;
  const body = mdToHTML(content || "");
  return body || '<p class="md-empty">（空文件）</p>';
}

/* 切到预览 / 回到编辑时调用 */
function applyMdView(tab) {
  const showSeg = !!tab && !tab.readonly && isMarkdown(tab.path);
  els.mdSeg.hidden = !showSeg;
  els.mdEditBtn.classList.toggle("is-active", showSeg && !state.mdPreview);
  els.mdPreviewBtn.classList.toggle("is-active", showSeg && state.mdPreview);

  if (isMdPreview(tab)) {
    els.mdPreviewPane.innerHTML = mdPreviewMarkup(tab);
    els.mdPreviewPane.hidden = false;
    els.editorHost.hidden = true;
  } else {
    els.mdPreviewPane.hidden = true;
    els.mdPreviewPane.textContent = "";
    if (tab && !tab.readonly) els.editorHost.hidden = false;
  }
}

/* 完全离开 Markdown 上下文（只读文件 / 无标签）时收起这一套 UI */
function hideMdChrome() {
  els.mdSeg.hidden = true;
  els.mdPreviewPane.hidden = true;
  els.mdPreviewPane.textContent = "";
}

function setMdPreview(on) {
  state.mdPreview = !!on;
  setPref(MD_MODE_KEY, state.mdPreview);
  const tab = activeTab();
  if (tab) applyMdView(tab);
  if (!state.mdPreview && tab && !tab.readonly) focusEditor();
}

function initMdMode() {
  state.mdPreview = getBoolPref(MD_MODE_KEY, false);
  els.mdEditBtn.addEventListener("click", () => setMdPreview(false));
  els.mdPreviewBtn.addEventListener("click", () => setMdPreview(true));
}

function nextAfterClose(path) {
  const i = state.tabs.findIndex((t) => t.path === path);
  if (i < 0) return;
  const next = state.tabs[i + 1] || state.tabs[i - 1];
  if (next) activateTab(next.path);
  else {
    state.activePath = "";
    resetAll();
    renderTabs();
    renderTree();
    updateInfo();
  }
}

async function closeTab(path, { force = false } = {}) {
  const tab = findTab(path);
  if (!tab) return;

  if (tab.dirty && !force) {
    const go = await confirmDialog({
      title: "有未保存的改动",
      message: "「" + tab.name + "」还有未保存的改动，关闭后这些改动会丢失。",
      okText: "放弃改动并关闭"
    });
    if (!go) return;
  }

  state.tabs = state.tabs.filter((t) => t.path !== path);
  dropTabState(path);

  if (state.activePath === path) {
    state.activePath = "";
    nextAfterClose(path);
  } else {
    renderTabs();
  }
  /* 一个标签都不剩时，Markdown 的工具条与预览要一起收掉 */
  if (!state.tabs.length) { showWelcome(); }
  updateInfo();
}

/* ============ 保存 ============ */

async function saveTab(tab) {
  if (!tab || tab.readonly || state.saving) return false;

  const content = isReady() && state.activePath === tab.path
    ? (pullContent(tab) ?? tab.content)
    : tab.content;

  if (!state.readwrite) {
    const ok = await ensurePermission(state.rootHandle, "readwrite");
    state.readwrite = ok;
    refreshPerm();
    if (!ok) {
      await alertDialog({
        title: "无法保存：没有写入权限",
        message: "浏览器没有授予这个文件夹的读写权限，改动只存在于页面上，没有写进磁盘。",
        hint: "点地址栏左侧的站点设置，把「本地文件系统」改为允许；或点顶栏「打开文件夹」重新选择一次并允许编辑。"
      });
      return false;
    }
  }

  state.saving = true;
  els.btnSave.disabled = true;
  try {
    await writeFileText(tab.path, content, tab.bom);
    tab.content = content;
    tab.dirty = false;
    const meta = await getMeta(tab.path);
    tab.size = meta.size;
    tab.mtime = meta.mtime;
    setLog("已保存 " + tab.path + " · " + new Date().toLocaleTimeString("zh-CN"));
    toast("已保存 " + tab.name, "ok");
    return true;
  } catch (e) {
    toast("保存失败：" + (e && e.message ? e.message : e), "error");
    return false;
  } finally {
    state.saving = false;
    renderTabs();
    updateInfo();
  }
}

function saveActive() { return saveTab(activeTab()); }

/* ============ 新建 / 重命名 / 移动 / 删除 ============ */

/* 弹窗级的名称校验：safeName + 与当前清单查重 + 保护回收站目录名 */
function nameValidator(dir, { allowSame = "" } = {}) {
  return (raw) => {
    const c = safeName(raw);
    if (!c.ok) return c.reason;
    if (c.name === TRASH_DIR) return "「" + TRASH_DIR + "」是回收站保留目录名";
    if (allowSame && c.name === allowSame) return "";
    const p = joinPath(dir, c.name);
    if (state.entryMap.has(p)) return "已存在同名文件或文件夹";
    return "";
  };
}

function targetDir(ctx) {
  if (ctx && ctx.kind === "dir") return ctx.path;
  if (ctx && ctx.kind === "file") return dirname(ctx.path);
  if (state.selected) {
    const e = state.entryMap.get(state.selected);
    if (e) return e.kind === "dir" ? e.path : dirname(e.path);
  }
  return "";
}

async function actionNewFile(ctx) {
  const dir = targetDir(ctx);
  const name = await promptDialog({
    title: "新建文件",
    label: "位置：" + (dir || "（根目录）"),
    placeholder: "例如 notes.md",
    okText: "创建",
    hint: "文件名不能包含路径分隔符",
    validate: nameValidator(dir)
  });
  if (name == null) return;
  try {
    await createFile(dir, name);
    await rescanAndFocus(joinPath(dir, name));
    toast("已创建 " + name, "ok");
    await openFile(joinPath(dir, name));
  } catch (e) {
    toast("创建失败：" + (e && e.message ? e.message : e), "error");
  }
}

async function actionNewFolder(ctx) {
  const dir = targetDir(ctx);
  const name = await promptDialog({
    title: "新建文件夹",
    label: "位置：" + (dir || "（根目录）"),
    placeholder: "例如 src",
    okText: "创建",
    validate: nameValidator(dir)
  });
  if (name == null) return;
  try {
    const p = await createFolder(dir, name);
    state.expanded.add(dir);
    await rescanAndFocus(p);
    toast("已创建文件夹 " + name, "ok");
  } catch (e) {
    toast("创建失败：" + (e && e.message ? e.message : e), "error");
  }
}

async function actionRename(ctx) {
  const path = ctx && ctx.path ? ctx.path : state.selected;
  if (!path) return;

  const tab = findTab(path);
  if (tab && tab.dirty) {
    const go = await confirmDialog({
      title: "先保存再重命名",
      message: "「" + tab.name + "」有未保存的改动。重命名会重新从磁盘读取内容，需要先保存。",
      okText: "保存并继续"
    });
    if (!go) return;
    if (!(await saveTab(tab))) return;
  }

  const oldName = basename(path);
  const dir = dirname(path);
  const name = await promptDialog({
    title: "重命名",
    label: path,
    value: oldName,
    okText: "重命名",
    validate: nameValidator(dir, { allowSame: oldName })
  });
  if (name == null || name === oldName) return;

  try {
    const newPath = await moveEntry(path, dir, name);
    if (tab) {
      dropTabState(path);
      state.tabs = state.tabs.filter((t) => t.path !== path);
      state.activePath = "";
      await openFile(newPath);
    } else {
      await rescanAndFocus(newPath);
    }
    toast("已重命名为 " + name, "ok");
  } catch (e) {
    toast("重命名失败：" + (e && e.message ? e.message : e), "error");
  }
}

async function actionMove(ctx) {
  const path = ctx && ctx.path ? ctx.path : state.selected;
  if (!path) return;

  const tab = findTab(path);
  if (tab && tab.dirty) {
    const go = await confirmDialog({
      title: "先保存再移动",
      message: "「" + tab.name + "」有未保存的改动，移动前需要先保存。",
      okText: "保存并继续"
    });
    if (!go) return;
    if (!(await saveTab(tab))) return;
  }

  /* 可选目标：所有目录（排除自身与其子目录） */
  const dirs = state.entries
    .filter((e) => e.kind === "dir" && e.path !== path && !e.path.startsWith(path + "/"))
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));

  const options = [{ value: "", label: "（根目录）" }]
    .concat(dirs.map((d) => ({ value: d, label: d })));

  const target = await selectDialog({
    title: "移动到…",
    label: path,
    options,
    value: "",
    okText: "移动",
    hint: "移动 = 在新位置写出副本后移除原路径"
  });
  if (target == null) return;
  if (target === dirname(path)) return;

  try {
    const newPath = await moveEntry(path, target, basename(path));
    if (tab) {
      dropTabState(path);
      state.tabs = state.tabs.filter((t) => t.path !== path);
      state.activePath = "";
      await openFile(newPath);
    } else {
      expandTo(target);
      await rescanAndFocus(newPath);
    }
    toast("已移动到 " + (target || "（根目录）"), "ok");
  } catch (e) {
    toast("移动失败：" + (e && e.message ? e.message : e), "error");
  }
}

async function actionDelete(ctx) {
  const path = ctx && ctx.path ? ctx.path : state.selected;
  if (!path) return;
  if (!CAPABILITIES.softDelete) { toast("当前构建未启用删除能力", "error"); return; }

  const name = basename(path);
  const isDir = !!(state.entryMap.get(path) && state.entryMap.get(path).kind === "dir");

  const go = await dangerConfirm({
    title: "移入回收站",
    message: (isDir ? "文件夹" : "文件") + "：" + path +
      "\n它会被完整复制到 " + TRASH_DIR + "/ 目录，然后从原位置移除。" +
      "只要回收站里的副本还在，就能还原；回收站被清空后才真正不可恢复。",
    confirmWord: name,
    okText: "移入回收站",
    hint: "当前删除方式：" + (DELETE_MODE === "trash" ? "可恢复" : "不可恢复") +
      "（真删除能力已预留，当前未启用）"
  });
  if (!go) return;

  /* 关掉受影响的标签（被删目录下的所有文件） */
  const affected = state.tabs.filter((t) => t.path === path || t.path.startsWith(path + "/"));
  for (const t of affected) {
    state.tabs = state.tabs.filter((x) => x.path !== t.path);
    dropTabState(t.path);
  }
  if (affected.some((t) => t.path === state.activePath)) {
    state.activePath = "";
    const next = state.tabs[0];
    if (next) await activateTab(next.path);
    else { resetAll(); renderTabs(); }
  }

  try {
    await deleteEntry(path, { mode: DELETE_MODE });
    await loadTrash();
    await rescanAndFocus(dirname(path));
    toast("已移入回收站：" + name, "ok");
  } catch (e) {
    toast("删除失败：" + (e && e.message ? e.message : e), "error");
  }
}

/* ============ 回收站 ============ */

async function actionRestore(item) {
  try {
    const target = await restoreFromTrash(item.stored);
    await loadTrash();
    await rescanAndFocus(target);
    toast("已还原到 " + target, "ok");
  } catch (e) {
    toast("还原失败：" + (e && e.message ? e.message : e), "error");
  }
}

async function actionPurge(item) {
  const name = basename(item.original);
  const go = await dangerConfirm({
    title: "彻底删除",
    message: name + "\n\n这一步会把副本从 " + TRASH_DIR + "/ 中移除，" +
      "**不可恢复**。此操作与「移入回收站」不同，请确认。",
    confirmWord: name,
    okText: "彻底删除",
    hint: "这是真删除，没有回退手段"
  });
  if (!go) return;
  try {
    await purgeTrashEntry(item.stored);
    await loadTrash();
    renderTree();
    toast("已彻底删除：" + name, "ok");
  } catch (e) {
    toast("删除失败：" + (e && e.message ? e.message : e), "error");
  }
}

function trashContextMenu(e, item) {
  const x = e ? e.clientX : 200;
  const y = e ? e.clientY : 200;
  showMenu(x, y, [
    { label: "还原到原位置", onSelect: () => actionRestore(item), hint: item.original },
    { separator: true },
    { label: "彻底删除（不可恢复）", danger: true, onSelect: () => actionPurge(item) }
  ]);
}

/* ============ 信息栏 ============ */

function updateInfo() {
  const tab = activeTab();
  const entry = tab ? state.entryMap.get(tab.path) : state.entryMap.get(state.selected);

  if (!entry && !tab) {
    els.infoEmpty.hidden = false;
    els.infoBody.hidden = true;
    return;
  }

  els.infoEmpty.hidden = true;
  els.infoBody.hidden = false;

  const path = tab ? tab.path : state.selected;
  const isDir = !tab && entry && entry.kind === "dir";

  els.infoPath.textContent = path;
  els.infoSize.textContent = tab ? humanSize(tab.size) : "—";
  els.infoLines.textContent = tab && !tab.readonly ? num(countLines(tab.content)) : "—";
  els.infoLang.textContent = isDir ? "目录" : (langKeyFor(path) || "纯文本");
  els.infoMtime.textContent = tab && tab.mtime ? fmtTime(new Date(tab.mtime)) : "—";

  els.btnRename.disabled = false;
  els.btnMove.disabled = false;
  els.btnNewFileHere.disabled = false;
  els.btnSoftDelete.disabled = !CAPABILITIES.softDelete;
}

/* ============ 打开根目录 ============ */

async function openRoot() {
  const r = await pickRoot();

  if (!r.ok) {
    if (r.reason === "abort") return;                 // 用户主动取消：静默
    if (r.reason === "nofs") {
      showEnvWarn("当前浏览器不支持文件系统访问 API", [
        tNode("本工具依赖 File System Access API，请改用"),
        bNode("Chrome / Edge"),
        tNode("等基于 Chromium 的浏览器，并通过 HTTPS 或 localhost 访问。")
      ], navigator.userAgent);
      return;
    }
    explainPickerError(r.errName || "Error", r.message || "（没有错误信息）");
    return;
  }

  hideEnvWarn();

  /* 换根：清空一切会话态 */
  closeAllTabs(true);
  state.view = "files";
  state.expanded.clear();
  state.selected = "";
  state.filter = "";
  state.showNoise = false;
  els.treeSearch.value = "";
  resetAll();

  els.empty.hidden = true;
  els.workbench.hidden = false;
  els.openBtn.hidden = false;
  els.statusbar.hidden = false;
  els.wbRoot.textContent = state.rootName;
  els.wbRoot.title = state.rootName;
  refreshPerm();

  await rescan();
  await loadTrash();
  renderTree();
  refreshStatus();
  updateInfo();

  if (!state.readwrite) toast(MSG.needRW, "error");
}

function closeAllTabs(silent) {
  state.tabs = [];
  state.activePath = "";
  if (!silent) renderTabs();
}

/* ============ 事件挂载 ============ */

/* 文件树回调 */
initTree({
  onOpenFile: (path) => { openFile(path); },
  onSelectNode: (node) => { state.selected = node.path; updateInfo(); },
  onContextMenu: (e, node) => {
    const isDir = node.kind === "dir";
    showMenu(e.clientX, e.clientY, [
      ...(isDir ? [] : [{ label: "打开", onSelect: () => openFile(node.path) }]),
      { label: isDir ? "在此新建文件" : "在同级新建文件", onSelect: () => actionNewFile(node) },
      { label: "新建文件夹", onSelect: () => actionNewFolder(node) },
      { separator: true },
      { label: "重命名…", onSelect: () => actionRename(node) },
      { label: "移动到…", onSelect: () => actionMove(node) },
      { separator: true },
      { label: "移入回收站", danger: true, hint: "可还原", onSelect: () => actionDelete(node) }
    ]);
  },
  onTrashContextMenu: (e, item) => trashContextMenu(e, item)
});

els.dropzone.addEventListener("click", openRoot);
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRoot(); }
});
els.openBtn.addEventListener("click", openRoot);
els.btnReload.addEventListener("click", async () => {
  await rescan();
  await loadTrash();
  renderTree();
  updateInfo();
  toast("已重新扫描", "ok");
});

els.noiseToggle.addEventListener("change", async () => {
  state.showNoise = els.noiseToggle.checked;
  await rescan();
  renderTree();
  updateInfo();
  toast(state.showNoise ? "已显示全部目录" : "已隐藏噪音目录", "ok");
});

/* 拖拽：明确告知无法获得写入权限，引导走「选择文件夹」 */
["dragenter", "dragover"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove("drag"); })
);
els.dropzone.addEventListener("drop", () => {
  toast("拖拽只能读取、无法保存。请点击此处用「选择文件夹」授权读写。", "error");
});

/* 文件树工具条 */
els.btnNewFile.addEventListener("click", () => actionNewFile(null));
els.btnNewFolder.addEventListener("click", () => actionNewFolder(null));

els.treeSearch.addEventListener("input", debounce(() => {
  state.filter = els.treeSearch.value.trim();
  renderTree();
}, 140));

els.btnTrash.addEventListener("click", async () => {
  if (state.view === "trash") {
    state.view = "files";
    renderTree();
    return;
  }
  await showTrashView();
});

/* 编辑器工具条 */
els.btnSave.addEventListener("click", () => saveActive());

/* 信息栏可见性：唯一的设置入口。
   以前点击与 Ctrl+B 两处各写一遍，且 Ctrl+B 漏了同步按钮的 is-active 类，
   导致「图标亮着但面板已收起」。这里收敛成一处并落盘偏好。 */
function setInfoVisible(v, { persist = true } = {}) {
  state.showInfo = !!v;
  els.paneInfo.hidden = !state.showInfo;
  els.btnToggleInfo.classList.toggle("is-active", state.showInfo);
  if (persist) setPref("info-visible", state.showInfo);
}
function toggleInfo() { setInfoVisible(!state.showInfo); }

els.btnToggleInfo.addEventListener("click", toggleInfo);

/* 信息栏动作 */
els.btnRename.addEventListener("click", () => actionRename(null));
els.btnMove.addEventListener("click", () => actionMove(null));
els.btnNewFileHere.addEventListener("click", () => actionNewFile(null));
els.btnSoftDelete.addEventListener("click", () => actionDelete(null));

/* 编辑器事件回灌 */
onSaveRequest(() => saveActive());
onDocChange(() => {
  const tab = activeTab();
  if (!tab || tab.readonly || tab.dirty) return;
  tab.dirty = true;
  renderTabs();
});

/* 全局快捷键（编辑器聚焦时由 CodeMirror 自己处理，这里只兜底） */
window.addEventListener("keydown", (e) => {
  const inEditor = els.editorHost.contains(document.activeElement);
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;

  if (e.key === "s" || e.key === "S") {
    if (inEditor) return;                     // 交给 CodeMirror，避免保存两次
    e.preventDefault();
    saveActive();
    return;
  }
  if (e.key === "w" || e.key === "W") {
    if (!state.activePath) return;
    e.preventDefault();
    closeTab(state.activePath);
    return;
  }
  if (e.key === "b" || e.key === "B") {
    e.preventDefault();
    toggleInfo();
  }
});

/* 有未保存改动时离开页面给出提示 */
window.addEventListener("beforeunload", (e) => {
  const dirty = state.tabs.filter((t) => t.dirty);
  if (!dirty.length) return;
  e.preventDefault();
  e.returnValue = "";
  return "";
});

/* 点空白处收起右键菜单（菜单模块已自处理，这里兜底编辑器区） */
els.editorHost.addEventListener("mousedown", () => hideMenu());

/* ============ Boot ============ */

initTheme();

if (!hasFSAccess()) {
  els.compat.textContent = "本工具依赖 File System Access API（需 Chromium 内核浏览器）";
  els.compat.classList.add("is-error");
  els.dropzone.classList.add("disabled");
  els.dropzone.setAttribute("aria-disabled", "true");
  showEnvWarn("当前浏览器不支持文件系统访问 API", [
    tNode("本工具直接读写本地磁盘，依赖 "),
    bNode("File System Access API"),
    tNode("。请改用 Chrome / Edge 等基于 Chromium 的浏览器，并通过 HTTPS 或 localhost 访问。")
  ], navigator.userAgent);
} else if (isEmbedded()) {
  /* 提前说清楚：不然用户点半天只会觉得「按钮坏了」 */
  els.compat.textContent = "浏览器支持文件系统访问 —— 但本页被嵌在框架中，需要独立标签页";
  els.compat.classList.add("is-error");
  showEnvWarn("本页被嵌在 iframe 里，文件系统读写很可能被浏览器拦截", [
    tNode("如果在预览面板里点「选择文件夹」没有反应，原因就在这里——Chrome 会拒绝跨域子框架调用文件系统访问 API（失败时会抛 "),
    bNode("SecurityError"),
    tNode("）。请把本页在"),
    bNode("独立标签页"),
    tNode("打开，功能完全正常。")
  ], location.href, [newTabAction()]);
} else {
  els.compat.textContent = "✓ 当前浏览器支持文件系统访问，可选择任意文件夹并授权读写";
}

els.trashDirName.textContent = TRASH_DIR;
/* 恢复用户上次的信息栏偏好（首次访问默认显示）。这里的赋值不写回存储，
   避免「只是读了默认值」也被当成用户显式选择。 */
setInfoVisible(getBoolPref("info-visible", true), { persist: false });
els.infoBody.hidden = true;
initMdMode();
renderTabs();
refreshStatus();
