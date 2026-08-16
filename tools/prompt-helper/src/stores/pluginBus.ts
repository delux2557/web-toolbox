// ============================================================
// 插件通信总线（PluginBus Store）
// ------------------------------------------------------------
// 插件之间"松耦合通信"的唯一通道：类型化事件（发布/订阅）。
// 规则（见 ARCHITECTURE.md）：插件间只通过本总线或共享 Store
// 的公开 action 通信，禁止 import 对方组件内部对象。
//
// 新增事件类型 → 在 BusEvents 接口加一行（类型安全，写错自动报错）
// ============================================================
import { defineStore } from 'pinia'

/** 平台级事件表（新增事件在这里声明，payload 类型随之约束） */
export interface BusEvents {
  /** 某插件产出结果（如工作流编译完成 / 工具处理完成） */
  'output:ready': { pluginId: string; text: string }
  /** 历史记录发生变化 */
  'history:changed': { historyId: string }
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

export const usePluginBus = defineStore('pluginBus', () => {
  const listeners = new Map<keyof BusEvents, Set<Handler<keyof BusEvents>>>()

  /** 订阅事件，返回取消订阅函数（组件卸载时调用，防止内存泄漏） */
  function on<K extends keyof BusEvents>(ev: K, fn: Handler<K>): () => void {
    let set = listeners.get(ev)
    if (!set) {
      set = new Set()
      listeners.set(ev, set)
    }
    set.add(fn as Handler<keyof BusEvents>)
    return () => {
      set!.delete(fn as Handler<keyof BusEvents>)
    }
  }

  /** 取消订阅 */
  function off<K extends keyof BusEvents>(ev: K, fn: Handler<K>): void {
    listeners.get(ev)?.delete(fn as Handler<keyof BusEvents>)
  }

  /** 发布事件（同步派发给所有订阅者） */
  function emit<K extends keyof BusEvents>(ev: K, payload: BusEvents[K]): void {
    listeners.get(ev)?.forEach((fn) => (fn as Handler<K>)(payload))
  }

  return { on, off, emit }
})
