/* ============================================================
 * security.js — 注入防护
 * ------------------------------------------------------------
 * 约定：任何「用户可控文本」（文件名、路径、文件内容、目录名）写入
 * innerHTML 前必须经过 escapeHTML / escapeAttr 之一。
 *
 * 本工具的风险面比纯展示类工具更大（可写盘、可新建任意名文件），
 * 因此额外提供 safeName()：
 *   1) 拒绝路径分隔符与 .. —— 防止越出用户已授权的目录范围；
 *   2) 拒绝 Windows 保留名（CON / PRN / AUX / NUL / COM1-9 / LPT1-9）；
 *   3) 拒绝控制字符与结尾的点 / 空格（Windows 上会被静默截断，
 *      导致 UI 显示名与实际落盘名不一致）。
 * ============================================================ */

export function escapeHTML(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function escapeAttr(s) {
  return escapeHTML(s);
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/* eslint-disable-next-line no-control-regex */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 校验并规范化用户输入的名称（文件或文件夹，不含路径）。
 * @returns {{ ok: true, name: string } | { ok: false, reason: string }}
 */
export function safeName(raw) {
  const name = String(raw == null ? "" : raw).trim();
  if (!name) return { ok: false, reason: "名称不能为空" };
  if (name === "." || name === "..") return { ok: false, reason: "名称不能是 . 或 .." };
  if (/[\\/]/.test(name)) return { ok: false, reason: "名称不能包含路径分隔符 / 或 \\" };
  if (CONTROL_CHARS.test(name)) return { ok: false, reason: "名称不能包含控制字符" };
  if (WIN_RESERVED.test(name)) return { ok: false, reason: "「" + name + "」是系统保留名称" };
  if (/[. ]$/.test(name)) return { ok: false, reason: "名称不能以空格或点号结尾" };
  if (name.length > 200) return { ok: false, reason: "名称过长（上限 200 字符）" };
  return { ok: true, name };
}

/* 路径工具：全部基于「以 / 分隔的相对路径」约定，不接受绝对路径与 .. 段 */
export function isSafePath(p) {
  if (typeof p !== "string" || !p) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split("/");
  return parts.every((seg) => seg && seg !== "." && seg !== "..");
}

export function joinPath(dir, name) {
  return dir ? dir + "/" + name : String(name);
}

export function dirname(p) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function basename(p) {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}
