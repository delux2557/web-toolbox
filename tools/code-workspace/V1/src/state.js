/* ============================================================
 * state.js — 应用可变状态（集中管理，模块间只通过此对象共享）
 * ============================================================ */

export const state = {
  /* ---- 工作区 ---- */
  rootName: "",              // 已打开根目录名
  rootHandle: null,          // FileSystemDirectoryHandle（readwrite 模式）
  readwrite: false,          // 是否真的拿到读写权限
  scanning: false,

  /* ---- 文件清单与树 ---- */
  entries: [],               // 扁平清单 [{path,name,kind,handle,parent}]
  entryMap: new Map(),       // path → entry（O(1) 查找）
  tree: null,                // 树对象 {children: Map, isFile?}
  expanded: new Set(),       // 展开的目录路径
  selected: "",              // 选中路径（文件或目录）
  filter: "",                // 文件树过滤词

  /* ---- 标签页 ---- */
  tabs: [],                  // [{path,name,content,dirty,size,mtime,readonly,error}]
  activePath: "",            // 当前激活标签的路径
  saving: false,
  opening: false,

  /* ---- 回收站（伪删除） ---- */
  trash: [],                 // [{stored, original, at}]

  /* ---- UI ---- */
  view: "files",             // 'files' | 'trash'（回收站视图）
  showNoise: false,          // 文件树是否显示 .git / node_modules 等噪音目录
  hiddenNoise: 0,            // 本次扫描被隐藏的噪音目录数（用于透明提示）
  truncated: false,          // 扫描是否因条目上限被截断
  showInfo: true,
  mdPreview: false,          // Markdown 是「预览」还是「编辑」（用户偏好，见 prefs.js）
  logLine: ""
};

/* ---- 标签页辅助 ---- */
export function findTab(path) {
  return state.tabs.find((t) => t.path === path) || null;
}

export function activeTab() {
  return findTab(state.activePath);
}

export function dirtyTabs() {
  return state.tabs.filter((t) => t.dirty);
}
