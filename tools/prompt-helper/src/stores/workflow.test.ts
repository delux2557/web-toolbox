// ============================================================
// 工作流 store · 会话模型链路单元测试
// ------------------------------------------------------------
// 覆盖 v1.2.0 的核心承诺（用户心智模型）：
//   "从历史打开 → 编辑 → 保存 = 更新那条，而不是新建"
// 具体验证：
//   1. applyHistoryEntry 载入后绑定 activeHistoryId
//   2. 有绑定时 saveToHistory 走"更新"分支（条数不变、内容更新）
//   3. 无绑定时 saveToHistory 走"新建"分支
//   4. resetDraft 解除绑定
//   5. 绑定指向已删除记录 → 回退新建并解除绑定
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkflowStore } from './workflow'
import { useHistoryStore } from './history'
import type { WorkflowDraft } from '@/types/workflow'
// node 测试环境没有 localStorage，用内存版模拟
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
})

const WORKFLOW_ID = 'dashboard-troubleshoot'

function makeDraft(issue: string): WorkflowDraft {
  return {
    workflowId: WORKFLOW_ID,
    stepDrafts: {
      'desc-step': { skipped: false, fields: { 'issue-desc': issue }, tempFields: [] },
    },
  }
}

beforeEach(() => {
  mem.clear()
  setActivePinia(createPinia())
})

describe('会话模型：载入 → 编辑 → 保存 = 更新', () => {
  it('applyHistoryEntry 载入后绑定 activeHistoryId', () => {
    const workflow = useWorkflowStore()
    const history = useHistoryStore()
    history.addEntry('h1', WORKFLOW_ID, '看板数据问题排查', makeDraft('V1'))

    const entry = history.entries[0]!
    workflow.applyHistoryEntry(entry)
    expect(workflow.activeHistoryId).toBe(entry.id)
    // 内容已载入草稿
    expect(workflow.draft.stepDrafts['desc-step']!.fields['issue-desc']).toBe('V1')
  })

  it('有绑定时保存 → 更新那条（条数不变、内容替换）', () => {
    const workflow = useWorkflowStore()
    const history = useHistoryStore()
    history.addEntry('h1', WORKFLOW_ID, '看板数据问题排查', makeDraft('V1'))
    workflow.applyHistoryEntry(history.entries[0]!)
    const before = history.entries.length

    // 编辑草稿 → 保存
    workflow.setFieldValue('desc-step', 'issue-desc', 'V2：更新后')
    const result = workflow.saveToHistory()

    expect(result).toBe('updated')
    expect(history.entries.length).toBe(before) // 关键：没有新增
    expect(history.entries[0]!.draft.stepDrafts['desc-step']!.fields['issue-desc']).toBe(
      'V2：更新后',
    )
  })

  it('无绑定时保存 → 新建一条（快照心智），且不自动绑定', () => {
    const workflow = useWorkflowStore()
    const history = useHistoryStore()
    workflow.setFieldValue('desc-step', 'issue-desc', '全新草稿内容')

    const result = workflow.saveToHistory()

    expect(result).toBe('created')
    expect(history.entries).toHaveLength(1)
    expect(workflow.activeHistoryId).toBeNull() // 新建后不绑定
  })

  it('resetDraft 清空草稿并解除绑定', () => {
    const workflow = useWorkflowStore()
    const history = useHistoryStore()
    history.addEntry('h1', WORKFLOW_ID, '看板数据问题排查', makeDraft('V1'))
    workflow.applyHistoryEntry(history.entries[0]!)
    expect(workflow.activeHistoryId).toBeTruthy()

    workflow.resetDraft()
    expect(workflow.activeHistoryId).toBeNull()
    expect(workflow.draft.stepDrafts['desc-step']!.fields['issue-desc']).toBeUndefined()
  })

  it('绑定指向已删除记录 → 回退新建并解除绑定（不报错）', () => {
    const workflow = useWorkflowStore()
    const history = useHistoryStore()
    history.addEntry('h1', WORKFLOW_ID, '看板数据问题排查', makeDraft('V1'))
    workflow.applyHistoryEntry(history.entries[0]!)

    history.removeEntries([history.entries[0]!.id]) // 历史被删
    const result = workflow.saveToHistory()

    expect(result).toBe('created') // 回退为新建
    expect(workflow.activeHistoryId).toBeNull()
    expect(history.entries).toHaveLength(1) // 新建的那条
  })
})
