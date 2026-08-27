/* ============================================================
 * tree.js — 目录树（ASCII 字符串 + DOM 渲染 + 目录首个文件索引）
 * ============================================================ */

import { escapeHTML } from "./security.js";

export function buildTreeObject(paths) {
  const root = { children: new Map() };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() });
      node = node.children.get(part);
    }
    node.isFile = true;
  }
  return root;
}

export function treeASCII(node, prefix, out) {
  const entries = [...node.children.entries()];
  entries.forEach(([name, child], i) => {
    const last = i === entries.length - 1;
    out.push(prefix + (last ? "└── " : "├── ") + name + (child.isFile ? "" : "/"));
    if (!child.isFile) treeASCII(child, prefix + (last ? "    " : "│   "), out);
  });
}

/* 目录 → 该目录下第一个文件（files 已按路径排序，首次命中即最小） */
export function buildDirFirstFile(files) {
  const m = new Map();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join("/");
      if (!m.has(dir)) m.set(dir, f.path);
    }
  }
  return m;
}

const ICON_FOLDER = '<svg class="fi" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_FILE = '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>';

/* 渲染目录树 DOM。展开/折叠在内部维护，定位行为通过 handlers 注入：
   - handlers.onFile(rel)：点击文件行
   - handlers.onDir(rel)：点击目录行（切换展开/折叠后回调） */
export function treeDOM(node, prefix, handlers) {
  prefix = prefix || "";
  const ul = document.createElement("ul");
  for (const [name, child] of node.children) {
    const rel = prefix ? prefix + "/" + name : name;
    const li = document.createElement("li");
    const row = document.createElement("div");
    if (child.isFile) {
      row.className = "tree-row is-file";
      row.dataset.path = rel;
      row.title = rel;
      row.innerHTML = ICON_FILE + '<span>' + escapeHTML(name) + "</span>";
      row.addEventListener("click", () => { if (handlers && handlers.onFile) handlers.onFile(rel); });
      li.appendChild(row);
    } else {
      row.className = "tree-row is-dir";
      row.dataset.path = rel;
      const tw = document.createElement("span");
      tw.className = "tw"; tw.textContent = "▾";
      row.innerHTML = ICON_FOLDER + '<span>' + escapeHTML(name) + "</span>";
      row.prepend(tw);
      const nested = treeDOM(child, rel, handlers);
      nested.className = "nested";
      li.appendChild(row);
      li.appendChild(nested);
      li.classList.add("open");
      row.addEventListener("click", () => {
        const open = li.classList.toggle("open");
        tw.textContent = open ? "▾" : "▸";
        if (handlers && handlers.onDir) handlers.onDir(rel);
      });
    }
    ul.appendChild(li);
  }
  return ul;
}