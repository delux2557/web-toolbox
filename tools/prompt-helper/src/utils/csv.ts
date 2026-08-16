// ============================================================
// CSV / JSON 表格解析工具
// ------------------------------------------------------------
// 用途：用户在 textarea 里粘贴了样例数据时，自动判断它是不是
// CSV / JSON，如果是，就解析成"表格"供前端渲染预览。
// 只解析前 maxRows 行，避免数据量大时界面卡顿。
// ============================================================

export type TabularFormat = 'csv' | 'json' | null

export interface TableData {
  format: 'csv' | 'json'
  /** 表头（第一行） */
  header: string[]
  /** 数据行（最多 maxRows 行） */
  rows: string[][]
  /** 完整数据行数（预览只显示一部分，这里给总数） */
  totalRows: number
}

/** 判断一段文本是否为合法的 CSV / JSON 表格数据 */
export function detectTabular(text: string): TabularFormat {
  const t = text.trim()
  if (t === '') return null

  // JSON：以 [ 或 { 开头，且能解析成数组
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const data = JSON.parse(t)
      if (Array.isArray(data) && data.length > 0) return 'json'
    } catch {
      /* 不是 JSON，继续往下判断 */
    }
  }

  // CSV：至少 2 行，且第一行包含逗号
  const lines = t.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length >= 2 && lines[0].includes(',')) return 'csv'

  return null
}

/** 简单 CSV 解析：支持双引号包裹含逗号的字段（如 "a,b"） */
function parseCsvRows(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '')
  return lines.map((line) => {
    const cells: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (inQuote) {
        if (ch === '"') {
          // 双引号转义："" 表示一个字面双引号
          if (line[i + 1] === '"') {
            cur += '"'
            i++
          } else {
            inQuote = false
          }
        } else {
          cur += ch
        }
      } else if (ch === '"') {
        inQuote = true
      } else if (ch === ',') {
        cells.push(cur.trim())
        cur = ''
      } else {
        cur += ch
      }
    }
    cells.push(cur.trim())
    return cells
  })
}

/** 把 JSON 数据转成二维表格（对象数组 或 数组嵌套数组） */
function jsonToTable(data: unknown): string[][] | null {
  if (!Array.isArray(data) || data.length === 0) return null

  // 情况 1：对象数组 [{a:1,b:2}, ...] —— 用所有出现过的键作为表头
  if (typeof data[0] === 'object' && data[0] !== null && !Array.isArray(data[0])) {
    const headers = Array.from(new Set(data.flatMap((r) => Object.keys(r as object))))
    const rows = data.map((r) =>
      headers.map((h) => String((r as Record<string, unknown>)[h] ?? '')),
    )
    return [headers, ...rows]
  }

  // 情况 2：数组嵌套数组 [[1,2],[3,4]] —— 第一行是表头（或原样展示）
  if (data.every((r) => Array.isArray(r))) {
    return data.map((r) => (r as unknown[]).map((v) => String(v)))
  }

  return null
}

/**
 * 解析一段文本为表格数据；不是合法表格返回 null。
 * @param maxRows 最多返回多少数据行（默认 50）
 */
export function parseTabular(text: string, maxRows = 50): TableData | null {
  const format = detectTabular(text)
  if (!format) return null

  if (format === 'json') {
    const data = JSON.parse(text.trim())
    const table = jsonToTable(data)
    if (!table) return null
    const header = table[0] ?? []
    const dataRows = table.slice(1)
    return {
      format,
      header,
      rows: dataRows.slice(0, maxRows),
      totalRows: dataRows.length,
    }
  }

  const table = parseCsvRows(text)
  if (table.length < 2) return null
  const header = table[0] ?? []
  const dataRows = table.slice(1)
  return {
    format,
    header,
    rows: dataRows.slice(0, maxRows),
    totalRows: dataRows.length,
  }
}
