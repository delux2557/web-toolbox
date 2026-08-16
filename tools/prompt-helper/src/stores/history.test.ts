// ============================================================
// 历史存档 store 单元测试
// ------------------------------------------------------------
// 重点验证"会话模型 + upsert"语义：
//   addEntry    → 每次都新建（新 id）
//   updateEntry → 更新同一条（id 不变，内容替换，updatedAt 刷新）
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useHistoryStore } from './history'
import type { WorkflowDraft } from '@/types/workflow'

// node 测试环境没有 localStorage，这里用一个内存版模拟
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
})

const emptyDraft = (workflowId: string): WorkflowDraft => ({
  workflowId,
  stepDrafts: {},
})

const draftWith = (workflowId: string, issue: string): WorkflowDraft => ({
  workflowId,
  stepDrafts: {
    'desc-step': { skipped: false, fields: { 'issue-desc': issue }, tempFields: [] },
  },
})

beforeEach(() => {
  mem.clear()
  setActivePinia(createPinia())
})

describe('addEntry 新建', () => {
  it('每次保存生成不同的 id，且新的在前', () => {
    const history = useHistoryStore()
    const a = history.addEntry('第一条', 'wf1', '看板排查', emptyDraft('wf1'))
    const b = history.addEntry('第二条', 'wf1', '看板排查', emptyDraft('wf1'))
    expect(a.id).not.toBe(b.id)
    expect(history.entries[0]!.id).toBe(b.id) // 新的在前
    expect(history.entries).toHaveLength(2)
  })
})

describe('updateEntry 更新（upsert 核心）', () => {
  it('保持原 id 和名称，替换内容并刷新 updatedAt', () => {
    const history = useHistoryStore()
    const created = history.addEntry('排查记录', 'wf1', '看板排查', draftWith('wf1', 'GMV 差 30 万'))
    const createdAt = created.createdAt

    const ok = history.updateEntry(created.id, draftWith('wf1', 'GMV 差 50 万（更新后）'))
    expect(ok).toBe(true)

    const updated = history.getById(created.id)!
    expect(updated.id).toBe(created.id) // 同一个 id
    expect(updated.name).toBe('排查记录') // 名称保留
    expect(updated.draft.stepDrafts['desc-step']!.fields['issue-desc']).toBe('GMV 差 50 万（更新后）')
    expect(updated.createdAt).toBe(createdAt) // 创建时间不变
    expect(updated.updatedAt).toBeGreaterThanOrEqual(createdAt) // 更新时间刷新
    expect(history.entries).toHaveLength(1) // 关键：没有新增记录
  })

  it('id 不存在时返回 false，且不产生新记录', () => {
    const history = useHistoryStore()
    const ok = history.updateEntry('不存在的id', emptyDraft('wf1'))
    expect(ok).toBe(false)
    expect(history.entries).toHaveLength(0)
  })

  it('更新后不影响其他记录', () => {
    const history = useHistoryStore()
    const keep = history.addEntry('保留这条', 'wf1', '看板排查', draftWith('wf1', 'A'))
    const edit = history.addEntry('要编辑这条', 'wf1', '看板排查', draftWith('wf1', 'B'))

    history.updateEntry(edit.id, draftWith('wf1', 'B 改'))
    expect(history.getById(keep.id)!.draft.stepDrafts['desc-step']!.fields['issue-desc']).toBe('A')
    expect(history.getById(edit.id)!.draft.stepDrafts['desc-step']!.fields['issue-desc']).toBe('B 改')
  })
})
