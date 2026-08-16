// ============================================================
// localStorage 持久化封装
// ------------------------------------------------------------
// 为什么单独封装一层？
//   1. 统一管理所有存储 key（前缀 ph: 防止和其他应用冲突）
//   2. 统一处理 JSON 序列化 / 解析失败兜底
//   3. 未来想换成 IndexedDB，只需改这一个文件，业务代码不动
//
// 📖 学习提示：组合式函数（composable）是 Vue 3 复用逻辑的方式，
// 名字以 use 开头，内部可以用 ref/computed/watch 等。
// ============================================================
import { watch, type Ref } from 'vue'

/** 所有存储 key 的唯一来源（避免各处写魔法字符串） */
export const STORAGE_KEYS = {
  /** 主题：light / dark */
  theme: 'ph:theme',
  /** 用户偏好（隐藏字段/改样板句等），见 types/workflow.ts 的 WorkflowPrefs */
  prefs: 'ph:prefs',
  /** 工作流草稿前缀：ph:draft:{workflowId}，每个工作流一份 */
  draft: (workflowId: string) => `ph:draft:${workflowId}`,
  /** 历史存档列表 */
  history: 'ph:history',
} as const

/** 读取并反序列化（解析失败返回兜底值，避免一个坏数据搞崩整个应用） */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** 序列化并写入 */
export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    // localStorage 有 5MB 上限，写入失败时静默降级（数据不丢，只是不持久化）
    console.warn(`[persistence] 保存失败（可能超出容量）: ${key}`, err)
  }
}

/** 删除 */
export function remove(key: string): void {
  localStorage.removeItem(key)
}

/**
 * 把一个响应式状态自动同步到 localStorage。
 * @param key     存储键
 * @param source  要持久化的响应式引用（ref / reactive）
 * @param toJson  可选：把 source 转成可序列化的结构（默认直接存 source.value）
 */
export function persist<T>(key: string, source: Ref<T>, toJson?: (value: T) => unknown): void {
  watch(
    source,
    (value) => save(key, toJson ? toJson(value) : value),
    { deep: true },
  )
}
