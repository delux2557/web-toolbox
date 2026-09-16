/* ============================================================
 * fsrepo.js — 文件系统访问层（读 / 写 / 增 / 删 / 移）
 * ------------------------------------------------------------
 * 【本文件的两条硬约束，改代码前务必先读】
 *
 * 1) File System Access API **没有 rename / move 原语**。
 *    只有 getDirectoryHandle / getFileHandle / removeEntry / createWritable。
 *    因此「重命名」「移动」「伪删除」本质上都是：
 *        在目标位置写出副本 → removeEntry 掉原路径
 *    副本先落地，才保证了「移入回收站」是可恢复的。
 *
 * 2) 删除只有一种底层手段：removeEntry(recursive)。
 *    所以「伪删除 vs 真删除」的差别不在用哪个 API，而在于
 *    **是否先把副本写进回收站**。差异被收敛到唯一的出口 deleteEntry()
 *    上，通过 DELETE_MODE 常量切换：
 *        'trash'     → 写副本到 .cw-trash/ 再移除原路径（一期默认，可还原）
 *        'permanent' → 直接移除原路径（不可恢复，一期不在 UI 暴露）
 *    将来要上真删除：把 DELETE_MODE 改成 'permanent'，其余代码零改动。
 * ============================================================ */

import {
  TRASH_DIR, TRASH_INDEX, MAX_SCAN_ENTRIES, MAX_DEPTH, MAX_EDIT_BYTES
} from "./constants.js";
import { safeName, isSafePath, joinPath, dirname, basename } from "./security.js";
import { state } from "./state.js";
import { stamp } from "./utils.js";

/* ---- 删除策略开关（唯一需要改的地方） ---- */
export const DELETE_MODE = "trash";   // 'trash' | 'permanent'
export const CAPABILITIES = {
  softDelete: true,      // 回收站可用
  hardDelete: false,     // 真删除：能力预留，UI 未接入
  restore: true          // 回收站还原
};

/* 目录扫描时默认隐藏的噪音目录（可在 UI 上切换） */
export const NOISE_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox",
  ".gradle", ".idea", ".DS_Store"
]);

export function hasFSAccess() {
  return window.isSecureContext && typeof window.showDirectoryPicker === "function";
}

/* ============ 句柄解析 ============ */

/* 相对路径 → 目录句柄（create=true 时逐级创建） */
export async function getDirHandle(path, { create = false } = {}) {
  if (!state.rootHandle) throw new Error("尚未打开根目录");
  if (path && !isSafePath(path)) throw new Error("非法路径：" + path);
  let dir = state.rootHandle;
  if (!path) return dir;
  const parts = path.split("/");
  if (parts.length > MAX_DEPTH) throw new Error("目录层级过深");
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(seg, { create });
  }
  return dir;
}

/* 相对路径 → 文件句柄 */
export async function getFileHandle(path, { create = false } = {}) {
  if (!isSafePath(path)) throw new Error("非法路径：" + path);
  const dir = await getDirHandle(dirname(path), { create });
  return dir.getFileHandle(basename(path), { create });
}

async function exists(path) {
  try {
    await getFileHandle(path);
    return true;
  } catch (e) {
    if (e && (e.name === "NotFoundError" || e.name === "TypeMismatchError")) return false;
    throw e;
  }
}

async function existsDir(path) {
  try {
    await getDirHandle(path);
    return true;
  } catch (e) {
    if (e && (e.name === "NotFoundError" || e.name === "TypeMismatchError")) return false;
    throw e;
  }
}

/* ============ 打开根目录 + 权限 ============ */

/**
 * 弹出目录选择器并确保拿到读写权限。
 * @returns {Promise<{ok:boolean, name?:string, readwrite?:boolean, reason?:string, errName?:string, message?:string}>}
 *   reason: 'abort'（用户取消）| 'nofs'（浏览器不支持）| 'blocked'（浏览器拒绝调用）
 */
export async function pickRoot() {
  if (!hasFSAccess()) return { ok: false, reason: "nofs" };

  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "cw-root", mode: "readwrite" });
  } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, reason: "abort" };
    /* 这里拿到的是真正的原因，必须原样带出去给上层展示——
       最常见的是 SecurityError：跨域 iframe 里 Chrome 会直接拒绝文件系统访问 */
    return {
      ok: false,
      reason: "blocked",
      errName: e && e.name ? e.name : "Error",
      message: e && e.message ? e.message : String(e)
    };
  }

  const granted = await ensurePermission(handle, "readwrite");
  state.rootHandle = handle;
  state.rootName = handle.name;
  state.readwrite = granted;
  return { ok: true, name: handle.name, readwrite: granted };
}

/**
 * 确保句柄具备指定权限；必要时弹出授权提示（需要用户手势上下文）。
 */
export async function ensurePermission(handle, mode = "readwrite") {
  if (!handle || typeof handle.queryPermission !== "function") return true;
  const opts = { mode };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if ((await handle.requestPermission(opts)) === "granted") return true;
  } catch (_) { /* 不支持权限 API 的浏览器：按 granted 处理 */ }
  return false;
}

/* ============ 遍历 ============ */

/**
 * 递归列目录。
 * @param {boolean} showAll 是否连 .git / node_modules 等噪音目录一起列
 * @returns {Promise<{entries:Array, hidden:number, truncated:boolean}>}
 */
export async function walk(showAll = false) {
  const entries = [];
  let hidden = 0;
  let truncated = false;

  async function rec(dirHandle, base, depth) {
    if (truncated) return;
    if (depth > MAX_DEPTH) return;
    const dirs = [];
    for await (const entry of dirHandle.values()) {
      if (entries.length >= MAX_SCAN_ENTRIES) { truncated = true; return; }
      const rel = joinPath(base, entry.name);
      if (entry.kind === "directory") {
        if (!showAll && NOISE_DIRS.has(entry.name)) { hidden++; continue; }
        entries.push({ path: rel, name: entry.name, kind: "dir", parent: base });
        dirs.push([entry, rel]);
      } else {
        entries.push({ path: rel, name: entry.name, kind: "file", parent: base });
      }
    }
    for (const [h, rel] of dirs) {
      if (truncated) return;
      await rec(h, rel, depth + 1);
    }
  }

  await rec(state.rootHandle, "", 0);
  return { entries, hidden, truncated };
}

/* ============ 读 ============ */

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * 读取文本。返回结构：
 *   { ok:true, content, size, mtime, bom }
 *   { ok:false, reason:'size'|'binary'|'encoding'|'missing'|'denied'|'error',
 *     size?, error?, errName?, errMsg? }
 *
 * 【为什么一定要带 errName / errMsg 出去】
 * 之前只返回粗粒度的 reason，UI 只能显示「无法读取这个文件。」——
 * 用户看到等于没看到，排查时也只能靠猜。失败原因必须原样透出到界面上。
 */
export async function readFileText(path) {
  try {
    const fh = await getFileHandle(path);
    const file = await fh.getFile();
    if (file.size > MAX_EDIT_BYTES) return { ok: false, reason: "size", size: file.size };

    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8192));
    for (let i = 0; i < head.length; i++) {
      if (head[i] === 0) return { ok: false, reason: "binary", size: file.size };
    }

    let bom = false;
    let bytes = new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      bom = true;
      bytes = bytes.subarray(3);
    }

    let content;
    try {
      content = utf8.decode(bytes);
    } catch (_) {
      return { ok: false, reason: "encoding", size: file.size };
    }

    return { ok: true, content, size: file.size, mtime: file.lastModified, bom };
  } catch (e) {
    const errName = (e && e.name) ? e.name : "Error";
    const errMsg = (e && e.message) ? e.message : String(e);
    /* NotAllowedError 单列一类：它和权限有关，处置办法跟「文件坏了」完全不同 */
    const reason = errName === "NotFoundError" ? "missing"
                 : errName === "NotAllowedError" ? "denied"
                 : "error";
    return { ok: false, reason, error: e, errName, errMsg };
  }
}

/* ============ 写 ============ */

/**
 * 写回文本（原路径覆盖写）。
 * @param {string} path
 * @param {string} content
 * @param {boolean} bom 是否保留 UTF-8 BOM（读时记录，写时还原）
 */
export async function writeFileText(path, content, bom = false) {
  const fh = await getFileHandle(path, { create: true });
  const w = await fh.createWritable();
  try {
    if (bom) await w.write(new Uint8Array([0xef, 0xbb, 0xbf]));
    await w.write(content);
  } catch (e) {
    try { await w.abort(); } catch (_) {}
    throw e;
  }
  await w.close();
}

/* ============ 新建 ============ */

export async function createFile(parentPath, name) {
  const chk = safeName(name);
  if (!chk.ok) throw new Error(chk.reason);
  const path = joinPath(parentPath, chk.name);
  if (await existsDir(path)) throw new Error("同名文件夹已存在");
  if (await exists(path)) throw new Error("同名文件已存在");
  await writeFileText(path, "", false);
  return path;
}

export async function createFolder(parentPath, name) {
  const chk = safeName(name);
  if (!chk.ok) throw new Error(chk.reason);
  const path = joinPath(parentPath, chk.name);
  if (await exists(path)) throw new Error("同名文件已存在");
  if (await existsDir(path)) throw new Error("同名文件夹已存在");
  await getDirHandle(path, { create: true });
  return path;
}

/* ============ 移动 / 重命名（= 复制 + 移除原路径） ============ */

/* 逐级复制文件：以 Blob 直接写入，不解码文本，二进制文件同样安全。
   （不用 stream().pipeTo()：pipeTo 会自行 close 目标流，关闭时机不可控） */
async function copyFileInto(srcPath, destPath) {
  const srcFh = await getFileHandle(srcPath);
  const srcFile = await srcFh.getFile();
  const destFh = await getFileHandle(destPath, { create: true });
  const w = await destFh.createWritable();
  try {
    await w.write(srcFile);
  } catch (e) {
    try { await w.abort(); } catch (_) {}
    throw e;
  }
  await w.close();
}

async function copyDirInto(srcDirPath, destDirPath, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error("目录层级过深，已中止");
  await getDirHandle(destDirPath, { create: true });
  const srcDir = await getDirHandle(srcDirPath);
  for await (const entry of srcDir.values()) {
    const from = joinPath(srcDirPath, entry.name);
    const to = joinPath(destDirPath, entry.name);
    if (entry.kind === "directory") await copyDirInto(from, to, depth + 1);
    else await copyFileInto(from, to);
  }
}

/**
 * 把 srcPath 整体复制到 destDirPath 下，名字可指定。
 * @returns {Promise<string>} 目标完整路径
 */
export async function copyEntry(srcPath, destDirPath, destName) {
  const name = destName || basename(srcPath);
  const chk = safeName(name);
  if (!chk.ok) throw new Error(chk.reason);
  const target = joinPath(destDirPath, chk.name);
  if (target === srcPath) throw new Error("目标与源相同");
  if (await exists(target)) throw new Error("目标位置已存在同名文件");
  if (await existsDir(target)) throw new Error("目标位置已存在同名文件夹");

  const isDir = await existsDir(srcPath);
  if (isDir) await copyDirInto(srcPath, target);
  else await copyFileInto(srcPath, target);
  return target;
}

/* 移除单个路径（recursive 对文件无副作用；对目录是递归删除） */
async function removeEntry(path) {
  const parent = await getDirHandle(dirname(path));
  await parent.removeEntry(basename(path), { recursive: true });
}

/**
 * 移动 / 重命名。语义等价：复制到目标 → 移除原路径。
 * @param {string} srcPath
 * @param {string} destDirPath 目标目录（重命名时传原目录）
 * @param {string} newName     目标文件名（可选，默认沿用原名）
 * @returns {Promise<string>} 新路径
 */
export async function moveEntry(srcPath, destDirPath, newName) {
  if (destDirPath === srcPath || destDirPath.startsWith(srcPath + "/")) {
    throw new Error("不能移动到自身或其子目录");
  }
  const target = await copyEntry(srcPath, destDirPath, newName);
  try {
    await removeEntry(srcPath);
  } catch (e) {
    /* 复制成功但原文件删除失败 → 回滚目标副本，避免留下重复文件造成困惑 */
    try { await removeEntry(target); } catch (_) {}
    throw new Error("原路径移除失败，已回滚：" + (e && e.message ? e.message : e));
  }
  return target;
}

/* ============ 回收站（伪删除） ============ */

function trashUniqueName(name) {
  const used = new Set(state.trash.map((t) => t.stored));
  let candidate = stamp() + "__" + name;
  let i = 2;
  while (used.has(candidate)) candidate = stamp() + "-" + i++ + "__" + name;
  return candidate;
}

async function readTrashIndex() {
  try {
    const r = await readFileText(joinPath(TRASH_DIR, TRASH_INDEX));
    if (!r.ok) return [];
    const list = JSON.parse(r.content);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

async function writeTrashIndex(list) {
  await getDirHandle(TRASH_DIR, { create: true });
  await writeFileText(joinPath(TRASH_DIR, TRASH_INDEX), JSON.stringify(list, null, 2), false);
}

export async function loadTrash() {
  state.trash = await readTrashIndex();
  return state.trash;
}

/**
 * 删除的唯一出口。删除策略由 DELETE_MODE 决定。
 * @param {string} path
 * @param {{mode?: 'trash'|'permanent'}} opt
 * @returns {Promise<{mode:string, stored?:string}>}
 */
export async function deleteEntry(path, opt = {}) {
  const mode = opt.mode || DELETE_MODE;

  /* 真删除分支：能力已预留，UI 一期不暴露。
     上线时只需把 DELETE_MODE 改成 'permanent'（并调整确认文案）。 */
  if (mode === "permanent") {
    await removeEntry(path);
    return { mode: "permanent" };
  }

  const name = basename(path);
  const stored = trashUniqueName(name);
  await getDirHandle(TRASH_DIR, { create: true });
  const storedPath = joinPath(TRASH_DIR, stored);

  /* 先落地副本，再移除原路径 —— 顺序不能反，否则就不是「伪删除」了 */
  await copyEntry(path, TRASH_DIR, stored);

  try {
    await removeEntry(path);
  } catch (e) {
    try { await removeEntry(storedPath); } catch (_) {}
    throw new Error("原路径移除失败，已回滚：" + (e && e.message ? e.message : e));
  }

  const list = await readTrashIndex();
  list.push({ stored, original: path, at: new Date().toISOString() });
  await writeTrashIndex(list);
  state.trash = list;

  return { mode: "trash", stored };
}

/**
 * 从回收站还原到原路径（原路径已存在时改名避让，不覆盖用户文件）。
 * @returns {Promise<string>} 还原后的路径
 */
export async function restoreFromTrash(stored) {
  const list = await readTrashIndex();
  const item = list.find((t) => t.stored === stored);
  if (!item) throw new Error("回收站索引中找不到该条目");

  const storedPath = joinPath(TRASH_DIR, stored);
  const original = item.original;
  const destDir = dirname(original);

  let name = basename(original);
  if (await exists(original)) name = "restored-" + stamp() + "-" + name;

  const target = await copyEntry(storedPath, destDir, name);
  await removeEntry(storedPath);

  const rest = list.filter((t) => t.stored !== stored);
  await writeTrashIndex(rest);
  state.trash = rest;

  return target;
}

/* 清空回收站里的一条（这一步才是真删除，UI 上仍需二次确认） */
export async function purgeTrashEntry(stored) {
  const storedPath = joinPath(TRASH_DIR, stored);
  await removeEntry(storedPath);
  const list = await readTrashIndex();
  const rest = list.filter((t) => t.stored !== stored);
  await writeTrashIndex(rest);
  state.trash = rest;
}

/* ============ 元信息 ============ */

export async function getMeta(path) {
  try {
    const fh = await getFileHandle(path);
    const f = await fh.getFile();
    return { size: f.size, mtime: f.lastModified };
  } catch (_) {
    return { size: null, mtime: null };
  }
}
