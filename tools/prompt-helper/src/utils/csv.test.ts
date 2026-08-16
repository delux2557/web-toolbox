// ============================================================
// CSV / JSON 解析工具单元测试
// ============================================================
import { describe, expect, it } from 'vitest'
import { detectTabular, parseTabular } from './csv'

describe('detectTabular 格式检测', () => {
  it('多行含逗号 → CSV', () => {
    expect(detectTabular('a,b\n1,2')).toBe('csv')
  })

  it('对象数组 JSON → json', () => {
    expect(detectTabular('[{"a":1},{"a":2}]')).toBe('json')
  })

  it('普通文本 → null', () => {
    expect(detectTabular('这是一段普通文字')).toBe(null)
    expect(detectTabular('')).toBe(null)
  })

  it('只有一行（无表头）→ null', () => {
    expect(detectTabular('a,b')).toBe(null)
  })

  it('非法 JSON（以 [ 开头但解析失败）→ 不会误判', () => {
    expect(detectTabular('[1,2')).toBe(null)
  })
})

describe('parseTabular CSV 解析', () => {
  it('解析表头 + 数据行 + 总行数', () => {
    const t = parseTabular('date,gmv,channel\n2026-08-15,1200000,小程序\n2026-08-14,1320000,小程序')
    expect(t).not.toBeNull()
    expect(t!.header).toEqual(['date', 'gmv', 'channel'])
    expect(t!.rows).toHaveLength(2)
    expect(t!.totalRows).toBe(2)
    expect(t!.format).toBe('csv')
  })

  it('支持双引号包裹含逗号的字段', () => {
    const t = parseTabular('name,note\n"老王,数据工程师",hello')
    expect(t!.rows[0]).toEqual(['老王,数据工程师', 'hello'])
  })

  it('超过 maxRows 时只截断前 N 行，但 totalRows 给总数', () => {
    const csv = 'a,b\n' + Array.from({ length: 100 }, (_, i) => `${i},${i}`).join('\n')
    const t = parseTabular(csv, 50)
    expect(t!.rows).toHaveLength(50)
    expect(t!.totalRows).toBe(100)
  })
})

describe('parseTabular JSON 解析', () => {
  it('对象数组：合并所有键为表头', () => {
    const t = parseTabular('[{"a":1,"b":2},{"a":3,"b":4}]')
    expect(t!.header).toEqual(['a', 'b'])
    expect(t!.rows[0]).toEqual(['1', '2'])
    expect(t!.format).toBe('json')
  })

  it('嵌套数组：原样转字符串', () => {
    const t = parseTabular('[[1,2],[3,4]]')
    expect(t!.rows[0]).toEqual(['3', '4'])
  })

  it('空数组 → null', () => {
    expect(parseTabular('[]')).toBeNull()
  })
})
