/* ============================================================
 * filesystem.js — 文件遍历 / 读取 / 包含分类判定
 * ============================================================ */

import { getRules } from "./filters.js";
import { extOf } from "./utils.js";

/* 读取单个文件（带大小上限判断） */
async function readEntry(entry) {
  try {
    const { maxFileSize } = getRules();
    const file = entry.file ? entry.file : await entry.handle.getFile();
    if (file.size > maxFileSize) return { ok: false, reason: "size", size: file.size };
    const content = await file.text();
    return { ok: true, size: file.size, content };
  } catch (e) {
    return { ok: false, reason: "error", error: e };
  }
}

/* 目录遍历：不再按忽略目录剪枝，保留完整文件清单——
   这样后续「反忽略/放行」无需重新选文件夹即可就地重聚合 */
async function walkHandle(handle, base, out) {
  for await (const entry of handle.values()) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await walkHandle(entry, rel, out);
    } else {
      out.push({ path: rel, name: entry.name, handle: entry });
    }
  }
  return out;
}

/* 拖拽文件夹（FileSystemEntry API）辅助 */
function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const read = () => reader.readEntries((batch) => {
      if (!batch.length) { resolve(all); return; }
      all.push(...batch);
      read();
    }, reject);
    read();
  });
}

function walkEntry(entry, base, out) {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file((file) => {
        out.push({ path: base ? base + "/" + entry.name : entry.name, name: entry.name, file });
        resolve();
      }, reject);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      readAllEntries(reader).then(async (entries) => {
        for (const c of entries) await walkEntry(c, base ? base + "/" + entry.name : entry.name, out);
        resolve();
      }).catch(reject);
    } else { resolve(); }
  });
}

/* 分类判定：返回 null 表示纳入，否则为排除原因。
   优先级(高→低)：强制包含(放行) > 目录忽略 > 文件名忽略 > 内置硬规则 > 无扩展名 > 扩展名白名单
   规则对象一次取回，避免逐文件重建集合。 */
function classifyEntry(path, name, rules) {
  const lower = name.toLowerCase();
  if (rules.forceIncludeSet.has(path)) return null;              // 放行优先
  if (dirIgnored(path, rules.ignoredDirSet)) return "dir";
  if (rules.ignoredNameSet.has(lower)) return "name";
  if (/\.min\.(js|css|mjs)$/i.test(lower)) return "hard";
  if (/\.(map|d\.ts)$/i.test(lower)) return "hard";
  if (/\.lock$/i.test(lower)) return "hard";
  const ext = extOf(lower);
  if (!ext) return rules.skipNoExt ? "noext" : null;             // 无扩展名点文件
  return rules.textExtSet.has(ext) ? null : "ext";
}

function dirIgnored(path, dirSet) {
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 1; i++) if (dirSet.has(parts[i])) return true;
  return false;
}

export { readEntry, walkHandle, walkEntry, readAllEntries, classifyEntry };