// ============================================================
// 工作流状态（Pinia Store）
// ------------------------------------------------------------
// 管三件事：
//   1. 当前选中的工作流
//   2. 当前草稿（用户在每一步填的内容，自动保存）
//   3. 用户偏好（隐藏步骤/字段、改样板句）
//
// 📖 学习提示：Pinia 是 Vue 官方状态管理库。"setup store"写法
// 就是写一个返回 ref/computed/函数的函数，用 defineStore 包起来。
// 任何组件里 useWorkflowStore() 拿到的都是同一份状态。
// ============================================================
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { getWorkflowById, workflowRegistry } from '@/configs'
import type {
  FieldValue,
  HistoryEntry,
  StepDraft,
  WorkflowDef,
  WorkflowDraft,
  WorkflowPrefs,
} from '@/types/workflow'
import { load, save, STORAGE_KEYS } from '@/composables/usePersistence'
import { genId } from '@/utils/format'
import { useHistoryStore } from './history'

/** 空偏好（首次使用） */
const EMPTY_PREFS: WorkflowPrefs = {
  hiddenRecipeIds: [],
  hiddenFieldIds: [],
  fieldOrder: {},
  customDefaults: {},
}

/** 根据工作流定义生成一个全空的草稿（每个步骤都有一格，等待填写） */
function createEmptyDraft(workflowId: string): WorkflowDraft {
  const wf = getWorkflowById(workflowId)
  const stepDrafts: Record<string, StepDraft> = {}
  for (const recipe of wf?.recipes ?? []) {
    stepDrafts[recipe.id] = { skipped: false, fields: {}, tempFields: [] }
  }
  return { workflowId, stepDrafts }
}

export const useWorkflowStore = defineStore('workflow', () => {
  // ---------- 状态 ----------
  /** 当前工作流的 id（默认第一个） */
  const currentWorkflowId = ref<string>(workflowRegistry[0]!.id)
  /** 当前草稿：从 localStorage 恢复，没有就新建空草稿 */
  const draft = ref<WorkflowDraft>(
    load(STORAGE_KEYS.draft(currentWorkflowId.value), createEmptyDraft(currentWorkflowId.value)),
  )
  /** 用户偏好：从 localStorage 恢复 */
  const prefs = ref<WorkflowPrefs>(load(STORAGE_KEYS.prefs, EMPTY_PREFS))
  /**
   * 当前草稿绑定的是哪条历史（"会话模型"的核心状态）。
   * 有值：草稿是从这条历史打开的，点"保存历史"= 更新这条；
   * 无值：草稿是全新的，点"保存历史"= 新建一条。
   * 持久化到 localStorage，刷新页面后绑定不丢失。
   */
  const activeHistoryId = ref<string | null>(load<string | null>(STORAGE_KEYS.activeHistory, null))
  watch(activeHistoryId, (v) => save(STORAGE_KEYS.activeHistory, v))

  // ---------- 自动持久化 ----------
  // 草稿：每次改动（deep 监听所有嵌套变化）都存到 ph:draft:{workflowId}
  watch(draft, (d) => save(STORAGE_KEYS.draft(d.workflowId), d), { deep: true })
  // 偏好：存到 ph:prefs
  watch(prefs, (p) => save(STORAGE_KEYS.prefs, p), { deep: true })

  // ---------- 派生状态（computed） ----------
  /** 当前工作流定义 */
  const currentWorkflow = computed<WorkflowDef | undefined>(() =>
    getWorkflowById(currentWorkflowId.value),
  )
  /** 过滤掉用户隐藏步骤后的"有效步骤"列表（页面按它渲染） */
  const activeRecipes = computed(() => {
    const wf = currentWorkflow.value
    if (!wf) return []
    return wf.recipes.filter((r) => !prefs.value.hiddenRecipeIds.includes(r.id))
  })
  /** 完成度：已填步骤 / 总步骤（跳过也算完成） */
  const progress = computed(() => {
    let total = 0
    let filled = 0
    for (const recipe of activeRecipes.value) {
      total++
      const sd = draft.value.stepDrafts[recipe.id]
      if (sd?.skipped) {
        filled++
        continue
      }
      const hasInput =
        recipe.fields.some((f) => {
          const v = sd?.fields[f.id]
          return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
        }) || (sd?.tempFields.length ?? 0) > 0
      if (hasInput) filled++
    }
    return { filled, total }
  })

  // ---------- 草稿操作 ----------
  /** 切换工作流：自动把当前草稿存好（watch 已兜底），再载入目标工作流的草稿 */
  function selectWorkflow(id: string) {
    if (id === currentWorkflowId.value) return
    currentWorkflowId.value = id
    draft.value = load(STORAGE_KEYS.draft(id), createEmptyDraft(id))
    // 历史条目属于特定工作流，切走后解除绑定（防止误更新别的记录）
    activeHistoryId.value = null
  }

  /** 写入某个字段的值（所有输入组件都走这里，自动保存） */
  function setFieldValue(recipeId: string, fieldId: string, value: FieldValue) {
    const sd = draft.value.stepDrafts[recipeId]
    if (!sd) return
    sd.fields[fieldId] = value
  }

  /** 切换某一步的"跳过"状态 */
  function toggleSkip(recipeId: string) {
    const sd = draft.value.stepDrafts[recipeId]
    if (!sd) return
    sd.skipped = !sd.skipped
  }

  /** 在当前步骤临时插入一个自定义字段（仅本次会话，存入草稿） */
  function addTempField(recipeId: string, label: string) {
    const sd = draft.value.stepDrafts[recipeId]
    if (!sd) return
    sd.tempFields.push({ id: genId(), label: label || '新字段', type: 'textarea', value: '' })
  }

  /** 删除临时字段 */
  function removeTempField(recipeId: string, tempId: string) {
    const sd = draft.value.stepDrafts[recipeId]
    if (!sd) return
    sd.tempFields = sd.tempFields.filter((t) => t.id !== tempId)
  }

  /** 清空当前草稿（回到初始状态，解除历史绑定） */
  function resetDraft() {
    draft.value = createEmptyDraft(currentWorkflowId.value)
    activeHistoryId.value = null
  }

  // ---------- 用户偏好操作 ----------
  /** 隐藏 / 取消隐藏整个步骤 */
  function toggleHiddenRecipe(recipeId: string) {
    const list = prefs.value.hiddenRecipeIds
    prefs.value.hiddenRecipeIds = list.includes(recipeId)
      ? list.filter((id) => id !== recipeId)
      : [...list, recipeId]
  }

  /** 隐藏 / 取消隐藏单个字段 */
  function toggleHiddenField(recipeId: string, fieldId: string) {
    const key = `${recipeId}.${fieldId}`
    const list = prefs.value.hiddenFieldIds
    prefs.value.hiddenFieldIds = list.includes(key)
      ? list.filter((k) => k !== key)
      : [...list, key]
  }

  /** 把某字段的默认样板句改成用户自己的版本（下次编译优先用这个） */
  function setCustomDefault(recipeId: string, fieldId: string, text: string) {
    prefs.value.customDefaults[`${recipeId}.${fieldId}`] = text
  }

  // ---------- 历史相关 ----------
  /**
   * 载入一条历史存档（"打开一个会话"）：
   * 1. 如果当前草稿有内容且不是正在编辑同一条 → 自动备份成一条新历史（永远有后悔药）
   * 2. 切换到存档所属的工作流
   * 3. 用存档内容覆盖当前草稿，并把草稿绑定到这条历史（activeHistoryId）
   */
  function applyHistoryEntry(entry: HistoryEntry) {
    const history = useHistoryStore()
    const hasContent = Object.values(draft.value.stepDrafts).some(
      (sd) => Object.keys(sd.fields).length > 0 || sd.tempFields.length > 0,
    )
    // 正在编辑的就是这条历史时，不需要备份自己
    if (hasContent && activeHistoryId.value !== entry.id) {
      history.addEntry(
        `自动备份 · ${formatNow()}`,
        draft.value.workflowId,
        currentWorkflow.value?.name ?? '未知工作流',
        draft.value,
      )
    }
    // 先切工作流（保证 draft key 正确），再覆盖内容
    if (currentWorkflowId.value !== entry.workflowId) {
      selectWorkflow(entry.workflowId)
    }
    draft.value = JSON.parse(JSON.stringify(entry.draft)) as WorkflowDraft
    // 绑定：之后点"保存历史"会更新这条，而不是新建
    activeHistoryId.value = entry.id
  }

  /**
   * 保存历史（"会话模型 + upsert"）：
   * - 草稿正绑定某条历史（从历史打开过）→ 更新那一条（保持 id/名称）
   * - 否则 → 新建一条（新建后不自动绑定，保持"每次保存=新版本"的快照心智）
   * 返回本次是更新还是新建，供界面提示。
   */
  function saveToHistory(): 'updated' | 'created' {
    const history = useHistoryStore()
    const wf = currentWorkflow.value
    if (!wf) return 'created'
    if (activeHistoryId.value) {
      const ok = history.updateEntry(activeHistoryId.value, draft.value)
      if (ok) return 'updated'
      // 绑定指向的历史已被删除 → 回退为新建，并解除绑定
      activeHistoryId.value = null
    }
    history.addEntry('', wf.id, wf.name, draft.value)
    return 'created'
  }

  return {
    currentWorkflowId,
    draft,
    prefs,
    activeHistoryId,
    currentWorkflow,
    activeRecipes,
    progress,
    selectWorkflow,
    setFieldValue,
    toggleSkip,
    addTempField,
    removeTempField,
    resetDraft,
    toggleHiddenRecipe,
    toggleHiddenField,
    setCustomDefault,
    applyHistoryEntry,
    saveToHistory,
  }
})

/** 备份命名用：当前时间字符串 */
function formatNow(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
