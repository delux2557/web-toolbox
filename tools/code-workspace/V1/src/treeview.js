/* ============================================================
 * treeview.js — 文件树 / 回收站视图渲染与交互
 * ------------------------------------------------------------
 * 渲染策略：只渲染「已展开」的层级（从树对象增量展开），
 * 而不是把 2 万条路径一次性铺成 DOM —— 大目录下这是可用性的分水岭。
 * ============================================================ */

import { els } from "./dom.js";
import { state } from "./state.js";
import { escapeHTML } from "./security.js";
import { basename, dirname } from "./security.js";
import { loadTrash } from "./fsrepo.js";

let H = {};   // 由 main.js 注入的回调

export function initTree(handlers) { H = handlers || {}; }

/* ============ 树对象 ============ */

export function buildTree(entries) {
  const root = { children: new Map() };
  for (const e of entries) {
    const parts = e.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map(), path: parts.slice(0, i + 1).join("/") });
      }
      node = node.children.get(part);
    }
    node.isFile = e.kind === "file";
  }
  return root;
}

/* 目录优先 + 自然序排序 */
function sortedChildren(node) {
  return [...node.children.entries()].sort((a, b) => {
    const ad = !a[1].isFile, bd = !b[1].isFile;
    if (ad !== bd) return ad ? -1 : 1;
    return a[0].localeCompare(b[0], "zh-CN", { numeric: true, sensitivity: "base" });
  });
}

/* ============ 图标 ============ */

const ICON_DIR = '<svg class="fi dir" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_FILE = '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>';
const ICON_TRASH = '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>';

/* ============ 渲染 ============ */

function rowEl({ path, name, kind, depth, title }) {
  const row = document.createElement("div");
  row.className = "tree-row" + (kind === "dir" ? " is-dir" : " is-file");
  row.dataset.path = path;
  row.style.paddingLeft = 8 + depth * 14 + "px";
  row.title = title || path;
  row.innerHTML = (kind === "dir" ? ICON_DIR : ICON_FILE) + "<span>" + escapeHTML(name) + "</span>";
  return row;
}

function renderNode(node, depth, frag) {
  for (const [name, child] of sortedChildren(node)) {
    const path = child.path;
    if (child.isFile) {
      const row = rowEl({ path, name, kind: "file", depth });
      if (path === state.selected) row.classList.add("selected");
      if (path === state.activePath) row.classList.add("active");
      row.addEventListener("click", () => H.onOpenFile && H.onOpenFile(path));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        H.onContextMenu && H.onContextMenu(e, { path, name, kind: "file" });
      });
      frag.appendChild(row);
    } else {
      const open = state.expanded.has(path);
      const row = rowEl({ path, name, kind: "dir", depth });
      const tw = document.createElement("span");
      tw.className = "tw";
      tw.textContent = open ? "▾" : "▸";
      row.prepend(tw);
      if (path === state.selected) row.classList.add("selected");
      row.addEventListener("click", () => {
        if (open) state.expanded.delete(path);
        else state.expanded.add(path);
        H.onSelectNode && H.onSelectNode({ path, name, kind: "dir" });
        renderTree();
      });
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        H.onContextMenu && H.onContextMenu(e, { path, name, kind: "dir" });
      });
      frag.appendChild(row);
      if (open) renderNode(child, depth + 1, frag);
    }
  }
}

function renderFiltered() {
  const q = state.filter.toLowerCase();
  const matches = state.entries
    .filter((e) => e.kind === "file" && e.path.toLowerCase().includes(q))
    .sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }));

  const frag = document.createDocumentFragment();
  const LIMIT = 400;
  const shown = matches.slice(0, LIMIT);

  const head = document.createElement("div");
  head.className = "tree-hint";
  head.textContent = matches.length > LIMIT
    ? `匹配 ${matches.length} 个文件，仅显示前 ${LIMIT} 个`
    : `匹配 ${matches.length} 个文件`;
  frag.appendChild(head);

  for (const m of shown) {
    const row = rowEl({ path: m.path, name: m.path, kind: "file", depth: 0, title: m.path });
    if (m.path === state.activePath) row.classList.add("active");
    row.addEventListener("click", () => H.onOpenFile && H.onOpenFile(m.path));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      H.onContextMenu && H.onContextMenu(e, { path: m.path, name: m.name, kind: "file" });
    });
    frag.appendChild(row);
  }
  return frag;
}

function renderTrash() {
  const frag = document.createDocumentFragment();
  if (!state.trash.length) {
    const empty = document.createElement("div");
    empty.className = "tree-hint";
    empty.textContent = "回收站是空的。用「移入回收站」删除的文件会出现在这里，可随时还原。";
    frag.appendChild(empty);
    return frag;
  }

  const head = document.createElement("div");
  head.className = "tree-hint";
  head.textContent = `共 ${state.trash.length} 项 · 右键可还原或彻底删除`;
  frag.appendChild(head);

  for (const item of state.trash.slice().reverse()) {
    const row = document.createElement("div");
    row.className = "tree-row is-file trash-row";
    row.title = item.original;
    row.innerHTML = ICON_TRASH +
      '<span class="trash-name">' + escapeHTML(basename(item.original)) + "</span>" +
      '<span class="trash-orig">' + escapeHTML(dirname(item.original) || "（根目录）") + "</span>";
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      row.classList.add("selected");
      H.onTrashContextMenu && H.onTrashContextMenu(e, item);
    });
    row.addEventListener("click", () => {
      els.treeRoot.querySelectorAll(".tree-row.selected").forEach((n) => n.classList.remove("selected"));
      row.classList.add("selected");
    });
    frag.appendChild(row);
  }
  return frag;
}

export function renderTree() {
  const frag = document.createDocumentFragment();

  if (state.view === "trash") {
    frag.appendChild(renderTrash());
  } else if (state.filter) {
    frag.appendChild(renderFiltered());
  } else {
    if (!state.tree) return;
    renderNode(state.tree, 0, frag);
    if (!frag.childNodes.length) {
      const empty = document.createElement("div");
      empty.className = "tree-hint";
      empty.textContent = "这个文件夹是空的。";
      frag.appendChild(empty);
    }
  }

  els.treeRoot.innerHTML = "";
  els.treeRoot.appendChild(frag);

  const fileCount = state.entries.filter((e) => e.kind === "file").length;
  const dirCount = state.entries.length - fileCount;
  els.treeCount.textContent = state.view === "trash"
    ? state.trash.length + " 项"
    : fileCount + " 文件 · " + dirCount + " 目录";

  if (state.view === "trash") els.btnTrash.classList.add("is-active");
  else els.btnTrash.classList.remove("is-active");
}

/* ============ 展开 / 定位 ============ */

export function expandTo(path) {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    state.expanded.add(parts.slice(0, i).join("/"));
  }
}

export function isExpanded(path) { return state.expanded.has(path); }

/* 展开到某路径并滚动到可视区 */
export function revealPath(path) {
  if (state.view !== "files") return;
  state.filter = "";
  els.treeSearch.value = "";
  expandTo(path);
  renderTree();
  requestAnimationFrame(() => {
    const el = els.treeRoot.querySelector('.tree-row[data-path="' + cssEscape(path) + '"]');
    if (el) el.scrollIntoView({ block: "center" });
  });
}

/* 属性选择器里路径含引号 / 反斜杠时需要转义；用 CSS.escape 兜底 */
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, "\\$&");
}

/* 折叠全部（保留根层） */
export function collapseAll() {
  state.expanded.clear();
  renderTree();
}

/* 把回收站列表拉起来并切到回收站视图 */
export async function showTrashView() {
  await loadTrash();
  state.view = "trash";
  renderTree();
}
