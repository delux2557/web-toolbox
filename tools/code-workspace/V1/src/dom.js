/* ============================================================
 * dom.js — DOM 引用集中管理（禁止在业务模块里散落 getElementById）
 * ============================================================ */

export function $(id) { return document.getElementById(id); }

export const els = {
  /* 空态 */
  empty: $("emptyState"), dropzone: $("dropzone"), compat: $("compatNote"),
  envWarn: $("envWarn"), openBtn: $("openBtn"),

  /* 工作区 */
  workbench: $("workbench"), wbRoot: $("wbRoot"), permBadge: $("permBadge"),
  btnReload: $("btnReload"), noiseToggle: $("noiseToggle"),

  /* 文件树 */
  treeRoot: $("treeRoot"), treeCount: $("treeCount"),
  btnNewFile: $("btnNewFile"), btnNewFolder: $("btnNewFolder"),
  treeSearch: $("treeSearch"), btnTrash: $("btnTrash"), trashHint: $("trashHint"),

  /* 编辑器 */
  tabBar: $("tabBar"), editorHost: $("editorHost"), editorWelcome: $("editorWelcome"),
  editorNotice: $("editorNotice"), mdPreviewPane: $("mdPreviewPane"),
  mdSeg: $("mdSeg"), mdEditBtn: $("mdEditBtn"), mdPreviewBtn: $("mdPreviewBtn"),
  btnSave: $("btnSave"), dirtyChip: $("dirtyChip"), btnToggleInfo: $("btnToggleInfo"),
  btnWrap: $("btnWrap"), btnShortcuts: $("btnShortcuts"),
  paneInfo: $("paneInfo"),

  /* 信息栏 */
  infoEmpty: $("infoEmpty"), infoBody: $("infoBody"), infoPath: $("infoPath"),
  infoSize: $("infoSize"), infoLines: $("infoLines"), infoLang: $("infoLang"),
  infoMtime: $("infoMtime"), btnRename: $("btnRename"), btnMove: $("btnMove"),
  btnNewFileHere: $("btnNewFileHere"), btnSoftDelete: $("btnSoftDelete"),
  trashDirName: $("trashDirName"),

  /* 全局 */
  statusbar: $("statusbar"), stProject: $("stProject"),
  stLog: $("stLog"), toastWrap: $("toastWrap"),
  ctxMenu: $("ctxMenu"), dialogHost: $("dialogHost"),
  themeToggle: $("themeToggle"), themeIconSun: $("themeIconSun"), themeIconMoon: $("themeIconMoon")
};
