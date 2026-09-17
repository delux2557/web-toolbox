/* ============================================================
 * shortcuts.js — 界面上的「快捷键一览」数据
 * ------------------------------------------------------------
 * 这里只放**要在弹层里展示的常用键位**，不是全部键位。
 *
 * 两种来源，别混：
 *   1) 「工作区」组 —— 本工具自己绑的，实现在 main.js / dialog.js / editor.js；
 *      改动那几处就要同步改这里（smoke.mjs 有一条契约断言盯着关键项）。
 *   2) 「编辑器」组 —— CodeMirror 6 标准 keymap 里的常用项，由离线包提供。
 *      完整清单一共 66 条（64 条来自离线包 + 2 条自加），没有全部列出来：
 *      列全了反而没人看，常用才是重点。
 *
 * 数据结构：keys 是「和弦数组」——外层每个元素是一个可选和弦，内层是同时按下的键。
 *   [[ "Ctrl", "S" ]]                  → Ctrl + S
 *   [[ "Alt", "↑" ], [ "Alt", "↓" ]]  → Alt + ↑ / Alt + ↓
 * 这样渲染时能精确地把每个键包成 <kbd>，键位里的 "/" 不会被误当成分隔符。
 * ============================================================ */

export const SHORTCUT_GROUPS = [
  {
    label: "工作区",
    rows: [
      { keys: [["Ctrl", "S"]], desc: "保存当前文件" },
      { keys: [["Ctrl", "Shift", "S"]], desc: "保存（多绑一条，防浏览器「另存为」抢键）" },
      { keys: [["Ctrl", "W"]], desc: "关闭当前标签" },
      { keys: [["Ctrl", "B"]], desc: "显示 / 隐藏信息栏" },
      { keys: [["Alt", "Z"]], desc: "自动换行开关（长行不用横向拖）" },
      { keys: [["Esc"]], desc: "关闭弹窗 / 右键菜单" },
      { keys: [["Enter"]], desc: "弹窗里确认" }
    ]
  },
  {
    label: "编辑器",
    rows: [
      { keys: [["Ctrl", "F"]], desc: "搜索" },
      { keys: [["F3"]], desc: "跳到下一个匹配" },
      { keys: [["Ctrl", "G"]], desc: "跳到指定行" },
      { keys: [["Ctrl", "Alt", "G"]], desc: "替换" },
      { keys: [["Ctrl", "D"]], desc: "选中下一个相同词" },
      { keys: [["Ctrl", "Shift", "L"]], desc: "选中所有相同词" },
      { keys: [["Ctrl", "Z"]], desc: "撤销（每个标签各自独立）" },
      { keys: [["Ctrl", "Y"]], desc: "重做" },
      { keys: [["Alt", "↑"], ["Alt", "↓"]], desc: "上下移动当前行" },
      { keys: [["Shift", "Alt", "↑"], ["Shift", "Alt", "↓"]], desc: "复制当前行" },
      { keys: [["Ctrl", "Alt", "↑"], ["Ctrl", "Alt", "↓"]], desc: "多光标：向上 / 向下加一个光标" },
      { keys: [["Ctrl", "/"]], desc: "行注释" },
      { keys: [["Alt", "A"]], desc: "块注释" },
      { keys: [["Shift", "Ctrl", "K"]], desc: "删除当前行" },
      { keys: [["Ctrl", "Shift", "["], ["Ctrl", "Shift", "]"]], desc: "折叠 / 展开" },
      { keys: [["Ctrl", "Alt", "["], ["Ctrl", "Alt", "]"]], desc: "全部折叠 / 展开" },
      { keys: [["Ctrl", "Space"]], desc: "手动触发补全" },
      { keys: [["Tab"], ["Shift", "Tab"]], desc: "缩进 / 反缩进" },
      { keys: [["Alt", "←"], ["Alt", "→"]], desc: "按语法单位左右移动光标" }
    ]
  }
];

/** 弹层底部的一句说明（免得用户以为这就是全部键位） */
export const SHORTCUT_NOTE =
  "编辑区键位来自 CodeMirror 6 的标准键位表，这里只列常用的一部分。";
