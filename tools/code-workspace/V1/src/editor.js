/* ============================================================
 * editor.js — 离线 CodeMirror 6 接入
 * ------------------------------------------------------------
 * 设计要点：
 *   1) 编辑器包走动态 import 懒加载（1.4MB，首屏不付这个代价）；
 *   2) **单 EditorView 实例 + 多 EditorState**：切标签时 setState 换文档，
 *      每个标签的撤销历史 / 光标位置 / 滚动位置都各自保留；
 *   3) 外观主题全部走 CSS 变量 + Compartment，明暗切换无需重建实例；
 *   4) 只读文件（二进制 / 超限 / 非 UTF-8）根本不进编辑器，
 *      由上层渲染提示卡片，避免解码出错后一存盘就把文件写坏。
 * ============================================================ */

import { els } from "./dom.js";
import { langKeyFor } from "./utils.js";
import { currentTheme, onThemeChange } from "./theme.js";

let CM = null;                       // vendor 包命名空间
let view = null;                     // 唯一 EditorView 实例
let loading = null;                  // 懒加载 promise（并发去重）
let saveHandler = null;              // 由 main.js 注入
let changeHandler = null;

const stash = new Map();             // path → EditorState（切标签时保存现场）
let langComp = null;                 // 语言 Compartment（CM 就绪后创建）
let hlComp = null;                   // 高亮配色 Compartment

export function isReady() { return !!view; }

export function onSaveRequest(fn) { saveHandler = fn; }
export function onDocChange(fn) { changeHandler = fn; }

/* 主题 → 代码高亮样式 */
function highlightFor(theme) {
  return CM.syntaxHighlighting(theme === "dark" ? CM.highlightDark : CM.highlightLight);
}

/* ============ 懒加载 vendor 包 ============ */

export function ensureEditor() {
  if (CM) return Promise.resolve(CM);
  if (loading) return loading;

  const url = new URL("../../vendor/codemirror/codemirror.bundle.js", import.meta.url);
  loading = import(url.href)
    .then((mod) => {
      CM = mod;
      langComp = new CM.Compartment();
      hlComp = new CM.Compartment();
      createView();
      return CM;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

/* ============ 视图创建 ============ */

function createView() {
  view = new CM.EditorView({
    state: CM.EditorState.create({ doc: "", extensions: baseExtensions() }),
    parent: els.editorHost
  });
  onThemeChange(() => {
    if (view && hlComp) view.dispatch({ effects: hlComp.reconfigure(highlightFor(currentTheme())) });
  });
}

function baseExtensions() {
  return [
    CM.lineNumbers(),
    CM.highlightActiveLineGutter(),
    CM.highlightSpecialChars(),
    CM.history(),
    CM.drawSelection(),
    CM.dropCursor(),
    CM.EditorState.allowMultipleSelections.of(true),
    CM.indentOnInput(),
    CM.bracketMatching(),
    CM.closeBrackets(),
    CM.autocompletion(),
    CM.rectangularSelection(),
    CM.crosshairCursor(),
    CM.highlightActiveLine(),
    CM.highlightSelectionMatches(),
    CM.foldGutter(),
    hlComp.of(highlightFor(currentTheme())),
    CM.keymap.of([
      { key: "Mod-s", run: () => { if (saveHandler) saveHandler(); return true; } },
      { key: "Mod-Shift-s", run: () => { if (saveHandler) saveHandler(); return true; } },
      ...CM.closeBracketsKeymap,
      ...CM.defaultKeymap,
      ...CM.searchKeymap,
      ...CM.historyKeymap,
      ...CM.foldKeymap,
      ...CM.completionKeymap,
      CM.indentWithTab
    ]),
    CM.baseTheme,
    CM.EditorView.updateListener.of((u) => {
      if (u.docChanged && changeHandler) changeHandler();
    })
  ];
}

function stateFor(tab) {
  const ext = langKeyFor(tab.path);
  return CM.EditorState.create({
    doc: tab.content,
    extensions: [langComp.of(CM.getLanguage(ext) || [])].concat(baseExtensions())
  });
}

/* ============ 文档切换 ============ */

function stashActive() {
  if (view && view.__path) stash.set(view.__path, view.state);
}

/**
 * 在编辑器里展示某个标签。只读标签不会走到这里。
 * @returns {boolean} 是否成功展示
 */
export function showTab(tab) {
  if (!CM || !view) return false;
  stashActive();

  let st = stash.get(tab.path);
  if (!st) {
    st = stateFor(tab);
    stash.set(tab.path, st);
  }
  view.setState(st);
  view.__path = tab.path;

  els.editorWelcome.hidden = true;
  /* 必须同时收掉只读提示卡片：否则打开过 .rar 这类二进制文件后，
     再切到普通文本文件，上一个文件的「· 只读」提示会一直挂在那儿。 */
  els.editorNotice.hidden = true;
  els.editorHost.hidden = false;

  requestAnimationFrame(() => view.requestMeasure());
  return true;
}

/* 从编辑器同步回 tab.content（保存前 / 切走前调用） */
export function pullContent(tab) {
  if (!CM || !view || !tab || view.__path !== tab.path) return null;
  return view.state.doc.toString();
}

/* 丢弃某标签的编辑器现场（关闭标签 / 文件被外部改动后重载） */
export function dropTabState(path) {
  stash.delete(path);
  if (view && view.__path === path) {
    view.setState(CM.EditorState.create({ doc: "", extensions: baseExtensions() }));
    view.__path = null;
  }
}

/* 整棵树重扫后清空所有现场 */
export function resetAll() {
  stash.clear();
  if (view) {
    view.setState(CM.EditorState.create({ doc: "", extensions: baseExtensions() }));
    view.__path = null;
  }
  if (els.editorHost) els.editorHost.hidden = true;
  if (els.editorWelcome) els.editorWelcome.hidden = false;
}

/* 命令：给当前文档重新套用语言（文件被重命名改扩展名后调用） */
export function reapplyLanguage(tab) {
  if (!CM || !view || !tab || view.__path !== tab.path) return;
  const ext = langKeyFor(tab.path);
  view.dispatch({ effects: langComp.reconfigure(CM.getLanguage(ext) || []) });
}

export function focusEditor() {
  if (view) view.focus();
}
