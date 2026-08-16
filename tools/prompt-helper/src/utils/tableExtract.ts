// ============================================================
// 表格解析纯函数（从 小工具-原版/table助手-v2.html 迁移）
// ------------------------------------------------------------
// 只放"纯逻辑"：解析 HTML 表格 → 结构化数据、CSV/JSON 序列化、
// 追加合并、示例数据。不碰 DOM 渲染（那是组件的活）。
// 抽出来是为了：可单元测试、组件保持轻量、未来可复用。
// 核心算法与原版完全一致，只做了类型化 + 函数签名化（不再依赖全局状态）。
// ============================================================

// ---------- 类型 ----------
export interface TableData {
  source: string
  columns: string[]
  rows: string[][]
}

// ---------- 常量 ----------
const SKIP_KEYWORDS = ['checkbox', 'selection', 'operation', 'action']
export const PREVIEW_LIMIT = 200

// ---------- 表格元素工具 ----------
function isHiddenEl(el: Element | null): boolean {
  if (!el || !el.getAttribute) return false
  if (el.hasAttribute('hidden')) return true
  const s = (el.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase()
  return s.includes('display:none') || s.includes('visibility:hidden')
}

function isSkipCell(el: Element | null): boolean {
  if (!el) return false
  if (isHiddenEl(el)) return true
  const cls = (el.getAttribute('class') || '').toLowerCase()
  return SKIP_KEYWORDS.some((k) => cls.includes(k))
}

function cellText(el: Element): string {
  return (el.textContent || '').replace(/\s+/g, ' ').trim()
}

function rowCells(tr: Element): Element[] {
  return Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
}

// ---------- 核心：表格提取（识别表头、跳过隐藏/功能列） ----------
export function extractTableData(table: Element): TableData {
  const allRows = Array.from(table.querySelectorAll('tr'))
  const thead = table.querySelector('thead')
  let headerRow: Element | null = null
  let bodyRows: Element[] = []
  let useDataFieldAsColumns = false // 标记是否从 data-field 提取列名

  // 1. 优先从 <thead> 取表头
  if (thead && thead.querySelector('tr')) {
    headerRow = thead.querySelector('tr')!
    bodyRows = Array.from(table.querySelectorAll('tbody tr'))
    if (!bodyRows.length) bodyRows = allRows.filter((tr) => !thead.contains(tr))
  }
  // 2. 没有 <thead>，但存在含 <th> 的行
  else {
    const first = allRows[0]
    if (first && first.querySelector('th')) {
      headerRow = first
      bodyRows = allRows.slice(1)
    }
    // 3. 智能兜底：检测第一行
    else if (first) {
      const cells = rowCells(first)
      const hasFields = cells.some((c) => (c.getAttribute('data-field') || '').trim() !== '')
      const hasNumeric = cells.some((c) => /^\d+$/.test(cellText(c).trim()))

      if (hasFields) {
        // 有 data-field：不作为表头，而是作为数据行，列名从 data-field 提取
        useDataFieldAsColumns = true
        headerRow = null
        bodyRows = allRows // 所有行都是数据行
      } else if (!hasNumeric) {
        headerRow = first
        bodyRows = allRows.slice(1)
      } else {
        headerRow = null
        bodyRows = allRows
      }
    } else {
      bodyRows = []
    }
  }

  // 过滤隐藏行、全空行（表头行不进入数据行）
  bodyRows = bodyRows.filter((tr) => {
    if (isHiddenEl(tr)) return false
    const cells = rowCells(tr)
    return cells.length && cells.some((c) => cellText(c) !== '')
  })

  // 如果使用 data-field 作为列名，从第一行提取字段名
  let columns: string[] = []
  if (useDataFieldAsColumns && bodyRows.length > 0) {
    const sampleRow = bodyRows[0]!
    const cells = rowCells(sampleRow)
    const skip = new Set<number>()
    cells.forEach((cell, i) => {
      if (isSkipCell(cell)) skip.add(i)
    })
    const keepIdx = Array.from({ length: cells.length }, (_, i) => i).filter((i) => !skip.has(i))
    columns = keepIdx.map((i) => {
      const field = cells[i]!.getAttribute('data-field') || ''
      return field.trim() || '列' + (i + 1)
    })
    const rows = bodyRows.map((tr) => {
      const tds = rowCells(tr)
      return keepIdx.map((i) => (tds[i] ? cellText(tds[i]!) : ''))
    })
    return { source: 'html', columns, rows }
  }

  // 常规处理：使用 headerRow 或回退列名
  const headerCells = headerRow ? rowCells(headerRow) : []
  const rawColCount = headerRow
    ? headerCells.length
    : bodyRows.length
      ? rowCells(bodyRows[0]!).length
      : 0

  const firstBodyCells = bodyRows.length ? rowCells(bodyRows[0]!) : []
  const skip = new Set<number>()
  for (let i = 0; i < rawColCount; i++) {
    if (isSkipCell(headerCells[i] ?? null) || isSkipCell(firstBodyCells[i] ?? null)) skip.add(i)
  }
  const keepIdx = Array.from({ length: rawColCount }, (_, i) => i).filter((i) => !skip.has(i))

  columns = headerRow
    ? keepIdx.map((i, n) => {
        const c = headerCells[i]
        const field = c ? (c.getAttribute('data-field') || '').trim() : ''
        return field || cellText(c!) || '列' + (n + 1)
      })
    : keepIdx.map((_, n) => '列' + (n + 1))

  const rows = bodyRows.map((tr) => {
    const cells = rowCells(tr)
    return keepIdx.map((i) => (cells[i] ? cellText(cells[i]!) : ''))
  })

  return { source: 'html', columns, rows }
}

/** 生成"表格来源"下拉选项的标签（表格序号 + 行列数 + class） */
export function tableMeta(t: Element, i: number): string {
  const trs = Array.from(t.querySelectorAll('tr'))
  const cols = Math.max(...trs.slice(0, 3).map((tr) => tr.children.length))
  const cls = (t.getAttribute('class') || '').trim()
  let label = '表格' + (i + 1) + ' · ' + trs.length + '行×' + cols + '列'
  if (cls) label += ' · class="' + (cls.length > 24 ? cls.slice(0, 24) + '…' : cls) + '"'
  return label
}

// ---------- 适配器（架构预留：JSON 数据源二期） ----------
export class HtmlTableAdapter {
  /** 安全解析：DOMParser 独立文档，脚本不执行、资源不加载 */
  load(input: string): Element[] {
    const doc = new DOMParser().parseFromString(input, 'text/html')
    return Array.from(doc.querySelectorAll('table')).filter((t) => !!t.querySelector('tr'))
  }
  extract(tableEl: Element): TableData {
    return extractTableData(tableEl)
  }
}

export function detectSourceType(input: string): 'html' | 'json' {
  const t = input.trim()
  return t.startsWith('{') || t.startsWith('[') ? 'json' : 'html'
}

// ---------- 导出：CSV 转义 + BOM ----------
function csvEscape(v: unknown): string {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"'
}

/** 生成 CSV 文本（含"序号"列，字段自动转义） */
export function toCSV(data: TableData): string {
  const lines = [['序号', ...data.columns].map(csvEscape).join(',')]
  data.rows.forEach((r, i) => lines.push([i + 1, ...r].map(csvEscape).join(',')))
  return lines.join('\r\n')
}

/** 生成 JSON 数组（每行一个对象，列名为键） */
export function toJSON(data: TableData): Record<string, string>[] {
  return data.rows.map((r) => {
    const o: Record<string, string> = {}
    data.columns.forEach((c, i) => (o[c] = r[i] ?? ''))
    return o
  })
}

/**
 * 追加合并：列名完全一致直接拼接；同名不同序按列名对齐；否则拒绝。
 * 返回 { data, note }；结构不一致返回 null（不静默错列）。
 */
export function mergeData(
  a: TableData,
  b: TableData,
): { data: TableData; note: string } | null {
  if (a.columns.length === b.columns.length && a.columns.every((c, i) => c === b.columns[i])) {
    return {
      data: { source: a.source, columns: a.columns, rows: a.rows.concat(b.rows) },
      note: '追加成功：+' + b.rows.length + ' 行',
    }
  }
  if (a.columns.length === b.columns.length && b.columns.every((c) => a.columns.includes(c))) {
    const rows = b.rows.map((r) => a.columns.map((c) => r[b.columns.indexOf(c)] ?? ''))
    return {
      data: { source: a.source, columns: a.columns, rows: a.rows.concat(rows) },
      note: '列顺序不同，已按列名对齐追加',
    }
  }
  return null
}

// ---------- 示例数据（原版 3 个场景示例，原样保留） ----------
export interface ExampleDef {
  id: string
  title: string
  tag: string
  desc: string
  data: string
}

export const EXAMPLES: ExampleDef[] = [
  {
    id: 'order',
    title: '订单明细表',
    tag: '智能识别',
    desc: '带 data-field 字段，自动识别表头并跳过「操作」列',
    data: `<table>
  <tr>
    <td data-field="订单号">SO-20240815-001</td>
    <td data-field="客户名称">杭州云启科技</td>
    <td data-field="订单金额">12800.00</td>
    <td data-field="状态">已发货</td>
    <td class="operation">查看</td>
  </tr>
  <tr>
    <td data-field="订单号">SO-20240815-002</td>
    <td data-field="客户名称">深圳蓝湾贸易</td>
    <td data-field="订单金额">4650.50</td>
    <td data-field="状态">待付款</td>
    <td class="operation">查看</td>
  </tr>
  <tr>
    <td data-field="订单号">SO-20240815-003</td>
    <td data-field="客户名称">广州南粤实业</td>
    <td data-field="订单金额">89600.00</td>
    <td data-field="状态">已完成</td>
    <td class="operation">查看</td>
  </tr>
</table>`,
  },
  {
    id: 'report',
    title: '月度销售报表',
    tag: '基础解析',
    desc: '普通表头 + 数字列，数字列自动右对齐',
    data: `<table>
  <thead>
    <tr><th>月份</th><th>销售额</th><th>订单量</th><th>环比</th></tr>
  </thead>
  <tbody>
    <tr><td>1月</td><td>328000</td><td>1260</td><td>—</td></tr>
    <tr><td>2月</td><td>412500</td><td>1480</td><td>+25.8%</td></tr>
    <tr><td>3月</td><td>396200</td><td>1395</td><td>-4.0%</td></tr>
    <tr><td>4月</td><td>485300</td><td>1732</td><td>+22.5%</td></tr>
  </tbody>
</table>`,
  },
  {
    id: 'bi',
    title: 'BI 项目看板',
    tag: '过滤列',
    desc: '含复选框列与隐藏列，自动跳过非数据列',
    data: `<table>
  <thead>
    <tr>
      <th class="checkbox">选择</th>
      <th>地区</th>
      <th>负责人</th>
      <th>项目数</th>
      <th style="display:none">内部ID</th>
      <th>完成率</th>
    </tr>
  </thead>
  <tbody>
    <tr><td class="checkbox"><input type="checkbox"/></td><td>华东</td><td>张伟</td><td>12</td><td>h01</td><td>85%</td></tr>
    <tr><td class="checkbox"><input type="checkbox"/></td><td>华南</td><td>李娜</td><td>9</td><td>h02</td><td>92%</td></tr>
    <tr><td class="checkbox"><input type="checkbox"/></td><td>华北</td><td>王强</td><td>15</td><td>h03</td><td>78%</td></tr>
    <tr><td class="checkbox"><input type="checkbox"/></td><td>西南</td><td>赵敏</td><td>7</td><td>h04</td><td>88%</td></tr>
  </tbody>
</table>`,
  },
]
