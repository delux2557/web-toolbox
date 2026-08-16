// ============================================================
// 插件通信总线单元测试
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePluginBus } from './pluginBus'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('pluginBus 事件总线', () => {
  it('emit 同步派发给所有订阅者（含 payload）', () => {
    const bus = usePluginBus()
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    bus.on('output:ready', fn1)
    bus.on('output:ready', fn2)
    bus.emit('output:ready', { pluginId: 'url-decoder', text: '结果' })
    expect(fn1).toHaveBeenCalledWith({ pluginId: 'url-decoder', text: '结果' })
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('on 返回的取消函数可退订', () => {
    const bus = usePluginBus()
    const fn = vi.fn()
    const off = bus.on('history:changed', fn)
    off()
    bus.emit('history:changed', { historyId: 'h1' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('off 退订指定处理器，不影响其他处理器', () => {
    const bus = usePluginBus()
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    bus.on('output:ready', fn1)
    bus.on('output:ready', fn2)
    bus.off('output:ready', fn1)
    bus.emit('output:ready', { pluginId: 'a', text: 'x' })
    expect(fn1).not.toHaveBeenCalled()
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('无订阅者时 emit 不报错（幂等）', () => {
    const bus = usePluginBus()
    expect(() =>
      bus.emit('output:ready', { pluginId: 'a', text: 'x' }),
    ).not.toThrow()
  })
})
