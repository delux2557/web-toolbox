// ============================================================
// 表格解析纯函数单元测试
// ------------------------------------------------------------
// 覆盖原版工具最核心的解析逻辑：表头识别（thead / th 首行 /
// data-field 智能兜底）、隐藏列与功能列跳过、追加合并防错列、
// CSV 转义、JSON 序列化。
// 需要 DOM（DOMParser）→ 本文件使用 happy-dom 环境。
// ============================================================
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  EXAMPLES,
  detectSourceType,
  extractTableData,
  mergeData,
  toCSV,
  toJSON,
  type TableData,
} from './tableExtract'

/** 解析 HTML 字符串 → 表格元素（直接复用 HtmlTableAdapter 的安全解析） */
function firstTable(html: string): Element {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) throw new Error('测试 HTML 中没有 <table>')
  return table
}

describe('extractTableData 表头识别', () => {
  it('标准 thead + tbody 结构', () => {
    const table = firstTable(`<table>
      <thead><tr><th>月份</th><th>销售额</th></tr></thead>
      <tbody>
        <tr><td>1月</td><td>328000</td></tr>
        <tr><td>2月</td><td>412500</td></tr>
      </tbody>
    </table>`)
    const data = extractTableData(table)
    expect(data.columns).toEqual(['月份', '销售额'])
    expect(data.rows).toHaveLength(2)
    expect(data.rows[0]).toEqual(['1月', '328000'])
  })

  it('无 thead 但首行含 <th>：首行作表头', () => {
    const table = firstTable(`<table>
      <tr><th>A</th><th>B</th></tr>
      <tr><td>1</td><td>2</td></tr>
      <tr><td>3</td><td>4</td></tr>
    </table>`)
    const data = extractTableData(table)
    expect(data.columns).toEqual(['A', 'B'])
    expect(data.rows).toHaveLength(2)
  })

  it('data-field 智能识别：字段名作列名，跳过 operation 列', () => {
    const table = firstTable(`<table>
      <tr><td data-field="订单号">SO-001</td><td data-field="金额">100</td><td class="operation">查看</td></tr>
      <tr><td data-field="订单号">SO-002</td><td data-field="金额">200</td><td class="operation">查看</td></tr>
    </table>`)
    const data = extractTableData(table)
    expect(data.columns).toEqual(['订单号', '金额'])
    expect(data.rows).toHaveLength(2)
    expect(data.rows[0]).toEqual(['SO-001', '100'])
  })

  it('跳过隐藏列（display:none）与复选框功能列', () => {
    const table = firstTable(`<table>
      <thead><tr>
        <th class="checkbox">选择</th><th>地区</th><th style="display:none">内部ID</th><th>完成率</th>
      </tr></thead>
      <tbody>
        <tr><td class="checkbox"><input type="checkbox"/></td><td>华东</td><td>h01</td><td>85%</td></tr>
      </tbody>
    </table>`)
    const data = extractTableData(table)
    expect(data.columns).toEqual(['地区', '完成率'])
    expect(data.rows[0]).toEqual(['华东', '85%'])
  })

  it('首行全是纯数字：全部视为数据，列名回退为"列N"', () => {
    const table = firstTable(`<table>
      <tr><td>1</td><td>2</td></tr>
      <tr><td>3</td><td>4</td></tr>
    </table>`)
    const data = extractTableData(table)
    expect(data.columns).toEqual(['列1', '列2'])
    expect(data.rows).toHaveLength(2)
  })

  it('过滤全空行与隐藏行', () => {
    const table = firstTable(`<table>
      <tr><th>X</th></tr>
      <tr><td>有值</td></tr>
      <tr><td>  </td></tr>
      <tr hidden><td>隐藏行</td></tr>
    </table>`)
    const data = extractTableData(table)
    expect(data.rows).toEqual([['有值']])
  })
})

describe('toCSV / toJSON', () => {
  const data: TableData = { source: 'html', columns: ['名称', '备注'], rows: [['表格,工具', '含"引号"']] }

  it('CSV：序号列 + 字段转义（所有值统一双引号包裹，含引号翻倍）', () => {
    const csv = toCSV(data)
    expect(csv).toContain('"序号","名称","备注"')
    expect(csv).toContain('"1","表格,工具","含""引号"""')
  })

  it('JSON：每行一个对象，列名为键', () => {
    const json = toJSON(data)
    expect(json).toEqual([{ 名称: '表格,工具', 备注: '含"引号"' }])
  })
})

describe('mergeData 追加合并', () => {
  const a: TableData = { source: 'html', columns: ['A', 'B'], rows: [['1', '2']] }

  it('列名完全一致：直接拼接', () => {
    const b: TableData = { source: 'html', columns: ['A', 'B'], rows: [['3', '4']] }
    const result = mergeData(a, b)
    expect(result).not.toBeNull()
    expect(result!.data.rows).toEqual([['1', '2'], ['3', '4']])
    expect(result!.note).toContain('追加成功')
  })

  it('同名不同序：按列名对齐', () => {
    const b: TableData = { source: 'html', columns: ['B', 'A'], rows: [['4', '3']] }
    const result = mergeData(a, b)
    expect(result!.data.rows[1]).toEqual(['3', '4']) // 对齐回 A,B 顺序
  })

  it('列结构不一致：拒绝合并（不静默错列）', () => {
    const b: TableData = { source: 'html', columns: ['A', 'C'], rows: [['3', '4']] }
    expect(mergeData(a, b)).toBeNull()
  })
})

describe('detectSourceType 与示例数据', () => {
  it('HTML 与 JSON 开头判断', () => {
    expect(detectSourceType('<table></table>')).toBe('html')
    expect(detectSourceType('[{"a":1}]')).toBe('json')
    expect(detectSourceType('{"a":1}')).toBe('json')
  })

  it('示例数据都是合法表格，能被解析出数据', () => {
    for (const ex of EXAMPLES) {
      const table = firstTable(ex.data)
      const data = extractTableData(table)
      expect(data.columns.length).toBeGreaterThan(0)
      expect(data.rows.length).toBeGreaterThan(0)
    }
  })
})
