/* ============================================================
 * menu.js — 右键上下文菜单
 * ------------------------------------------------------------
 * 用法：showMenu(clientX, clientY, [{label, danger, disabled, hint, onSelect}, ...])
 * 说明：
 *   - 菜单项文本一律走 textContent 赋值，不做 HTML 拼接；
 *   - 全局关闭监听器只在模块加载时注册一次，靠 hidden 状态短路，
 *     避免每次弹菜单都往 document 上叠一个监听器（内存泄漏）。
 * ============================================================ */

import { els } from "./dom.js";

let open = false;

export function hideMenu() {
  if (!open) return;
  open = false;
  els.ctxMenu.hidden = true;
  els.ctxMenu.innerHTML = "";
  els.ctxMenu.style.left = "0px";
  els.ctxMenu.style.top = "0px";
}

/* 全局监听：菜单未打开时立即返回，零开销 */
function onGlobalDown(e) {
  if (!open) return;
  if (!els.ctxMenu.contains(e.target)) hideMenu();
}
function onGlobalKey(e) {
  if (open && e.key === "Escape") hideMenu();
}

document.addEventListener("mousedown", onGlobalDown, true);
document.addEventListener("keydown", onGlobalKey);
window.addEventListener("blur", hideMenu);
window.addEventListener("resize", hideMenu);
document.addEventListener("scroll", hideMenu, true);

export function showMenu(x, y, items) {
  hideMenu();
  const menu = els.ctxMenu;

  for (const it of items) {
    if (!it || it.separator) {
      const sep = document.createElement("div");
      sep.className = "ctx-sep";
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctx-item" + (it.danger ? " danger" : "");
    btn.textContent = it.label;
    if (it.hint) {
      const h = document.createElement("span");
      h.className = "ctx-hint";
      h.textContent = it.hint;
      btn.appendChild(h);
    }
    if (it.disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        const run = it.onSelect;
        hideMenu();
        if (run) run();
      });
    }
    menu.appendChild(btn);
  }

  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.hidden = false;
  open = true;

  /* 先量尺寸再定位置，保证不溢出视口 */
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(4, Math.min(x, maxX)) + "px";
  menu.style.top = Math.max(4, Math.min(y, maxY)) + "px";
}
