// ============================================================
// 历史存档（Pinia Store）
// ------------------------------------------------------------
// 对应产品里的"历史记录"：像 AI 聊天记录一样，
// 每一条都是用户主动"保存历史"留下的快照，可回看、载入、重命名、删除。
// 与草稿的区别：草稿只有一份（实时自动保存），历史可有很多条。
// ============================================================
import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { HistoryEntry, WorkflowDraft } from '@/types/workflow'
import {
  load,
  save,
  SCHEMA_VERSION,
  STORAGE_KEYS,
} from '@/composables/usePersistence'
import { genId } from '@/utils/format'

/** 深拷贝草稿（草稿是纯 JSON 数据，用 JSON 方法即可） */
function cloneDraft(draft: WorkflowDraft): WorkflowDraft {
  return JSON.parse(JSON.stringify(draft)) as WorkflowDraft
}

/**
 * 从 localStorage 读取历史并净化：过滤缺关键字段的损坏条目，
 * 防止旧版本数据（或手动改坏的 localStorage）拖垮列表。
 * 同时记录当前 schema 版本，供未来数据迁移判断。
 */
function loadEntries(): HistoryEntry[] {
  const list = load<HistoryEntry[]>(STORAGE_KEYS.history, [])
  if (!Array.isArray(list)) return []
  const clean = list.filter(
    (e) =>
      e &&
      typeof e.id === 'string' &&
      typeof e.workflowId === 'string' &&
      typeof e.name === 'string' &&
      typeof e.draft === 'object',
  )
  if (clean.length !== list.length) {
    save(STORAGE_KEYS.history, clean)
  }
  save(STORAGE_KEYS.schemaVersion, SCHEMA_VERSION)
  return clean
}

export const useHistoryStore = defineStore('history', () => {
  /** 历史列表（新的在前） */
  const entries = ref<HistoryEntry[]>(loadEntries())

  // 任何改动自动持久化
  watch(entries, (list) => save(STORAGE_KEYS.history, list), { deep: true })

  /** 保存一条历史（返回新条目） */
  function addEntry(name: string, workflowId: string, workflowName: string, draft: WorkflowDraft): HistoryEntry {
    const now = Date.now()
    const entry: HistoryEntry = {
      id: genId(),
      name: name || `${workflowName} · ${formatMonthDay(now)}`,
      workflowId,
      workflowName,
      draft: cloneDraft(draft),
      createdAt: now,
      updatedAt: now,
    }
    entries.value.unshift(entry)
    return entry
  }

  /**
   * 更新一条历史的内容（"会话模型"的保存语义）：
   * 保持原 id 与名称不变，只替换草稿快照、刷新 updatedAt。
   * 返回是否更新成功（id 不存在时返回 false）。
   */
  function updateEntry(id: string, draft: WorkflowDraft): boolean {
    const entry = entries.value.find((e) => e.id === id)
    if (!entry) return false
    entry.draft = cloneDraft(draft)
    entry.updatedAt = Date.now()
    return true
  }

  /** 删除一条（可批量：传入 id 数组） */
  function removeEntries(ids: string[]) {
    const set = new Set(ids)
    entries.value = entries.value.filter((e) => !set.has(e.id))
  }

  /** 重命名 */
  function renameEntry(id: string, newName: string) {
    const entry = entries.value.find((e) => e.id === id)
    if (entry && newName.trim()) {
      entry.name = newName.trim()
      entry.updatedAt = Date.now()
    }
  }

  /** 按 id 查找 */
  function getById(id: string): HistoryEntry | undefined {
    return entries.value.find((e) => e.id === id)
  }

  return { entries, addEntry, updateEntry, removeEntries, renameEntry, getById }
})

function formatMonthDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
