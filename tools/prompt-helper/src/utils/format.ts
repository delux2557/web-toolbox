// ============================================================
// 通用小工具
// ============================================================

/** 生成唯一 id（历史存档、临时字段用） */
export function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 时间戳 → "8月16日 14:30" 格式 */
export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 文件大小 → 可读格式 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 转义 XML 特殊字符（编译 XML 格式时用） */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
