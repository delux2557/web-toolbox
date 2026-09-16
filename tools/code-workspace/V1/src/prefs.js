/* ============================================================
 * prefs.js — UI 偏好的统一持久化层
 * ------------------------------------------------------------
 * 为什么单独一个模块：
 *   信息栏是否显示、Markdown 是编辑还是预览 —— 这些都是「用户设过一次
 *   就希望一直有效」的界面偏好。之前只有主题做了持久化，其余开关刷新即丢，
 *   用户会认为是 bug。把所有偏好收敛到一处，新增偏好时只需加一个 key。
 *
 * 命名空间与容错：
 *   - key 统一加 `cw-` 前缀，避免与该站点下其他工具（codebase-context 等）撞车；
 *   - 读写全部 try/catch：隐私模式 / 禁用存储时静默降级为「本次会话内有效」，
 *     绝不因为存储不可用而让界面报错或卡住；
 *   - 值一律走 JSON，读坏了的旧值当作没写过，不抛异常。
 *
 * 例外：主题（cw-theme）仍由 theme.js 直接读写 —— 壳的首帧引导脚本
 *   需要在模块加载前就读到它，不能依赖本模块。
 * ============================================================ */

const NS = "cw-";

export function getPref(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    /* 存储不可用，或旧值不是合法 JSON → 当作用户没设过 */
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

export function getBoolPref(key, fallback) {
  const v = getPref(key, fallback);
  return typeof v === "boolean" ? v : fallback;
}
